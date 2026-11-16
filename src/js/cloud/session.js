//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- sign-in session and token refresh. Edit here, then run: python build.py
  // ── session ─────────────────────────────────────────────────────────────
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}
  const saveSession = s => {
    session = s ? { ...s, expires_at: Date.now() + (s.expires_in || 3600) * 1000 - 60000 } : null;
    session ? localStorage.setItem(SESSION_KEY, JSON.stringify(session)) : localStorage.removeItem(SESSION_KEY);
    paintAccount();
  };

  async function signIn(email, password) {
    const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || d.message || 'sign-in failed');
    saveSession(d);
    return d;
  }
  let authWanted = false;    // the session was refused while something else was on screen: the form shows with the list
  let refreshing = null;
  function refresh() {
    refreshing = refreshing || doRefresh().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function doRefresh() {
    if (!session?.refresh_token) return false;
    // the same time limit as api() — 45 s for the request and its small answer: a refresh that never answered held
    // every call waiting on it. Cut, it is a network failure like any other: the session is kept (only the server's
    // no ends it, below), and the callers get an error with no status, as when the connection drops.
    const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
    const limit = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) { /* gone already */ } }, 45000) : null;
    try {
      const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
        ...(ctl ? { signal: ctl.signal } : {})
      });
      // only a refused token ends the session (0.11.55): a 5xx or 429 is the server's trouble, not the worker's
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        saveSession(null);
        // said, and back to the sign-in form, as Naked Heart does: the list used to stay on screen with nothing sent and
        // not a word. Never over an open checklist or task page — there the form comes with the list (showWeek).
        try {
          showToast('Please sign in again — your work is kept on this phone', 'error');
          if (fbOnScreen() && !$('week').classList.contains('hidden')) show('auth', 'Sign in', null); else authWanted = true;
        } catch (e) { /* the app's next start shows the form anyway */ }
        return false;
      }
      if (!r.ok) throw new Error(`${r.status} the sign-in server is busy, try again`);
      saveSession(await r.json());
      return true;
    } catch (e) {
      if (ctl && ctl.signal.aborted && !/^\d{3} /.test(String((e && e.message) || ''))) throw new Error('no answer in time');
      throw e;
    } finally { clearTimeout(limit); }
  }
  // 0.11.118: Capture runs on the person's own session (edge function `capture`) — this is how it asks for it
  window.fbBearer = async () => {
    if (!session) return null;
    try { if (session.expires_at && Date.now() > session.expires_at - 30000) await refresh(); } catch (e) { /* tried */ }
    return session ? { token: session.access_token, apikey: ANON, base: URL_BASE } : null;
  };
  // Every call to Supabase goes through here: it refreshes an expired token once.
  async function api(path, opts = {}, retry = true) {
    if (!session) throw new Error('signed out');
    if (session.expires_at && Date.now() > session.expires_at) await refresh();
    // the refresh was refused and ended the session: said as "signed out", not as a script error on the next line
    if (!session) throw new Error('signed out');
    // a time limit: with signal bars and no throughput a request never answered, and the one flush and the one sync
    // waited on it for minutes — nothing else was sent meanwhile. 45 s for a small request (under 20 kB); 5 minutes
    // for a photo or a report that carries pictures, and longer for a bigger file — the time 2 kB a second needs — so
    // that a slow link still gets it through (a cut request starts again from nothing: with 45 s up to 100 kB and 4 kB a
    // second above, a scouting report on a weak greenhouse link was cut at every pass and never arrived). A caller that brings its own signal keeps it. The error carries no status, so it reads as a network failure
    // everywhere: the outbox row waits and is tried again, never set aside.
    const own = opts.signal || typeof AbortController === 'undefined' ? null : new AbortController();
    const isBlob = typeof Blob !== 'undefined' && opts.body instanceof Blob;
    const bytes = isBlob ? (opts.body.size || 0) : typeof opts.body === 'string' ? opts.body.length : 0;
    const bigBody = isBlob || bytes > 20000;
    const cut = () => { try { own.abort(); } catch (e) { /* gone already */ } };
    let limit = own ? setTimeout(cut, Math.max(bigBody ? 300000 : 45000, Math.round(bytes / 2))) : null;
    let r, said401 = '';
    try {
      r = await fetch(URL_BASE + path, {
        ...opts,
        ...(own ? { signal: own.signal } : {}),
        headers: { apikey: ANON, Authorization: 'Bearer ' + session.access_token,
                   'Content-Type': 'application/json', ...(opts.headers || {}) }
      });
      // the answer has begun, and its body is read under a limit of its own: the first one ended here, and a body
      // that stopped coming held the flush and the sync just the same. Thirty minutes, or the time 2 kB a second needs
      // when the answer says it is longer. Thirty and not ten: a compressed answer does not say its length, and the
      // first whole sync on a weak link must not be cut and start again from nothing. It is one limit for the whole
      // body, not one that starts again with every piece.
      if (own) { clearTimeout(limit); limit = setTimeout(cut, Math.max(1800000, Math.round((Number(r.headers.get('content-length')) || 0) / 2))); }
      if (r.status === 401 && retry) {
        // the token is tried again below. What the server said is a few words: five seconds for them, no more — read
        // under the body's long limit, a 401 that stopped coming held the retry, the flush and the sync with it
        if (own) { clearTimeout(limit); limit = setTimeout(cut, 5000); }
        try { said401 = await r.text(); } catch (e) { /* the status says enough */ }
      } else {
        if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
        return r.status === 204 ? null : await r.json();
      }
    } catch (e) {
      // cut by the limit: no status on it, so a network failure to everybody; an answer with a status stays what it is
      if (own && own.signal.aborted && !/^\d{3} /.test(String((e && e.message) || ''))) throw new Error('no answer in time');
      throw e;
    } finally { clearTimeout(limit); }
    if (await refresh()) return api(path, opts, false);
    throw new Error(`${r.status} ${said401.slice(0, 160)}`);
  }


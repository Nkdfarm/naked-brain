//! Naked Brain - the Cloudflare Worker address and the team password gate: global. Edit here, then run: python build.py
// ─── CLOUDFLARE PROXY + PASSWORD ─────────────────────────────
const PROXY = 'https://notion-proxy.francesco-955.workers.dev';

function getAppPassword()    { return localStorage.getItem('brainplus_pw') || ''; }
function setAppPassword(pw)  { localStorage.setItem('brainplus_pw', pw); }
function clearAppPassword()  { localStorage.removeItem('brainplus_pw'); }

function showPasswordGate() {
  const gate = document.getElementById('passwordGate');
  gate.classList.remove('hidden');
  setTimeout(() => document.getElementById('appPasswordInput')?.focus(), 50);
}
function hidePasswordGate() {
  document.getElementById('passwordGate').classList.add('hidden');
}
function togglePwVisibility() {
  const inp = document.getElementById('appPasswordInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function tryUnlockApp() {
  const pw  = document.getElementById('appPasswordInput').value;
  const err = document.getElementById('appPasswordError');
  const btn = document.getElementById('unlockBtn');
  if (!pw) return;
  btn.disabled = true; btn.textContent = 'Checking…';
  err.style.display = 'none';
  try {
    // 20 s at most (0.11.92): a fetch that hangs on iOS left "Checking…" for ever
    const ctl = new AbortController(), tid = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(PROXY + '/ping', {
      headers: { 'X-App-Password': pw }, signal: ctl.signal
    }).finally(() => clearTimeout(tid));
    if (res.ok) {
      setAppPassword(pw);
      hidePasswordGate();
      if (typeof ensureAuthor === 'function') ensureAuthor();
      if (window.sopOpen && document.body.classList.contains('mode-sop') && !document.body.classList.contains('src-cloud')) window.sopOpen();
    } else {
      err.textContent = 'Wrong password — try again.';
      err.style.display = 'block';
      document.getElementById('appPasswordInput').value = '';
      document.getElementById('appPasswordInput').focus();
    }
  } catch(e) {
    err.textContent = 'Connection error — check your network.';
    err.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Unlock';
  }
}

// Wrapper for all Cloudflare proxy calls — injects password, handles 401, adds timeout
// 0.11.118 — Capture behind the person's own sign-in. With a FarmBox session, Notion and Groq are reached through the
// platform (edge function `capture`, which holds the keys): no team password. Which way this phone goes is decided once
// (localStorage nb_capture_via): 'platform' when the platform's Notion key can see this phone's Capture database;
// 'worker:<time>' when it cannot, or the function is not there — then the Cloudflare Worker and its password as before,
// asked again after a day. A phone that is not signed in always uses the Worker.
let captureProbe = null;
async function captureDecide() {
  let who = null;
  try { who = typeof window.fbBearer === 'function' ? await window.fbBearer() : null; } catch (e) { who = null; }
  if (!who) return { via: 'worker', who: null };
  let kept = '';
  try { kept = localStorage.getItem('nb_capture_via') || ''; } catch (e) { kept = ''; }
  if (kept === 'platform') return { via: 'platform', who };
  if (kept.startsWith('worker:') && Date.now() - Number(kept.slice(7)) < 24 * 3600 * 1000) return { via: 'worker', who };
  captureProbe = captureProbe || (async () => {
    try {
      const ids = (typeof TAB_DB === 'object' ? Object.values(TAB_DB) : []).map(id => document.getElementById(id)?.value.trim()).filter(Boolean);
      const path = ids.length ? '/v1/databases/' + ids[0] : '/ping';
      const ctl = new AbortController(), tid = setTimeout(() => ctl.abort(), 15000);
      const res = await fetch(who.base + '/functions/v1/capture' + path, { signal: ctl.signal,
        headers: { Authorization: 'Bearer ' + who.token, apikey: who.apikey, 'Notion-Version': '2022-06-28' } }).finally(() => clearTimeout(tid));
      if (res.ok) { try { localStorage.setItem('nb_capture_via', 'platform'); } catch (e) {} return 'platform'; }
      // 401 with no X-Upstream is the session, not the route: nothing decided. Anything else: the Worker, for a day.
      if (res.status === 401 && !res.headers.get('X-Upstream')) return null;
      // a busy server (5xx) or a rate limit (429) says nothing about the route either: it used to send the phone to the
      // Worker and its team password for a day
      if (res.status >= 500 || res.status === 429) return null;
      try { localStorage.setItem('nb_capture_via', 'worker:' + Date.now()); } catch (e) {}
      return 'worker';
    } catch (e) { return null; }                       // no signal: decided at the next call
    finally { setTimeout(() => { captureProbe = null; }, 0); }
  })();
  const via = await captureProbe;
  return { via: via || 'worker', who, undecided: !via };
}
// Capture's tab is opened: the team password is asked only when this phone still goes through the Worker.
// Not while nothing is decided yet (a signed-in phone with no signal the first time Capture is opened): the gate
// covered the whole app, asked a password the workers no longer have, and Unlock needs the network.
async function captureGate() {
  const d = await captureDecide();
  if (d.via !== 'platform' && !d.undecided) ensureAppPassword();
}

async function cfFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const route = String(url).startsWith(PROXY) ? await captureDecide() : { via: 'worker', who: null };
  const viaPlatform = route.via === 'platform' && !!route.who;
  if (viaPlatform) {
    url = route.who.base + '/functions/v1/capture' + String(url).slice(PROXY.length);
    headers.set('Authorization', 'Bearer ' + route.who.token);
    headers.set('apikey', route.who.apikey);
  } else headers.set('X-App-Password', getAppPassword());
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 120000); // 2-min hard cap (iOS hangs otherwise)

  // Combine this wrapper's timeout with the caller's own signal. Spreading
  // `...options` and then setting `signal` overwrote anything passed in, so the
  // per-upload and per-chunk timeouts in uploadFileToNotion never actually
  // aborted anything — only this 2-min cap was ever in force.
  const outer = options.signal;
  let onOuterAbort = null;
  let signal = controller.signal;
  if (outer) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      signal = AbortSignal.any([outer, controller.signal]);   // Safari 17.4+
    } else if (outer.aborted) {
      controller.abort(outer.reason);                          // older iOS: forward
    } else {
      onOuterAbort = () => controller.abort(outer.reason);
      outer.addEventListener('abort', onOuterAbort, { once: true });
    }
  }

  try {
    const res = await fetch(url, { ...options, headers, signal });
    // a 401 from Notion or Groq themselves (a revoked key on the Worker) is not the app password: the Worker marks what
    // it passed on with X-Upstream (cloudflare-worker.js, 0.11.92), so only its own refusal signs out
    if (res.status === 401 && res.headers.get('X-Upstream')) {
      throw new Error(`${res.headers.get('X-Upstream')} refused the server's key — tell the admin (the app password is fine)`);
    }
    if (res.status === 401 && viaPlatform) throw new Error('Your sign-in has ended — sign in again on the Tasks tab.');
    if (res.status === 401) {
      clearAppPassword();
      showPasswordGate();
      throw new Error('Session expired — please re-enter your password.');
    }
    return res;
  } finally {
    clearTimeout(tid);
    if (onOuterAbort) outer.removeEventListener('abort', onOuterAbort);
  }
}

// Show the shared team password on load — unless the app is running on the
// FarmBox cloud, where every person signs in with their own account. Capture
// still goes through the Worker, so the gate appears when that tab is opened.
function appPasswordNeeded() {
  return false;   // 0.11.117: the app opens on the FarmBox sign-in; Capture asks the team password when it is opened
}
function ensureAppPassword() {
  if (!getAppPassword()) showPasswordGate();
}
document.addEventListener('DOMContentLoaded', () => {
  if (appPasswordNeeded()) showPasswordGate();
});

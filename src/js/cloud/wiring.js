//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- buttons and events wiring. Edit here, then run: python build.py
  // ── wiring ──────────────────────────────────────────────────────────────
  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('signin'); btn.disabled = true; $('authErr').textContent = '';
    btn.textContent = 'Signing in…';
    try {
      await signIn($('email').value.trim(), $('pass').value);
      $('pass').value = '';
      // a session that ended by itself never passed through Sign out: the list opens on who signs in now, not on the last choice
      try { await setKV('who', null); } catch (e) { /* the choice stays */ }
      btn.textContent = 'Reading your tasks…';
      await sync(true);
    } catch (err) {
      const k = errKind(err);
      $('authErr').textContent = k === 'net' ? 'No signal — signing in needs a connection. Try again where there is signal.'
        : k === 'busy' ? 'The server is busy — try again in a minute.' : String(err.message || err);
    } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });
  $('sync').addEventListener('click', () => sync(false));
  $('sendall').addEventListener('click', () => sendAllNow());
  $('finish').addEventListener('click', finishRun);
  ['pointerdown', 'input'].forEach(ev => $('run').addEventListener(ev, () => {
    if (!run) return;
    run.lastAct = Date.now();
    const tt = timerTaskOf(run.task); if (tt) timerTouch(tt.id);
  }, { capture: true, passive: true }));
  const upSel = document.getElementById('fb-uploadNet');
  if (upSel) { upSel.value = uploadNet(); upSel.onchange = () => { try { localStorage.setItem('fb_upload_net', upSel.value); } catch (e) {} flush(); }; }
  navigator.connection?.addEventListener?.('change', () => flush());

  document.querySelectorAll('[data-source]').forEach(btn => btn.addEventListener('click', () => {
    setSource(btn.dataset.source);
  }));
  let signingOut = false;
  document.getElementById('fb-signout')?.addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true;
    try {
      // what this person has not sent would go up later under the next person's name — the server takes who it is
      // from the sign-in. So it is sent first when there is signal (eight seconds at most, never a wait without end),
      // and when something still stays the person is asked. Without signal, or the outbox not readable: asked or as before.
      const outBtn = document.getElementById('fb-signout');
      if (outBtn) { outBtn.disabled = true; outBtn.textContent = 'Sending what is left…'; }
      // a checklist left open has its timer running: paused first, as its Back does — forgotten instead, the server
      // went on counting it for hours. First, so that the pause goes up in the flush below, under this person's
      // sign-in (sent after the next one it stops nobody's time), and is counted in the question when it could not go.
      // The price: "no, stay" leaves the checklist paused, and one tap starts it again. Pausing only after the answer
      // was tried on 13 Oct 2026 and taken back: the pause then waited behind a photo being sent, or was never asked about.
      try { for (const id of Object.keys(TIMERS)) if (timerRunning(id)) await timerPause(id); } catch (e) { /* as before */ }
      try {
        if (session && navigator.onLine) await Promise.race([flush().catch(() => {}), new Promise(res => setTimeout(res, 8000))]);
        const left = (await all('outbox')).length;
        if (left && !confirm(`${left} thing${left === 1 ? '' : 's'} you did ${left === 1 ? 'is' : 'are'} not sent yet.\n\nIf you sign out now, ${left === 1 ? 'it goes' : 'they go'} up later under the next person's name.\n\nSign out anyway?`)) return;
      } catch (e) { /* sign out as before */ }
      saveSession(null);
      await setKV('farm', null); farm = null;
      await setKV('me', null).catch(() => {}); await setKV('who', null).catch(() => {});   // the next person is not the last one (0.11.103)
      // nor do they get this person's timers (their minutes showed as the next person's own) or open checklist
      await setKV('timers', null).catch(() => {}); TIMERS = {};
      await setKV('run_open', null).catch(() => {});
      showToast('Signed out', 'success');
      if (document.body.classList.contains('src-cloud')) fbOpen();
    } finally {
      signingOut = false;
      const outBtn = document.getElementById('fb-signout');
      if (outBtn) { outBtn.disabled = false; outBtn.textContent = 'Sign out'; }
    }
  });

  function setSource(src) {
    localStorage.setItem(SOURCE_KEY, src);
    document.body.classList.toggle('src-cloud', src === 'cloud');
    if (src !== 'cloud' && document.body.classList.contains('mode-gallery')) setAppMode('sop');   // the Gallery is FarmBox mode only (0.11.144)
    document.querySelectorAll('[data-source]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.source === src)));
    if (document.body.classList.contains('mode-sop')) {
      if (src === 'cloud') fbOpen(); else if (window.sopOpen) window.sopOpen();
    }
  }

  let resumed = false;
  function fbOpen() {
    paintAccount();
    if (!session) { show('auth', 'Sign in', null); return; }
    showWeek();
    openLotFromHash();
    if (!resumed) { resumed = true; resumeRun().catch(e => console.warn('resume', e)); }
    if (navigator.onLine) sync(false);
  }

  const netPill = () => $('net')?.classList.toggle('hidden', navigator.onLine);
  addEventListener('online', () => { netPill(); session ? sync(false) : flush(); });
  // who is doing what stays current (0.11.84): a quiet sync every minute while the app is on screen and connected
  setInterval(() => {
    if (!document.hidden && navigator.onLine && session && document.body.classList.contains('src-cloud')
        && !document.querySelector('.fb-cam')) sync(false, true);
  }, 60000);
  addEventListener('offline', netPill);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { liveClose(); return; }
    liveOpen();
    if (document.body.classList.contains('src-cloud')) { (session && navigator.onLine) ? sync(false, true) : flush(); }
  });
  addEventListener('online', () => liveOpen());


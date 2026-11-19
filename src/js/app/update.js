//! Naked Brain - service worker and the update check. CURRENT_VERSION stays in this file: the update check and release-brain.ps1 read it from the built index.html. Edit here, then run: python build.py
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  // ─── VERSION CHECK ────────────────────────────────────────
  const CURRENT_VERSION = '0.11.147';
  let updateAvailable = false;

  let lastSaid = null, notYetAt = 0;
  // the page that carries the number, fetched past every cache: does it say the new one?
  async function arrived(v) {
    try {
      const txt = await (await fetch('./index.html?probe=' + Date.now(), { cache: 'reload' })).text();
      return txt.includes("CURRENT_VERSION = '" + v + "'");
    } catch (_) { return false; }
  }
  // one check at a time (0.11.146, review of 16 Nov): on waking, the screen coming back and the signal coming back ask
  // together, and the second saw the first one's number as "said twice" at once
  let checkingNow = null;
  function checkForUpdates() {
    checkingNow = checkingNow || checkUpdateOnce().finally(() => { checkingNow = null; });
    return checkingNow;
  }
  async function checkUpdateOnce() {
    try {
      const res = await fetch('./version.json?t=' + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      // a CDN can say the new number before it has the new files, and flip for a while:
      // a number is offered only once it has been said twice, and not within five
      // minutes of a tap that found the files not there yet
      const steady = data.version && data.version === lastSaid;
      lastSaid = data.version;
      if (Date.now() - notYetAt < 5 * 60 * 1000) return;
      // only a number newer than this page's is an update: a version.json older than the page (the same CDN flip, the
      // other way round) was offered as "available", and applied by itself when its old page was found
      const isNew = versionNewer(data.version, CURRENT_VERSION);
      // 0.11.64: a new number seen once is asked again in 15 s, not in 5 minutes
      if (!steady && data.version && isNew) { clearTimeout(recheckTimer); recheckTimer = setTimeout(checkForUpdates, 15000); return; }
      if (steady && isNew) {
        updateAvailable = true;
        // "Update now" was already tapped for this version but the phone is
        // still on the old one: say so instead of offering the same button again.
        const stuck = sessionStorage.getItem('nb_update_target') === data.version;
        // 0.11.64: nothing open (no checklist, sheet, camera or typing) → update by itself, once per version
        if (!stuck && quietNow()) {
          if (await arrived(data.version)) { autoUpdate(data.version); return; }
          notYetAt = Date.now();   // the files have not reached this phone yet: ask again in five minutes, not every two (0.11.92)
        }
        // the ✕ on the card puts the card away for this version, nothing more: it used to switch off the update by
        // itself above as well, for as long as the page lived
        if (sessionStorage.getItem('nb_update_dismissed') !== data.version) showVersionNotification(data.version, stuck);
      }
    } catch(e) {}
  }
  // is v a later release than cur? Both as three numbers (0.11.124); anything else is compared as before — any
  // number that is not this page's counts — so an odd version string never stops the check
  function versionNewer(v, cur) {
    try {
      const three = s => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s)); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
      const a = three(v), b = three(cur);
      if (!a || !b) return v !== cur;
      for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
      return false;
    } catch (_) { return v !== cur; }
  }
  let recheckTimer = null;
  // is the person in the middle of something? A checklist, a scouting, a sheet, the camera, a photo, a field being typed in
  function quietNow() {
    if (document.visibilityState !== 'visible') return false;
    const run = document.getElementById('fb-run');
    if (run && !run.classList.contains('hidden')) return false;
    if (document.querySelector('.fb-sheet, .fb-cam, .fb-viewer, .fb-measure')) return false;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return false;
    // Capture, or a voice note on a task, holds something a reload would lose: a recording in progress, a transcription
    // on its way, photos / a video / a voice note attached to a note not sent yet (kept in memory only), a send in
    // progress. The Update now card still shows; the update by itself waits.
    try {
      if (document.querySelector('#recordBtn.recording, .fb-fbk-rec.on')) return false;
      const tb = document.getElementById('transcribingBar');
      if (tb && tb.style.display && tb.style.display !== 'none') return false;
    } catch (_) {}
    try { if (submitting || mediaFiles.length) return false; } catch (_) {}   // names of a later script: not there yet = nothing held
    // the outbox being sent, or Force send running (0.11.146): a reload cut the upload, and it went up again under a new name
    try { if (typeof window.fbSending === 'function' && window.fbSending()) return false; } catch (_) {}
    return true;
  }
  function autoUpdate(v) {
    const n = document.createElement('div');
    n.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top) + 72px);left:50%;transform:translateX(-50%);z-index:10002;' +
      'background:var(--ink);color:var(--ink-text);padding:12px 16px;border-radius:var(--radius-xl);font-size:var(--text-sm);box-shadow:var(--shadow-lg)';
    nbLabel(n, '{i:download} Updating to ' + v + '…');
    document.body.appendChild(n);
    setTimeout(() => applyUpdate(v), 900);
  }
  // unregister the worker, empty the caches, open an address the HTTP cache has never seen
  async function applyUpdate(newVersion) {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== 'fb-lib-v1' && k !== 'transformers-cache').map(k => caches.delete(k)));   // the text reader and the measuring models stay
      }
    } catch (_) {}
    sessionStorage.setItem('nb_update_target', newVersion);
    // A unique address can't be answered from the browser's HTTP cache
    // (GitHub Pages: max-age=600). reload() could hand back the old page on
    // iPhone, and the box would then keep coming back.
    const params = new URLSearchParams(location.search);
    params.set('updated', Date.now());
    location.replace(location.pathname + '?' + params + location.hash);
  }

  function showVersionNotification(newVersion, stuck = false) {
    const existing = document.getElementById('versionUpdateNotification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'versionUpdateNotification';
    notification.style.cssText = `
      position: fixed;
      top: calc(env(safe-area-inset-top) + 72px);
      left: 50%;
      transform: translateX(-50%);
      width: calc(100% - 40px);
      max-width: 380px;
      background: var(--ink);
      border: none;
      color: var(--ink-text);
      padding: 14px 16px;
      border-radius: var(--radius-xl);
      font-size: var(--text-sm);
      box-shadow: var(--shadow-lg);
      z-index: 10002;
      animation: nbPopIn 300ms ease-out;
      display: flex;
      align-items: center;
      gap: 12px;
    `;
    notification.innerHTML = `
      <span style="font-size:1.3rem;display:inline-flex">${nbIcon('download').outerHTML}</span>
      <div style="flex:1">
        <div style="font-weight:700;margin-bottom:2px">v ${newVersion} available</div>
        <div style="font-size:var(--text-xs);color:var(--ink-muted)">${stuck
          ? 'Could not finish updating — close Naked Brain completely and open it again'
          : 'A new version of Naked Brain is ready'}</div>
      </div>
      <button id="updateNowBtn" style="
        background:var(--accent);
        color:var(--text-inverse);
        border:none;
        border-radius:var(--radius-full);
        padding:8px 14px;
        font-size:var(--text-xs);
        font-weight:700;
        cursor:pointer;
        white-space:nowrap;
        flex-shrink:0;
        min-height:40px;
      ">Update now</button>
      <button id="dismissUpdateBtn" style="
        background:none;
        border:none;
        color:var(--ink-muted);
        font-size:1.1rem;
        cursor:pointer;
        padding:4px;
        flex-shrink:0;
        line-height:1;
        min-width:40px;
        min-height:40px;
      ">✕</button>
    `;
    document.body.appendChild(notification);

    document.getElementById('updateNowBtn').addEventListener('click', async () => {
      // reloading into the old files is the loop: the new page must be reachable first
      const btn = document.getElementById('updateNowBtn');
      btn.disabled = true; btn.textContent = 'Checking…';
      if (!(await arrived(newVersion))) {
        notYetAt = Date.now();
        notification.querySelector('#updateNowBtn').textContent = 'Not here yet';
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:12px;opacity:.85;margin-top:4px';
        msg.textContent = newVersion + ' is published but has not reached this connection yet — it will be offered again in a few minutes.';
        btn.parentElement.appendChild(msg);
        setTimeout(() => notification.remove(), 8000);
        return;
      }
      applyUpdate(newVersion);
    });

    document.getElementById('dismissUpdateBtn').addEventListener('click', () => {
      sessionStorage.setItem('nb_update_dismissed', newVersion);
      notification.remove();
    });
  }


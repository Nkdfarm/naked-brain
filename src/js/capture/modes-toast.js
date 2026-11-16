//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- app sections (Tasks/Capture/Gallery) and showToast. Edit here, then run: python build.py
// ─── APP SECTIONS: Tasks / Capture / Gallery ─────────────────
// Opens on Tasks (mode 'sop': the SoP module — procedures and checklists,
// script at the end of the page); the home-screen "New Voice Note" shortcut
// (?action=record) opens Capture.
// The date box of Daily and SU reports is filled when the form is drawn, and the form is drawn again only on a tab
// tap, a chip tap or a send: on a page that stayed open past midnight it went on showing yesterday while Send wrote
// today. Coming back to the app, or to Capture, puts today in it — unless the person picked a date, which is kept.
function freshFormDate() {
  try {
    if (!datedOnForm(activeTab) || getTabValue(activeTab, 'Date')) return;
    const today = localDateISO();
    document.querySelectorAll('.tab-fields-wrap input[type="date"]').forEach(i => {
      if (document.activeElement !== i && i.value !== today) i.value = today;
    });
  } catch (e) { /* the box keeps what it shows */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') freshFormDate(); });

function setAppMode(mode) {
  document.body.classList.remove('mode-sop', 'mode-capture', 'mode-gallery');
  document.body.classList.add('mode-' + mode);
  document.querySelectorAll('.app-tab').forEach(btn => {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  window.scrollTo(0, 0);
  if (mode === 'sop') {
    if (document.body.classList.contains('src-cloud')) {
      // A checklist that is open stays open: coming back from Capture (or a tap on Tasks) used to draw the list over
      // it without the Back's own steps — the timer kept running and the task stayed held. Its back arrow is the way
      // to the list. A task page or the scouting hub holds nothing: Tasks goes to the list from there, as always.
      let inside = false;
      try { inside = ['fb-run'].some(id => { const v = document.getElementById(id); return !!v && !v.classList.contains('hidden'); }); } catch (e) { inside = false; }
      if (window.fbOpen && !inside) window.fbOpen();
    }
    else if (window.sopOpen) window.sopOpen();
  }
  if (mode === 'capture') freshFormDate();
  if (mode === 'capture') captureGate();   // 0.11.118: the team password only where this phone still goes through the Worker
  if (mode === 'gallery' && window.galleryOpen) window.galleryOpen();   // 0.11.144: the farm's photos, in the FarmBox part of the page
}
document.querySelectorAll('.app-tab').forEach(btn =>
  btn.addEventListener('click', () => setAppMode(btn.dataset.mode)));
// The SoP part used to run from sop/ with its own service worker: remove it.
navigator.serviceWorker?.getRegistrations().then(regs =>
  regs.filter(r => /\/sop\/$/.test(r.scope)).forEach(r => r.unregister())).catch(() => {});
setAppMode(new URLSearchParams(location.search).get('action') === 'record' ? 'capture' : 'sop');


// ─── TOAST ───────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}


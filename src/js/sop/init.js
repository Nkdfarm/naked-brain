//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- menu, updates, sopOpen. Edit here, then run: python build.py
// ─── MENU, UPDATES, INIT ─────────────────────────────────────
$('menuBtn').addEventListener('click', () => {
  let ov;
  const item = (label, fn) => el('button', { class: 'btn btn-block', style: 'justify-content:flex-start', onclick: () => { ov.remove(); fn(); } }, label);
  ov = sheet('FarmBox SOP', `Version ${APP_VERSION}`,
    el('div', { style: 'display:flex;flex-direction:column;gap:0.5rem' },
      item('{i:refresh} Refresh SOP list', () => { go('#/'); showList({ force: true }).catch(e => toast(failureReason(e), 'error')); }),
      item('{i:clock} Run history', () => go('#/runs')),
      item('{i:download} Import a document', () => go('#/import')),
      item('{i:external} Open SOP database in Notion', () => window.open('https://www.notion.so/' + SOP_DB, '_blank', 'noopener')),
      item('{i:external} Open SOP Runs in Notion', () => window.open('https://www.notion.so/' + RUNS_DB, '_blank', 'noopener')),
      item('{i:logout} Log out', () => { clearAppPassword(); showPasswordGate(); })));
});

window.addEventListener('beforeunload', e => { if (leaveGuard?.()) { e.preventDefault(); e.returnValue = ''; } });
// Started the first time the SoP tab opens — no network work while on Tasks or Capture.
let sopStarted = false;
function sopOpen() {
  if (!sopStarted) { sopStarted = true; updateNet(); }
  route();
}

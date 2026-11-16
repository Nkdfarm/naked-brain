//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- author button, skins, Settings page, tabs. Edit here, then run: python build.py
// ─── AUTHOR BUTTON ───────────────────────────────────────────
function syncAuthorBtn() {
  const val = document.getElementById('authorName').value.trim();
  const btn = document.getElementById('authorBtn');
  btn.textContent = val || 'Enter Author';
}

// The author name is mandatory: asked right after the first login and whenever
// it is missing (e.g. cleared in Settings). It is also the name the SoP tab puts
// on completed checklists. The header button reopens the dialog to change it;
// an empty name is never accepted.
function getAuthor() { return document.getElementById('authorName').value.trim(); }
function setAuthor(name) {
  document.getElementById('authorName').value = name;
  syncAuthorBtn();
  renderNoteStamp();
  saveConfig();
  syncDailyTitle(activeTab);
}
function openAuthorGate(canCancel) {
  const input = document.getElementById('authorGateInput');
  input.value = getAuthor();
  document.getElementById('authorGateError').style.display = 'none';
  document.getElementById('authorGateCancel').classList.toggle('hidden', !canCancel);
  document.getElementById('authorGate').classList.remove('hidden');
  setTimeout(() => input.focus(), 50);
}
function saveAuthorGate() {
  const name = document.getElementById('authorGateInput').value.trim().replace(/\s+/g, ' ');
  if (!name) {
    document.getElementById('authorGateError').style.display = 'block';
    document.getElementById('authorGateInput').focus();
    return;
  }
  setAuthor(name);
  document.getElementById('authorGate').classList.add('hidden');
}
function ensureAuthor() {
  if (getAppPassword() && !getAuthor()) openAuthorGate(false);
}
document.getElementById('authorBtn').addEventListener('click', () => openAuthorGate(true));
document.getElementById('authorGateSave').addEventListener('click', saveAuthorGate);
document.getElementById('authorGateInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveAuthorGate(); });
document.getElementById('authorGateCancel').addEventListener('click', () =>
  document.getElementById('authorGate').classList.add('hidden'));

// Sync on load (after loadConfig runs)
document.addEventListener('DOMContentLoaded', syncAuthorBtn);
const html = document.documentElement;
// Theme choice is saved as 'light' | 'dark' | 'system' (Auto = follow the phone).
// Nothing saved yet = light, the default.
function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') {
    html.setAttribute('data-theme', choice);
    localStorage.setItem('ugly200_theme', choice);
  } else {
    html.removeAttribute('data-theme');
    localStorage.setItem('ugly200_theme', 'system');
  }
  document.querySelectorAll('[data-theme-choice]').forEach(btn =>
    btn.setAttribute('aria-pressed', String(btn.dataset.themeChoice === (choice || 'system'))));
}
applyTheme(localStorage.getItem('ugly200_theme') || 'light');
document.querySelectorAll('[data-theme-choice]').forEach(btn =>
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice)));

// ─── SKINS ───────────────────────────────────────────────────
// A skin is skins/<id>.json: { id, name, fonts, radius, light: {token: value}, dark: {...} }.
// Token names are the CSS variables of the design-token block above, without the
// leading "--". Applying a skin only writes a <style> that redefines those
// variables for light, dark and Auto; the layout, components and text never change.
// The default skin "naked-farm" is the built-in block itself, so it writes nothing.
const DEFAULT_SKIN = 'naked-farm';
const SKIN_KEY = 'nb_skin';          // chosen skin id
const SKIN_CACHE_KEY = 'nb_skin_json'; // last applied skin, for an instant start offline

function skinCss(skin) {
  const decl = obj => Object.entries(obj || {})
    .filter(([k, v]) => /^[a-z0-9-]+$/i.test(k) && typeof v === 'string' && !/[;{}]/.test(v))
    .map(([k, v]) => `--${k}: ${v};`).join(' ');
  const base = decl({ ...(skin.radius ? Object.fromEntries(Object.entries(skin.radius).map(([k, v]) => ['radius-' + k, v])) : {}),
                      ...(skin.fonts?.body ? { 'font-body': `'${skin.fonts.body.replace(/'/g, '')}', system-ui, sans-serif` } : {}) });
  const light = decl(skin.light), dark = decl(skin.dark);
  return `:root, [data-theme="light"] { ${base} ${light} }\n` +
         `[data-theme="dark"] { ${dark} }\n` +
         `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${dark} } }`;
}

function applySkin(skin) {
  let style = document.getElementById('skinStyle');
  if (!skin || skin.id === DEFAULT_SKIN) { if (style) style.remove(); return; }
  if (!style) { style = document.createElement('style'); style.id = 'skinStyle'; document.head.appendChild(style); }
  style.textContent = skinCss(skin);
  const font = skin.fonts?.body;
  if (font && font !== 'Inter' && !document.getElementById('skinFont')) {
    const link = document.createElement('link');
    link.id = 'skinFont'; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(font).replace(/%20/g, '+') + ':wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }
}

var skinSeq = 0;   // the last skin chosen wins (0.11.92): a slower earlier answer used to apply over it
async function loadSkin(id) {
  const my = ++skinSeq;
  id = (id || DEFAULT_SKIN).replace(/[^a-z0-9-]/gi, '');
  localStorage.setItem(SKIN_KEY, id);
  if (id === DEFAULT_SKIN) { localStorage.removeItem(SKIN_CACHE_KEY); applySkin(null); return; }
  try {
    const res = await fetch(`skins/${id}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const skin = await res.json();
    if (my !== skinSeq) return;
    localStorage.setItem(SKIN_CACHE_KEY, JSON.stringify(skin));
    applySkin(skin);
  } catch (e) {
    console.warn('Skin not loaded:', e);
  }
}

function initSkin() {
  // Instant: the last applied skin from localStorage, before any network.
  try { const cached = localStorage.getItem(SKIN_CACHE_KEY); if (cached) applySkin(JSON.parse(cached)); } catch (e) {}
  const chosen = localStorage.getItem(SKIN_KEY) || DEFAULT_SKIN;
  const select = document.getElementById('skinSelect');
  if (select) {
    select.value = chosen;
    select.addEventListener('change', () => loadSkin(select.value));
    fetch('skins/index.json').then(r => r.json()).then(list => {
      select.innerHTML = '';
      (list.skins || []).forEach(s => {
        const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; select.appendChild(o);
      });
      select.value = chosen;
    }).catch(() => {});
  }
  if (chosen !== DEFAULT_SKIN) loadSkin(chosen);   // refresh from the file when online
}
initSkin();

// ─── SETTINGS PAGE ───────────────────────────────────────────
// Opened from the gear. Pushes a history entry so the phone's back
// gesture/button closes it instead of leaving the app.
const settingsPage = document.getElementById('settingsPage');
function openSettings() {
  setConfigLocked(true);
  document.getElementById('settingsVersion').textContent = 'v ' + CURRENT_VERSION;
  settingsPage.classList.remove('hidden');
  settingsPage.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  history.pushState({ settings: true }, '', '#settings');
}
function closeSettings() {
  settingsPage.classList.add('hidden');
  document.body.style.overflow = '';
  setConfigLocked(true);
  ensureAuthor();
}
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('settingsBack').addEventListener('click', () =>
  history.state?.settings ? history.back() : closeSettings());
// A Back that closes Settings is Settings' alone: the Tasks part listens to the same event (registered after this one)
// and used to step its own screen back too — out of an open checklist, its timer paused, or, in a zone of an extra
// scouting, sending the zone.
window.addEventListener('popstate', e => {
  if (settingsPage.classList.contains('hidden')) return;
  closeSettings();
  e.stopImmediatePropagation();
});
if (location.hash === '#settings') history.replaceState(null, '', location.pathname + location.search);

// ─── TABS ─────────────────────────────────────────────────────
// Big task-focused title per tab: says what you're doing, not which database.
const TAB_HERO = {
  ugly200: ['Log an issue', 'Record what you see — it goes to the Ugly200 list.'],
  sop:     ['Capture a procedure', 'Talk or film the steps — it is saved to the SoP database.'],
  daily:   ['Daily update', 'What got done, and what needs deciding.'],
  sulive:  ['SU report', 'Ideas to improve FarmBox — what you would change, and why. What you saw in the crops today goes in the scouting, under All.'],
};
// Daily: the Title box shows the author's name automatically (still editable).
// The box is shared by all Capture tabs, so an untouched automatic name is
// cleared again when you leave Daily — it never becomes an Ugly200/SoP title.
function syncDailyTitle(tab) {
  const input = document.getElementById('noteTitle');
  if (!input) return;
  const author = document.getElementById('authorName')?.value.trim() || '';
  const current = input.value.trim();
  if (titledByAuthor(tab)) {
    if (!current || input.dataset.auto === '1' || current === author) {
      input.value = author;
      input.dataset.auto = '1';
    }
  } else if (input.dataset.auto === '1') {
    if (current === author) input.value = '';
    delete input.dataset.auto;
  }
}
document.getElementById('noteTitle').addEventListener('input', e => { delete e.target.dataset.auto; });

function setActiveTab(tab) {
  activeTab = tab;
  localStorage.setItem('brain_activeTab', tab);
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on);
  });
  const label = document.getElementById('submitTabLabel');
  if (label) label.textContent = TAB_LABELS[tab] || 'Notion';
  const hero = TAB_HERO[tab];
  if (hero) {
    document.getElementById('heroTitle').textContent = hero[0];
    document.getElementById('heroSub').textContent = hero[1];
  }
  const noteWrap = document.getElementById('noteWrap');
  if (noteWrap) noteWrap.style.display = tab === 'daily' ? 'none' : '';
  const noteTitleWrap = document.getElementById('noteTitleWrap');
  if (noteTitleWrap) noteTitleWrap.style.display = '';   // Title on every tab (Daily too, 0.9.15)
  syncDailyTitle(tab);
  renderTabFields(tab);
  updateSubmitBtn();
}
document.querySelectorAll('.tab-btn').forEach(btn =>
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab))
);


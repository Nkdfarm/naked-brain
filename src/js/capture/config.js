//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- config keys, PIN lock, note time, GPS. Edit here, then run: python build.py
// ─── CONFIG KEYS ─────────────────────────────────────────────
const LS_KEY = 'ugly200_config';

const CONFIG_FIELDS = [
  'authorName',
  'notionDbId_ugly200',
  'notionDbId_sop',
  'notionDbId_daily',
  'notionDbId_sulive',
];

// SU reports (0.11.120 as "SU Live", renamed in 0.11.121; owner 12 Oct 2026) took the place of FB1Log, the FarmBox1
// build log: its last entry was of 10 July. The FB1Log database stays in Notion; the app no longer writes to it.
// The tab's key stays `sulive`: it names the setting and what each phone remembers.
// Ideas is gone too (0.11.124, owner 12 Oct 2026): nothing was ever sent to it, and its Notion database was removed.
const TAB_LABELS = { ugly200: 'Ugly200', sop: 'SoP', daily: 'Daily', sulive: 'SU reports' };
const TAB_DB     = { ugly200: 'notionDbId_ugly200', sop: 'notionDbId_sop', daily: 'notionDbId_daily', sulive: 'notionDbId_sulive' };
let activeTab = localStorage.getItem('brain_activeTab') || 'ugly200';
if (!TAB_DB[activeTab]) activeTab = 'ugly200';   // a phone left on a tab that is gone
// Daily's Title box starts as the author's name. SU reports had the same in 0.11.120; since 0.11.121 its Title
// starts blank and the person writes it (owner: "the title has to be blank and filled by the user").
const titledByAuthor = tab => tab === 'daily';
const TITLE_REQUIRED = { sulive: true };
// Tabs that carry their date on the form (a `date` field): that date is sent, date only
const datedOnForm = tab => (TAB_SCHEMAS[tab] || []).some(f => f.type === 'date');

// Local calendar date as YYYY-MM-DD. toISOString() gives the UTC date, which
// is still yesterday in the early morning in South Africa.
function localDateISO(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const TAB_SCHEMAS = {
  ugly200: [
    { key: 'Tags',     type: 'multi_select', options: ['FarmBox','Field Visit','Urgent','Greenhouse','Energy','Robotics'] },
    { key: 'Status',   type: 'select',       options: ['Open','In Progress','Done'] },
    { key: 'Location', type: 'text', beforeMedia: true },
  ],
  sop: [
    { key: 'Category', type: 'select', options: ['Hardware','Software','Field Ops','Safety'] },
    { key: 'Status',   type: 'select', options: ['Draft','In Review','Approved','Archived'] },
  ],
  daily: [
    // Same order as the columns in the Notion Daily database, with the date first
    { key: 'Date', type: 'date' },
    { key: 'FarmBox1', aliases: ['Done today'], type: 'text', multiline: true },
    { key: 'FarmLab', aliases: ['FarmLab Update'], type: 'text', multiline: true },
    { key: 'Tech Plan', aliases: ['TechPlan', 'Key milestone'], type: 'text', multiline: true },
    { key: 'Decisions needed', type: 'text', multiline: true },
  ],
  sulive: [
    // The Stellenbosch University team's reports: anything that would improve FarmBox. Like Daily without its
    // three boxes — the report is its title, the voice note and the Note. The kind of report comes first, as a menu
    // that keeps its last choice on this phone (the same person mostly sends the same kind); the zone is optional.
    { key: 'Category', type: 'select', menu: true, required: true, persist: true, top: true, options: ['Agronomy','Tech','General'] },
    { key: 'Date', type: 'date' },
    { key: 'Zone', type: 'multi_select', options: ['Zone 1','Zone 2','Zone 3','Zone 4','FarmBox1'] },
  ],
};

let tabValues = {};
try { tabValues = JSON.parse(localStorage.getItem('brain_tabValues') || '{}'); } catch(e) { tabValues = {}; }
function getTabValue(tab, key) { return tabValues[tab]?.[key]; }
function setTabValue(tab, key, value) {
  if (!tabValues[tab]) tabValues[tab] = {};
  if (value === null || value === undefined || (Array.isArray(value) && !value.length) || value === '') delete tabValues[tab][key];
  else tabValues[tab][key] = value;
  localStorage.setItem('brain_tabValues', JSON.stringify(tabValues));
}

// ─── LOAD SAVED CONFIG ────────────────────────────────────────
// ─── HARDCODED DEFAULTS ───────────────────────────────────────
const APP_DEFAULTS = {
  notionDbId_ugly200: '3581301d4ab88196a51ed98b3ad9b219',
  notionDbId_sop:     '3581301d4ab8819693a1e1d1f958e6d6',
  notionDbId_daily:   '3581301d4ab88133a0e8c7349be6c857',
  notionDbId_sulive:  'dc909f3465674d41b57467457eb0770e',
  authorName:         '',
};

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    CONFIG_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      // Priority: localStorage > hardcoded default > keep as-is
      if (saved[id] !== undefined) el.value = saved[id];
      else if (APP_DEFAULTS[id]) el.value = APP_DEFAULTS[id];
    });
  } catch(e) {}
}

function saveConfig() {
  const data = {};
  CONFIG_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  localStorage.setItem(LS_KEY, JSON.stringify(data));
  const badge = document.getElementById('configSavedBadge');
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 2500);
}

function clearConfig() {
  localStorage.removeItem(LS_KEY);
  CONFIG_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.value = '';
    }
  });
  showToast('Config cleared from this device', 'info');
}

// ─── CONFIG PIN LOCK ─────────────────────────────────────────
const CONFIG_PIN = '1234';
let configUnlocked = false;

// The Configuration section of Settings re-locks whenever Settings is opened or closed.
function setConfigLocked(locked) {
  configUnlocked = !locked;
  document.getElementById('configPanel').classList.toggle('open', !locked);
  document.getElementById('pinOverlay').style.display = locked ? 'flex' : 'none';
  document.getElementById('pinError').style.display = 'none';
  document.getElementById('pinInput').value = '';
  const badge = document.getElementById('configLockBadge');
  nbLabel(badge, locked ? '{i:lock} PIN required' : '{i:unlock} Unlocked');
  badge.classList.toggle('open', !locked);
}

function tryUnlockConfig() {
  const pinInput = document.getElementById('pinInput');
  if (pinInput.value === CONFIG_PIN) {
    setConfigLocked(false);
  } else {
    document.getElementById('pinError').style.display = 'block';
    pinInput.value = '';
    pinInput.focus();
  }
}

document.getElementById('pinSubmit').addEventListener('click', tryUnlockConfig);
document.getElementById('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlockConfig(); });

document.getElementById('authorName').addEventListener('change', saveConfig);

document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
document.getElementById('clearConfigBtn').addEventListener('click', clearConfig);

// ─── NOTE START TIME ─────────────────────────────────────────
// Captured when the page loads (or after each submission reset).
// This is the date sent to Notion — reflects when the note started.
let noteStartTime = new Date();
// The page's load was not the note's start: an issue logged at four on a page opened at seven went to Notion as of
// seven, and on a page that had lived two days, as of two days before. The start is now taken when the empty form
// first gets something (updateSubmitBtn); a draft that comes back keeps the start it had (restoreDraft).
let noteStarted = false;

function renderNoteStamp() {
  const d = noteStartTime;
  const dateStr = d.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
  const timeStr = d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  // The date/author line was removed from the capture box (0.9.13); keep this
  // safe in case it comes back.
  const dateEl = document.getElementById('noteDate');
  if (dateEl) dateEl.textContent = `${dateStr} · ${timeStr}`;
  const authorEl = document.getElementById('noteAuthorStamp');
  if (authorEl) authorEl.textContent = document.getElementById('authorName')?.value.trim() || '';
}

// ─── GPS LOCATION ────────────────────────────────────────────
// Added on demand with "Add location" (never automatic): the live precision
// is shown while the GPS settles, and the user saves the fix once it is close
// enough to their target. Sent with the note as a location line with a map link in
// the page, plus Location / Precision columns when the DB has them.
let captureLocation = null;   // the saved fix: { lat, lon, acc, at }
let _gpsLive = null;          // latest live fix, not saved yet
let _gpsWatch = null;
const GPS_TARGET_KEY = 'nb_gps_target';

function mapsUrl(loc) { return `https://www.google.com/maps?q=${loc.lat.toFixed(6)},${loc.lon.toFixed(6)}`; }
function locationText(loc) { return `${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)} (±${Math.round(loc.acc)} m)`; }
function gpsTarget() { return Number(document.getElementById('gpsTarget').value) || 10; }

// Idle: the Add button. Live: the precision panel. Saved: the stamp with ×.
function renderGpsStamp() {
  const live = _gpsWatch !== null;
  document.getElementById('gpsAddBtn').hidden = live || !!captureLocation;
  document.getElementById('gpsLive').hidden = !live;
  document.getElementById('gpsSaved').hidden = live || !captureLocation;
  if (captureLocation) {
    const el = document.getElementById('gpsStamp');
    nbLabel(el, '{i:pin} ' + locationText(captureLocation));
    el.href = mapsUrl(captureLocation);
  }
}

function renderGpsLive(msg) {
  const acc = document.getElementById('gpsAcc');
  const coords = document.getElementById('gpsCoords');
  const save = document.getElementById('gpsSaveBtn');
  if (!_gpsLive) {
    acc.textContent = msg || 'Searching GPS…';
    acc.className = 'gps-acc';
    coords.textContent = '';
    save.disabled = true;
    return;
  }
  const m = Math.round(_gpsLive.acc), target = gpsTarget();
  acc.textContent = `±${m} m`;
  acc.className = 'gps-acc ' + (m <= target ? 'ok' : m <= target * 3 ? 'near' : 'far');
  coords.textContent = `${_gpsLive.lat.toFixed(6)}, ${_gpsLive.lon.toFixed(6)}` + (m <= target ? ' · target reached' : '');
  save.disabled = false;
}

function stopGpsWatch() {
  if (_gpsWatch !== null) navigator.geolocation.clearWatch(_gpsWatch);
  _gpsWatch = null;
  _gpsLive = null;
}

function startGpsLive() {
  if (!('geolocation' in navigator)) { showToast('Location is not available on this device', 'error'); return; }
  stopGpsWatch();
  _gpsWatch = navigator.geolocation.watchPosition(pos => {
    const c = pos.coords;
    _gpsLive = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, at: new Date(pos.timestamp).toISOString() };
    renderGpsLive();
  }, err => {
    console.warn('GPS:', err.message);
    if (err.code === err.PERMISSION_DENIED) {
      stopGpsWatch(); renderGpsStamp();
      showToast('Location permission denied — allow it in the phone settings', 'error');
    } else if (!_gpsLive) {
      renderGpsLive('No GPS signal yet…');   // keeps watching; timeouts are retried
    }
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  renderGpsLive();
  renderGpsStamp();
}

function saveGpsLive() {
  if (!_gpsLive) return;
  captureLocation = _gpsLive;
  stopGpsWatch();
  renderGpsStamp();
  saveDraft();
}

function clearLocation() {
  stopGpsWatch();
  captureLocation = null;
  renderGpsStamp();
  saveDraft();
}

(() => {
  const sel = document.getElementById('gpsTarget');
  try { const t = localStorage.getItem(GPS_TARGET_KEY); if (t && [...sel.options].some(o => o.value === t)) sel.value = t; } catch(e) {}
  sel.addEventListener('change', () => { try { localStorage.setItem(GPS_TARGET_KEY, sel.value); } catch(e) {} renderGpsLive(); });
  document.getElementById('gpsAddBtn').addEventListener('click', startGpsLive);
  document.getElementById('gpsSaveBtn').addEventListener('click', saveGpsLive);
  document.getElementById('gpsCancelBtn').addEventListener('click', () => { stopGpsWatch(); renderGpsStamp(); });
  document.getElementById('gpsRemoveBtn').addEventListener('click', clearLocation);
})();

// Re-render stamp if author name changes live
document.getElementById('authorName').addEventListener('input', renderNoteStamp);


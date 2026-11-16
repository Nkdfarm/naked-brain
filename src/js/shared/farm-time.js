//! Naked Brain - generated from FarmBox-Platform shared/farm-time.js (global functions: farmDayOf, addDaysYmd). Edit it there, run node scripts/sync-shared.mjs, then python build.py
// The farm's day — one rule for both apps (17 Nov 2026). Edit HERE, then run: node scripts/sync-shared.mjs
// It writes console/js/farm-time.js (Naked Heart, an ES module) and ../Ugly200/src/js/shared/farm-time.js (Naked
// Brain, a global script piece); `node scripts/sync-shared.mjs --check` says whether the copies still match.
// Plain functions only: no import, no closure, no app state — each app passes its farm's time zone.

// The day (YYYY-MM-DD) of an instant (a Date, ms or an ISO string; now when empty) on the farm's clock. Never through
// toISOString, which is the UTC day: in Johannesburg the work of 00:00-02:00 landed on the day before. An unknown zone
// falls back to the device's own day.
function farmDayOf(at, tz) {
  const t = at == null ? new Date() : at instanceof Date ? at : new Date(at);
  try {
    const p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(t).forEach(x => { p[x.type] = x.value; });
    if (p.year && p.month && p.day) return `${p.year}-${p.month}-${p.day}`;
  } catch (e) { /* an unknown zone: the device's day */ }
  return new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// A day (YYYY-MM-DD) moved by n days, at noon UTC so that no clock change can move it to another date.
function addDaysYmd(day, n) {
  const t = new Date(String(day).slice(0, 10) + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

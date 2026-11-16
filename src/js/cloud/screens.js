//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- screens and grouped tasks. Edit here, then run: python build.py
  // ── screens ─────────────────────────────────────────────────────────────
  // Going into a task or a checklist leaves a history entry behind, so the
  // phone's own Back gesture steps back a screen instead of closing the app.
  // The entry is pushed with the same URL — the SoP hash router is untouched.
  const views = ['auth', 'week', 'task', 'run', 'lot'];
  const backStack = [];
  let unwinding = 0;

  // Tasks is what the person is looking at. It used to ask for a class `hidden` on #viewFarmbox, which nothing ever
  // sets (the view is shown and hidden by the body's mode), so it was always true — in Capture too.
  const fbOnScreen = () => document.body.classList.contains('mode-sop');

  function show(name, title, back) {
    views.forEach(v => $(v).classList.toggle('hidden', v !== name));
    $('title').textContent = title;
    $('back').classList.toggle('hidden', !back);
    $('back').onclick = back ? () => history.back() : null;
    window.scrollTo(0, 0);

    if (!back) {
      backStack.length = 0;              // back at the root of the section
    } else if (!unwinding) {
      backStack.push(back);
      history.pushState({ fb: name, depth: backStack.length }, '');
    }
  }

  window.addEventListener('popstate', async () => {
    if (!backStack.length) return;   // not ours: let it through
    // Back pressed while Capture is on screen: the checklist or task page open underneath stays as it is. The entry
    // the browser just left is put back, so the history and backStack stay in step and the page's own Back still works.
    if (!fbOnScreen()) { history.pushState({ fb: 'kept', depth: backStack.length }, ''); return; }
    // Back over the camera, a photo or a sheet closes that first and keeps the screen under it (0.11.55):
    // it used to change the screen underneath and leave the overlay — the camera still running — on top
    const over = [...document.querySelectorAll('.fb-cam, .fb-viewer, .fb-sheet')].pop();
    if (over) {
      if (typeof over._close === 'function') over._close(); else over.remove();
      history.pushState({ fb: 'overlay', depth: backStack.length }, '');
      return;
    }
    const back = backStack.pop();
    unwinding++;
    try { await back(); } finally { unwinding--; }
  });

  const fmtDay = iso => {
    const d = new Date(iso + 'T00:00:00'), t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const diff = Math.round((d - t0) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  };
  const hhmm = t => (t || '').slice(0, 5);
  const SLOTS = ['am', 'pm', 'any'];
  const SLOT_WORD = { am: 'Morning', pm: 'Afternoon', any: 'Anytime' };
  const SLOT_SHORT = { am: 'AM', pm: 'PM', any: '—' };
  const slotOf = t => SLOTS.includes(t.slot) ? t.slot : (t.due_time ? (t.due_time < '12:00' ? 'am' : 'pm') : 'any');
  // where it is drawn (FarmBox 0080): an anytime task fills the morning while it has room, else the afternoon
  const BANDS = ['am', 'pm'];
  const bandOf = t => BANDS.includes(t.plan_slot) ? t.plan_slot : (slotOf(t) === 'pm' ? 'pm' : 'am');
  const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // ── grouped tasks (Phase A) ─────────────────────────────────────────────
  // The platform plans ONE task per crop × zone × date and lists the positions
  // it covers (task_positions in the sync payload). A farm still on the old
  // planner gets one task per position; those rows are folded here into the
  // same shape, so every screen only ever sees a group:
  //   { key, title, …, members:[task], positions:[{label, quantity, unit, minutes}], minutes }
  const UNIT_WORDS = { tray: ['tray', 'trays'], plant: ['plant', 'plants'], position: ['position', 'positions'],
                       m2: ['m²', 'm²'], area: ['m²', 'm²'], plug: ['plug', 'plugs'], unit: ['unit', 'units'] };
  const unitWord = (u, n) => { const w = UNIT_WORDS[String(u || '').toLowerCase()]; return w ? (n === 1 ? w[0] : w[1]) : (u || ''); };
  const num = v => { const n = +v; return isNaN(n) ? 0 : n; };
  const fmtNum = n => (Math.round(n * 10) / 10).toString();
  const fmtQty = (q, u) => q == null || q === '' ? '' : `${fmtNum(num(q))} ${unitWord(u, num(q))}`.trim();
  const fmtMin = m => Math.round(num(m)) + ' min';
  const fmtWork = m => { m = Math.round(num(m)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  // a live timer, to the second (0.11.62): 12:34, and 1:02:05 past an hour
  const fmtClock = m => { const t = Math.max(0, Math.floor(num(m) * 60)), h = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60;
    return (h ? `${h}:${String(mm).padStart(2, '0')}` : String(mm)) + ':' + String(ss).padStart(2, '0'); };


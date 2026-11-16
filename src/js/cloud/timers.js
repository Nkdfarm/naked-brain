//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- task timers and the week list. Edit here, then run: python build.py
  // ── the task timer (FarmBox 0161, 0.11.56): opening a checklist starts it, Pause stops it, finishing ends it ──
  // Mine live here (KV timers: task id → { segs: [[start ms, stop ms | null], …] }) and go up through the outbox,
  // so it works offline; the server's sums (sync task_times) add everybody else's time on the task.
  // One running task a person; a timer still running at 18:00 stops there (a forgotten one is not all night).
  let TIMERS = {}, TTIMES = new Map(), WNAMES = new Map(), WAITING = new Set();
  let GH_SENT = {};          // the whole-greenhouse notes this phone sent: '<unit>:<day>' → [{at, text, seconds}] (KV gh_sent)
  let EXTRA_SENT = {};       // an extra scouting's zones sent today: zone key → when (KV extra_sent)
  const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';
  // faces (0.11.114): the people by id, and their pictures kept on this phone (KV wphotos: id → {v, data})
  let WORKERS = new Map(), WPHOTOS = {};
  // A person's own colour: their place at their site (FarmBox 0220) picks it — the same list and the same sums as
  // Naked Heart's personColour (ui.js), so a person has one colour in both apps and no two people share one.
  const PERSON_COLOURS = [[210, 70, 50], [0, 70, 55], [135, 55, 40], [30, 90, 52], [275, 60, 58], [175, 70, 38], [325, 75, 62], [50, 85, 45],
                          [20, 45, 35], [235, 55, 35], [85, 60, 45], [300, 45, 38], [190, 80, 55], [350, 55, 35], [0, 0, 55], [155, 50, 60]];
  const PERSON_TONES = [[62, 48], [70, 62], [50, 36]];
  function personColour(i) {
    if (i < PERSON_COLOURS.length) { const [hue, sat, lum] = PERSON_COLOURS[i]; return `hsl(${hue} ${sat}% ${lum}%)`; }
    const [sat, lum] = PERSON_TONES[i % 3];
    return `hsl(${Math.round(((i * 137.508) % 360) * 1000) / 1000} ${sat}% ${lum}%)`;
  }
  const FACE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="9.6" r="4.4"/>'
    + '<path d="M3.2 24.5c0-5.3 3.9-8.9 8.8-8.9s8.8 3.6 8.8 8.9z"/></svg>';
  function faceOf(id) {
    const w = WORKERS.get(id), box = document.createElement('span');
    box.className = 'fb-face';
    if (w && w.name) box.title = w.name;
    const ph = WPHOTOS[id];
    if (ph && ph.data && /^data:image\//.test(ph.data)) { const img = new Image(); img.alt = ''; img.src = ph.data; box.append(img); return box; }
    box.innerHTML = FACE_SVG;
    if (w && w.place != null) box.style.setProperty('--fc', personColour(Number(w.place)));
    return box;
  }
  // the pictures that changed since this phone last had them: asked once, kept; a failure waits for the next sync
  async function workerPhotos(workers) {
    if (!Array.isArray(workers) || !workers.some(w => 'photo_v' in w)) return;      // a server before FarmBox 0220
    const kept = (await getKV('wphotos')) || {};
    let changed = false;
    for (const id of Object.keys(kept)) if (!workers.some(w => w.id === id && w.photo_v)) { delete kept[id]; changed = true; }
    const want = workers.filter(w => w.photo_v && (kept[w.id] || {}).v !== w.photo_v).map(w => w.id);
    if (want.length) {
      const rows = await api('/rest/v1/rpc/worker_photos', { method: 'POST', body: JSON.stringify({ p_farm: farm.id, p_ids: want }) });
      for (const r of rows || []) if (r.photo_url) { kept[r.id] = { v: r.photo_v, data: r.photo_url }; changed = true; }
    }
    if (changed) await setKV('wphotos', kept);
  }
  async function loadTimers() {
    try { TIMERS = (await getKV('timers')) || {}; } catch (e) { TIMERS = {}; }
    try { const ws = await all('workers'); WNAMES = new Map(ws.map(w => [w.id, w.name])); WORKERS = new Map(ws.map(w => [w.id, w])); }
    catch (e) { WNAMES = new Map(); WORKERS = new Map(); }
    try { WPHOTOS = (await getKV('wphotos')) || {}; } catch (e) { WPHOTOS = {}; }
    try { TTIMES = new Map(((await getKV('task_times')) || []).map(x => [x.task_id, x])); } catch (e) { TTIMES = new Map(); }
    try { EXTRA_SENT = (await getKV('extra_sent')) || {}; } catch (e) { EXTRA_SENT = {}; }
    try { GH_SENT = (await getKV('gh_sent')) || {}; } catch (e) { GH_SENT = {}; }
    try { const c = await getKV('dg_counts'); if (c && c.byTask) DG_COUNTS = c; } catch (e) { /* none yet */ }
    try { DG_UNSENT = new Set((await dgUnsentRounds()).map(x => x.key)); } catch (e) { DG_UNSENT = new Set(); }
    // the tasks whose report is still on this phone (0.11.91): their card says "waiting to send"
    try { WAITING = new Set((await all('outbox')).filter(r => r.payload && r.payload.task_id && !r.payload.__timer && !r.payload.__upload && !r.payload.__feedback)
                              .map(r => r.payload.task_id)); } catch (e) { WAITING = new Set(); }
  }
  const saveTimers = () => setKV('timers', TIMERS).catch(() => {});
  // 0.11.91 (FarmBox 0201): a stretch nobody closed ends when the person stops touching the checklist — the idle limit
  // after the last answer, photo or tap (20 min, or 1.5 × the task's planned time when that is longer), four hours at
  // the most. It was 18:00 of the day: work after 18:00 counted nothing, a checklist left open counted until 18:00.
  const IDLE_MIN = 20, STRETCH_MAX = 4 * 3600000;
  const stretchEnd = (rec, x) => Math.min(x[0] + STRETCH_MAX, Math.max(x[0], (rec && rec.act) || 0) + Math.max(IDLE_MIN, num(rec && rec.lim)) * 60000);
  const segEnd = (x, rec) => x[1] != null ? x[1] : Math.max(x[0], Math.min(Date.now(), stretchEnd(rec, x)));
  const localMin = id => { const rec = TIMERS[id]; return ((rec && rec.segs) || []).reduce((a, x) => a + (segEnd(x, rec) - x[0]) / 60000, 0); };
  const timerRunning = id => { const rec = TIMERS[id]; return ((rec && rec.segs) || []).some(x => x[1] == null && Date.now() < stretchEnd(rec, x)); };
  // everybody's minutes: the server's sum without my part, plus my part as this phone knows it (sent or not)
  function taskMinutes(id) {
    const sv = TTIMES.get(id);
    if (TIMERS[id]) return Math.max(0, (sv ? num(sv.minutes) - num(sv.mine) : 0) + localMin(id));
    return sv ? num(sv.minutes) : 0;
  }
  const groupMinutes = g => (g.members || []).reduce((a, m) => a + taskMinutes(m.id), 0);
  // who (FarmBox 0186, 0.11.84 — owner: "everyone must see if a task is ongoing or finished, and by whom"):
  // the other people with a timer running on it, everybody else who timed it, and who closed it
  const uniq = xs => [...new Set(xs.filter(Boolean))];
  const peopleOn = (g, pick) => uniq((g.members || []).flatMap(m => ((TTIMES.get(m.id) || {}).by || []).filter(pick).map(b => firstName(b.name))));
  const othersRunning = g => peopleOn(g, b => b.running && !b.me);
  const othersTimed = g => peopleOn(g, b => !b.me);
  const doneBy = g => uniq((g.members || []).filter(m => m.status === 'done').map(m => firstName(WNAMES.get(m.done_by))));
  const names = xs => xs.length > 2 ? `${xs[0]} +${xs.length - 1}` : xs.join(' + ');
  // who is responsible for a task (0.11.96, owner 4 Oct 2026): the people it is given to; an extra scouting is its maker's
  function whoIds(g) {
    const ids = [...(g.workerIds || [])];
    const m = /^extra:scouting:([^:]+):/.exec(String(g.generation_key || ''));
    if (m && !ids.includes(m[1])) ids.push(m[1]);
    // in the order of the Tasks board's people column (0.11.115), then as they came
    const at = id => (WORKERS.get(id) || {}).board_sort ?? 1e9;
    return ids.map((id, i) => [id, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(x => x[0]);
  }
  const whoOf = g => uniq(whoIds(g).map(id => firstName(WNAMES.get(id))));
  // the hold (FarmBox 0201): one person on a task at a time. Somebody else's name here = the task is theirs until they
  // finish it, hand it over, a manager takes it back, or the day ends (as of the last sync, a minute at most).
  const heldOther = g => { for (const m of (g.members || [])) { const h = (TTIMES.get(m.id) || {}).held;
    if (h && !h.me && !isClosed(m.status)) return firstName(h.name) || 'Somebody'; } return null; };
  const groupRunning = g => (g.members || []).some(m => timerRunning(m.id));
  const timerTaskOf = g => (g.members || []).find(m => !isClosed(m.status)) || null;
  const timerEvent = (id, action, ms) => ({ __timer: true, client_run_id: `tmr-${id}-${action[0]}-${ms}`, task_id: id, action, at: new Date(ms).toISOString() });
  let preStart = null;       // a start the server has just taken (openTask asks it first when online): { id, ms }
  async function timerStart(id, lim) {
    if (!id || timerRunning(id)) return;
    const now = preStart && preStart.id === id && Date.now() - preStart.ms < 60000 ? preStart.ms : Date.now(), ev = [];
    preStart = null;
    for (const [other, rec] of Object.entries(TIMERS)) {         // one running task a person
      if (other !== id && timerRunning(other)) { rec.segs[rec.segs.length - 1][1] = now; ev.push(timerEvent(other, 'pause', now)); }
    }
    if (!TIMERS[id]) TIMERS[id] = { segs: [] };
    // a stretch that ran out by itself ends where it ran out, before the new one starts
    TIMERS[id].segs.forEach(x => { if (x[1] == null) { x[1] = segEnd(x, TIMERS[id]); ev.push(timerEvent(id, 'pause', x[1])); } });
    TIMERS[id].segs.push([now, null]); TIMERS[id].at = now; TIMERS[id].act = Date.now(); if (lim) TIMERS[id].lim = lim; delete TIMERS[id].closed;
    await saveTimers();
    ev.push(timerEvent(id, 'start', now));
    await queue(ev);
  }
  async function timerPause(id) {
    if (!timerRunning(id)) return;
    const now = Date.now();
    TIMERS[id].segs[TIMERS[id].segs.length - 1][1] = now;
    await saveTimers();
    await queue([timerEvent(id, 'pause', now)]);
  }
  // something was done in the checklist: the timer's idle limit counts from here
  let touchSaved = 0;
  function timerTouch(id) {
    const rec = TIMERS[id]; if (!rec || !timerRunning(id)) return;
    rec.act = Date.now();
    if (rec.act - touchSaved > 20000) { touchSaved = rec.act; saveTimers(); }
  }
  // the task is given back (0.11.91): opened to look, or handed over to somebody else — the server frees it
  async function timerRelease(id) {
    const rec = TIMERS[id], now = Date.now();
    if (rec) { rec.segs.forEach(x => { if (x[1] == null) x[1] = segEnd(x, rec); }); rec.closed = true; }
    await saveTimers();
    await queue([timerEvent(id, 'release', now)]);
  }
  // the task was finished or marked not done: its timer stops here; the server stops its own with the task
  function timerCloseLocal(id) {
    const rec = TIMERS[id]; if (!rec) return;
    rec.segs.forEach(x => { if (x[1] == null) x[1] = segEnd(x, rec); });
    rec.closed = true; saveTimers();
  }
  // at every look at the day: a timer left running stops where its person stopped touching it, old ones go
  async function tidyTimers(groups) {
    const ev = [];
    const closed = new Set((groups || []).flatMap(g => (g.members || []).filter(m => isClosed(m.status)).map(m => m.id)));
    for (const [id, rec] of Object.entries(TIMERS)) {
      const last = rec.segs[rec.segs.length - 1];
      if (last && last[1] == null && (Date.now() >= stretchEnd(rec, last) || closed.has(id))) {
        last[1] = segEnd(last, rec);
        if (!closed.has(id)) ev.push(timerEvent(id, 'pause', last[1]));
      }
      if ((rec.at || 0) < Date.now() - 8 * 86400000) delete TIMERS[id];
    }
    await saveTimers();
    if (ev.length) await queue(ev);
  }
  // the words on the right of a task (the same in the console): Done in 42 min · (play) 12 min · Pause ·
  // (pause) 12 min so far · Not finished · 12 min (an earlier day) · Done (never timed)
  // To do · In progress · Paused · Done · Cancelled · Not done (its day ended, still open) — the same words in the console
  function timeChip(g, late) {
    const m = groupMinutes(g), on = groupRunning(g);
    if (g.status === 'done') {
      const over = m >= 1 && num(g.minutes) > 0 && m > num(g.minutes) * 1.25;
      // done by X, or by X + Y in the time of both (0.11.91): who closed it and everybody who worked on it
      const by = uniq([...doneBy(g), ...peopleOn(g, b => num(b.minutes) >= 1)]);
      const wait = (g.members || []).some(x => WAITING.has(x.id));
      const c = el('span', 'fb-chip ok' + (over ? ' over' : '') + (wait ? ' wait' : ''), ['Done', by.length ? names(by) : null,
        m >= 1 ? fmtWork(m) + (by.length > 1 ? ' total' : '') : null, wait ? 'waiting to send' : null].filter(Boolean).join(' · '));
      if (over) c.title = `planned ${fmtMin(g.minutes)}`;
      return c;
    }
    if (g.status === 'skipped') {
      const x = (g.members || []).find(t => t.status === 'skipped') || {};
      const c = el('span', 'fb-chip skip', 'Cancelled' + (x.skip_reason ? ' · ' + reasonWord(x.skip_reason).toLowerCase() : ''));
      if (x.skip_note) c.title = x.skip_note;
      return c;
    }
    // an extra scouting: its zones say when they were last sent; the card says how many were
    if (!on && (g.extra || g.extraZone) && !heldOther(g)) {
      if (g.extraZone) {
        const at = EXTRA_SENT[g.key];
        return at ? el('span', 'fb-chip ok', 'Sent ' + new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · add more')
                  : el('span', 'fb-chip todo', 'Add photos');
      }
      const n = (g.zones || []).filter(z => EXTRA_SENT[z.key]).length;
      return el('span', 'fb-chip ' + (n ? 'ok' : 'todo'), n ? `${n} zone${n === 1 ? '' : 's'} sent · open all day` : 'Open all day');
    }
    // somebody else holds it (0.11.91): locked, running or paused
    const lock = (g.hub && !g.extra) || on ? null : heldOther(g);
    if (lock) {
      const live = (g.members || []).some(x => (TTIMES.get(x.id) || {}).running);
      return el('span', 'fb-chip run other', `{i:lock} ${live ? 'In progress' : 'Paused'} · ${lock}` + (m >= 1 ? ` · ${fmtWork(m)}` : ''));
    }
    const also = othersRunning(g);
    if (on) {
      const word = 'In progress · ' + (also.length ? `you + ${names(also)} · ` : '') + '{t}';
      const c = el('span', 'fb-chip run', word.replace('{t}', fmtClock(m)));
      c.dataset.timerIds = g.members.map(x => x.id).join(','); c.dataset.timerWord = word;
      return c;
    }
    // somebody else has it running (as of the last sync, a minute at most)
    if (also.length) return el('span', 'fb-chip run other', `In progress · ${names(also)}` + (m >= 1 ? ` · ${fmtWork(m)}` : ''));
    const was = othersTimed(g);
    if (late) return el('span', 'fb-chip late', ['Not done', was.length ? names(was) : null, m >= 1 ? fmtWork(m) : null].filter(Boolean).join(' · '));
    // paused = mine, still held by me; a task somebody started and gave back is free: "To continue" (0.11.91)
    const mine = (g.members || []).some(x => ((TTIMES.get(x.id) || {}).held || {}).me || (TIMERS[x.id] && !TIMERS[x.id].closed && TIMERS[x.id].segs.length));
    if (m >= 1) return el('span', 'fb-chip paused', [mine ? 'Paused' : 'To continue', was.length ? names(was) : null, fmtWork(m)].filter(Boolean).join(' · '));
    if (g.status === 'partial') return el('span', 'fb-chip', `In part · ${g.doneCount}/${g.members.length}`);
    return el('span', 'fb-chip todo', 'To do');
  }
  // a running timer ticks where it shows (the cards, the checklist) without redrawing the page
  setInterval(() => {
    document.querySelectorAll('[data-timer-ids]').forEach(c => {
      const ids = c.dataset.timerIds.split(',');
      const m = ids.reduce((a, id) => a + taskMinutes(id), 0);
      nbLabel(c, (c.dataset.timerWord || '{i:play} {t}').replace('{t}', fmtClock(m)).replace('{m}', fmtWork(m)));
    });
  }, 1000);                 // every second: the timers show their seconds (0.11.62)
  const posLabel = p => p.position_code || p.label || p.code || p.position_name || p.name || p.position_label || null;

  async function loadGroups() {
    const tasks = (await all('tasks')).filter(t => t.status !== 'cancelled')
      .map(t => swipeOverlay.has(t.id) ? { ...t, ...swipeOverlay.get(t.id) } : t);
    const byTask = new Map();
    (await all('positions')).forEach(p => {
      if (!byTask.has(p.task_id)) byTask.set(p.task_id, []);
      byTask.get(p.task_id).push(p);
    });
    const groups = new Map();
    for (const t of tasks) {
      const own = byTask.get(t.id) || (Array.isArray(t.positions) ? t.positions : null);
      // a task that carries its own positions is already grouped by the server;
      // only old-planner rows (a procedure AND a position of their own) fold
      // together — a manual task with neither always stands alone
      const legacyPos = t.position_id || posLabel(t);
      const key = own ? 'srv:' + t.id : t.group_key ? 'grp:' + (t.farm_id || '') + ':' + t.group_key
        : (legacyPos && (t.sop_version_id || t.sop_id))
          ? ['cli', t.farm_id || '', t.sop_version_id || t.sop_id, t.planned_date, t.due_time || '', t.area || '',
             t.crop_name || '', t.title].join('|')
          : 'one:' + t.id;
      let g = groups.get(key);
      if (!g) {
        g = { ...t, key, members: [], positions: [], minutes: 0, quantity: 0, unit: t.unit || null };
        groups.set(key, g);
      }
      g.members.push(t);
      const ps = (own && own.length) ? own
        : [{ task_id: t.id, position_code: posLabel(t), quantity: t.quantity, unit: t.unit, minutes: t.estimated_minutes }];
      ps.forEach(p => g.positions.push({ ...p, task_id: p.task_id || t.id, label: posLabel(p),
        unit: p.unit || t.unit || null, done: t.status === 'done' }));
      g.minutes += num(t.estimated_minutes);
      g.quantity += num(t.quantity);
      if (!g.unit) g.unit = t.unit || ps.find(p => p.unit)?.unit || null;
    }
    const who = new Map();
    (await all('task_workers')).forEach(x => { if (!who.has(x.task_id)) who.set(x.task_id, new Set()); who.get(x.task_id).add(x.worker_id); });
    for (const g of groups.values()) {
      g.workerIds = new Set(g.members.flatMap(m => [...(who.get(m.id) || [])]));
      const done = g.members.filter(m => m.status === 'done').length;
      const shut = g.members.filter(m => isClosed(m.status)).length;
      g.status = done === g.members.length ? 'done' : shut === g.members.length ? 'skipped' : shut ? 'partial' : 'open';
      g.doneCount = shut;
      g.skip_reason = g.members.find(m => m.status === 'skipped')?.skip_reason || null;
      g.openMinutes = g.members.filter(m => !isClosed(m.status)).reduce((s, m) => s + num(m.estimated_minutes), 0);
      if (!g.quantity) g.quantity = g.positions.reduce((s, p) => s + num(p.quantity), 0);
      g.positions.sort((a, b) => String(a.zone_name || '').localeCompare(String(b.zone_name || ''), undefined, { numeric: true })
        || String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true }));
      // drop the placeholder when the old planner gave us nothing to name
      if (g.positions.length === 1 && !g.positions[0].label && !g.positions[0].quantity) g.positions = [];
    }
    // 0.11.67 (owner: "a unique task as before indicating the zones; after a click the 5 separate tasks per zone"):
    // the scouting of one zone is its own task (FarmBox 0172); on the day list a unit's zone scoutings of a day
    // are one card, the hub, which opens on the list of its zones
    const out = [], hubs = new Map();
    for (const g of groups.values()) {
      const gk = String(g.generation_key || '');
      // an extra scouting (0.11.94, FarmBox 0204): one task of a person for the day with every zone as a line. Its card
      // opens on the zones; each zone opens the scouting with every section and no minimum, as often as wanted
      if (gk.startsWith('extra:scouting:')) {
        const items = g.positions.filter(p => p.kind === 'area' && p.ref_id);
        const lines = items.map(x => ({ id: x.id, ref_id: x.ref_id }));
        g.hub = true; g.extra = true;
        g.zones = items.map(it => ({ ...g, hub: false, extra: false, extraZone: true, zones: undefined, key: 'xz:' + g.id + ':' + it.id,
          positions: [it], area: it.label, zone_name: null, zone_id: it.area_zone_id || null, system_id: it.area_system_id || null,
          minutes: 0, quantity: 0, extraItems: lines, sections: ['trap', 'health', 'growth'] }))
          .sort((a, b) => String(a.area || '').localeCompare(String(b.area || ''), undefined, { numeric: true }));
        out.push(g); continue;
      }
      if (!(gk.startsWith('routine:scouting:') && !gk.startsWith('routine:scouting:all:'))) { out.push(g); continue; }
      const hk = 'hub:scouting:' + (g.farm_id || '') + ':' + g.planned_date;
      let h = hubs.get(hk);
      if (!h) { h = { ...g, key: hk, hub: true, zones: [], members: [], positions: [], minutes: 0, quantity: 0, workerIds: new Set() }; hubs.set(hk, h); out.push(h); }
      h.zones.push(g);
      h.members.push(...g.members); h.positions.push(...g.positions);
      h.minutes += g.minutes; h.quantity += g.quantity;
      g.workerIds.forEach(w => h.workerIds.add(w));
    }
    for (const h of hubs.values()) {
      h.zones.sort((a, b) => String(a.positions[0]?.label || a.area || '').localeCompare(String(b.positions[0]?.label || b.area || ''), undefined, { numeric: true }));
      h.positions = h.zones.flatMap(z => z.positions);
      const done = h.members.filter(m => m.status === 'done').length, shut = h.members.filter(m => isClosed(m.status)).length;
      h.status = done === h.members.length ? 'done' : shut === h.members.length ? 'skipped' : shut ? 'partial' : 'open';
      h.doneCount = shut;
      h.skip_reason = h.members.find(m => m.status === 'skipped')?.skip_reason || null;
      h.openMinutes = h.zones.reduce((a, z) => a + z.openMinutes, 0);
      if (h.zones.length === 1) out[out.indexOf(h)] = h.zones[0];      // one zone: no hub needed
    }
    return out;
  }
  // a group by its key, a zone inside a hub included
  const findGroup = (groups, key) => groups.find(x => x.key === key) || groups.find(x => x.id === key)
    || groups.flatMap(x => x.zones || []).find(x => x.key === key || x.id === key) || null;
  const hubOf = (groups, key) => groups.find(x => x.hub && x.zones.some(z => z.key === key)) || null;
  let hubReturn = null;      // the hub a zone's scouting was opened from: Finish and Back come back to it
  const nudged = new Set();  // the extra zones already asked "the planned scouting instead?" in this session

  // "3 positions · 24 trays · 45 min" — only the parts we know. A quantity in
  // positions is the position count already, so it is not said twice.
  const isPosUnit = u => ['position', 'positions'].includes(String(u || '').toLowerCase());
  const qtyBits = g => {
    const n = g.positions.length;
    // one place that is the task's own area (a zone's scouting, 0.11.65) is not said twice; a count of zones is no quantity
    const one = n === 1 ? g.positions[0].label : null;
    return [n > 1 ? `${n} positions` : (one && one !== g.area && one !== g.zone_name ? one : null),
            g.quantity && !isPosUnit(g.unit) && !['system', 'area'].includes(String(g.unit || '').toLowerCase()) ? fmtQty(g.quantity, g.unit) : null,
            g.extra || g.extraZone ? null : fmtMin(g.minutes)].filter(Boolean);       // an extra scouting has no planned time
  };
  const groupMeta = g => [g.zone_name || g.area, ...qtyBits(g)].filter(Boolean).join(' · ');
  // the zones (or bays) a task visits, when its places are zones: "Zones 1 · 2 · 3 · 4.1 · 4.2" (0.11.60)
  const zonesLine = g => {
    const it = (g.positions || []).filter(p => p.kind && p.kind !== 'position');
    if (it.length < 2 || !it.every(p => /^(zone|bay)\s/i.test(p.label || ''))) return null;
    const bays = it.every(p => /^bay\s/i.test(p.label || ''));
    return (bays ? 'Bays ' : 'Zones ') + it.map(p => String(p.label).replace(/^(zone|bay)\s+/i, '').replace(/^(\d+)-(\d+)$/, '$1.$2')).join(' · ');
  };

  // which folds of the day list are open, for as long as the app is open (0.11.40)
  const foldState = { earlier: false, doneToday: false, days: new Set() };
  async function showWeek() {
    // a session refused while a checklist was open (doRefresh): the sign-in form now, instead of a list that sends nothing
    // …and whenever there is no session at all: the same sync that showed the form used to draw the list back over it
    authWanted = false;
    if (!session) { show('auth', 'Sign in', null); return; }
    await feedbackOn();
    const groups = (await loadGroups())
      // plain comparison, not localeCompare: ICU collation sorts punctuation
      // before digits, which put the untimed tasks at the top of the day
      .sort((a, b) => {
        const k = x => x.planned_date + BANDS.indexOf(bandOf(x)) + (slotOf(x) === 'any' ? '1' : '0') + (x.due_time || '99:99:99') + (x.title || '');
        return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;
      });
    const today = todayISO(), horizon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    // whose tasks: everyone, nobody yet, or one person — the person signed in by default (FarmBox 0086)
    // … but for somebody off the task pages (FarmBox 0229, 0.11.123): they see every task and can do any, and are no name in this list
    const workers = (await all('workers')).filter(w => w.active !== false && !w.off_tasks)
      .sort((a, b) => ((a.board_sort ?? 1e9) - (b.board_sort ?? 1e9))      // the order of the Tasks board in Naked Heart (0.11.114)
        || (a.employment === 'casual') - (b.employment === 'casual') || String(a.name).localeCompare(String(b.name)));
    const me = await getKV('me');
    let who = await getKV('who');
    if (!who || (who !== 'all' && who !== 'none' && !workers.some(w => w.id === who))) who = workers.some(w => w.id === me) ? me : 'all';
    // the clock card and the "Now" card are gone (0.11.56): each task times itself
    if ($('clock')) { $('clock').textContent = ''; $('clock').className = 'fb-clock'; }
    await loadTimers(); await tidyTimers(groups);
    const whoBox = $('who'); whoBox.textContent = '';
    if (workers.length) {
      const sel = el('select', 'fb-who-sel');
      [['all', 'Everyone'], ['none', 'Nobody yet'], ...workers.map(w => [w.id, w.name + (w.id === me ? ' (me)' : '') + (w.employment === 'casual' ? ' · on demand' : w.employment === 'part_time' ? ' · part time' : '')])]
        .forEach(([v, label]) => { const o = el('option', null, label); o.value = v; sel.append(o); });
      sel.value = who;
      sel.setAttribute('aria-label', 'Whose tasks');
      sel.onchange = async () => { await setKV('who', sel.value); showWeek(); };
      if (WORKERS.has(who)) whoBox.append(faceOf(who));
      whoBox.append(sel);
    }
    // sister units (0.11.37): both units by default, or one of them
    const units = (await getKV('sisters')) || [];
    const unitOf = t => units.find(u => u.id === t.farm_id) || null;
    let unit = await getKV('unit');
    if (!units.some(u => u.id === unit)) unit = 'all';
    if (units.length > 1) {
      const us = el('select', 'fb-who-sel');
      [['all', 'Both units'], ...units.map(u => [u.id, u.name])]
        .forEach(([v, label]) => { const o = el('option', null, label); o.value = v; us.append(o); });
      us.value = unit;
      us.setAttribute('aria-label', 'Which unit');
      us.onchange = async () => { await setKV('unit', us.value); showWeek(); };
      whoBox.append(us);
    }
    const mine = t => (unit === 'all' || t.farm_id === unit) &&
      (who === 'all' ? true : who === 'none' ? t.workerIds.size === 0
        : t.workerIds.has(who) || (t.extra && String(t.generation_key || '').includes(':' + who + ':')));
    // + Extra scouting (0.11.94): anybody, any time, any zone — beside the planned scouting, never instead of it
    let xb = $('extra');
    if (!xb) {
      xb = document.createElement('button'); xb.id = 'fb-extra'; xb.type = 'button'; xb.className = 'btn btn-block fb-extra';
      // 0.11.132: Digital scouting in its place — the day's live scouting page; no new extra scouting is started
      nbLabel(xb, '{i:camera} Digital scouting');
      xb.title = 'The day\'s scouting, live: see and add photos, notes and traps in each zone';
      xb.onclick = () => openDigital({});
      whoBox.after(xb);
    }
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const past = groups.filter(t => t.planned_date < today && t.planned_date >= weekAgo && mine(t));
    const week = groups.filter(t => t.planned_date >= today && t.planned_date <= horizon && mine(t));
    await refreshSW();   // what a swipe needs to know about each card (0.11.27)

    show('week', 'Tasks', null);
    $('weekSub').textContent = units.length > 1
      ? (unit === 'all' ? units.map(u => u.name).join(' + ') : (units.find(u => u.id === unit) || {}).name || '')
      : farm ? farm.name : 'Your farm work, day by day.';
    // "Pull ⟳" was no gesture here, and when it is the person or the unit chosen above that empties the list, a sync brings nothing
    $('empty').textContent = who !== 'all' || unit !== 'all' ? 'No tasks for this choice — change it above to see the others.' : 'Nothing planned yet. Tap ⟳ to sync.';
    $('empty').classList.toggle('hidden', week.length + past.length > 0);

    // the task in progress, at the top of the day (0.11.61): a timer left running is hard to miss
    const nx = $('next'); nx.textContent = '';
    const going = groups.find(g => !isClosed(g.status) && groupRunning(g));
    if (going) {
      const strip = el('div', 'fb-going');
      const txt = el('div', 'fb-going-text');
      txt.append(el('small', null, 'In progress'), el('b', null, going.title));
      const tm = el('span', 'fb-going-time', `{i:play} ${fmtClock(groupMinutes(going))}`);
      tm.dataset.timerIds = going.members.map(x => x.id).join(','); tm.dataset.timerWord = '{i:play} {t}';
      const pz = el('button', 'btn btn-sm', '{i:pause}'); pz.title = 'Pause'; pz.setAttribute('aria-label', 'Pause ' + going.title);
      pz.onclick = async e => { e.stopPropagation(); for (const x of going.members) await timerPause(x.id); showWeek(); };
      const op = el('button', 'btn btn-sm btn-primary', 'Open');
      op.onclick = e => { e.stopPropagation(); openTask(going.key); };
      strip.onclick = () => openTask(going.key);
      strip.append(txt, tm, pz, op);
      nx.append(strip);
    }

    const byDay = list => { const m = new Map(); list.forEach(t => { if (!m.has(t.planned_date)) m.set(t.planned_date, []); m.get(t.planned_date).push(t); }); return m; };
    const openOf = list => list.filter(t => !isClosed(t.status));
    const minsOf = list => openOf(list).reduce((s, t) => s + t.openMinutes, 0);
    const workedOf = list => list.reduce((s, t) => s + groupMinutes(t), 0);
    // a day's line: 5 of 8 done · 3 h 10 worked · then what is left (planned) or, for a day gone by, not finished
    const dayLine = (list, past) => {
      const done = list.filter(t => t.status === 'done').length, open = openOf(list).length, w = workedOf(list);
      const cancelled = list.filter(t => t.status === 'skipped').length;
      return [`${done} of ${list.length} done`, w >= 1 ? `${fmtWork(w)} worked` : null,
              open ? (past ? `${open} not done` : `${open} to do, ${fmtMin(minsOf(list))} planned`) : null,
              cancelled ? `${cancelled} cancelled` : null].filter(Boolean).join(' · ');
    };
    // a day's work: one block per unit (sister units), the morning above the line, the afternoon under it
    const dayBody = (list, date, withClosed) => {
      const frag = document.createDocumentFragment();
      const blocks = units.length > 1
        ? units.map(u => [u, list.filter(t => t.farm_id === u.id)]).filter(([, l]) => l.length)
        : [[null, list]];
      const orphans = units.length > 1 ? list.filter(t => !unitOf(t)) : [];
      if (orphans.length) blocks.push([null, orphans]);
      for (const [u, part0] of blocks) {
        if (u) {
          const h = el('div', 'fb-unit');
          h.style.setProperty('--u', u.colour || 'var(--text-muted)');
          const left = openOf(part0).length;
          const w = workedOf(part0);
          h.append(el('span', 'fb-ubadge', u.badge || u.code), el('span', null, u.name),
                   el('span', 'fb-ucount', `${left} open` + (left ? ' · ' + fmtMin(minsOf(part0)) : '') + (w >= 1 ? ` · ${fmtWork(w)} worked` : '')));
          frag.append(h);
        }
        BANDS.forEach(slot => {
          const part = part0.filter(t => bandOf(t) === slot && (withClosed || !isClosed(t.status)));
          frag.append(el('div', 'fb-slot ' + slot, SLOT_WORD[slot] + (part.length ? '' : ' — nothing')));
          part.forEach(t => frag.append(taskCard(t, date < today && !isClosed(t.status))));
        });
      }
      return frag;
    };
    const fold = (cls, open, onToggle) => { const d = el('details', 'fb-fold ' + cls); d.open = open; d.ontoggle = () => onToggle(d.open); return d; };

    const days = $('days'); days.textContent = '';
    // the days behind, folded: a red dot where something was left undone; a done task opens to be edited (0.11.40)
    if (past.length) {
      const left = openOf(past).length;
      const det = fold('fb-earlier', foldState.earlier, v => { foldState.earlier = v; });
      const sum = el('summary');
      if (left) sum.append(el('span', 'fb-dot'));
      sum.append(el('span', 'fb-fold-title', 'Earlier'), el('span', 'fb-fold-meta', left ? `${left} not done — tap to finish` : 'all closed'));
      det.append(sum);
      [...byDay(past)].sort((x, y) => (x[0] < y[0] ? 1 : -1)).forEach(([date, list]) => {
        const sec = el('section', 'fb-day');
        const n = openOf(list).length;
        const h = el('h2', null, `${fmtDay(date)} · ${dayLine(list, true)}`);
        if (n) h.prepend(el('span', 'fb-dot'));
        sec.append(h, dayBody(list, date, true));
        det.append(sec);
      });
      days.append(det);
    }
    const ahead = byDay(week);
    // today: what is closed today folded at the top (0.11.78, owner: "on the top, not at the bottom"), then the open work
    const todays = ahead.get(today) || [];
    const sec = el('section', 'fb-day');
    sec.append(el('h2', null, todays.length ? `${fmtDay(today)} · ${dayLine(todays, false)}` : fmtDay(today)));
    const shut = todays.filter(t => isClosed(t.status));
    if (shut.length) {
      const det = fold('fb-done-today', foldState.doneToday, v => { foldState.doneToday = v; });
      det.append(el('summary', null, `Closed today · ${shut.length}`));
      shut.forEach(t => det.append(taskCard(t, false)));
      sec.append(det);
    }
    if (todays.length) sec.append(dayBody(todays, today, false));
    else sec.append(el('div', 'config-hint', 'Nothing planned today.'));
    days.append(sec);
    // the days ahead, closed until opened
    for (const [date, list] of ahead) {
      if (date === today) continue;
      const det = fold('fb-ahead', foldState.days.has(date), v => { if (v) foldState.days.add(date); else foldState.days.delete(date); });
      const sum = el('summary');
      sum.append(el('span', 'fb-fold-title', fmtDay(date)),
                 el('span', 'fb-fold-meta', `${list.length} task${list.length === 1 ? '' : 's'}` + (minsOf(list) ? ` · ${fmtMin(minsOf(list))}` : '')));
      det.append(sum, dayBody(list, date, true));
      days.append(det);
    }
    paintFoot();
  }


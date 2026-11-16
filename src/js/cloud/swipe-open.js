//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- swipe a task, open a task. Edit here, then run: python build.py
  // ── swipe a task (0.11.27): right = done (no input needed), left = not done ──
  const isClosed = st => st === 'done' || st === 'skipped';
  const SW = { sops: new Map(), steps: new Map(), me: null, admin: false };
  async function refreshSW() {
    SW.sops = new Map((await all('sops')).map(x => [x.id, x]));
    SW.steps = new Map();
    (await all('steps')).forEach(x => { if (!SW.steps.has(x.version_id)) SW.steps.set(x.version_id, []); SW.steps.get(x.version_id).push(x); });
    SW.me = await getKV('me');
    SW.admin = (await all('workers')).some(w => w.id === SW.me && w.role === 'farm_admin');
    SW.manager = SW.admin || (await all('workers')).some(w => w.id === SW.me && w.role === 'farm_manager');   // may take a held task back (0.11.93)
  }
  const swipeOverlay = new Map();                   // task id → the state held for the five seconds of Undo
  // why a task is cancelled (0.11.61, FarmBox 0168): a real choice — "no time" is what Not done says by itself
  const REASONS = [['not_needed', 'Not needed'], ['equipment', 'Equipment not available'], ['weather', 'Weather or access'], ['other', 'Other']];
  const OLD_REASONS = { no_time: 'No time', blocked: 'Weather or equipment' };
  const reasonWord = r => (REASONS.find(x => x[0] === r) || [r, OLD_REASONS[r] || r || ''])[1];
  const INPUT_MODULES = ['harvest', 'scouting', 'ipm_traps'];

  // how many answers a task asks for: a weight per batch for a harvest, else its checklist's
  // steps — once per place when the routine runs its steps in each (0078). 0 = swipe it done.
  function inputsOf(g) {
    if (canSwipeDone(g)) return 0;
    const sop = SW.sops.get(g.sop_id);
    if (!sop) return 0;
    if (sop.attributes?.module === 'scouting') return 'photos';
    if (sop.attributes?.module === 'harvest') return g.positions.filter(p => !isItem(p)).length || 1;
    const steps = (SW.steps.get(g.sop_version_id) || []).length;
    const places = g.positions.filter(isItem).length;
    return steps * (sop.one_task && places > 1 ? places : 1);
  }

  function canSwipeDone(g) {
    const sop = SW.sops.get(g.sop_id);
    if (!g.sop_id) return true;                       // a task with no procedure: nothing to fill in
    if (!sop) return false;
    if (INPUT_MODULES.includes(sop.attributes?.module)) return false;
    if (sop.one_task && g.positions.some(isItem)) return false;
    return sop.validation === 'tick' || !!sop.swipe_done;
  }
  // what a task asks for, said in a few words
  function needsOf(g) {
    const sop = SW.sops.get(g.sop_id);
    const m = sop?.attributes?.module;
    if (m === 'harvest') return 'the weight of each batch';
    if (m === 'scouting') return 'trap photos, then OK or not OK';
    if (m === 'ipm_traps') return 'a photo and a count for each trap';
    const steps = SW.steps.get(g.sop_version_id) || [];
    const readings = steps.filter(x => x.step_type === 'measure' || x.step_type === 'record').length;
    const photos = steps.filter(x => /photo|video/.test(x.evidence || '')).length;
    const zones = sop?.one_task ? g.positions.filter(isItem).length : 0;
    const bits = [readings ? `${readings} reading${readings > 1 ? 's' : ''}` : null, photos ? `${photos} photo${photos > 1 ? 's' : ''}` : null].filter(Boolean);
    const each = zones > 1 ? ` in each of ${zones} places` : '';
    return bits.length ? bits.join(' and ') + each : `its checklist (${steps.length} step${steps.length === 1 ? '' : 's'})` + each;
  }
  const maySkip = g => SW.admin || (SW.me && g.workerIds.has(SW.me));

  function swipeable(card, g) {
    const wrap = el('div', 'fb-swipe');
    wrap.append(el('div', 'fb-swipe-bg left', '✓ Done'), el('div', 'fb-swipe-bg right', 'Cancel ✕'), card);
    let x0 = null, y0 = null, dx = 0, on = false, width = 0;
    card.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // away from the screen's edges: those belong to the phone's back gesture
      if (e.clientX < 24 || e.clientX > window.innerWidth - 24) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; on = false; width = wrap.clientWidth;
    });
    card.addEventListener('pointermove', e => {
      if (x0 == null) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!on) {
        if (Math.abs(mx) < 12) return;
        if (Math.abs(mx) < Math.abs(my) * 1.5) { x0 = null; return; }   // a scroll, not a swipe
        on = true; card.setPointerCapture?.(e.pointerId); wrap.classList.add('moving');
      }
      dx = mx;
      card.style.transform = `translateX(${dx}px)`;
      wrap.classList.toggle('to-right', dx > 0); wrap.classList.toggle('to-left', dx < 0);
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      if (!on) return;
      card.dataset.swiped = '1';
      setTimeout(() => delete card.dataset.swiped, 400);
      wrap.classList.remove('moving');
      const far = Math.abs(dx) > width * 0.35;
      card.style.transform = '';
      wrap.classList.remove('to-right', 'to-left');
      if (!far || isClosed(g.status)) return;
      if (dx > 0) swipeDone(g); else swipeNotDone(g);
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
    return wrap;
  }

  // an extra scouting (0.11.96, owner: "could be cancelled or marked as done with a swipe without any other questions"):
  // right = done, left = cancelled — no reason, no note, only the five seconds of Undo. Its maker or the Admin.
  // photos of an extra scouting still only in its zones' drafts on this phone: closing the task would leave them in no
  // report (0.11.113 — an extra cancelled on 5 Oct 2026 left 7 uploaded photos with nothing pointing to them)
  async function extraUnsent(g) {
    try {
      const pre = 'scout2:xz:' + g.id + ':';
      let n = 0, key = null;
      (await allKV()).filter(r => String(r.id).startsWith(pre)).forEach(r => {
        const k = ((r.v || {}).photos || []).reduce((sum, q) => sum + (q.section === 'trap'
          ? Object.values(q.sides || {}).filter(S => S && !S.sent && (S.full instanceof Blob || S.photo_path)).length
          : (q.sent ? 0 : 1)), 0);
        if (k) { n += k; key = key || String(r.id).slice(7); }
      });
      return { n, key };
    } catch (e) { return { n: 0, key: null }; }
  }

  function swipeExtra(g, done, checked) {
    if (g.extraZone) { notice('Swipe the Extra scouting card itself — this is one of its zones.'); return; }
    if (!(SW.admin || whoOf(g).length === 0 || (SW.me && String(g.generation_key || '').includes(':' + SW.me + ':')) || maySkip(g))) {
      notice('Only the person who started this extra scouting, or the Admin, can close it.'); return;
    }
    if (!checked) {
      extraUnsent(g).then(u => {
        if (u.n) notice(`${u.n} photo${u.n === 1 ? ' is' : 's are'} not sent yet — open the zone and tap Finish first, or ${u.n === 1 ? 'it' : 'they'} will be in no report.`, () => openTask(u.key));
        else swipeExtra(g, done, true);
      });
      return;
    }
    const open = g.members.filter(m => !isClosed(m.status));
    if (!open.length) return;
    const now = new Date().toISOString();
    const patch = done ? { status: 'done', done_at: now } : { status: 'skipped', skip_reason: 'not_needed', skip_note: null };
    open.forEach(t => swipeOverlay.set(t.id, patch));
    showWeek();
    holdForUndo(`${done ? 'Done' : 'Cancelled'}: ${g.title}`, async () => {
      open.forEach(t => swipeOverlay.delete(t.id));
      await putAll('tasks', open.map(t => ({ ...t, ...patch })));
      // quiet: an extra that never reached the server has nothing to close there
      await queue(open.map(t => done
        ? { __tick: true, quiet: true, client_run_id: 'tick-' + t.id, task_id: t.id, actual_minutes: null }
        : { __skip: true, quiet: true, client_run_id: 'skip-' + t.id, task_id: t.id, reason: 'not_needed', note: null }));
    }, () => { open.forEach(t => swipeOverlay.delete(t.id)); showWeek(); });
  }

  function swipeDone(g) {
    if (g.extra || g.extraZone) return swipeExtra(g, true);
    if (g.status === 'partial') { notice('Part of this is done already — open it to finish the rest.', () => openTask(g.key)); return; }
    if (!canSwipeDone(g)) { notice(`This one needs input: ${needsOf(g)}.`, () => openTask(g.key)); return; }
    const open = g.members.filter(m => !isClosed(m.status));
    const now = new Date().toISOString();
    open.forEach(t => swipeOverlay.set(t.id, { status: 'done', done_at: now }));
    showWeek();
    holdForUndo(`Done: ${g.title}`, async () => {
      const rows = open.map(t => ({ ...t, status: 'done', done_at: now }));
      open.forEach(t => swipeOverlay.delete(t.id));
      await putAll('tasks', rows);
      await queue(open.map(t => ({ __tick: true, client_run_id: 'tick-' + t.id, task_id: t.id, actual_minutes: null })));
    }, () => { open.forEach(t => swipeOverlay.delete(t.id)); showWeek(); });
  }

  function swipeNotDone(g) {
    if (g.extra || g.extraZone) return swipeExtra(g, false);
    if (!maySkip(g)) { notice('Only the Admin or the people on this task can cancel it.'); return; }
    // cancelling is a decision (0.11.61): a reason chosen and a note saying why
    const sheet = el('div', 'fb-sheet');
    const card = el('div', 'fb-sheet-card');
    card.append(el('h3', null, 'Cancel this task'), el('div', 'fb-meta', g.title));
    let reason = null;
    const row = el('div', 'fb-actions');
    const btns = REASONS.map(([v, l]) => {
      const b = el('button', 'fb-btn', l);
      b.setAttribute('aria-pressed', String(v === reason));
      b.onclick = () => { reason = v; btns.forEach(([vv, bb]) => bb.setAttribute('aria-pressed', String(vv === reason))); };
      row.append(b);
      return [v, b];
    });
    const note = el('textarea', 'fb-runnote'); note.rows = 2; note.placeholder = 'Why? (the manager reads it)';
    const acts = el('div', 'fb-actions'); acts.style.justifyContent = 'flex-end'; acts.style.marginTop = 'var(--space-3)';
    const cancel = el('button', 'fb-btn', 'Keep it');
    const ok = el('button', 'fb-btn fb-btn-primary', 'Cancel the task');
    acts.append(cancel, ok);
    card.append(row, note, acts);
    sheet.append(card);
    document.body.append(sheet);
    const close = () => sheet.remove();
    cancel.onclick = close;
    sheet.onclick = e => { if (e.target === sheet) close(); };
    ok.onclick = () => {
      if (!reason) { showToast('Choose why it is cancelled', 'error'); return; }
      if (!note.value.trim()) { showToast('Say why in the note', 'error'); note.focus(); return; }
      close();
      const open = g.members.filter(m => !isClosed(m.status));
      const text = note.value.trim() || null;
      open.forEach(t => swipeOverlay.set(t.id, { status: 'skipped', skip_reason: reason, skip_note: text }));
      showWeek();
      holdForUndo(`Cancelled (${reasonWord(reason).toLowerCase()}): ${g.title}`, async () => {
        const rows = open.map(t => ({ ...t, status: 'skipped', skip_reason: reason, skip_note: text }));
        open.forEach(t => swipeOverlay.delete(t.id));
        await putAll('tasks', rows);
        await queue(open.map(t => ({ __skip: true, client_run_id: 'skip-' + t.id, task_id: t.id, reason, note: text })));
      }, () => { open.forEach(t => swipeOverlay.delete(t.id)); showWeek(); });
    };
  }

  // five seconds to change one's mind; the change is kept at once if the app is put away
  let pendingSwipe = null;
  // the swipe is kept after its five seconds wherever the person is by then; the list is drawn again only when it is
  // the list that is on screen — a task opened meanwhile was closed under the person's hands by this redraw
  const redrawWeek = () => { if (!$('week').classList.contains('hidden')) showWeek(); };
  function holdForUndo(label, commit, revert) {
    if (pendingSwipe) { clearTimeout(pendingSwipe.timer); const p = pendingSwipe; pendingSwipe = null; p.commit().then(() => redrawWeek()); }
    let bar = document.getElementById('fb-undo');
    if (!bar) { bar = el('div', 'fb-undo'); bar.id = 'fb-undo'; document.body.append(bar); }
    // a notice shown just before left its own timer running: it hid this Undo bar before its five seconds were over
    clearTimeout(bar._t); bar.classList.remove('info');
    bar.textContent = '';
    const undo = el('button', 'fb-link', 'Undo');
    bar.append(el('span', null, label), undo);
    bar.classList.add('show');
    const finish = async () => { bar.classList.remove('show'); const p = pendingSwipe; pendingSwipe = null; if (p) { await p.commit(); redrawWeek(); } };
    pendingSwipe = { commit, revert, timer: setTimeout(finish, 5000) };
    undo.onclick = () => { if (!pendingSwipe) return; clearTimeout(pendingSwipe.timer); const p = pendingSwipe; pendingSwipe = null; bar.classList.remove('show'); p.revert(); };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pendingSwipe) { clearTimeout(pendingSwipe.timer); const p = pendingSwipe; pendingSwipe = null; document.getElementById('fb-undo')?.classList.remove('show'); p.commit(); }
  });

  // a short message with an optional Open
  function notice(text, onOpen) {
    let bar = document.getElementById('fb-undo');
    if (!bar) { bar = el('div', 'fb-undo'); bar.id = 'fb-undo'; document.body.append(bar); }
    if (pendingSwipe) { clearTimeout(pendingSwipe.timer); const p = pendingSwipe; pendingSwipe = null; p.commit().then(() => redrawWeek()); }
    bar.textContent = '';
    bar.append(el('span', null, text));
    if (onOpen) { const o = el('button', 'fb-link', 'Open'); o.onclick = () => { bar.classList.remove('show'); onOpen(); }; bar.append(o); }
    bar.classList.add('show', 'info');
    clearTimeout(bar._t);
    bar._t = setTimeout(() => bar.classList.remove('show', 'info'), 4500);
  }

  // Positions the task covers, one line each: name · quantity · minutes —
  // by zone when the task spans more than one (a farm-wide sowing), and
  // with the crop on the line when the task carries more than one (0073).
  const sowingLine = x => {
    if (!x || typeof x !== 'object') return '';
    const n = v => (v === '' || v == null ? null : Number(v));
    return [n(x.seeds_per_plug) != null ? `${n(x.seeds_per_plug)} seed${n(x.seeds_per_plug) === 1 ? '' : 's'}/plug` : null,
            n(x.seed_g_per_tray) != null ? `${n(x.seed_g_per_tray)} g/tray` : null,
            n(x.depth_mm) != null ? (n(x.depth_mm) === 0 ? 'on the surface' : `${n(x.depth_mm)} mm deep`) : null,
            x.cover && x.cover !== 'none' ? String(x.cover) : null,
            n(x.blackout_days) != null ? `blackout ${n(x.blackout_days)} d` : null,
            x.germination_c ? `${x.germination_c} °C` : null,
            x.notes || null].filter(Boolean).join(' · ');
  };
  const isItem = p => p.kind && p.kind !== 'position';
  const cropsOf = g => new Set(g.positions.map(p => p.crop_name).filter(Boolean));
  const zonesOf = g => new Set(g.positions.map(p => p.zone_name).filter(Boolean));
  function positionList(g) {
    const box = el('div', 'fb-pos');
    const items = g.positions.every(isItem);
    box.append(el('div', 'fb-sec', `${items ? 'Items' : 'Positions'} · ${g.positions.length}`));
    const manyCrops = cropsOf(g).size > 1, manyZones = zonesOf(g).size > 1;
    let lastZone = null;
    g.positions.forEach(p => {
      if (manyZones && p.zone_name && p.zone_name !== lastZone) {
        box.append(el('div', 'fb-pos-row zone', p.zone_name)); lastZone = p.zone_name;
      }
      const r = el('div', 'fb-pos-row' + (p.done ? ' done' : ''));
      const name = el('span', 'fb-pos-name', [p.label || (isItem(p) ? 'Item' : 'Position'), manyCrops ? p.crop_name : null].filter(Boolean).join(' · '));
      if (isItem(p) && p.done_at) r.classList.add('done');
      // the crop's sowing figures under the batch on a sowing / nursery task (FarmBox 0074)
      const sow = sowingLine(p.sowing);
      if (sow) name.append(el('small', 'fb-pos-sow', sow));
      r.append(name);
      const right = [p.quantity != null && p.quantity !== '' && !isPosUnit(p.unit || g.unit) ? fmtQty(p.quantity, p.unit || g.unit) : null,
                     p.minutes != null ? fmtMin(p.minutes) : null].filter(Boolean).join(' · ');
      r.append(el('span', 'fb-pos-val', right || (p.done ? 'done' : '')));
      box.append(r);
    });
    const tot = el('div', 'fb-pos-row total');
    tot.append(el('span', 'fb-pos-name', 'Total'));
    tot.append(el('span', 'fb-pos-val', [g.quantity && !isPosUnit(g.unit) ? fmtQty(g.quantity, g.unit) : null, fmtMin(g.minutes)].filter(Boolean).join(' · ')));
    box.append(tot);
    return box;
  }

  // a tap on a task (0.11.60): straight into its checklist (the timer starts); a task with no checklist asks
  // "mark it done?"; a done one opens what was sent to edit it; a "not done" one opens to be done after all
  // one opening at a time: a double tap started the timer and the run twice (review 16 Nov 2026)
  let openingTask = false;
  async function openTask(key, fromHub = null) {
    if (openingTask) return;
    openingTask = true;
    try { return await openTaskNow(key, fromHub); } finally { openingTask = false; }
  }
  async function openTaskNow(key, fromHub = null) {
    const groups = await loadGroups();
    const t = findGroup(groups, key);
    if (!t) return;
    if (t.hub) { hubReturn = null; extraPick = false; return openHub(t); }
    // (0.11.95 asked "the planned scouting instead?" when opening a zone of an extra; removed in 0.11.102, owner: "remove
    // message for extra scouting" — an extra opens straight away)
    hubReturn = fromHub || hubOf(groups, t.key)?.key || null;     // a zone of a hub comes back to it
    const sop = (await all('sops')).find(s => s.id === t.sop_id);
    await refreshSW();
    const hasChecklist = !!sop && (sop.validation || 'checklist') !== 'tick';
    if (t.extraZone && sop) return startRun(t, sop);      // an extra's zone always opens to add, even once the extra is closed
    // the daily scouting of a zone (0.11.132): Digital scouting at that zone — the round and its Finish are no longer
    // used for a new day; a done run of before still opens to be changed, as it did
    { const gk0 = String(t.generation_key || '');
      if (sop && isScouting(sop) && gk0.startsWith('routine:scouting:') && !gk0.startsWith('routine:scouting:all:')
          && (t.status !== 'done' || String(t.planned_date) >= DG_SINCE)) {
        const day = t.planned_date > todayISO() ? todayISO() : t.planned_date;
        return openDigital({ day, taskId: day === t.planned_date ? (t.members?.[0]?.id || t.id) : null });
      } }
    if (t.status === 'done') {
      // a zone scouting finished today by somebody else (0.11.97): this person's photos go in as an extra of that zone
      const gk = String(t.generation_key || '');
      if (hasChecklist && isScouting(sop) && gk.startsWith('routine:scouting:') && !gk.startsWith('routine:scouting:all:')
          && t.planned_date === todayISO() && !(SW.admin || SW.manager || (SW.me && t.workerIds.has(SW.me)))
          && !(await getKV(sentKey(t.members[0].id)).catch(() => null))) {
        const xk = await extraZoneFor(t);
        if (xk) {
          await loadTimers();
          const by = uniq([...doneBy(t), ...peopleOn(t, b => num(b.minutes) >= 1)]);
          showToast(`${t.area || 'This zone'} was scouted${by.length ? ' by ' + names(by) : ''} — what you add goes in as extra`, 'info');
          nudged.add(xk); extraPick = false;
          return openTaskNow(xk, fromHub || hubOf(groups, t.key)?.key || null);
        }
      }
      if (hasChecklist) return editTask(t, sop);
      await loadTimers();
      const by = uniq([...doneBy(t), ...peopleOn(t, b => num(b.minutes) >= 1)]);
      showToast(`Done ✓${by.length ? ' by ' + names(by) : ''} — a task without a checklist has nothing to add to`, 'info'); return;
    }
    if (t.status === 'skipped') {
      if (hasChecklist) return startRun(t, sop);
      if (confirm(`${t.title} — mark it done after all?`)) await markDone(t);
      return;
    }
    // a task of a later day (0.11.73, owner 30 Sept 2026: the evening of the 29th scouted Zone 1 on the task of the 30th, so
    // the 30th said "1 of 5 done" with no photo): offer today's same task first, then ask before starting it early
    if (t.planned_date > todayISO()) {
      const when = fmtDay(t.planned_date);
      const same = groups.flatMap(g => g.hub ? g.zones : [g]).find(g => g.key !== t.key && g.planned_date === todayISO()
        && g.sop_id === t.sop_id && (g.area || '') === (t.area || '') && (g.farm_id || '') === (t.farm_id || '') && !isClosed(g.status));
      if (same && confirm(`This is the task for ${when}.\n\nToday's "${t.title}"${t.area ? ' · ' + t.area : ''} is still open — do today's instead?`))
        return openTaskNow(same.key, fromHub);
      if (!confirm(`This task is for ${when}, not today.\n\nDo it now anyway? What you record counts for today in the report.`)) return;
    }
    // somebody else has this task running (0.11.84): two people sending the same task makes two reports
    await loadTimers();
    // one person on a task at a time (0.11.91, FarmBox 0201): a task somebody else has open — running or paused — stays
    // theirs until they finish it or hand it over; an Admin or a manager can take it back
    const lock = heldOther(t);
    if (lock && !groupRunning(t)) {
      if (!(SW.manager && navigator.onLine)) { showToast(`${lock} is on this task — it opens when ${lock} finishes or hands it over`, 'error'); return; }
      if (!confirm(`${lock} is on this task.\n\nTake it back from ${lock}? What ${lock} has not sent stays on ${lock}'s phone.`)) return;
      try { for (const m of t.members.filter(x => !isClosed(x.status))) await api('/rest/v1/rpc/release_task', { method: 'POST', body: JSON.stringify({ p_task: m.id }) }); }
      catch (e) { showToast('Could not take it back — ' + String(e.message || e).replace(/^\d+ /, '').slice(0, 80), 'error'); return; }
      liveSay();
    }
    if (!hasChecklist) { if (confirm(`${t.title} — mark it done?`)) await markDone(t); return; }
    // online: the server is asked first, so two phones opening the same task in the same minute do not both get in
    const tt = timerTaskOf(t);
    let handed = null;
    if (tt && navigator.onLine && !timerRunning(tt.id)) {
      const ms = Date.now(), quick = pr => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3500))]);
      try {
        const r = await quick(api('/rest/v1/rpc/task_timer', { method: 'POST', body: JSON.stringify({ p_task: tt.id, p_action: 'start',
          p_at: new Date(ms).toISOString(), p_client: `tmr-${tt.id}-s-${ms}` }) }));
        if (r && r.refused) { showToast(`${firstName(r.held_by) || 'Somebody else'} is on this task — it opens when it is finished or handed over`, 'error'); sync(false, true).catch(() => {}); return; }
        if (r && r.ignored && r.status === 'done') { showToast(`Already done${r.done_by ? ' by ' + firstName(r.done_by) : ''}`, 'info'); sync(false, true).catch(() => {}); return; }
        if (r && !r.ignored) preStart = { id: tt.id, ms };
        // handed over by somebody else: their report so far comes with it (when this phone has no draft of its own)
        const mine = await getKV(isScouting(sop) ? scDraftKey(t) : runDraftKey(t)).catch(() => null);
        if (!mine && othersTimed(t).length) {
          const d = await quick(api('/rest/v1/rpc/run_detail', { method: 'POST', body: JSON.stringify({ p_task: tt.id }) }));
          if (d && d.run && ((d.steps || []).length || (d.traps || []).length || (d.observations || []).length)) handed = { ...d, resume: true };
        }
      } catch (e) { /* no answer in time: carry on as offline, the outbox sends the start */ }
    }
    await startRun(t, sop, handed);
    if (handed) showToast(`Continuing what ${firstName(handed.run.by) || 'somebody'} started — it stays one report`, 'info');
  }

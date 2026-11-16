//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- old scouting: scoutSections, one long function. Edit here, then run: python build.py
  // ── the screen ──────────────────────────────────────────────────────────
  async function scoutSections(task, sop, detail) {
    // 0.11.65 (FarmBox 0172): the scouting is one task a zone — its zone line says which, and only that zone's
    // traps are listed (a card of the zone that names no table counts in each of its tables). An older task
    // covering every zone still lists them all.
    const zoneLines = task.positions.filter(x => x.area_zone_id);
    const zoneIds = new Set(zoneLines.map(x => x.area_zone_id)), sysIds = new Set(zoneLines.map(x => x.area_system_id).filter(Boolean));
    const traps = (await all('traps')).filter(t => t.active !== false && (!t.farm_id || !task.farm_id || t.farm_id === task.farm_id))
      .filter(t => !zoneIds.size || (zoneIds.has(t.zone_id) && (!t.system_id || !sysIds.size || sysIds.has(t.system_id))))
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    // the zone's number for a position written as its row alone: B6 in Zone 4-1 is 4.1B6
    const zonePrefix = (() => { const z = zoneLines.length === 1 ? zoneShort(zoneLines[0].label || zoneLines[0].zone_name) : '';
                                return /^\d+(\.\d+)?$/.test(z) ? z : ''; })();
    const fullPos = v => { const c = String(v || '').toUpperCase().replace(/\s/g, '');
                           return c && /^[A-Z]/.test(c) && zonePrefix ? zonePrefix + c : c; };
    const th = (await getKV('ipm_threshold')) || { watch: 25, over: 50 };
    const trapById = new Map(traps.map(t => [t.id, t]));
    const crops = [...new Map(task.positions.flatMap(p => Array.isArray(p.crops) ? p.crops : []).map(c => [c.id, c])).values()];
    // verdict (0.11.63): each section's own OK / not OK and its note — { trap: { ok: true, note: '' }, … }
    const sc = run.sc = { tab: 'trap', photos: new Map(), outcome: null, outcomeNote: '', lastPos: '', traps, th, extra: new Set(), status: new Map(), verdict: {} };
    let draft = null;
    try { draft = await getKV(scDraftKey(task)); } catch (e) { /* none */ }
    if (draft && Date.now() - (draft.saved || 0) < 24 * 3600000) {
      if (draft.cid && !detail) run.clientId = draft.cid;      // sent in part by Send everything now (0.11.87): the same run
      sc.cid = draft.cid || null;
      (draft.photos || []).forEach(p => {
        // a one-sided trap photo from an older draft: that side of the card
        if (p.section === 'trap' && !p.sides) {
          p.sides = { [p.colour === 'blue' ? 'blue' : 'yellow']: { thumb: p.thumb, full: p.full, full_w: p.full_w, taken_at: p.taken_at, counts: p.counts,
            total: p.total, algo_total: p.algo_total, algorithm: p.algorithm, confidence: p.confidence, corrected: p.corrected, ai: p.ai, photo_path: p.photo_path } };
          p.code_ok = !!p.code;
        }
        sc.photos.set(p.ref, p);
      });
      Object.assign(sc, { tab: draft.tab || 'trap', outcome: draft.outcome || null, outcomeNote: draft.outcomeNote || '', lastPos: draft.lastPos || '',
                          extra: new Set(draft.extra || []), status: new Map(draft.status || []), verdict: draft.verdict || {}, noTraps: !!draft.noTraps });
    } else if (detail) {
      // editing a scouting already sent: what the server holds
      (detail.traps || []).forEach(r => {
        const ref = 'tr-' + r.trap_id;
        const p = sc.photos.get(ref) || { ref, section: 'trap', trap_id: r.trap_id, code: shortCode(r.code), code_text: shortCode(r.code), code_ok: true,
                                          taken_at: r.read_at, replaced: false, note: '', code_read: r.code_read, code_source: r.code_source || 'list', gps: r.gps, sides: {} };
        p.replaced = p.replaced || !!r.replaced; p.new_card = p.new_card || !!r.new_card; p.note = p.note || r.notes || '';
        p.note_level = p.note_level || r.note_level || null;
        p.sides[r.side === 'blue' ? 'blue' : 'yellow'] = { thumb: r.photo_data, photo_path: r.photo_path, total: r.total, algo_total: r.algo_total,
          counts: r.counts, corrected: r.corrected, algorithm: r.algorithm, confidence: r.confidence, ai: r.ai, taken_at: r.read_at,
          week_rate: r.week_rate, orig_total: r.total, lower_ok: !!r.lower_ok,
          // a reference picture (0.11.129): run_detail says it (FarmBox 0238), and so does the copy kept on this phone
          reference: r.reference === true };
        sc.photos.set(ref, p);
      });
      (detail.observations || []).forEach(o => sc.photos.set(o.client_ref, { ref: o.client_ref, section: o.section || 'health', taken_at: o.taken_at,
        thumb: o.photo_data, photo_path: o.photo_path, part: o.part, crop_id: o.crop_id, note: o.note || '', pos_code: o.pos_code || '',
        gps: o.gps, measures: o.measures || [], px_per_mm: o.px_per_mm, ai: o.ai, zone_id: o.zone_id, item_id: o.item_id,
        note_level: o.note_level || null }));
      sc.outcome = detail.run?.outcome || null; sc.outcomeNote = detail.run?.outcome_note || '';
      // each section's verdict as sent (FarmBox 0169); a scouting sent before that was OK or not OK as a whole
      const so = detail.run?.section_outcomes;
      if (so) Object.entries(so).forEach(([k, v]) => { sc.verdict[k] = { ok: v.outcome === 'ok', note: v.note || '' }; });
      else if (sc.outcome === 'ok') SC_TABS.forEach(([k]) => { sc.verdict[k] = { ok: true, note: '' }; });
    }
    // the traps are read in Digital scouting (0260, owner 23 Oct 2026: "why we want to have the phone counting? we can
    // remove it to avoid confusion"): the round takes no trap photo, counts none and sends none. A trap photo left in a
    // draft from before is dropped; an edit sends no `traps`, so the server keeps the readings it has as they are
    [...sc.photos.values()].forEach(p => { if (p.section === 'trap') sc.photos.delete(p.ref); });
    sc.noTraps = false; sc.status.clear(); delete sc.verdict.trap;
    // The sections due today (FarmBox 0145): the procedure's days (Settings of the procedure › Sections), a
    // holiday's moved to the next working day by the server (task.sections), and a trap or growth day that
    // was missed — no trap read, no growth photo since — comes back the next day. The others can still be
    // opened by hand ("Not due today: + Traps").
    const cfg = sop?.attributes?.sections || null;
    const isoDow = d => { const x = new Date(d + 'T12:00:00').getDay(); return x === 0 ? 7 : x; };
    const scheduled = (t, k) => Array.isArray(t.sections) ? t.sections.includes(k)
      : !cfg ? true : !!cfg[k] && (cfg[k].days || []).map(Number).includes(isoDow(t.planned_date));
    const state = ((await getKV('scouting_state')) || []).find(x => x.farm_id === task.farm_id) || {};
    const lastDone = {
      trap: [state.trap_at, ...traps.map(t => t.last_read_at ? String(t.last_read_at).slice(0, 10) : null)].filter(Boolean).sort().pop() || null,
      growth: state.growth_at || null,
    };
    const earlier = (await all('tasks')).filter(t => t.sop_id === task.sop_id && t.farm_id === task.farm_id && t.status !== 'cancelled'
      && t.planned_date < task.planned_date).sort((a, b) => (a.planned_date < b.planned_date ? 1 : -1));
    sc.due = {}; sc.missed = {};
    for (const k of ['health', 'growth']) {               // the traps: in Digital scouting (0260)
      if (scheduled(task, k)) { sc.due[k] = true; continue; }
      if (k === 'health' || (cfg && !cfg[k])) continue;
      const prev = earlier.find(t => scheduled(t, k));
      if (prev && (!lastDone[k] || lastDone[k] < prev.planned_date)) { sc.due[k] = true; sc.missed[k] = prev.planned_date; }
    }
    // an extra scouting (0.11.94): every section is open and nothing is required
    const free = !!task.extraZone;
    if (free) { sc.due = {}; sc.missed = {}; }
    sc.free = free;
    [...sc.photos.values()].forEach(p => { if (!sc.due[p.section]) sc.extra.add(p.section); });
    const shown = k => free || !!sc.due[k] || sc.extra.has(k);
    if (sc.tab !== 'review' && !shown(sc.tab)) sc.tab = (SC_TABS.find(([k]) => shown(k)) || SC_TABS[1])[0];
    sc.shown = shown;
    if (navigator.onLine && shown('trap')) ocr().catch(() => {});   // warm the text reader while the person walks to the first trap

    // 0.11.50 (owner: "the scouting task window is a little bit confusing"): the tabs say how far along each
    // section is (a section not due today stays, greyed, and opens on a tap); the long explanations sit behind ?;
    // Traps is the unit's list of traps; a new card is confirmed in one sheet that goes straight to its other
    // side; one finish bar — Not OK, or All OK · finish.
    const box = el('div', 'fb-sc');
    const tabs = el('div', 'fb-sc-tabs');
    const panes = {};
    const tabBtns = {};
    SC_TABS.forEach(([k, label]) => {
      const b = el('button', 'fb-sc-tab'); b.type = 'button';
      b.onclick = () => { if (!shown(k)) sc.extra.add(k); sc.tab = k; paintTabs(); saveScDraft(); };
      tabBtns[k] = b; tabs.append(b);
      panes[k] = el('div', 'fb-sc-pane');
    });
    // Review (0.11.63): everything captured, section by section, with its verdict
    const revBtn = el('button', 'fb-sc-tab fb-sc-revtab'); revBtn.type = 'button';
    revBtn.onclick = () => { sc.tab = 'review'; paintTabs(); saveScDraft(); };
    tabs.append(revBtn);
    panes.review = el('div', 'fb-sc-pane fb-sc-review');
    // 0.11.101: "12 photos kept on this phone · 9 uploaded, 3 waiting" under the tabs, so nobody wonders
    const safe = el('div', 'fb-sc-safe hidden');
    sc.paintSafe = () => {
      const files = [...sc.photos.values()].flatMap(p => p.section === 'trap' ? SIDES.map(([k]) => p.sides?.[k]).filter(Boolean) : [p])
        .filter(x => x.full instanceof Blob || x.photo_path);
      const n = files.length, up = files.filter(x => x.photo_path).length;
      safe.classList.toggle('hidden', !n);
      nbLabel(safe, n ? `{i:lock} ${n} photo${n === 1 ? '' : 's'} kept on this phone · ${up === n ? 'all uploaded' : `${up} uploaded, ${n - up} waiting`}` : '');
    };
    box.append(tabs, safe, ...SC_TABS.map(([k]) => panes[k]), panes.review);
    const count = k => [...sc.photos.values()].filter(p => p.section === k).length;
    const photoOf = t => [...sc.photos.values()].find(p => p.section === 'trap' && p.trap_id === t.id) || null;
    const trapDone = t => { const p = photoOf(t); return (p && SIDES.every(([k]) => p.sides?.[k])) || (!p && sc.status.has(t.id)); };
    // the minimum a section asks today (0.11.74, owner): every trap of the zone (both sides, or marked taken down / out of
    // reach), 2 plant-health photos, 2 growth photos — more is always welcome
    const MIN_PHOTOS = { health: 2, growth: 2 };
    const need = k => !!sc.due[k];
    const trapPhotos = () => [...sc.photos.values()].filter(p => p.section === 'trap');
    const met = k => k === 'trap'
      ? sc.noTraps || (traps.length ? traps.every(trapDone) : trapPhotos().length > 0 && trapPhotos().every(p => SIDES.every(([sk]) => p.sides?.[sk])))
      : count(k) >= MIN_PHOTOS[k];
    sc.need = need; sc.met = met; sc.minPhotos = MIN_PHOTOS;
    const tabSub = (k, n) => {
      if (k === 'trap') return 'in Digital scouting';
      if (free) return n ? `${n} photo${n === 1 ? '' : 's'}` : 'optional';
      if (!need(k)) return n ? `not today · ${n} photo${n === 1 ? '' : 's'}` : 'not today';
      if (k === 'trap' && sc.noTraps) return 'no traps today';
      if (k === 'trap') return traps.length ? `${traps.filter(trapDone).length} of ${traps.length} traps` : n ? `${n} photographed` : 'every trap';
      return met(k) ? `${n} photo${n === 1 ? '' : 's'}` : `${n} of ${MIN_PHOTOS[k]} min`;
    };
    const paintTabs = function () { paintTabsNow(); };
    const paintTabsNow = function () {
      SC_TABS.forEach(([k, label]) => {
        const b = tabBtns[k];
        b.textContent = '';
        const ok = !need(k) || met(k);
        const name = el('span', 'fb-sc-name');
        name.append(el('span', 'fb-sc-v' + (k === 'trap' ? '' : ok ? ' ok' : ' nok'), ok && k !== 'trap' ? '✓' : ''));
        if (sc.verdict[k] && sc.verdict[k].ok === false) name.append(nbIcon('alert'), document.createTextNode(' '));
        // a phone is narrow: "Plant health" is "Health" on the tab under 420 px
        if (k === 'health') name.append(el('span', 'fb-sc-long', label), el('span', 'fb-sc-short', 'Health'));
        else name.append(document.createTextNode(label));
        b.append(name, el('small', 'fb-sc-sub', tabSub(k, count(k))));
        b.setAttribute('aria-pressed', String(sc.tab === k));
        b.setAttribute('aria-label', `${label}: ${tabSub(k, count(k))}${need(k) && k !== 'trap' ? (ok ? ', done' : ', still required') : ''}`);
        b.classList.toggle('off', false);
        panes[k].classList.toggle('hidden', sc.tab !== k);
        verdicts[k]?._paint();
      });
      revBtn.textContent = '';
      revBtn.append(el('span', null, 'Review'), el('small', 'fb-sc-sub', `${sc.photos.size} photo${sc.photos.size === 1 ? '' : 's'}`));
      revBtn.setAttribute('aria-pressed', String(sc.tab === 'review'));
      panes.review.classList.toggle('hidden', sc.tab !== 'review');
      if (sc.tab === 'review') paintReview();
      $('finish').textContent = run.edit && !run.resume ? 'Save the changes' : 'Finish';
      sc.paintSafe?.();
    };
    sc.goTab = k => { if (k !== 'review' && !shown(k)) sc.extra.add(k); sc.tab = k; paintTabs(); };

    // (0.11.75's automatic send — a bar "Zone complete, sending in 5 s" once every minimum was met — was removed in 0.11.83,
    // owner: "I prefer the user has time to take more than the minimum 2 photos": the zone goes when the person presses Finish.)

    // ── each section ends the same way (0.11.63): one red → green button, and a note that says why when it stays red ──
    const verdicts = {};
    // 0.11.101 (owner 4 Oct 2026, the scouting review: "more intuitive … avoid problems"): a section is OK unless
    // somebody says there is a problem — one button to report it, and then its note. No red button to turn green in
    // every tab, no question at Finish.
    function verdictBlock(k, label) {
      if (!sc.verdict[k]) sc.verdict[k] = { ok: true, note: '' };
      const b = el('div', 'fb-sc-verdict'); b.id = 'fb-scv-' + k;
      const tick = el('button', 'fb-tick'); tick.type = 'button';
      const note = el('textarea', 'fb-runnote'); note.rows = 2;
      note.value = sc.verdict[k]?.note || '';
      b._paint = () => {
        const v = sc.verdict[k] || {}, ok = !!v.ok;
        tick.classList.toggle('on', ok);
        nbLabel(tick, ok ? `✓ ${label} OK · tap to report a problem` : `{i:alert} Problem in ${label.toLowerCase()} · tap if it is OK after all`);
        tick.setAttribute('aria-pressed', String(ok));
        note.placeholder = ok ? 'Note (optional)' : `What is the problem in ${label.toLowerCase()}? (the manager is told)`;
        note.classList.toggle('hidden', ok && !String(v.note || '').trim() && document.activeElement !== note);
        if (document.activeElement !== note) note.value = v.note || '';
      };
      tick.onclick = () => { const v = sc.verdict[k] || (sc.verdict[k] = { ok: true, note: '' }); v.ok = !v.ok; paintTabs(); saveScDraft();
                             if (!v.ok) { note.classList.remove('hidden'); note.focus(); } };
      note.oninput = () => { const v = sc.verdict[k] || (sc.verdict[k] = { ok: false, note: '' }); v.note = note.value; saveScDraft(); };
      b.append(el('div', 'fb-sec', label + ' — result'), tick, note);
      verdicts[k] = b;
      return b;
    }

    // ── Review (0.11.63): every photo and what came with it — counts, sizes, position, the AI note, the comment ──
    const wordOf = (list, v) => (list.find(x => x[0] === v) || [v, v || ''])[1];
    const zoomImg = (src, full, title) => {
      const im = el('img'); im.src = src || ''; im.alt = title; im.loading = 'lazy';
      im.onclick = e => { e.stopPropagation(); photoViewer(full instanceof Blob ? full : src, { title }); };
      return im;
    };
    function paintReview() {
      const R = panes.review; R.textContent = '';
      const secs = SC_TABS.filter(([k]) => k !== 'trap' && (shown(k) || count(k)));
      if (!secs.length) { R.append(el('div', 'config-hint', 'Nothing captured yet.')); return; }
      secs.forEach(([k, label]) => {
        const v = sc.verdict[k] || {};
        const sec = el('div', 'fb-rv-sec');
        const head = el('button', 'fb-rv-head'); head.type = 'button';
        head.append(el('span', 'fb-sc-v ' + (v.ok ? 'ok' : 'nok'), v.ok ? '✓' : ''), el('b', null, label),
          el('span', 'fb-rv-word ' + (v.ok ? 'ok' : 'nok'), !shown(k) ? 'off today' : v.ok ? 'OK' : 'not OK yet'));
        head.onclick = () => sc.goTab(k);
        sec.append(head);
        if (v.note) sec.append(el('div', 'fb-rv-note' + (v.ok ? '' : ' nok'), v.note));
        const items = [...sc.photos.values()].filter(p => p.section === k).sort((a, b) => String(a.taken_at).localeCompare(String(b.taken_at)));
        if (!items.length && !(k === 'trap' && sc.status.size)) sec.append(el('div', 'fb-meta', 'No photos.'));
        items.forEach(p => {
          const row = el('div', 'fb-rv-item');
          const pics = el('div', 'fb-rv-pics');
          const txt = el('div', 'fb-rv-text');
          const lines = [];
          if (k === 'trap') {
            SIDES.forEach(([sk, sl]) => { const S = p.sides?.[sk]; if (S?.thumb) pics.append(zoomImg(S.thumb, S.full, `Trap ${p.code || ''} · ${sl.toLowerCase()}`)); });
            txt.append(el('b', null, `Trap ${p.code || '?'}${p.code && !p.code_ok ? ' — not confirmed' : ''}`));
            lines.push(SIDES.map(([sk, sl]) => { const S = p.sides?.[sk]; return `${sl.split(' ')[0]} ${S ? (S.reference ? 'reference photo' : (S.total ?? '?') + (S.corrected ? ' (corrected)' : '')) : '— missing'}`; }).join(' · '));
            lines.push(trapLevel(p).text);
            if (p.replaced) lines.push('Card replaced');
            SIDES.forEach(([sk, sl]) => { const t = p.sides?.[sk]?.ai ? aiText({ section: 'trap', ai: p.sides[sk].ai }) : ''; if (t) lines.push(`✦ ${sl.split(' ')[0]}: ${t}`); });
          } else {
            pics.append(zoomImg(p.thumb, p.full, k === 'growth' ? 'Growth photo' : 'Plant photo'));
            const crop = crops.find(c => c.id === p.crop_id)?.name;
            txt.append(el('b', null, [wordOf(k === 'growth' ? GROWTH_PARTS : PARTS, p.part), crop].filter(Boolean).join(' · ')));
            lines.push(posWords(fullPos(p.pos_code)) ? 'Position ' + fullPos(p.pos_code) : zoneLines.length === 1 ? (zoneLines[0].label || 'this zone') : '— no position');
            const ms = (p.measures || []).map(m => `${wordOf(MEASURE_WHAT, m.what).toLowerCase()} ${m.mm} mm${m.by === 'auto' ? ' {i:square}' : ''}`);
            if (ms.length) lines.push('Size: ' + ms.join(' · '));
            else if (p.px_per_mm) lines.push(scaleWords(p));
            if (p.ai) lines.push('✦ ' + aiText(p));
          }
          lines.filter(Boolean).forEach(l => txt.append(el('div', l.startsWith('✦') ? 'fb-rv-ai' : 'fb-meta', l)));
          if (p.note) {
            const c = el('div', 'fb-rv-comment');
            const lv = noteLevelOf(p);
            if (lv) { const dot = el('span', 'fb-risk-dot ' + lv); dot.title = (NOTE_LEVELS.find(([v]) => v === lv) || [])[1] || ''; c.append(dot); }
            c.append(document.createTextNode('“' + p.note + '”'));
            txt.append(c);
          }
          row.onclick = () => { sc.goTab(k); if (k === 'trap') sc.reveal?.(p.ref);
            setTimeout(() => document.querySelector(`.fb-sc-card[data-ref="${p.ref}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); };
          row.append(pics, txt);
          sec.append(row);
        });
        if (k === 'trap') sc.status.forEach((st, id) => {
          const t = trapById.get(id); if (!t) return;
          sec.append(el('div', 'fb-rv-item fb-rv-plain', `Trap ${shortCode(t.code)}: ${st.status === 'taken_down' ? 'taken down' : 'can’t reach' + (st.note ? ' — ' + st.note : '')}`));
        });
        R.append(sec);
      });
    }

    // one hidden picker for the gallery, used by every section
    const pick = el('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.style.display = 'none';
    box.append(pick);
    const pickFile = () => new Promise(res => { pick.value = ''; pick.onchange = () => res(pick.files[0] || null); pick.click(); });

    // a full photo goes up as soon as it is taken (0.11.99): on 4 Oct an extra scouting's last three full photos were
    // still waiting for Finish when the phone closed the app. One at a time, on the connection Settings allows; what
    // does not go up now goes after the report, as before. The path travels with the report.
    const upBusy = new WeakSet(); let upChain = Promise.resolve(), upNow = null;
    function upSoon(holder, kind, name) {
      const R = run;
      upChain = upChain.then(async () => {
        if (run !== R || R.edit || R.upStop || !(holder.full instanceof Blob) || holder.photo_path || upBusy.has(holder)) return;
        if (!session || !navigator.onLine || !uploadAllowed()) return;
        upBusy.add(holder);
        const t = R.task.members[0] || {};
        const path = `${t.farm_id || farm.id}/${R.clientId}/${kind}-${String(name).replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}.jpg`;
        const ctl = upNow = new AbortController();
        try {
          await api('/storage/v1/object/evidence/' + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: holder.full, signal: ctl.signal });
          holder.photo_path = path;
          if (run === R) { saveScDraft(); R.sc?.paintSafe?.(); }
        } catch (e) { /* after the report, from the outbox */ }
        finally { upBusy.delete(holder); if (upNow === ctl) upNow = null; }
      }).catch(() => {});
    }
    // Finish waits a moment for the photo on its way up (0.11.119): on 7 Oct Finish came 2 s after a photo, found it
    // with no path yet and queued it again — the same photo twice in storage, one of them in no report. A photo still
    // not up after the wait is stopped here and goes from the outbox, once.
    sc.upSettle = async (R, ms) => {
      R.upStop = true;
      const t = setTimeout(() => { try { upNow?.abort(); } catch (e) { /* gone */ } }, ms);
      try { await upChain; } finally { clearTimeout(t); }
    };

    async function shoot(section, forTrap, fromGallery) {
      if (section === 'trap') return;               // the traps are read in Digital scouting (0260): no trap photo here
      const hint = section === 'trap'
        ? (forTrap ? `Trap ${forTrap.code} — square-on, the WHOLE card in the photo, top to bottom` : 'A sticky trap — square-on, the whole card, top to bottom, and its code in the picture')
        : section === 'growth' ? 'The fruit or leaf with the scale card beside it, flat, at the same distance'
        : 'Close and in focus: the part that looks wrong';
      let f = null, fromCam = false;
      if (!fromGallery) {
        const r = await takeTrapPhoto(forTrap?.code || '', hint, section);
        if (r === 'cancel') return;
        f = r; fromCam = !!r;
      }
      if (!f) f = await pickFile();
      if (f) await addPhoto(section, f, forTrap);
    }

    async function addPhoto(section, file, forTrap) {
      if (section === 'trap') return addTrap(file, forTrap);        // one card, two sides (0149)
      let big;
      try { big = await shrinkPhoto(file, FULL_PX, null); }
      catch (e) { showToast('That photo could not be read — try again', 'error'); return; }
      const p = { ref: 'sc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), section,
                  taken_at: new Date().toISOString(), note: '', full_w: big.canvas.width, full_h: big.canvas.height };
      p.thumb = shrinkCanvas(big.canvas, 640, 0.6);
      p.full = await new Promise(res => big.canvas.toBlob(res, 'image/jpeg', FULL_Q));
      const c1600 = scaleCanvas(big.canvas, 1600);
      if (c1600 !== big.canvas) freeCanvas(big.canvas);              // given back at once (0.11.99)
      big = null;
      // a plant photo only: a trap photo went to addTrap above (its old branches here were dead code since 0149)
      const headZone = crops.length > 0 && crops.every(c => HEAD_RE.test(c.name || ''));
      Object.assign(p, { pos_code: sc.lastPos || '', part: section === 'growth' ? (headZone ? 'head' : 'fruit') : 'leaf', measures: [],
                         crop_id: crops.length === 1 ? crops[0].id : null });
      p.scale_state = 'busy';                   // the scale card is looked for once the card is on screen (0.11.69)
      sc.photos.set(p.ref, p);
      const card = photoCard(p);
      lists[section].prepend(card);
      paintTabs(); paintCoverage(); saveScDraft();
      findMarker(c1600).then(m => {
        p.scale_state = m?.error ? 'offline' : m ? 'found' : 'none';
        if (m && !m.error) {
          p.px_per_mm = Math.round(m.ppm * (p.full_w / c1600.width) * 1000) / 1000;
          p.scale_source = 'marker'; p.scale_quad = m.quad; p.scale_skew = Math.round(m.skew * 100) / 100;
        }
        card._paintMs?.(); saveScDraft();
        if (section === 'growth' && !p.px_per_mm) { noScale(p, card); return; }
        // one tap by the person says which object (0.11.80, owner: "can I help the algorithm? maybe just 2 points") — on
        // 276 Open Images crops the phone's own guess missed the object on about half; from a tap the outline is right
        if (p.px_per_mm && p.section === 'growth') sc.sizeCheck?.(p);
      }).catch(e => { console.warn('scale card', e); p.scale_state = 'none'; card._paintMs?.(); if (section === 'growth') noScale(p, card); })
        .finally(() => freeCanvas(c1600));
      upSoon(p, 'scout', p.ref);
    }
    // A growth photo is only kept with the scale card in it (0.11.86, owner 2 Oct 2026: "do not accept picture in growth
    // without the scale detected"): the sizes are measured against the card, and a growth photo without a size says
    // nothing on the curve. The photo is refused in a sheet — take it again, or leave it out.
    function noScale(p, card) {
      if (!sc.photos.has(p.ref)) return;
      const out = () => { sc.photos.delete(p.ref); card.remove(); paintTabs(); paintCoverage(); saveScDraft(); };
      const sheet = el('div', 'fb-sheet');
      const box = el('div', 'fb-sheet-card');
      const img = el('img', 'fb-noscale-img'); img.src = p.thumb || ''; img.alt = 'The photo';
      const offline = p.scale_state === 'offline';
      box.append(el('h3', null, offline ? 'The scale card could not be read' : 'No scale card in this photo'), img,
        el('div', 'fb-meta', offline
          ? 'The card reader needs a connection the first time on this phone. Connect once, then take the photo again — a growth photo is only kept with its scale card.'
          : 'A growth photo is only kept with the printed scale card in the picture: the fruit or leaf is measured against it. Hold the card flat beside what you photograph, all of it in view, and take it again.'));
      const again = el('button', 'fb-btn fb-btn-primary', '{i:camera} Take it again'); again.type = 'button';
      const drop = el('button', 'fb-btn', 'Leave it out'); drop.type = 'button';
      again.onclick = () => { sheet.remove(); out(); shoot('growth'); };
      drop.onclick = () => { sheet.remove(); out(); };
      const acts = el('div', 'fb-actions'); acts.append(again, drop);
      box.append(acts);
      sheet.append(box);
      document.body.append(sheet);
    }
    // The code of a trap: a known trap, or a new position added by itself. What the phone (or the AI) read is
    // a PROPOSAL until the person confirms it — typed or read, one ✓ Confirm, which opens the other side (0149).
    function setTrapCode(p, text, source) {
      p.code_text = String(text || '').toUpperCase().replace(/\s/g, '');
      const pc = parseTrapCode(p.code_text);
      if (!pc.ok) { p.code = null; p.trap_id = null; p.code_ok = false; return; }
      const known = traps.find(t => shortCode(t.code) === pc.code);
      p.code = pc.code; p.trap_id = known ? known.id : null;
      p.code_ok = source === 'list';                  // chosen from the list of missing traps: already sure
      if (source) p.code_source = source;
    }

    // ── a trap: one card, its yellow side and its blue side (FarmBox 0149) ──
    // Each side is photographed and counted on its own (a blue face catches thrips, a yellow one whitefly and
    // the rest); once the code is confirmed the camera opens for the other side of the same card — its code is
    // not read again. The trap's figure is the two sides added.
    async function sideFrom(file, want) {
      let big;
      try { big = await shrinkPhoto(file, FULL_PX, null); }
      catch (e) { showToast('That photo could not be read — try again', 'error'); return null; }
      const S = { taken_at: new Date().toISOString(), full_w: big.canvas.width, thumb: shrinkCanvas(big.canvas, 640, 0.6) };
      S.full = await new Promise(res => big.canvas.toBlob(res, 'image/jpeg', FULL_Q));
      const canvas = scaleCanvas(big.canvas, 1600);
      const seen = cardColour(canvas);
      const side = want || seen;
      if (want && seen !== want) S.check = `this looks like the ${seen} side`;
      // counted on the full photo (0.11.70: up to 4000 px, a thrips is ~1 mm)
      try {
        const r = countInsects(big.canvas, { colour: side });
        Object.assign(S, { counts: r.counts, total: r.total, algo_total: r.total, algorithm: r.algorithm, confidence: r.confidence, corrected: false,
                           rows_seen: r.rows_seen ?? null, light: r.light || null });
        const lc = lightCheck(r);
        if (r.partial) S.check = `part of the card is outside the photo (${r.partial.replace('bottom', 'the bottom').replace('top', 'the top')}) — retake it with the whole card`;
        else if (lc) S.check = lc;
        if (r.scale === 'none') S.rows_seen = null;
      } catch (e) { S.total = null; }
      if (canvas !== big.canvas) freeCanvas(big.canvas);
      big = null;
      upSoon(S, 'trap', side);
      return { S, side, canvas };
    }
    async function addTrap(file, forTrap) {
      const got = await sideFrom(file, null);
      if (!got) return;
      const p = { ref: 'sc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), section: 'trap', taken_at: got.S.taken_at,
                  note: '', replaced: false, sides: { [got.side]: got.S },
                  trap_id: forTrap?.id || null, code: forTrap ? shortCode(forTrap.code) : null, code_text: forTrap ? shortCode(forTrap.code) : '',
                  code_source: forTrap ? 'list' : null, code_ok: !!forTrap };
      sc.photos.set(p.ref, p);
      const card = cardOf(p);
      paintTabs(); paintCoverage(); saveScDraft();
      if (forTrap) { askOtherSide(p, card); return; }
      codeSheet(p, card, got.canvas);
    }
    // A card not in the list: which trap is it? The reader's proposal (or the AI's, or a pick from the traps not
    // photographed yet) in one sheet; Yes confirms it and opens the camera for the other side at once.
    // 0.11.51 (owner: "ok for 2"): when the phone's reader finds no position and there is signal, the AI reads the
    // code by itself — the one exception to "AI only when pressed", for this small read and nothing else; what it
    // reads is still a proposal until Yes.
    function codeSheet(p, card, canvas) {
      const sheet = el('div', 'fb-sheet');
      const box = el('div', 'fb-sheet-card fb-codesheet');
      const missing = SIDES.find(([k]) => !p.sides?.[k]);
      const first = p.sides?.[Object.keys(p.sides || {})[0]];
      const img = el('img', 'fb-codesheet-img'); img.src = first?.thumb || ''; img.alt = '';
      const inp = el('input', 'fb-num fb-codesheet-code'); inp.type = 'text'; inp.placeholder = '1B6';
      inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('autocomplete', 'off'); inp.spellcheck = false;
      inp.setAttribute('aria-label', 'The position written on the card');
      const what = el('div', 'fb-meta', 'Reading the code…');
      const yes = el('button', 'fb-btn fb-btn-primary', missing ? `Yes — now the ${missing[1].toLowerCase()}` : 'Yes'); yes.type = 'button';
      const ai = el('button', 'fb-btn fb-ai', '✦ Read with AI'); ai.type = 'button';
      const later = el('button', 'fb-link', 'Later'); later.type = 'button';
      let touched = false, reading = true, asking = false, source = 'text';
      const paintWhat = () => {
        const v = canon(inp.value), pc = parseTrapCode(v);
        if (!v) what.textContent = reading ? 'Reading the code…' : asking ? 'Asking the AI to read it…'
          : (p.code_read ? `Read "${p.code_read}" — write the position` : 'Write the position on the card, like 1B6');
        else if (!pc.ok) what.textContent = 'Write it like 1B6: zone, row, metres';
        else what.textContent = traps.find(t => shortCode(t.code) === pc.code) ? 'A trap of the list' : `New trap · ${pc.n} · row ${pc.row} · ${pc.metres} m`;
      };
      inp.oninput = () => { const v = inp.value.toUpperCase().replace(/\s/g, ''); if (v !== inp.value) inp.value = v; touched = true; source = 'typed'; paintWhat(); };
      const todo = traps.filter(t => !photoOf(t) && !sc.status.has(t.id)).slice(0, 18);
      const picks = el('div', 'fb-actions fb-codesheet-picks');
      todo.forEach(t => { const b = el('button', 'fb-btn', shortCode(t.code)); b.type = 'button';
        b.onclick = () => { inp.value = shortCode(t.code); touched = true; source = 'list'; paintWhat(); }; picks.append(b); });
      const close = () => sheet.remove();
      yes.onclick = () => {
        const pc = parseTrapCode(canon(inp.value));
        if (!pc.ok) { showToast('Write the position on the card, like 1B6', 'error'); inp.focus(); return; }
        setTrapCode(p, pc.code, source); p.code_ok = true; sc.open.delete(p.ref);     // confirmed: it folds like any trap
        close(); card._paintTrap?.(); paintTabs(); paintCoverage(); saveScDraft(); askOtherSide(p, card);
      };
      later.onclick = () => { if (canon(inp.value)) setTrapCode(p, canon(inp.value), source); close(); card._paintTrap?.(); paintCoverage(); saveScDraft(); };
      // auto: asked by the sheet itself — it never overwrites what the person typed or picked, and says a failure quietly
      const askAi = async auto => {
        if (!navigator.onLine) { if (!auto) showToast('Reading with the AI needs a connection', 'error'); return; }
        if (asking) return;
        asking = true; ai.disabled = true; ai.textContent = '✦ Reading…'; paintWhat();
        try {
          const image = await photoBase64(first);
          if (!image) throw new Error('this photo is not on the phone any more');
          const r = await api('/functions/v1/photo-note', { method: 'POST', body: JSON.stringify({ farm_id: task.farm_id || farm.id, kind: 'code', image,
            context: { codes: traps.map(x => shortCode(x.code)), read: p.code_read || null } }) });
          if (!r?.ok) throw new Error(r?.error || 'no answer');
          const seen = canon(r.ai?.code_seen), m = seen && traps.length ? matchCode([seen], traps) : null, f = m ? null : coerceCode(seen);
          if ((m || f) && !(auto && touched)) { inp.value = shortCode((m || f).code); touched = !auto; source = 'ai'; }
          else if (!(m || f) && !auto) showToast(seen ? `The AI read "${seen}" — not a position; type it` : 'The AI could not read a position on this card', 'error');
          else if (!(m || f) && seen) p.code_read = seen;
        } catch (e) { if (!auto) showToast('Read with AI: ' + String(e.message || e).replace(/^\d+ /, '').slice(0, 90), 'error'); else console.warn('AI code read', e); }
        asking = false; ai.disabled = false; ai.textContent = '✦ Read with AI'; paintWhat();
      };
      ai.onclick = () => askAi(false);
      const row = el('div', 'fb-actions'); row.append(yes, ai, later);
      box.append(el('h3', null, 'Which trap is this?'), img, inp, what);
      if (todo.length) box.append(el('div', 'fb-meta', 'Or one not photographed yet:'), picks);
      box.append(row);
      sheet.append(box); document.body.append(sheet);
      let found = false;
      readTrapCode(canvas, traps).then(r => {
        p.code_read = r.text || null;
        const v = r.trap ? shortCode(r.trap.code) : r.fresh ? shortCode(r.fresh.code) : '';
        if (v) found = true;
        if (!touched && v) { inp.value = v; source = 'text'; }
      }).catch(e => console.warn('text reader', e)).finally(() => {
        reading = false; paintWhat(); saveScDraft();
        // nothing found, nothing typed, the sheet still open: the AI reads it
        if (!found && !touched && sheet.isConnected) askAi(true);
      });
    }
    async function addSide(p, side, card, fromGallery) {
      let f = null;
      if (!fromGallery) {
        const r = await takeTrapPhoto(p.code || '', `Trap ${p.code || ''} — now the ${side} side, square-on`, 'trap');
        if (r === 'cancel') return;
        f = r;
      }
      if (!f) f = await pickFile();
      if (!f) return;
      const got = await sideFrom(f, side);
      if (!got) return;
      // in place of a reference picture (Retake, or the ✕ then a new photo): a new 0 is a reference again, never a
      // counted 0 — in an edit fewerOf says nothing, so without this it went up as the hard fall of a new card
      const was = p.sides[side];
      if ((was && (was.reference || was.refWas)) || p.refWas?.[side]) got.S.refWas = true;
      if (p.refWas) delete p.refWas[side];
      p.sides[side] = got.S;
      card._paintTrap?.(); paintCoverage(); saveScDraft();
    }
    // the code confirmed: straight to the other side of the same card
    function askOtherSide(p, card) {
      const missing = SIDES.map(x => x[0]).find(k => !p.sides?.[k]);
      if (missing) setTimeout(() => addSide(p, missing, card), 300);
    }
    // insects a day on one side: the same rule as the server, against that side's photo before
    function sideRate(p, k) {
      const S = p.sides?.[k];
      if (!S || S.total == null) return null;
      if (S.reference) return null;                  // a reference picture is not counted: no rate, no colour (0.11.129)
      if (run.edit && S.orig_total != null) return S.total === S.orig_total && S.week_rate != null ? { rate: Math.round(S.week_rate / 7 * 10) / 10 } : null;
      const t = trapById.get(p.trap_id);
      const last = t?.last_sides?.[k];
      if (!last || last.total == null || !last.at || Date.now() - new Date(last.at) > 21 * 864e5) return null;
      const since = new Date(last.at), days = (new Date(S.taken_at) - since) / 864e5;
      const high = last.high ?? last.total;          // the card's highest count since it went up (FarmBox 0176)
      const fresh = last.replaced || p.new_card ? S.total
        : S.lower_ok && S.total < high ? 0
        : (S.total < high && high - S.total >= 3 && S.total < high * 0.6) ? S.total
        : Math.max(0, S.total - high);
      return days >= 0.5 ? { rate: Math.round(fresh / days * 10) / 10, fresh, since } : null;
    }
    // A card keeps its insects: a count clearly lower than the card's high (3 or more and 5 % fewer) means this
    // photo missed some, the one before counted too many, or the card is new (0.11.72, owner 30 Sept 2026)
    // A true edit of a done task: what was sent is changed, and nothing is asked. A hand-over (resume) or adding to a done
    // round (addOnly) also come with run.edit set, but their new photos are a round like any other: there the question and
    // the reference happen, on the new photos only — a side that came from the server (orig_total) stays as it came.
    const trueEdit = () => !!run.edit && !run.resume && !run.edit.addOnly;
    // the card's last reading in the sync may be this very run's (the part already sent, then synced): it is no baseline —
    // the reading before it is not on this phone — so nothing is said, as before
    const ownReading = (p, k, last) => !!run.edit && (run.edit.traps || []).some(r => r.trap_id === p.trap_id
      && (r.side === 'blue' ? 'blue' : 'yellow') === k && r.read_at && new Date(r.read_at).getTime() === new Date(last.at).getTime());
    function fewerOf(p, k) {
      const S = p.sides?.[k];
      if (!S || S.total == null || trueEdit() || S.orig_total != null) return null;
      const last = trapById.get(p.trap_id)?.last_sides?.[k];
      if (!last || last.total == null || !last.at || last.replaced || Date.now() - new Date(last.at) > 21 * 864e5) return null;
      if (ownReading(p, k, last)) return null;
      const high = last.high ?? last.total;
      if (!(high - S.total >= 3 && S.total < high * 0.95)) return null;
      return { high, at: new Date(last.at), hard: S.total < high * 0.6 };
    }
    // (owner 15 Oct 2026: "in case of 0 insect, the app asks if new trap and the pic could be kept just as reference")
    // A photo that reads 0 on a card that already had insects is most likely a photo the reader could not count — a
    // card does not lose its insects. It is kept as a reference picture, by itself and without the question: it is not
    // counted, gives no rate, and the card goes on from its last count. Not in an edit (fewerOf says nothing there),
    // not on a card marked Replaced or New card, not once the person undid it for this photo (S.refUndone).
    // Checked again at every paint of the card: a count changed from 0, Replaced, New card, Keep 0, or a code corrected
    // to a trap with no earlier count each take the reference away.
    // An edit never makes a reference (fewerOf says nothing there). One the server gave goes while the count, the card or
    // the person's choice says otherwise — a count corrected to 5 sent as "reference, 5" would be counted — and comes back
    // when that is undone (S.refWas): a 0 never turns into a counted 0, the hard fall of a new card, without a word.
    function autoReference(p, k) {
      const S = p.sides?.[k];
      if (!S) return false;
      const off = S.total !== 0 || p.new_card || p.replaced || S.lower_ok;
      if (trueEdit() || S.orig_total != null) {
        if (S.reference && off) { S.reference = false; S.refWas = true; return true; }
        if (!S.reference && S.refWas && !off) { S.reference = true; return true; }
        return false;
      }
      // a new photo: by the card's history, or because the photo it replaces was a reference (S.refWas, Retake / ✕)
      const want = !off && (!!fewerOf(p, k) || !!S.refWas);
      if (S.reference && !want) { S.reference = false; return true; }
      if (!S.reference && want && !S.refUndone) { S.reference = true; return true; }
      return false;
    }
    const toneOf = rate => rate >= th.over ? 'red' : rate >= th.watch ? 'orange' : 'green';
    function trapLevel(p) {
      const rs = SIDES.map(([k]) => sideRate(p, k)).filter(Boolean);
      const sum = rs.reduce((a, x) => a + x.rate, 0);
      // a reference picture is no count: left out of what the card shows
      const refs = SIDES.filter(([k]) => p.sides?.[k]?.reference).length;
      const cards = SIDES.map(([k]) => p.sides?.[k]).filter(S => S && !S.reference && S.total != null).map(S => S.total);
      const refWord = refs ? (cards.length || rs.length ? ' · the other side is a reference photo, not counted' : '') : '';
      if (!rs.length) return { tone: '', text: cards.length ? `${cards.reduce((a, x) => a + x, 0)} on the card · first photo: the count starts, the colour comes with the next one${refWord}`
                                             : refs && SIDES.every(([k]) => p.sides?.[k]) ? 'Reference photo: not counted — the card goes on from its last count' : 'photograph both sides' };
      const r = Math.round(sum * 10) / 10, tone = toneOf(r);
      return { tone, text: `Trap: ${r} a day · ${{ red: 'high', orange: 'watch', green: 'low' }[tone]}${rs.length < 2 && cards.length > 1 ? ' (one side starts its count)' : ''}${refWord}` };
    }
    function trapCard(p) {
      const card = el('div', 'fb-step fb-photo fb-sc-card fb-trapcard'); card.dataset.ref = p.ref;
      const head = el('div', 'fb-actions fb-trap-head');
      const sel = el('input', 'fb-num fb-sc-code'); sel.type = 'text'; sel.placeholder = '1B6';
      sel.setAttribute('autocapitalize', 'characters'); sel.setAttribute('autocomplete', 'off'); sel.spellcheck = false;
      sel.setAttribute('aria-label', 'The position written on the card');
      if (traps.length) { const dl = el('datalist'); dl.id = 'fb-trapcodes-' + p.ref; traps.forEach(t => { const o = el('option'); o.value = shortCode(t.code); dl.append(o); }); sel.setAttribute('list', dl.id); head.append(dl); }
      const ok = el('button', 'fb-btn fb-btn-primary', '✓ Confirm'); ok.type = 'button';
      const src = el('span', 'fb-chip');
      const aiCode = el('button', 'fb-btn fb-ai', '✦ Read with AI'); aiCode.type = 'button';
      aiCode.title = 'Send this photo to the AI to read the handwritten position (needs signal)';
      aiCode.onclick = async () => {
        if (!navigator.onLine) { showToast('Reading with the AI needs a connection', 'error'); return; }
        const S = p.sides?.yellow?.full || p.sides?.yellow?.thumb ? p.sides.yellow : p.sides?.blue;
        if (!S) { showToast('Photograph the card first', 'error'); return; }
        aiCode.disabled = true; aiCode.textContent = '✦ Reading…';
        try {
          const image = await photoBase64(S);
          if (!image) throw new Error('this photo is not on the phone any more');
          const r = await api('/functions/v1/photo-note', { method: 'POST', body: JSON.stringify({ farm_id: task.farm_id || farm.id, kind: 'code', image,
            context: { codes: traps.map(x => shortCode(x.code)), read: p.code_read || null } }) });
          if (!r?.ok) throw new Error(r?.error || 'no answer');
          const seen = canon(r.ai?.code_seen);
          const m = seen && traps.length ? matchCode([seen], traps) : null;
          const f = m ? null : coerceCode(seen);
          if (m || f) { setTrapCode(p, shortCode((m || f).code), 'ai'); p.code_read = seen; }
          else { p.code_read = seen || p.code_read; showToast(seen ? `The AI read "${seen}" — not a position; type it` : 'The AI could not read a position on this card', 'error'); }
          card._paintTrap(); paintCoverage(); saveScDraft();
        } catch (e) { showToast('Read with AI: ' + String(e.message || e).replace(/^\d+ /, '').slice(0, 90), 'error'); }
        aiCode.disabled = false; aiCode.textContent = '✦ Read with AI';
      };
      head.append(el('span', 'fb-trap-lbl', 'Trap'), sel, ok, src, aiCode);
      const sidesBox = el('div', 'fb-trap-sides');
      const total = el('div', 'fb-sc-level');
      const note = el('input', 'fb-note'); note.type = 'text'; note.value = p.note || ''; note.placeholder = 'Comment (optional): torn, wet, missing…';
      const risk = riskMenu(p, note, saveScDraft);   // the risk of what the comment says, as on a plant photo (0.11.131)
      const noteRow = el('div', 'fb-note-row'); noteRow.append(note, risk);
      const rep = el('button', 'fb-btn', 'Replaced'); rep.type = 'button';
      rep.title = 'The card was changed after these photos: the next count starts from nothing';
      rep.setAttribute('aria-pressed', String(!!p.replaced));
      // the sides are painted again: a reference picture on a card that is replaced is no reference any more (0.11.129)
      rep.onclick = () => { p.replaced = !p.replaced; rep.setAttribute('aria-pressed', String(p.replaced)); saveScDraft(); card._paintTrap?.(); paintCoverage(); };
      const drop = el('button', 'fb-link', 'Remove'); drop.type = 'button';
      drop.onclick = () => { if (!confirm('Remove this trap and its photos?')) return; sc.photos.delete(p.ref); card.remove(); paintTabs(); paintCoverage(); saveScDraft(); };
      const acts = el('div', 'fb-actions'); acts.append(rep, drop);
      card.append(head, sidesBox, total, acts, noteRow);
      const paintTotal = () => { const l = trapLevel(p); total.textContent = l.text; total.className = 'fb-sc-level ' + l.tone; card.dataset.tone = l.tone; };
      card._codeState = text => { src.textContent = text; src.className = 'fb-chip'; };
      card._paintTrap = () => {
        if (document.activeElement !== sel) sel.value = p.code_text || '';
        const how = p.code_source === 'text' ? 'read from the card' : p.code_source === 'ai' ? 'read by the AI' : '';
        src.textContent = !p.code_text ? (p.code_read ? `read "${p.code_read}" — write the position` : 'write the position on the card')
          : !p.code ? 'write the position, like 1B6'
          : !p.code_ok ? (p.code_source === 'typed' ? `${p.code}: tap Confirm` : `${how ? how + ': ' : ''}is it ${p.code}? Confirm or correct it`)
          : p.trap_id ? 'known trap' : `new trap · ${codeWords(p)}`;
        src.className = 'fb-chip' + (p.code && p.code_ok ? ' ok' : ' late');
        ok.classList.toggle('hidden', !p.code || !!p.code_ok);
        aiCode.classList.toggle('hidden', !!p.code_ok || !(p.sides?.yellow || p.sides?.blue));
        sidesBox.textContent = '';
        SIDES.forEach(([k, label]) => sidesBox.append(sideBlock(p, k, label, card, paintTotal)));
        paintTotal();
      };
      ok.onclick = () => { if (!p.code) return; p.code_ok = true; card._paintTrap(); paintCoverage(); saveScDraft(); askOtherSide(p, card); };
      sel.oninput = () => { const v = sel.value.toUpperCase().replace(/\s/g, ''); if (v !== sel.value) sel.value = v;
                            setTrapCode(p, v, 'typed'); card._paintTrap(); paintCoverage(); saveScDraft(); };
      card._paintTrap();
      return card;
    }
    function sideBlock(p, k, label, card, paintTotal) {
      const S = p.sides?.[k];
      const b = el('div', 'fb-trap-side ' + k);
      b.append(el('div', 'fb-sec', label));
      if (!S) {
        const go = el('button', 'fb-btn', '{i:camera} ' + label); go.type = 'button';
        const gal = el('button', 'fb-btn', '{i:image}'); gal.type = 'button'; gal.setAttribute('aria-label', label + ' from the gallery');
        go.onclick = () => addSide(p, k, card);
        gal.onclick = () => addSide(p, k, card, true);
        const r = el('div', 'fb-actions'); r.append(go, gal); b.append(r);
        return b;
      }
      const img = el('img'); img.src = S.thumb || ''; img.alt = label;
      img.onclick = () => photoViewer(S.full instanceof Blob ? S.full : S.thumb, { title: `Trap ${p.code || ''} · ${label.toLowerCase()}` });
      const num = el('input', 'fb-num'); num.type = 'number'; num.min = '0'; num.step = '1'; num.value = S.total == null ? '' : String(S.total);
      num.setAttribute('aria-label', 'Insects on the ' + label.toLowerCase());
      const said = el('span', 'fb-chip', S.algo_total != null ? (S.total !== S.algo_total ? `phone said ${S.algo_total}` : 'counted') : '');
      const lv = el('div', 'fb-meta');
      const paintSide = () => { const r = sideRate(p, k); lv.textContent = S.reference ? 'reference photo — not counted' : r ? `${r.rate} a day${r.fresh != null ? ` · +${r.fresh}` : ''}` : 'count starts'; };
      num.oninput = () => { const n = parseInt(num.value, 10); S.total = isNaN(n) ? null : n; S.corrected = S.algo_total != null && S.total !== S.algo_total;
                            said.textContent = S.algo_total != null ? (S.corrected ? `phone said ${S.algo_total}` : 'counted') : ''; paintSide(); paintFew(); paintTotal(); saveScDraft(); };
      // 0.11.101: nobody corrected a count in 58 readings — the number is a line to read, and opens on a tap
      const cnt = el('button', 'fb-btn fb-trap-cnt'); cnt.type = 'button';
      const paintCnt = () => { nbLabel(cnt, `${S.total} insect${S.total === 1 ? '' : 's'} {i:pencil}`); cnt.title = 'Tap to correct the count'; };
      const showNum = on => { num.classList.toggle('hidden', !on); cnt.classList.toggle('hidden', on); };
      cnt.onclick = () => { showNum(true); num.focus(); num.select?.(); };
      num.addEventListener('blur', () => { if (S.total != null) { paintCnt(); showNum(false); } });
      if (S.total != null) paintCnt();
      showNum(S.total == null);
      const row = el('div', 'fb-actions'); row.append(cnt, num, said);
      const aiBox = el('div', 'fb-sc-ai' + (S.ai ? '' : ' hidden'), S.ai ? aiText({ section: 'trap', ai: S.ai }) : '');
      const again = el('button', 'fb-link', 'Retake'); again.type = 'button'; again.onclick = () => addSide(p, k, card);
      const ai = el('button', 'fb-btn fb-ai', S.ai ? '✦ again' : '✦ AI note'); ai.type = 'button';
      ai.onclick = async () => {
        if (!navigator.onLine) { showToast('The AI note needs a connection', 'error'); return; }
        ai.disabled = true; ai.textContent = '✦ Asking…';
        try {
          const image = await photoBase64(S);
          if (!image) throw new Error('this photo is not on the phone any more');
          const r = await api('/functions/v1/photo-note', { method: 'POST', body: JSON.stringify({ farm_id: task.farm_id || farm.id, kind: 'trap', image,
            context: { trap_code: p.code || null, colour: k, codes: traps.map(x => shortCode(x.code)), note: p.note || null } }) });   // blind: not the phone's count (0.11.70)
          if (!r?.ok) throw new Error(r?.error || 'no answer');
          S.ai = r.ai;
          if (!p.code && r.ai.code_seen) {
            const m = traps.length ? matchCode([r.ai.code_seen], traps) : null;
            const f = m ? null : coerceCode(r.ai.code_seen);
            if (m || f) setTrapCode(p, shortCode((m || f).code), 'ai');
          }
          saveScDraft(); card._paintTrap();
        } catch (e) { showToast('AI note: ' + String(e.message || e).replace(/^\d+ /, '').slice(0, 90), 'error'); ai.disabled = false; ai.textContent = '✦ AI note'; }
      };
      const acts = el('div', 'fb-actions'); acts.append(ai, again);
      // the ✕ takes this side's photo away; the last side takes the trap with it
      b.append(picX(img, () => {
        if (S.reference || S.refWas) p.refWas = { ...(p.refWas || {}), [k]: true };   // a new photo of this side stays a reference on a 0 (addSide)
        delete p.sides[k];
        if (!SIDES.some(([s2]) => p.sides[s2])) { sc.photos.delete(p.ref); card.remove(); paintTabs(); }
        else card._paintTrap();
        paintCoverage(); saveScDraft();
      }));
      const rw = rowsWords(S);
      if (rw) b.append(el('span', 'fb-chip fb-rows ' + (rw.ok ? 'ok' : 'late'), rw.text));
      if (S.check) b.append(el('span', 'fb-chip late', S.check));
      const few = el('div', 'fb-sc-few');
      const paintFew = () => {
        few.textContent = ''; few.className = 'fb-sc-few';
        const btn = (t, fn, primary) => { const x = el('button', 'fb-btn' + (primary ? ' fb-btn-primary' : ''), t); x.type = 'button'; x.onclick = fn; return x; };
        const redraw = () => { saveScDraft(); card._paintTrap?.(); paintCoverage(); };
        if (autoReference(p, k)) { saveScDraft(); paintSide(); paintTotal(); }
        if (S.reference) {
          few.classList.add('done');
          few.append(el('span', '', 'No insect read on this photo: kept as a reference picture, not counted — the card goes on from its last count. '));
          const acts = el('div', 'fb-actions');
          // the card is new on both sides: neither side stays a reference, or the other would go up as reference + new card
          // (each side remembers it was one, so undoing New card brings the reference back — see autoReference)
          const keep0 = btn('Keep 0', () => { S.lower_ok = true; redraw(); });
          keep0.title = 'This 0 is right: the card goes on from 0 (its earlier count is set aside)';
          acts.append(btn('New card', () => { p.new_card = true;
                        SIDES.forEach(([k2]) => { const S2 = p.sides?.[k2]; if (S2 && S2.reference) { S2.reference = false; S2.refWas = true; } }); redraw(); }),
                      btn('Retake', () => addSide(p, k, card)),
                      fewerOf(p, k)
                        // back to the question; not set again by itself for this photo
                        ? btn('Undo', () => { S.reference = false; S.refUndone = true; redraw(); })
                        // no question to go back to (an edit, or the card's last count is this round's own): Undo would
                        // quietly count the 0, a hard fall — the choice is said instead
                        : keep0);
          few.append(acts);
          return;
        }
        if (p.new_card) {
          few.classList.add('done');
          few.append(el('span', '', 'New card: every insect on it counts as new. '), btn('Undo', () => { p.new_card = false; redraw(); }));
          return;
        }
        if (S.lower_ok) {
          few.classList.add('done');
          few.append(el('span', '', `Kept ${S.total}: the count before was too high, the card goes on from ${S.total}. `), btn('Undo', () => { S.lower_ok = false; redraw(); }));
          return;
        }
        const f = fewerOf(p, k);
        if (!f) { few.classList.add('hidden'); return; }
        const day = f.at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        few.append(el('div', 'fb-sc-few-t', f.hard
          ? `${S.total} insects — far fewer than the ${f.high} this card already had (last photo ${day}). Is it a new card?`
          : `${S.total} insects — fewer than the ${f.high} this card already had (last photo ${day}). A card keeps its insects: retake it with the whole card, square-on, in good light — or say what happened.`));
        const acts = el('div', 'fb-actions');
        const retake = btn('Retake', () => addSide(p, k, card), !f.hard);
        const fresh = btn('New card', () => { p.new_card = true; redraw(); }, f.hard);
        const keep = btn(`Keep ${S.total}`, () => { S.lower_ok = true; redraw(); });
        keep.title = 'This count is right: the one before counted too many';
        if (f.hard) acts.append(fresh, retake, keep); else acts.append(retake, fresh, keep);
        few.append(acts);
      };
      b.append(few, row, lv);
      b.append(acts, aiBox);
      paintSide(); paintFew();
      return b;
    }
    const codeWords = p => {
      const pc = parseTrapCode(p.code || '');
      return pc.ok ? `${pc.n} · row ${pc.row} · ${pc.metres} m` : '';
    };
    // a card of a known size and colour counts better: count again once the trap is known
    function recount(p, canvas) {
      const t = trapById.get(p.trap_id);
      if (!t || !canvas || p.corrected) return;
      try { const r = countInsects(canvas, t); Object.assign(p, { counts: r.counts, total: r.total, algo_total: r.total, confidence: r.confidence }); } catch (e) {}
    }

    // The colour: new insects A DAY since the photo before (FarmBox 0147) — the same rule as the server:
    // after Replaced, or when the count falls hard (under 60 % and at least 3 fewer: a new card went up),
    // everything on the card is new; a small fall is a miscount. The first photo of a trap, or one after
    // three weeks without, only starts the count: no colour yet.
    function level(p) {
      if (p.total == null) return null;
      const t = trapById.get(p.trap_id);
      let rate = null, fresh = null, since = null;
      if (run.edit && p.orig_total != null) rate = p.total === p.orig_total && p.week_rate != null ? Math.round(p.week_rate / 7 * 10) / 10 : null;
      else if (t && t.last_read_at && t.last_total != null && Date.now() - new Date(t.last_read_at) < 21 * 864e5) {
        since = new Date(t.last_read_at);
        const days = (new Date(p.taken_at) - since) / 864e5;
        fresh = t.last_replaced || p.replacedBefore ? p.total
          : (p.total < t.last_total && t.last_total - p.total >= 3 && p.total < t.last_total * 0.6) ? p.total
          : Math.max(0, p.total - t.last_total);
        if (days >= 0.5) rate = Math.round(fresh / days * 10) / 10;
      }
      if (rate == null) return { tone: '', text: `${p.total} on the card · first photo: the count starts, the colour comes with the next one` };
      const tone = rate >= th.over ? 'red' : rate >= th.watch ? 'orange' : 'green';
      const word = { red: 'high', orange: 'watch', green: 'low' }[tone];
      const when = since && (new Date(p.taken_at) - since) < 6 * 864e5 ? since.toLocaleDateString(undefined, { weekday: 'short' })
        : since ? since.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
      return { tone, text: `${rate} a day · +${fresh ?? '?'} since ${when || 'the last photo'} · ${word}` };
    }

    function aiButton(p, card, box) {
      const b = el('button', 'fb-btn fb-ai', p.ai ? '✦ AI note again' : '✦ AI note');
      b.type = 'button';
      b.onclick = async () => {
        if (!navigator.onLine) { showToast('The AI note needs a connection', 'error'); return; }
        b.disabled = true; b.textContent = '✦ Asking…';
        try {
          const t = trapById.get(p.trap_id);
          const context = p.section === 'trap'
            ? { trap_code: p.code || null, colour: t?.colour || p.colour || 'yellow', size: t?.width_cm ? `${t.width_cm} × ${t.height_cm} cm` : null, codes: traps.map(x => shortCode(x.code)), note: p.note || null }
            : { part: p.part, position: p.pos_code || null, note: p.note || null, scale_found: !!p.px_per_mm, scale_source: p.scale_source || null,
                crop: crops.find(c => c.id === p.crop_id)?.name || null, crops: crops.map(c => c.name) };
          const image = await photoBase64(p);
          if (!image) throw new Error('this photo is not on the phone any more');
          const r = await api('/functions/v1/photo-note', { method: 'POST', body: JSON.stringify({ farm_id: task.farm_id || farm.id, kind: p.section, image, context }) });
          if (!r?.ok) throw new Error(r?.error || 'no answer');
          p.ai = r.ai;
          if (p.section === 'trap' && !p.code && r.ai.code_seen) {
            const m = traps.length ? matchCode([r.ai.code_seen], traps) : null;
            const f = m ? null : coerceCode(r.ai.code_seen);
            if (m || f) { setTrapCode(p, shortCode((m || f).code), 'ai'); card._paintTrap?.(); paintCoverage(); }
          }
          box.textContent = aiText(p); box.classList.remove('hidden');
          card._paintMs?.();
          saveScDraft();
        } catch (e) {
          showToast('AI note: ' + String(e.message || e).replace(/^\d+ /, '').slice(0, 90), 'error');
        } finally { b.disabled = false; b.textContent = p.ai ? '✦ AI note again' : '✦ AI note'; }
      };
      return b;
    }

    // where in the zone (0.11.65): optional — the task says the zone; the row and metres say where in it (B6)
    function positionRow(p, onChange) {
      const row = el('div', 'fb-actions fb-sc-pos');
      const inp = el('input', 'fb-num'); inp.type = 'text'; inp.value = p.pos_code || ''; inp.placeholder = zonePrefix ? 'B6' : '3B8';
      inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('autocomplete', 'off'); inp.spellcheck = false;
      inp.setAttribute('aria-label', zonePrefix ? 'Where in the zone: row and metres from the corridor (optional)' : 'Position: zone, row, metres from the corridor');
      const words = el('span', 'fb-chip');
      const paint = () => {
        const w = posWords(fullPos(p.pos_code));
        const zoneWord = zoneLines.length === 1 ? (zoneLines[0].label || zoneLines[0].zone_name) : '';
        words.textContent = w ? (zonePrefix ? `${zoneWord} · ${w.replace(/^[^·]*·\s*/, '')}` : w)
          : p.pos_code ? (zonePrefix ? 'write it as B6: row, metres' : 'write it as 3B8')
          : zoneWord ? `${zoneWord} · row optional` : 'position needed';
        words.className = 'fb-chip' + (w || (!p.pos_code && zoneWord) ? ' ok' : ' late');
      };
      inp.oninput = () => {
        const v = inp.value.toUpperCase().replace(/\s/g, '');
        if (v !== inp.value) inp.value = v;
        p.pos_code = v; if (parsePos(fullPos(v))) sc.lastPos = v;
        paint(); onChange?.(); saveScDraft();
      };
      row.append(el('span', 'fb-trap-lbl', 'Where'), inp, words);
      row._paint = paint; paint();
      return row;
    }

    function chips(list, get, set) {
      const row = el('div', 'fb-actions');
      list.forEach(([v, l]) => {
        const b = el('button', 'fb-btn', l); b.type = 'button';
        b.setAttribute('aria-pressed', String(get() === v));
        b.onclick = () => { set(get() === v && list !== PARTS && list !== GROWTH_PARTS ? null : v);
          row.querySelectorAll('.fb-btn').forEach((x, i) => x.setAttribute('aria-pressed', String(list[i][0] === get()))); saveScDraft(); };
        row.append(b);
      });
      return row;
    }

    function photoCard(p) {
      if (p.section === 'trap') return trapCard(p);
      const card = el('div', 'fb-step fb-photo fb-sc-card'); card.dataset.ref = p.ref;
      const top = el('div', 'fb-shot');
      const img = el('img'); img.src = p.thumb || ''; img.alt = '';
      const side = el('div', 'fb-sc-side');
      const dropIt = () => { sc.photos.delete(p.ref); card.remove(); paintTabs(); paintCoverage(); saveScDraft(); };
      top.append(picX(img, dropIt), side);
      card.append(top);
      const aiBox = el('div', 'fb-sc-ai' + (p.ai ? '' : ' hidden'), aiText(p));
      const note = el('input', 'fb-note'); note.type = 'text'; note.value = p.note || '';
      const risk = riskMenu(p, note, saveScDraft);   // the risk of what the comment says (0.11.130)
      const acts = el('div', 'fb-actions');
      card.append(el('div', 'fb-sc-when', new Date(p.taken_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })));

      {
        const pos = positionRow(p);
        card._paintPos = () => pos._paint();
        // part, crop, position and comment behind one tap (0.11.101: in 10 days 3 of 115 photos had a position, 1 a
        // comment, 2 a part other than the one proposed); the line says what is set
        const more = el('details', 'fb-sc-more');
        const sum = el('summary');
        const paintSum = () => {
          const lab = ((p.section === 'growth' ? GROWTH_PARTS : PARTS).find(x => x[0] === p.part) || [0, ''])[1];
          sum.textContent = ['Details', lab, crops.length > 1 ? (crops.find(c => c.id === p.crop_id) || {}).name : null,
            p.pos_code || null, String(p.note || '').trim() ? 'comment' : null].filter(Boolean).join(' · ');
        };
        more.append(sum);
        more.addEventListener('toggle', paintSum); more.addEventListener('input', paintSum); more.addEventListener('click', () => setTimeout(paintSum, 0));
        card._more = more;
        more.append(chips(p.section === 'growth' ? GROWTH_PARTS : PARTS, () => p.part, v => { p.part = v; }));
        if (crops.length > 1) more.append(chips(crops.map(c => [c.id, c.name]), () => p.crop_id, v => { p.crop_id = v; }));
        more.append(pos);
        paintSum();
        // sizes (0.11.52, owner: "in the plant health add a message scale detected and estimate dimension of the fruit /
        // leaf, zoom in the pic when clicked"): a growth photo always has its scale line; a plant-health one once a scale
        // is known or a size taken. ✦ Estimate the size asks the AI (pressed only) for the sizes against the scale.
        const ms = el('div', 'fb-actions fb-sc-measures');
        let paintMs = () => {};
        {
          paintMs = () => {
            ms.textContent = '';
            const growth = p.section === 'growth';
            if (!growth && !p.px_per_mm && !(p.measures || []).length && p.scale_state !== 'busy') { ms.classList.add('hidden'); return; }
            ms.classList.remove('hidden');
            ms.append(el('span', 'fb-chip' + (p.px_per_mm ? (p.scale_skew > 1.3 ? ' late' : ' ok') : p.scale_state === 'busy' ? '' : ' late'),
              p.px_per_mm ? scaleWords(p) : p.scale_state === 'busy' ? 'looking for the scale card…'
                : p.scale_state === 'offline' ? 'no scale card read — the card reader needs a connection the first time' : 'no scale card seen'));
            (p.measures || []).forEach((m, i) => {
              const c = el('button', 'fb-btn' + (m.by === 'auto' ? ' fb-auto' : ''), `${m.by === 'auto' ? '{i:square} ' : ''}${(MEASURE_WHAT.find(x => x[0] === m.what) || [0, m.what])[1]} ${m.mm} mm ✕`); c.type = 'button';
              if (m.by === 'auto') c.title = 'Measured by the phone on the outline; ✕ removes it';
              c.onclick = () => { p.measures.splice(i, 1); paintMs(); saveScDraft(); };
              ms.append(c);
            });
            if (p.full instanceof Blob) {
              const go = el('button', 'fb-btn', p.px_per_mm ? '{i:ruler} Measure' : '{i:ruler} Measure on a ruler or tape'); go.type = 'button';
              go.title = p.px_per_mm ? 'Tap the two ends of what you measure' : 'No scale card: tap two marks on the ruler or tape, say how far apart they are, then measure';
              go.onclick = () => measurePhoto(p, paintMs);
              ms.append(go);
            }
            if (p.px_per_mm) {
              const est = el('button', 'fb-btn fb-ai', '✦ Estimate the size'); est.type = 'button';
              est.title = 'The AI reads the fruit or leaf against the scale (needs signal)';
              est.onclick = () => aiBtn.click();
              ms.append(est);
            }
            if (p.auto_state === 'busy') ms.append(el('span', 'fb-chip', '{i:square} measuring…'));
            else if (p.px_per_mm && p.full instanceof Blob && p.auto_state !== 'done') {
              const t = el('button', 'fb-btn fb-btn-primary',
                p.auto_state === 'none' ? '{i:square} Nothing outlined — tap it again'
                : p.auto_state === 'failed' ? '{i:square} The outline tool needs a connection the first time — try again'
                : '{i:square} Measure: two lines'); t.type = 'button';
              t.onclick = () => sc.sizeCheck(p);
              ms.append(t);
            }
            if (p.auto_state === 'done' && p.auto_view) {
              // what the phone measured, on the photo (0.11.76): a wrong object shows at once
              const b = el('button', 'fb-auto-view'); b.type = 'button';
              const im = el('img'); im.src = p.auto_view; im.alt = 'What the phone measured';
              b.append(im, el('span', null, p.size_ok ? '✓ Measured. Tap to look again or move the lines.'
                : 'Lines drawn — tap to check them and keep a size.'));
              if (p.size_ok) b.classList.add('ok');
              b.onclick = () => sc.sizeCheck(p);
              ms.append(b);
            }
            const aiSizes = (p.ai?.measures || []).map(m => `${(MEASURE_WHAT.find(x => x[0] === m.what) || [0, m.what])[1].toLowerCase()} ≈ ${m.mm} mm`);
            if (aiSizes.length) ms.append(el('span', 'fb-chip ok', '✦ ' + aiSizes.join(' · ')));
          };
          paintMs();
          card.append(ms);
        }
        // tap the photo: full screen, pinch or double-tap to zoom, Measure inside
        img.onclick = () => photoViewer(p.full instanceof Blob ? p.full : p.thumb,
          { title: p.section === 'growth' ? 'Growth photo' : 'Plant photo', measure: p.full instanceof Blob ? () => measurePhoto(p, paintMs) : null,
            scale: p.px_per_mm ? scaleWords(p) : null,
            outline: p.auto_view || null,
            pick: p.full instanceof Blob && p.px_per_mm ? pt => sc.autoSize(p, [[pt[0], pt[1], 1]]) : null });
        card._paintMs = () => paintMs();
        note.placeholder = p.section === 'growth' ? 'Comment (optional)' : 'Comment: what you see (optional)';
        const aiBtn = aiButton(p, card, aiBox);       // Remove is the ✕ on the photo now (0.11.86), no ⋯ menu
        acts.append(aiBtn);
        const noteRow = el('div', 'fb-note-row'); noteRow.append(note, risk);
        card._more.append(noteRow);
        card.append(card._more, acts, aiBox);
      }
      return card;
    }

    // ── the four panes ──
    const lists = {};
    const addBar = (section, label) => {
      const bar = el('div', 'fb-actions fb-sc-add');
      const cam = el('button', 'btn btn-primary', '{i:camera} ' + label); cam.type = 'button';
      const gal = el('button', 'fb-btn', '{i:image}'); gal.type = 'button'; gal.title = 'From the gallery'; gal.setAttribute('aria-label', 'Photo from the gallery');
      cam.onclick = () => shoot(section);
      gal.onclick = () => shoot(section, null, true);
      bar.append(cam, gal);
      return bar;
    };
    // Traps
    const cover = el('div', 'fb-sc-cover');
    // one row per trap: a ring to do, half a ring with one side missing, its colour when done; the details
    // (both sides, counts, AI note, Replaced, note) open under the row
    const cardEls = new Map();
    const cardOf = p => { let c = cardEls.get(p.ref); if (!c) { c = photoCard(p); cardEls.set(p.ref, c); } return c; };
    // the zone names come with the task: one item per zone (FarmBox 0095), its zone on area_zone_id
    const zoneName = new Map(task.positions.filter(x => x.area_zone_id).map(x => [x.area_zone_id, x.label || x.zone_name]));
    sc.open = new Set(); sc.menu = null;
    // the phone measures the fruit or leaf (0.11.53): at the centre by itself, or where the person tapped in the viewer
    sc.autoSize = async (p, point, want) => {
      if (!(p.full instanceof Blob) || !p.px_per_mm) return;
      const card = document.querySelector(`.fb-sc-card[data-ref="${p.ref}"]`);
      p.auto_state = 'busy'; card?._paintMs?.();
      try {
        const r = await autoMeasure(p, point || null, want);
        if (!r) p.auto_state = 'none';
        else {
          p.measures = [...(p.measures || []).filter(m => m.by !== 'auto'),
            { what: 'length', line: 'longest', mm: r.length_mm, by: 'auto', scale: p.scale_source || 'marker' },
            { what: 'width', line: 'across', mm: r.width_mm, by: 'auto', scale: p.scale_source || 'marker' }];
          p.auto_view = r.view; p.auto_point = r.point; p.auto_algo = r.algorithm; p.auto_state = 'done'; p.size_ok = false;
        }
      } catch (e) { console.warn('measuring', e); p.auto_state = 'failed'; }
      card?._paintMs?.(); saveScDraft();
      if (p.auto_state === 'done' && p.section === 'growth' && !point && !sizeSheetOpen) sizeCheck(p);
      return p.auto_state;
    };
    // ── "Is this the fruit?" (0.11.79, owner: "a special fruit detection with a visible contour"): the contour, the length
    // and the width, large; Yes confirms the sizes; Tap the fruit measures what is tapped; Measure by hand opens the ruler ──
    let sizeSheetOpen = false;
    async function sizeCheck(p) {
      while (document.querySelector('.fb-cam, .fb-viewer, .fb-measure, .fb-sheet')) await new Promise(r => setTimeout(r, 500));
      if (run.sc !== sc || !sc.photos.has(p.ref) || sizeSheetOpen || !p.px_per_mm) return;
      sizeSheetOpen = true;
      samPrepare(p).catch(() => {});                                   // encoded while the person looks for the fruit
      const what = p.part === 'head' ? 'head' : p.part === 'leaf' ? 'leaf' : 'fruit';
      const sheet = el('div', 'fb-sheet');
      const box = el('div', 'fb-sheet-card fb-sizecheck');
      const title = el('h3');
      const img = el('img', 'fb-sizecheck-img'); img.alt = 'The photo';
      const sizes = el('div', 'fb-sizecheck-sizes');
      const hint = el('div', 'fb-meta', '');
      const yes = el('button', 'fb-btn fb-btn-primary', '✓ Save'); yes.type = 'button';
      const bigger = el('button', 'fb-btn', '⊕ Bigger'); bigger.type = 'button';
      const smaller = el('button', 'fb-btn', '⊖ Smaller'); smaller.type = 'button';
      const again = el('button', 'fb-btn', 'Start again'); again.type = 'button';
      const hand = el('button', 'fb-btn', '{i:ruler} Measure by hand'); hand.type = 'button';
      const later = el('button', 'fb-link', 'Not now'); later.type = 'button';
      const measured = () => p.auto_state === 'done' && !!p.auto_view;
      let picking = !measured(), busy = false, note = '';
      let pts = (samState.get(p)?.points || []).slice();
      const paint = () => {
        const done = measured(), st = samState.get(p);
        title.textContent = busy ? 'Measuring…' : picking ? `Tap the ${what}` : `Is this the ${what}?`;
        img.src = (done && !picking) ? p.auto_view : (p.thumb || p.auto_view || '');
        sizes.textContent = '';
        // the sizes to track are tapped (0.11.98): none is kept by itself
        const autos = (p.measures || []).filter(m => m.by === 'auto');
        if (done && !picking) autos.forEach(m => {
          const b = el('button', 'fb-btn fb-size-pick ' + (m.line === 'across' ? 'across' : 'longest'), `${m.keep ? '✓ ' : ''}${m.line === 'across' ? 'Across' : 'Longest'} ${m.mm} mm`);
          b.type = 'button'; b.setAttribute('aria-pressed', String(!!m.keep)); b.disabled = busy;
          b.onclick = () => { m.keep = !m.keep; paint(); };
          sizes.append(b);
        });
        const kept = autos.filter(m => m.keep).length;
        yes.textContent = kept ? `✓ Save ${kept === 2 ? 'both' : autos.find(m => m.keep).line === 'across' ? 'across' : 'longest'}` : 'Tap the size to keep';
        // the 40 MB only the first time on this phone (0.11.83: it was said at every launch, the flag lived in memory only)
        hint.textContent = note || (busy ? (!samKnown() ? `Loading the outline tool (the first time only, about 40 MB) and outlining the ${what}…`
            : samDevice === 'wasm' ? `Outlining the ${what}… this phone's browser has no graphics acceleration, so the first outline of a photo can take up to a minute.`
            : !samReady ? `Preparing the outline tool and outlining the ${what}…`
            : `Outlining the ${what}…`)
          : picking ? `Tap the middle of the ${what} on the photo — the phone outlines it and measures it against the card.`
          : st ? `Blue = the longest straight line edge to edge, pink = the longest at a right angle to it. Tap the size (or both) to keep. Outline not right? Tap a part that does not belong to take it out, or a missing part to add it.`
          : `Blue = the longest straight line edge to edge, pink = the longest at a right angle to it. Tap the size (or both) to keep.`);
        note = '';
        img.classList.toggle('picking', !busy);
        yes.classList.toggle('hidden', picking || !done);
        again.classList.toggle('hidden', picking || !done);
        bigger.classList.toggle('hidden', picking || !done || !st?.bigger);
        smaller.classList.toggle('hidden', picking || !done || !st?.smaller);
        adj.classList.toggle('hidden', bigger.classList.contains('hidden') && smaller.classList.contains('hidden'));
        [yes, bigger, smaller, again, hand].forEach(b => { b.disabled = busy; });
        if (!kept) yes.disabled = true;
      };
      const close = () => { sheet.remove(); sizeSheetOpen = false; samRelease(); document.querySelector(`.fb-sc-card[data-ref="${p.ref}"]`)?._paintMs?.(); saveScDraft(); };
      const measure = async want => {
        busy = true; paint();
        let st = await sc.autoSize(p, pts.length ? pts : null, want);
        if (st !== 'done' && pts.length > 1) {                           // the last tap took everything away: undo it
          pts.pop(); st = await sc.autoSize(p, pts);
          note = 'That tap took the whole outline away — tap nearer the edge of the part to take out.';
        } else if (st !== 'done') { pts = []; note = `Nothing outlined there — tap the middle of the ${what}, or measure by hand.`; }
        busy = false; picking = st !== 'done';
        paint();
      };
      yes.onclick = () => {
        p.measures = (p.measures || []).filter(m => m.by !== 'auto' || m.keep);
        p.measures.forEach(m => { if (m.by === 'auto') m.confirmed = true; });
        p.size_ok = true; close();
      };
      bigger.onclick = () => measure(1);
      smaller.onclick = () => measure(-1);
      again.onclick = () => { pts = []; samState.delete(p); picking = true; paint(); };
      hand.onclick = () => { close(); measurePhoto(p, () => document.querySelector(`.fb-sc-card[data-ref="${p.ref}"]`)?._paintMs?.()); };
      later.onclick = close;
      img.onclick = async e => {
        if (busy) return;
        // the picture inside the frame (object-fit: contain leaves bars on two sides)
        const rc = img.getBoundingClientRect(), ar = (img.naturalWidth || 1) / (img.naturalHeight || 1);
        const dw = Math.min(rc.width, rc.height * ar), dh = dw / ar, ox = rc.left + (rc.width - dw) / 2, oy = rc.top + (rc.height - dh) / 2;
        const fx = (e.clientX - ox) / dw, fy = (e.clientY - oy) / dh;
        if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return;             // a tap on the bars
        const st = samState.get(p);
        if (picking || !st) pts = [[fx, fy, 1]];                          // the object
        else {                                                             // inside the outline: not this; outside: this too
          const inside = st.m[Math.round(fy * (st.h - 1)) * st.w + Math.round(fx * (st.w - 1))];
          pts = [...pts, [fx, fy, inside ? 0 : 1]];
          if (pts.length > 10) pts = [pts[0], ...pts.slice(-9)];
        }
        await measure(0);
      };
      const adj = el('div', 'fb-actions'); adj.append(smaller, bigger);
      box.append(title, img, sizes, adj, hint);
      const acts = el('div', 'fb-actions'); acts.append(yes, again, hand);
      box.append(acts, later);
      sheet.append(box);
      sheet.onclick = e => { if (e.target === sheet) close(); };
      document.body.append(sheet);
      paint();
    }
    // 0.11.99: the two lines by hand first (instant, any phone, offline); the outline tool is its optional button
    sc.outline = sizeCheck;
    sc.sizeCheck = p => lineTool(p, () => { document.querySelector(`.fb-sc-card[data-ref="${p.ref}"]`)?._paintMs?.(); saveScDraft(); },
                                 navigator.gpu ? () => sizeCheck(p) : null);
    sc.reveal = ref => { if (sc.photos.get(ref)?.section === 'trap') { sc.open.add(ref); paintCoverage(); } };
    const shortLevel = p => {
      const rs = SIDES.map(([k]) => sideRate(p, k)).filter(Boolean);
      if (rs.length) { const r = Math.round(rs.reduce((a, x) => a + x.rate, 0) * 10) / 10, tone = toneOf(r); return `${r} a day · ${{ red: 'high', orange: 'watch', green: 'low' }[tone]}`; }
      const counted = SIDES.map(([k]) => p.sides?.[k]).filter(S => S && !S.reference && S.total != null);   // a reference picture is no count
      if (!counted.length && SIDES.some(([k]) => p.sides?.[k]?.reference)) return 'reference photo · not counted';
      const n = counted.reduce((a, S) => a + S.total, 0);
      return `${n} on the card · the count starts`;
    };
    function trapMenu(t) {
      const m = el('div', 'fb-tl-menu');
      const st = sc.status.get(t.id);
      const row = el('div', 'fb-actions');
      const cam = el('button', 'fb-btn', '{i:camera} Photograph'); cam.type = 'button'; cam.onclick = () => { sc.menu = null; shoot('trap', t); };
      const gal = el('button', 'fb-btn', '{i:image}'); gal.type = 'button'; gal.setAttribute('aria-label', 'From the gallery'); gal.onclick = () => { sc.menu = null; shoot('trap', t, true); };
      const down = el('button', 'fb-btn', 'Taken down'); down.type = 'button'; down.title = 'Replaced or removed: this card leaves the list';
      down.setAttribute('aria-pressed', String(st?.status === 'taken_down'));
      down.onclick = () => { st?.status === 'taken_down' ? sc.status.delete(t.id) : sc.status.set(t.id, { status: 'taken_down' }); paintTabs(); paintCoverage(); saveScDraft(); };
      const far = el('button', 'fb-btn', 'Can’t reach it today'); far.type = 'button';
      far.setAttribute('aria-pressed', String(st?.status === 'unreachable'));
      far.onclick = () => { st?.status === 'unreachable' ? sc.status.delete(t.id) : sc.status.set(t.id, { status: 'unreachable', note: '' }); paintTabs(); paintCoverage(); saveScDraft();
        lists.trap.querySelector('.fb-tl-menu .fb-note')?.focus(); };
      row.append(cam, gal, down, far); m.append(row);
      if (st?.status === 'unreachable') {
        const note = el('input', 'fb-note'); note.type = 'text'; note.value = st.note || ''; note.placeholder = 'Why? (the manager is told)';
        note.oninput = () => { st.note = note.value; saveScDraft(); };
        m.append(note);
      }
      return m;
    }
    function trapRow(t, p) {
      const wrap = el('div', 'fb-tl-item');
      const line = el('div', 'fb-tl-line');
      const r = el('button', 'fb-tl-row'); r.type = 'button';
      const st = t && !p ? sc.status.get(t.id) : null;
      const miss = p ? SIDES.find(([k]) => !p.sides?.[k]) : null;
      const tone = p && !miss ? (trapLevel(p).tone || 'start') : '';
      const dot = el('span', 'fb-tl-dot ' + (st ? 'x' : !p ? 'todo' : !p.code_ok ? 'ask' : miss ? 'half' : tone));
      const code = p ? (p.code_ok ? p.code : (p.code ? p.code + '?' : '?')) : shortCode(t.code);
      const text = st ? (st.status === 'taken_down' ? 'taken down' : `can’t reach${st.note ? ': ' + st.note : ' — say why'}`)
        : !p ? 'to do'
        : !p.code_ok ? (p.code ? `is it ${p.code}? tap to confirm` : 'which trap? tap to write it')
        : miss ? `${miss[1].toLowerCase()} left` : shortLevel(p);
      r.append(dot, el('b', 'fb-tl-code', code), el('span', 'fb-tl-text', text), el('span', 'fb-tl-act', !p ? '{i:camera}' : sc.open.has(p.ref) ? '▴' : '▾'));
      r.setAttribute('aria-label', `Trap ${code}: ${text}`);
      line.append(r);
      if (p) {
        if (!p.code_ok) sc.open.add(p.ref);
        r.onclick = () => { sc.open.has(p.ref) ? sc.open.delete(p.ref) : sc.open.add(p.ref); paintCoverage(); };
        if (miss && p.code_ok) { const go = el('button', 'fb-tl-more', '{i:camera}'); go.type = 'button'; go.setAttribute('aria-label', `Photograph the ${miss[1].toLowerCase()} of trap ${code}`);
          go.onclick = () => addSide(p, miss[0], cardOf(p)); line.append(go); }
        wrap.append(line);
        if (sc.open.has(p.ref)) wrap.append(cardOf(p));
      } else {
        r.onclick = () => (st ? (sc.menu = t.id, paintCoverage()) : shoot('trap', t));
        const more = el('button', 'fb-tl-more', '⋯'); more.type = 'button'; more.setAttribute('aria-label', `More for trap ${code}`);
        more.onclick = () => { sc.menu = sc.menu === t.id ? null : t.id; paintCoverage(); };
        line.append(more); wrap.append(line);
        if (sc.menu === t.id) wrap.append(trapMenu(t));
      }
      return wrap;
    }
    function paintCoverage() {
      paintTabs();                 // the tab's dot follows each trap photographed (0.11.74)
      cover.textContent = '';
      const photosT = [...sc.photos.values()].filter(x => x.section === 'trap').sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)));
      if (!traps.length && !photosT.length)
        cover.append(el('div', 'fb-hold fb-sc-first', 'First round: photograph every trap. Each is added from the position on its card — 1B6 = zone 1, row B, 6 m from the corridor. The count starts today; the colour comes with the next photo.'));
      lists.trap.textContent = '';
      const loose = photosT.filter(p => !p.trap_id || !traps.some(t => t.id === p.trap_id));
      if (loose.length) {
        lists.trap.append(el('div', 'fb-tl-zone', traps.length ? 'New cards' : 'Photographed today'));
        loose.forEach(p => lists.trap.append(trapRow(null, p)));
      }
      const groups = new Map();
      traps.forEach(t => { const z = zoneName.get(t.zone_id) || `Zone ${parseTrapCode(t.code).n || '?'}`; if (!groups.has(z)) groups.set(z, []); groups.get(z).push(t); });
      for (const [z, ts] of groups) {
        const done = ts.filter(trapDone).length;
        lists.trap.append(el('div', 'fb-tl-zone', `${z} · ${done} of ${ts.length}`));
        ts.forEach(t => lists.trap.append(trapRow(t, photoOf(t))));
      }
      if (sc.noTraps && photosT.length) sc.noTraps = false;
      sc.paintNone?.();
      paintTabs();
    }
    const missedLine = k => sc.missed[k] ? el('div', 'fb-hold fb-sc-missed', `Not done ${/^(Yesterday|Today|Tomorrow)$/.test(fmtDay(sc.missed[k])) ? fmtDay(sc.missed[k]).toLowerCase() : 'on ' + fmtDay(sc.missed[k])} — due today.`) : '';
    lists.trap = el('div', 'fb-tl');
    const scan = el('div', 'fb-actions fb-sc-add');
    const scanBtn = el('button', 'btn btn-primary', traps.length ? '{i:camera} Scan a trap not in the list' : '{i:camera} Scan a trap'); scanBtn.type = 'button';
    scanBtn.title = 'The phone reads the position written on the card';
    const scanGal = el('button', 'fb-btn', '{i:image}'); scanGal.type = 'button'; scanGal.title = 'From the gallery'; scanGal.setAttribute('aria-label', 'Trap photo from the gallery');
    scanBtn.onclick = () => shoot('trap'); scanGal.onclick = () => shoot('trap', null, true);
    scan.append(scanBtn, scanGal);
    // no trap photo today (0.11.77, owner 30 Sept 2026): the section counts as done, the report says so, nothing is counted
    const noneRow = el('div', 'fb-sc-notraps');
    const paintNone = () => {
      noneRow.textContent = '';
      const hasPhotos = [...sc.photos.values()].some(p => p.section === 'trap');
      if (sc.noTraps) {
        noneRow.append(el('span', 'fb-chip ok', '✓ No traps today — nothing counted'));
        const undo = el('button', 'fb-link', 'Undo'); undo.type = 'button';
        undo.onclick = () => { sc.noTraps = false; if (sc.verdict.trap?.note === 'No traps today') sc.verdict.trap = { ok: false, note: '' }; paintNone(); paintCoverage(); saveScDraft(); };
        noneRow.append(undo);
      } else if (!hasPhotos) {
        const b = el('button', 'fb-btn', 'No traps today'); b.type = 'button';
        b.title = 'Skip the traps in this zone today: no trap photo, the report says No traps today';
        b.onclick = () => {
          sc.noTraps = true;
          const v = sc.verdict.trap || (sc.verdict.trap = { ok: false, note: '' });
          v.ok = true; if (!String(v.note || '').trim()) v.note = 'No traps today';
          paintNone(); paintCoverage(); saveScDraft();
        };
        noneRow.append(b);
      }
      lists.trap.classList.toggle('fb-dim', !!sc.noTraps);
      scan.classList.toggle('hidden', !!sc.noTraps);
    };
    sc.paintNone = paintNone;
    // the traps are read in Digital scouting (0260): this tab only leads there, to this zone of today
    const toDg = el('button', 'btn btn-primary', 'Open Digital scouting'); toDg.type = 'button';
    toDg.onclick = async () => {
      const zl = zoneLines[0] || {};
      setKV('run_open', null).catch(() => {});
      await leaveRun();
      openDigital({ day: todayISO(), taskId: task.extraZone ? null : (task.members?.[0]?.id || task.id || null),
                    unitId: zl.area_system_id || zl.area_zone_id || task.system_id || task.zone_id || null });
    };
    const toDgRow = el('div', 'fb-actions fb-sc-add'); toDgRow.append(toDg);
    panes.trap.append(el('div', 'config-hint', 'Traps are read in Digital scouting: there each card is photographed and the AI counts it.'), toDgRow);
    // Plant health
    lists.health = el('div');
    panes.health.append(el('div', 'config-hint', 'A photo of anything that looks wrong on a plant: where in the zone if you want (row and metres, B6), a comment, the AI note if you want it. Tap a photo to zoom.'),
                        addBar('health', 'Add a photo'), lists.health, verdictBlock('health', 'Health'));
    // Growth
    lists.growth = el('div');
    panes.growth.append(missedLine('growth'), el('div', 'config-hint', 'A photo of a fruit or leaf with the scale card beside it, or a ruler or tape along it: the size comes by itself (or {i:ruler}). Tap a photo to zoom.'),
                        addBar('growth', 'Add a photo'), lists.growth, verdictBlock('growth', 'Growth'));
    // 0.11.63: no box for the greenhouse as a whole — each section says OK or not OK, and the result follows
    sc.shoot = shoot;

    // the photos already taken (a draft, or a scouting being edited), newest on top
    [...sc.photos.values()].sort((a, b) => String(a.taken_at).localeCompare(String(b.taken_at)))
      .forEach(p => { if (p.section === 'trap') cardOf(p); else lists[p.section]?.prepend(photoCard(p)); });
    paintCoverage(); paintTabs();
    return box;
  }


//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- finishing a scouting. Edit here, then run: python build.py
  // ── finishing a scouting ────────────────────────────────────────────────
  async function finishScouting() {
    const R = run, sc = run.sc;   // the run being finished (0.11.55)
    const photos = [...sc.photos.values()];
    const trapsP = photos.filter(p => p.section === 'trap');
    const plants = photos.filter(p => p.section !== 'trap');
    const stop = (tab, text, ref) => {
      $('runHint').textContent = text;
      showToast(text, 'error');   // the hint sits under Finish, out of view while the tab scrolls to the problem
      sc.goTab(tab);
      if (ref === 'verdict') {
        const v = document.getElementById('fb-scv-' + tab);
        v?.scrollIntoView({ behavior: 'smooth', block: 'center' }); v?.querySelector('textarea')?.focus({ preventScroll: true });
      } else if (ref) { sc.reveal?.(ref); const c = document.querySelector(`.fb-sc-card[data-ref="${ref}"]`);
        if (c?._more) c._more.open = true;                               // what is missing sits in its details
        c?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    };
    // every trap of the zone photographed, or marked taken down / out of reach (0.11.65)
    if (sc.due?.trap && !sc.noTraps && !trapsP.length && (!sc.traps.length || sc.traps.some(t => !sc.status.has(t.id))))
      return stop('trap', sc.traps.length ? 'Take at least one trap photo — the traps are due today.' : 'First round: photograph every trap.');
    const noCode = trapsP.find(p => !p.code);
    if (noCode) return stop('trap', 'A trap has no position — write the one on the card (1B6).', noCode.ref);
    const unsure = trapsP.find(p => !p.code_ok);
    if (unsure) return stop('trap', `Is it trap ${unsure.code}? Confirm the position or correct it.`, unsure.ref);
    const oneSide = trapsP.find(p => SIDES.some(([k]) => !p.sides?.[k]));
    if (oneSide) return stop('trap', `Trap ${oneSide.code}: the ${SIDES.find(([k]) => !oneSide.sides?.[k])[0]} side still needs its photo.`, oneSide.ref);
    const noNum = trapsP.find(p => SIDES.some(([k]) => p.sides[k].total == null));
    if (noNum) return stop('trap', `Trap ${noNum.code}: type the number of insects on each side.`, noNum.ref);
    const seen = new Map();
    for (const p of trapsP) {
      if (seen.has(p.code)) return stop('trap', `Trap ${shortCode(p.code)} has two photos — remove one.`, p.ref);
      seen.set(p.code, p);
    }
    // plant health and growth under today's minimum (0.11.74): asked once, then sent as it is
    const SHORT_LABEL = { health: 'Health', growth: 'Growth' };
    const short = ['health', 'growth'].filter(k => sc.due?.[k] && plants.filter(p => p.section === k).length < (sc.minPhotos?.[k] ?? 2));
    if (!(R.edit && !R.resume) && short.length && sc.sentShort !== short.join()) {
      const txt = short.map(k => `${SHORT_LABEL[k]} ${plants.filter(p => p.section === k).length} of ${sc.minPhotos?.[k] ?? 2} photos`).join(', ');
      if (!confirm(`Under today's minimum: ${txt}. Finish anyway?`))
        return stop(short[0], `${SHORT_LABEL[short[0]]}: at least ${sc.minPhotos?.[short[0]] ?? 2} photos today.`);
      sc.sentShort = short.join();
    }
    // a growth photo taken on this phone and still without its scale card (0.11.86) — one restored from a draft before
    // the card was looked for; the photos of a report sent earlier are left as they are
    const bare = plants.find(p => p.section === 'growth' && !p.px_per_mm && p.full instanceof Blob);
    if (bare) return stop('growth', 'A growth photo has no scale card — remove it (✕) and take it again with the card in the picture.', bare.ref);
    // one zone a task (0.11.65): the zone is known; a task over several zones still needs where
    const oneZone = run.task.positions.filter(x => x.area_zone_id).length === 1;
    const lost = oneZone ? null : plants.find(p => !parsePos(p.pos_code));
    if (lost) return stop(lost.section, 'A photo has no position — write it (3B8).', lost.ref);
    const zp = oneZone ? zoneShort(run.task.positions.find(x => x.area_zone_id).label) : '';
    const posOf = v => { const c = String(v || '').toUpperCase().replace(/\s/g, ''); const f = c && /^[A-Z]/.test(c) && /^\d+(\.\d+)?$/.test(zp) ? zp + c : c; return parsePos(f) ? f : null; };
    // each section today says OK or not OK (0.11.63): one still red is asked about once, then needs its note
    const LABEL = Object.fromEntries(SC_TABS);
    const secs = SC_TABS.map(([k]) => k).filter(k => k !== 'trap' && sc.shown?.(k));
    // an extra scouting (0.11.94) asks for no verdict: a section is "not OK" only when its note says what is wrong
    const X = !!R.task.extraZone;
    if (X && !photos.length && !secs.some(k => String(sc.verdict[k]?.note || '').trim())) {
      showToast('Nothing to send yet — add a photo first', 'info'); return;
    }
    const red = X ? secs.filter(k => !sc.verdict[k]?.ok && String(sc.verdict[k]?.note || '').trim()) : secs.filter(k => !sc.verdict[k]?.ok);
    // 0.11.101: a problem is reported by its own button, so nothing is asked here — only its note is needed
    const noWhy = red.find(k => !String(sc.verdict[k]?.note || '').trim());
    if (noWhy) return stop(noWhy, `Say what the problem is in ${LABEL[noWhy].toLowerCase()} — the manager is told.`, 'verdict');
    sc.outcome = red.length ? 'nok' : X ? null : 'ok';
    sc.outcomeNote = secs.map(k => String(sc.verdict[k]?.note || '').trim() ? `${LABEL[k]}: ${String(sc.verdict[k].note).trim()}` : null).filter(Boolean).join(' · ');
    // the traps of the list not photographed on a trap day: taken down, forgotten, or out of reach (0146)
    const photographed = new Set(trapsP.map(p => p.trap_id).filter(Boolean));
    const missing = !(run.edit && !run.resume) && sc.due?.trap && !sc.noTraps ? sc.traps.filter(t => !photographed.has(t.id)) : [];
    const open = missing.filter(t => { const x = sc.status.get(t.id); return !x || (x.status === 'unreachable' && !String(x.note || '').trim()); });
    // only the ones still open: a trap already marked in its row (0.11.50) is not asked about again
    if (open.length) { $('runHint').textContent = ''; return missingTraps(open); }

    $('finish').disabled = true;
    $('runHint').textContent = 'Saving…';
    try {
    if (sc.upSettle) await sc.upSettle(R, 4000);
    const finished = new Date().toISOString();
    const t = run.edit && !run.resume ? run.task.members[0] : (run.task.members.find(m => m.status !== 'done') || run.task.members[0]);
    const cid = run.edit?.run?.client_run_id || run.clientId;
    const step = run.steps[0];
    const trapById = new Map(sc.traps.map(x => [x.id, x]));
    const payload = {
      farm_id: t.farm_id || farm.id, task_id: t.id, sop_version_id: t.sop_version_id || run.task.sop_version_id,
      client_run_id: cid, status: X ? 'partial' : 'completed', started_at: run.edit?.run?.started_at || run.started, finished_at: finished,
      ...(run.edit ? { edit: true, ...(run.append ? { append: true } : {}) } : {}),
      // an extra scouting: its task stays open all day (partial), and is made by the server from these ids if it is not there yet
      ...(X ? { extra: true, extra_items: R.task.extraItems || [] } : {}),
      ...(X && !red.length ? {} : { outcome: sc.outcome, outcome_note: String(sc.outcomeNote || '').trim() || null,
      section_outcomes: Object.fromEntries((X ? red : secs).map(k => [k, { outcome: sc.verdict[k]?.ok ? 'ok' : 'nok', note: String(sc.verdict[k]?.note || '').trim() || null }])) }),
      steps: step && !X ? [{ seq: step.seq, step_id: step.id, result: sc.outcome === 'ok' ? 'ok' : 'nok', note: String(sc.outcomeNote || '').trim() || null,
                       media: [], recorded_at: finished }] : [],
      // no `traps` and no `trap_status` (0260): the traps are read in Digital scouting, and an edit without them keeps
      // the trap readings the run already has
      observations: plants.map(p => ({ client_ref: p.ref, section: p.section, part: p.part || 'other', crop_id: p.crop_id || null,
        // an extra's photo names its zone line (0.11.100): without it the server filed the photo with no zone, and the
        // report, which reads by zone, never showed it (20 photos on 4 Oct)
        zone_id: p.zone_id || (X ? R.task.zone_id || null : null), item_id: p.item_id || (X ? R.task.positions?.[0]?.id || null : null),
        note: p.note || null, note_level: noteLevelOf(p), photo_data: p.thumb || null, photo_path: p.photo_path || null, taken_at: p.taken_at,
        pos_code: posOf(p.pos_code), gps: null, measures: (p.measures || []).filter(m => m.by !== 'auto' || m.confirmed), px_per_mm: p.px_per_mm ?? null, ai: p.ai || null })),
    };
    const uploads = [
      ...trapsP.flatMap(p => SIDES.map(([k]) => [k, p.sides[k]]).filter(([, S]) => S.full instanceof Blob && !S.photo_path && !S.sent)
                                  .map(([k, S]) => ({ kind: 'trap', ref: `${p.code}:${k}`, blob: S.full }))),
      ...plants.filter(p => p.full instanceof Blob && !p.photo_path && !p.sent).map(p => ({ kind: 'observation', ref: p.ref, blob: p.full })),
    ];
    if (!X) {
      run.task.members.forEach(m => { if (m.id === t.id) { m.status = 'done'; m.done_at = m.done_at || finished; } });
      await putAll('tasks', run.task.members.filter(m => m.id === t.id));
    }
    await queue([payload, ...uploads.map((u, n) => ({ __upload: true, client_run_id: `${cid}~up-${Date.now().toString(36)}-${String(n).padStart(3, '0')}`,
      run_client_id: cid, farm_id: payload.farm_id, kind: u.kind, ref: u.ref, blob: u.blob }))]);
    if (X) {
      // the zone is sent and stays open: its timer pauses, its card says when
      EXTRA_SENT[R.task.key] = Date.now();
      for (const k of Object.keys(EXTRA_SENT)) if (EXTRA_SENT[k] < Date.now() - 36 * 3600000) delete EXTRA_SENT[k];
      setKV('extra_sent', EXTRA_SENT).catch(() => {});
      if (timerRunning(t.id)) await timerPause(t.id);
    }
    try { clearTimeout(scDraftTimer); await del('kv', scDraftKey(R.task)); await setKV('run_open', null); } catch (e) { /* nothing to clear */ }
    addStop(R);
    $('finish').disabled = false;
    const edited = !!R.edit && !R.resume;
    // an extra scouting: sent as it is — only a word about the sections left empty this time
    const empty = X ? SC_TABS.filter(([k]) => k !== 'trap' && !photos.some(p => p.section === k)).map(([, l]) => l.toLowerCase()) : [];
    showToast(X ? 'Sent ✓ — added to today\'s report' + (sc.outcome === 'nok' ? ', the manager is told' : '') + (empty.length && empty.length < 2 ? ` · no ${empty.join(', no ')} this time` : '')
      : edited ? 'Changes saved ✓' : sc.outcome === 'nok' ? 'Saved — not OK, the manager is told' : 'Scouting done ✓', sc.outcome === 'nok' ? 'error' : 'success');
    R.sentOk = true;
    if (run === R) backFromRun();        // back to the day's zones (0.11.67)
    } catch (e) {
      R.upStop = false;
      $('finish').disabled = false;
      $('runHint').textContent = 'Could not save: ' + String(e.message || e).slice(0, 100);
      showToast('Could not save — ' + String(e.message || e).slice(0, 60), 'error');
    }
  }


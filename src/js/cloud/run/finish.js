//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- finishing a checklist run. Edit here, then run: python build.py
  async function finishRun() {
    if (run?.sc) return finishScouting();
    const R = run;   // the run being finished: the person may open another task while it saves (0.11.55)
    // the trap round: every trap needs its photo and a number before the round can close
    if (run.traps) {
      const undone = [...run.traps.values()].filter(t => t.photo_data == null || t.total == null);
      if (undone.length) {
        $('runHint').textContent = `${undone.length} trap${undone.length > 1 ? 's' : ''} still need a photo and a count.`;
        document.querySelector(`.fb-trap[data-trap="${undone[0].trap_id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    // the procedure's trap step is answered by the trap cards — counted, or skipped today (0096) —
    // only that one: the plant checks need their own answer
    if (run.traps || run.scout) {
      const trapSteps = run.steps.filter(s => /trap/i.test(s.title || ''));
      const answer = (key, s, it) => {
        const n = it ? (run.trapsByItem?.get(it.id) || []).length : (run.trapList?.length || 0);
        const opened = it ? run.trapsOpen?.has(it.id) !== false && n > 0 : n > 0;
        if (!run.answers.has(key)) run.answers.set(key, { seq: s.seq, step_id: s.id, result: opened ? 'ok' : 'skipped',
          ...(it ? { item_id: it.id } : {}),
          note: opened ? `${n} trap${n > 1 ? 's' : ''} photographed and counted` : (n ? 'skipped today' : 'no sticky trap registered here') });
        if (!(run.media.get(key) || []).length) run.media.set(key, [{ trapEvidence: true }]);
      };
      if (run.perItem) run.itemList.forEach(it => trapSteps.forEach(s => answer(stepKey(s, it), s, it)));
      else trapSteps.forEach(s => answer(s.seq, s, null));
    }
    // a harvest task: the weights typed above answer the weigh / record steps
    if (run.harvests) {
      // "Last cut" with no weight: the server records no harvest without kg, so the batch stayed open while the phone said
      // the checklist was complete — stopped here, before anything is queued, for a listed line and an added one alike
      const noKg = [...run.harvests.values()].find(x => x.final && !(num(x.kg) > 0));
      if (noKg) {
        const nm = noKg.label || noKg.position_code || 'this batch';
        $('runHint').textContent = `Type the kg of ${nm}, or untick Last cut`;
        showToast($('runHint').textContent, 'error');
        const inp = document.querySelector(`#fb-steps [data-plan="${noKg.plan_id}"] input`);
        if (inp) { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); inp.focus(); }
        return;
      }
      const rows = [...run.harvests.values()].filter(x => num(x.kg) > 0);
      const big = rows.find(x => num(x.kg) > 200);
      if (big && !confirm(`${big.position_code}: ${big.kg} kg — is that right?`)) return;
      const kg = Math.round(rows.reduce((a, x) => a + num(x.kg), 0) * 100) / 100;
      if (kg > 0) {
        run.steps.filter(s => (s.step_type === 'measure' || s.step_type === 'record') && !run.answers.has(s.seq)).forEach(s => {
          run.answers.set(s.seq, { seq: s.seq, step_id: s.id, result: 'ok',
            ...(s.step_type === 'measure' ? { value_num: kg } : { value_text: rows.map(x => `${x.position_code} ${x.kg} kg`).join(', ') }),
            note: `${kg} kg from ${rows.length} position${rows.length > 1 ? 's' : ''}` });
        });
      }
    }
    const expected = run.perItem
      ? run.itemList.flatMap(it => run.steps.map(s => ({ s, key: stepKey(s, it), item: it })))
      : run.steps.map(s => ({ s, key: s.seq, item: null }));
    const unanswered = expected.filter(x => !run.answers.has(x.key));
    const red = unanswered.filter(x => isTick(x.s) || (run.chips && (x.s.step_type === 'check' || x.s.step_type === 'action')));
    const missing = unanswered.filter(x => !red.includes(x));
    const noPhoto = expected.filter(x => !run.chips && /photo|video/.test(x.s.evidence || '') && !(run.media.get(x.key) || []).length);
    if (missing.length || noPhoto.length) {
      const where = x => x.item ? ` (${x.item.label})` : '';
      $('runHint').textContent = missing.length
        ? `${missing.length} step${missing.length > 1 ? 's' : ''} still to answer${where(missing[0])}.`
        : `${noPhoto.length} step${noPhoto.length > 1 ? 's' : ''} still need a photo${where(noPhoto[0])}.`;
      showToast($('runHint').textContent, 'error');   // the hint sits under Finish, scrolled out of view
      const first = (missing[0] || noPhoto[0]).key;
      document.querySelector(`.fb-step[data-key="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // the places (0.11.59): one is done with the checklist; several still red are asked about
    if (run.items && run.itemsAuto) run.items.forEach(st => { st.done = true; });
    else if (run.items) {
      const left = [...run.items.values()].filter(st => !st.done);
      if (left.length && !confirm(`${left.length} place${left.length === 1 ? '' : 's'} still red — send ${left.length === 1 ? 'it' : 'them'} as not done?`)) return;
    }
    // still red (0.11.57): asked, then sent as not OK — the note says why, and the manager is told
    const runNote = String(document.getElementById('fb-runNote')?.value || '').trim();
    if (red.length) {
      const names = red.slice(0, 4).map(x => x.item ? zoneShort(x.item.label) : x.s.title).join(', ') + (red.length > 4 ? '…' : '');
      if (!confirm(`${red.length} still red (${names}) — send ${red.length === 1 ? 'it' : 'them'} as not OK?`)) return;
      if (!runNote) {
        $('runHint').textContent = 'Say in the notes what is not OK.';
        showToast('Say in the notes what is not OK', 'error');
        document.getElementById('fb-runNote')?.focus();
        return;
      }
      red.forEach(x => run.answers.set(x.key, { seq: x.s.seq, step_id: x.s.id, result: 'nok', ...(x.item ? { item_id: x.item.id } : {}), note: runNote }));
    }
    const anyNok = [...run.answers.values()].some(a => a.result === 'nok');
    if (anyNok && !runNote) {
      $('runHint').textContent = 'Something is not OK: say what in the notes.';
      showToast('Something is not OK: say what in the notes', 'error');
      document.getElementById('fb-runNote')?.focus();
      return;
    }
    $('finish').disabled = true;
    $('runHint').textContent = 'Saving…';
    try {

    // the step photos ride with the run in the outbox and go up just before it (0.11.55): uploading them here lost
    // every photo taken without signal, and made Finish wait for them
    const steps = [];
    for (const x of expected) {
      const a = run.answers.get(x.key);
      const blobs = (run.media.get(x.key) || []).filter(f => f instanceof Blob);   // the trap cards carry their own photos
      // an edited run keeps the photos already on the server (Edit what was sent)
      const saved = (run.media.get(x.key) || []).filter(f => f && f.saved)
        .map(f => typeof f.saved === 'string' ? { path: f.saved, kind: 'photo' } : f.saved);
      steps.push({ ...a, media: saved, ...(blobs.length ? { media_blobs: blobs } : {}), recorded_at: new Date().toISOString() });
    }

    // the full photos (traps and plants) follow the run from the outbox and attach themselves:
    // a slow signal never holds the run (0.11.25)
    const uploads = [];
    for (const x of (run.traps ? run.traps.values() : [])) {
      if (x.full instanceof Blob && !x.photo_path) uploads.push({ kind: 'trap', ref: x.code, blob: x.full });
    }
    for (const x of (run.scout ? run.scout.values() : [])) {
      if (x.full instanceof Blob && !x.photo_path) uploads.push({ kind: 'observation', ref: x.client_ref, blob: x.full });
    }

    // One run per task row. A server-grouped task is one row; a phone-grouped
    // one is several, each getting the same answers (they were done together).
    const finished = new Date().toISOString();
    const open = run.edit && !run.resume ? run.task.members : run.task.members.filter(m => m.status !== 'done');
    const cid = run.edit?.run?.client_run_id || run.clientId;
    const payloads = open.map((t, i) => ({
      farm_id: t.farm_id || farm.id, task_id: t.id, sop_version_id: t.sop_version_id || run.task.sop_version_id,
      client_run_id: i ? `${cid}-${i}` : cid, status: 'completed',
      ...(run.edit ? { edit: true, ...(run.append ? { append: true } : {}) } : {}),
      started_at: run.edit?.run?.started_at || run.started, finished_at: finished, steps,
      // the checklist's note and its verdict (0.11.57): a not OK tells the manager (an issue, FarmBox 0141)
      notes: runNote || null, outcome: anyNok ? 'nok' : 'ok', outcome_note: anyNok ? runNote : (runNote || null),
      position_ids: run.task.positions.filter(p => p.task_id === t.id && p.position_id).map(p => p.position_id),
      // harvest weights, on the first run only
      ...(run.harvests && !i ? { harvests: [...run.harvests.values()].filter(x => num(x.kg) > 0 || x.final).map(x => ({
        plan_id: x.plan_id, position_code: x.position_code, kg: x.kg, final: !!x.final })) } : {}),
      // the ticks on the task's items, on the first run only
      ...(run.items && !i ? { items: [...run.items.values()].map(x => ({ id: x.id, done: !!x.done, note: x.note || '' })) } : {}),
      // IPM readings, on the first run only (a phone-grouped round is one zone anyway)
      ...(run.traps && !i ? { traps: [...run.traps.values()].filter(x => x.photo_data != null).map(x => ({
        trap_id: x.trap_id, code: x.code, photo_data: x.photo_data, photo_path: x.photo_path || null,
        // the count typed by the person: the phone sends none of its own (0260)
        total: x.total ?? 0, corrected: true,
        // the old round has no Risk menu: a comment goes up yellow, the same rule as a comment whose risk was never chosen
        pest: x.pest || null, replaced: x.replaced, notes: x.notes || null, note_level: noteLevelOf({ note: x.notes, note_level: x.note_level }), read_at: finished })) } : {}),
      // the scouting photos, on the first run only (0096)
      ...(run.scout && !i ? { observations: [...run.scout.values()].filter(x => x.photo_data).map(x => ({
        client_ref: x.client_ref, item_id: x.item_id, zone_id: x.zone_id, crop_id: x.crop_id, part: x.part,
        note: x.note || null, note_level: noteLevelOf(x), photo_data: x.photo_data, taken_at: x.taken_at })) } : {})
    }));
    open.forEach(t => { t.status = 'done'; t.done_at = finished; });
    await putAll('tasks', open);
    // the run first, then its full photos, keyed to sort right after it
    await queue([...payloads, ...uploads.map((u, n) => ({ __upload: true, client_run_id: `${cid}~up-${String(n).padStart(3, '0')}`,
      run_client_id: cid, farm_id: run.task.farm_id || farm.id, kind: u.kind, ref: u.ref, blob: u.blob }))]);
    try { clearTimeout(draftTimer); await del('kv', runDraftKey(R.task)); } catch (e) { /* nothing to clear */ }
    if (R.traps) { try { await del('kv', trapDraftKey(R.task)); } catch (e) { /* nothing to clear */ } }
    if (R.harvests) { try { await del('kv', harvDraftKey(R.task)); } catch (e) { /* nothing to clear */ } }
    try { await setKV('run_open', null); } catch (e) {}
    addStop(R);
    const failed = steps.filter(s => s.result === 'nok').length;
    $('finish').disabled = false;
    showToast(R.edit && !R.resume ? 'Changes saved ✓' : failed ? `Saved — ${failed} step${failed > 1 ? 's' : ''} not OK` : 'Checklist complete ✓',
              failed ? 'error' : 'success');
    if (run === R) showWeek();        // not when the person has already opened another task
    } catch (e) {
      // nothing is left disabled: the answers are still on screen and in the draft
      $('finish').disabled = false;
      $('runHint').textContent = 'Could not save: ' + String(e.message || e).slice(0, 100);
      showToast('Could not save — ' + String(e.message || e).slice(0, 60), 'error');
    }
  }


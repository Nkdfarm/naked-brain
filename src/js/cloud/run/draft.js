//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the checklist's own draft. Edit here, then run: python build.py
  // ── the checklist's own draft (0.11.39): answers, notes and photos kept in
  // IndexedDB as they happen, so Android closing the app while the camera is
  // open loses nothing. Restored by replaying them into the step cards.
  const runDraftKey = task => 'rundraft:' + (task.key || task.id);
  let draftTimer = null;
  function saveRunDraft() {
    if (!run) return;
    run.touched = true;
    clearTimeout(draftTimer);
    const r = run;
    draftTimer = setTimeout(async () => {
      try {
        await setKV(runDraftKey(r.task), { saved: Date.now(), cid: r.draftCid || null, answers: [...r.answers.entries()],
          runNote: document.getElementById('fb-runNote')?.value || '',
          media: [...r.media.entries()].map(([k, list]) => [k, list.filter(f => f instanceof Blob)]).filter(x => x[1].length) });
      } catch (e) { console.warn('run draft not saved', e); }
    }, 300);
  }
  async function restoreRunDraft(task) {
    let d = null;
    try { d = await getKV(runDraftKey(task)); } catch (e) { return 0; }
    if (!d || Date.now() - (d.saved || 0) > 12 * 3600000) return 0;
    // sent as it stood by Send (0.11.89): Finish completes that same run
    if (d.cid && run && !run.edit) { run.clientId = d.cid; run.draftCid = d.cid; }
    return replayAnswers(d);
  }
  // what a done task sent, back into the step cards to be changed (0.11.40); its photos stay on the server
  function replayDetail(d) {
    const answers = [], notes = [];
    for (const x of d.steps || []) {
      const key = x.item_id ? `${x.item_id}|${x.seq}` : x.seq;
      answers.push([key, { result: x.result, value_num: x.value_num, value_text: x.value_text }]);
      if (x.note) notes.push([key, x.note]);
      if ((x.media || []).length) {
        run.media.set(key, x.media.map(path => ({ saved: path })));
        const chip = document.querySelector(`#fb-steps .fb-step[data-key="${CSS.escape(String(key))}"] .fb-shot .fb-chip`);
        if (chip) { chip.textContent = `${x.media.length} saved`; chip.className = 'fb-chip ok'; }
      }
    }
    return replayAnswers({ answers, notes, media: [], runNote: d.run?.outcome_note || d.run?.notes || '' });
  }
  function replayAnswers(d) {
    let n = 0;
    // a step card, or a zone button (0.11.57): whatever carries the key
    const card = key => document.querySelector(`#fb-steps [data-key="${CSS.escape(String(key))}"]`);
    for (const [key, a] of d.answers || []) {
      const c = card(key); if (!c) continue;
      if (c._setOk) { if (a.result === 'ok' || a.result === 'na') { c._setOk(true); n++; } continue; }
      const num = c.querySelector('input.fb-num');
      if (num && a.value_num != null) { num.value = a.value_num; num.dispatchEvent(new Event('input')); n++; continue; }
      if (num && a.value_text != null) { num.value = a.value_text; num.dispatchEvent(new Event('input')); n++; continue; }
      const btns = [...c.querySelectorAll('.fb-actions .fb-btn')];
      const b = a.result === 'ok' ? btns[0] : a.result === 'nok' ? btns.find(x => x.classList.contains('no')) : a.result === 'na' ? btns[2] : null;
      if (b) { b.click(); n++; }
    }
    // the checklist's note (0.11.57); an older draft or an edited run brings its step notes into it
    const rn = document.getElementById('fb-runNote');
    const text = [d.runNote, ...(d.notes || []).map(x => x[1])].filter(Boolean).join('\n');
    if (rn && text && !rn.value) rn.value = text;
    for (const [key, list] of d.media || []) {
      const c = card(key)?._addPhoto ? card(key) : document.querySelector('#fb-steps .fb-run-end');
      if (c?._addPhoto) for (const f of list) { c._addPhoto(f); n++; }
    }
    return n;
  }

  // A run that was open when the app was closed (within 12 hours, and the
  // task still open) is reopened as the section opens; the trap cards bring
  // their draft back with them.
  async function resumeRun() {
    let o = null;
    try { o = await getKV('run_open'); } catch (e) { return; }
    if (!o || !o.key || Date.now() - (o.at || 0) > 12 * 3600000) return;
    const groups = await loadGroups();
    const t = findGroup(groups, o.key);
    if (!t || t.status === 'done') { await setKV('run_open', null); return; }
    hubReturn = hubOf(groups, t.key)?.key || null;
    const sop = (await all('sops')).find(x => x.id === t.sop_id);
    if (!sop) return;
    // a zone's daily scouting is Digital scouting since 0.11.132: no round to bring back (a round's photos still on this
    // phone are sent by Force send, as before)
    const gk = String(t.generation_key || '');
    if (isScouting(sop) && !t.extraZone && gk.startsWith('routine:scouting:') && !gk.startsWith('routine:scouting:all:')) { await setKV('run_open', null); return; }
    await startRun(t, sop);
    clientNote('resumed', `the app had been closed with a checklist open: ${t.title || ''}${t.area ? ' · ' + t.area : ''}`);
    showToast('The app had been closed — your checklist is back as you left it', 'info');
  }


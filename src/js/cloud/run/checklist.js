//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- running a checklist (the global run). Edit here, then run: python build.py
  // ── running a checklist ─────────────────────────────────────────────────
  // Two levels: the list shows step titles to tick; "Details" on a step opens
  // the instruction, the expected result and what to do if it is not OK.
  let run = null;
  // a harvest under a treatment's withholding period (FarmBox 0098): said before anything else
  const holdLine = t => t.withholding_until && t.status !== 'done'
    ? `Do not harvest before ${new Date(t.withholding_until + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} — a treatment's withholding period. Ask the manager.`
    : null;
  async function startRun(task, sop, detail = null) {
    const steps = (await all('steps'))
      .filter(s => s.version_id === task.sop_version_id)
      .sort((a, b) => a.seq - b.seq);
    if (!steps.length) {
      showToast('This procedure has no approved steps yet', 'error');
      return;
    }
    run = { task, sop, steps, started: new Date().toISOString(),
            answers: new Map(), media: new Map(), allOpen: false,
            traps: null, harvests: null, items: null, perItem: false, itemList: [], clientId: 'run-' + task.id + '-' + Date.now(),
            edit: detail,                      // editing a done task (0.11.40): what the server holds
            // 0.11.91: resume = an open task handed over by somebody else, continued on their report;
            // append = only adding (a hand-over, or somebody not on the task): the server removes nothing
            resume: !!detail?.resume, append: !!(detail?.resume || detail?.addOnly), touched: false, lastAct: Date.now() };
    // remembered, so a relaunch (Android closing the app) comes straight back here
    try { await setKV('run_open', { key: task.key || task.id, at: Date.now() }); } catch (e) {}

    // the head (0.11.59), the same on every checklist and the scouting: the title with "Show all details" on its line,
    // under it one line with what the task page said; the timer sits in the top bar beside ←
    const head = $('runHead'); head.textContent = '';
    const tline = el('div', 'fb-runtitle');
    tline.append(el('h1', null, task.title));
    const toggle = isScouting(sop) ? null : el('button', 'fb-link', 'Show all details');
    if (toggle) {
      toggle.onclick = () => {
        run.allOpen = !run.allOpen;
        toggle.textContent = run.allOpen ? 'Hide all details' : 'Show all details';
        $('steps').querySelectorAll('.fb-step').forEach(c => {
          c.classList.toggle('open', run.allOpen);
          c.querySelector('.fb-link[aria-expanded]')?.setAttribute('aria-expanded', String(run.allOpen));
        });
      };
      tline.append(toggle);
    }
    // feedback on this task, from inside its checklist (0.11.85): the checklist stays as it is underneath
    if (await feedbackOn()) {
      const fk = el('button', 'fb-link', '{i:message} Feedback');
      fk.onclick = () => openFeedback(task, true);
      tline.append(fk);
    }
    head.append(tline);
    // under the title (0.11.60): where to go — the zones to visit, or the place — then the minutes, PPE and tools
    const itemsOf = task.positions.filter(isItem);
    const where = zonesLine(task)
      || (itemsOf.length ? itemsOf.map(p => p.label).join(' · ') : null)
      || task.zone_name || (task.area && !['Whole unit', 'All zones'].includes(task.area) ? task.area : null);
    const respNames = whoOf(task);
    head.append(el('p', 'fb-runfacts', [where, task.crop_name, respNames.length ? '{i:user} ' + respNames.join(' + ') : null,
      task.extraZone ? null : `about ${fmtMin(task.minutes)}`,
      sop?.safety_ppe ? 'PPE: ' + sop.safety_ppe : null, sop?.tools ? 'Tools: ' + sop.tools : null].filter(Boolean).join(' · ')));
    // a treatment (0.11.145, migration 0269): what to mix, as Naked Heart planned it — the rate, the quantity, the water
    // with its L/ha and the crop phase, the strength per litre, whether the label's limit per hectare held it
    // (a release or a trap carries no water: its line says what is planned, not what to mix)
    if (String(task.generation_key || '').startsWith('ipm:') && task.notes) {
      head.append(el('p', 'fb-runfacts', (/ L of water/.test(task.notes) ? 'Mix: ' : 'Planned: ') + task.notes));
    }
    // a crop task's batches, folded under the facts (they were on the task page)
    const batches = task.positions.filter(p => !isItem(p));
    if (batches.length && !isScouting(sop)) {
      const f = el('details', 'fb-fold fb-batches');
      f.append(el('summary', null, `${batches.length} batch${batches.length === 1 ? '' : 'es'}`), positionList(task));
      head.append(f);
    }
    // the timer (0.11.56): opening the checklist starts it (reopening resumes it); not when editing a done task
    const tt = detail && !detail.resume ? null : timerTaskOf(task);
    // adding to a done task is timed too (0.11.91): its own stretch, closed on Save or Back
    if (detail && !detail.resume && task.members[0]) {
      run.addId = task.members[0].id;
      queue([timerEvent(run.addId, 'add', Date.now())]).catch(() => {});
    }
    if (tt) {
      await loadTimers();
      await timerStart(tt.id, Math.round(num(task.minutes) * 1.5));
      run.paintTimer = () => {                       // in the top bar, where "Checklist" was written (0.11.59)
        const on = groupRunning(task), m = fmtClock(groupMinutes(task));
        const t = $('title'); t.textContent = '';
        // the timer is the button (0.11.60): pause stops it, play goes on
        const sp = el('button', 'fb-hdr-timer' + (on ? '' : ' paused'), (on ? '{i:pause} ' : '{i:play} ') + m);
        sp.type = 'button'; sp.title = on ? 'Pause the timer' : 'Resume the timer';
        sp.setAttribute('aria-label', (on ? 'Pause' : 'Resume') + ' the timer, ' + m);
        sp.dataset.timerIds = task.members.map(x => x.id).join(',');
        sp.dataset.timerWord = on ? '{i:pause} {t}' : '{i:play} {t}';
        sp.onclick = () => timerToggle();
        t.append(sp);
      };
    }

    const box = $('steps'); box.textContent = '';
    if (holdLine(task)) box.append(el('div', 'fb-hold', holdLine(task)));
    $('finish').textContent = detail && !detail.resume ? 'Save the changes' : 'Finish';
    // a one_task routine with items (the sumps, the zones): the steps once per
    // item under its heading, every reading kept with its item (FarmBox 0078);
    // any other task with items (maintenance assets): a tick per item, steps once
    run.perItem = !isScouting(sop) && !!(sop?.one_task && task.positions.some(isItem));
    // the IPM trap round on one zone (the old round): one card per sticky trap, before the steps
    if (isTrapRound(sop) && !isScouting(sop) && !run.perItem) box.append(await trapRound(task, sop));
    // a harvest task: the weight per batch, before the steps
    // (0.11.128) on every harvest task, not only one that lists its batches: a batch is also added by its code there
    if (isHarvestTask(sop)) box.append(await harvestBlock(task, detail));
    if (isScouting(sop)) {
      // the daily scouting (FarmBox 0141): Traps · Plant health · Growth · Finish, in any order
      box.append(await scoutSections(task, sop, detail));
    } else if (run.perItem && steps.every(isTick) && !isTrapRound(sop)) {
      // every step a tick (the irrigation check): each step once, its zones as buttons, red until tapped (0.11.57)
      run.itemList = task.positions.filter(isItem);
      run.chips = true;
      steps.forEach(s => box.append(zoneStepCard(s, run.itemList)));
    } else if (run.perItem) {
      run.itemList = task.positions.filter(isItem);
      for (const it of run.itemList) {
        box.append(el('div', 'fb-sec fb-item-head', it.label || 'Item'));
        if (isTrapRound(sop)) box.append(await trapRound(task, sop, it));
        steps.forEach(s => box.append(stepCard(s, it)));
      }
    } else {
      if (task.positions.some(isItem)) { const ib = itemButtons(task); if (ib) box.append(ib); }
      steps.forEach(s => box.append(stepCard(s)));
    }
    // a section's name once, where it starts — not on every card (0.11.59)
    { let last = null;
      [...box.children].forEach(c => {
        if (c.classList.contains('fb-item-head')) { last = null; return; }
        const sec = c.classList.contains('fb-step') ? c.querySelector(':scope > .fb-sec') : null;
        if (!sec) return;
        if (sec.textContent === last) sec.remove(); else last = sec.textContent;
      }); }
    if (!isScouting(sop)) box.append(runEnd(task, steps));
    $('runHint').textContent = '';
    paintPause(false);               // Pause lives on the timer now (0.11.60)
    paintNotDone(!detail && !task.extraZone && !isClosed(task.status) && task.status !== 'partial' && maySkip(task));
    paintHandOver(!!tt && !task.extraZone);
    show('run', detail && !detail.resume ? (detail.addOnly ? 'Add' : 'Edit') : isScouting(sop) ? 'Scouting' : 'Checklist',
         async () => {
           setKV('run_open', null).catch(() => {});
           await leaveRun(); backFromRun();
         });
    run.paintTimer?.();          // after show(), which writes the bar's title
    if (isScouting(sop)) return;                       // the scouting keeps its own draft
    const back = await restoreRunDraft(task);
    if (back) showToast(`Your checklist is as you left it (${back} answers and photos)`, 'info');
    else if (detail) replayDetail(detail);
  }

  // the notes box and an optional photo, under the steps (0.11.57): one note for the checklist, the one a red step needs
  function runEnd(task, steps) {
    const end = el('div', 'fb-run-end');
    const note = el('textarea', 'fb-runnote'); note.id = 'fb-runNote'; note.rows = 3;
    note.placeholder = 'Notes — say what is not OK';
    note.oninput = () => saveRunDraft();
    end.append(note);
    const shot = el('div', 'fb-shot');
    const pick = el('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.style.display = 'none';
    const btn = el('button', 'fb-btn', '{i:camera} Add a photo');
    const key = run.perItem && run.itemList[0] ? stepKey(steps[0], run.itemList[0]) : steps[0].seq;
    const add = async f => {
      try {
        const big = await shrinkPhoto(f, FULL_PX, null);
        const b = await new Promise(res => big.canvas.toBlob(res, 'image/jpeg', FULL_Q));
        big.canvas.width = big.canvas.height = 0;
        f = b || f;
      } catch (e) { /* the file as it is */ }
      const list = run.media.get(key) || []; list.push(f); run.media.set(key, list);
      const img = el('img'); img.src = URL.createObjectURL(f); img.alt = 'photo';
      img.onload = () => URL.revokeObjectURL(img.src);
      // the ✕ removes with five seconds of Undo (0.11.147, picUndoX in js/cloud/ask.js)
      let at = -1;
      shot.insertBefore(picUndoX(img,
        pic => { const l = run.media.get(key) || []; at = l.indexOf(f); if (at >= 0) l.splice(at, 1); pic.remove(); saveRunDraft(); },
        () => { const l = run.media.get(key) || []; if (!l.includes(f)) l.splice(Math.min(Math.max(at, 0), l.length), 0, f); run.media.set(key, l); saveRunDraft(); }), btn);
      saveRunDraft();
    };
    btn.onclick = async () => {
      let r = null;
      try { r = await takeTrapPhoto('', task.title, 'step'); } catch (e) { r = null; }
      if (r === 'cancel') return;
      if (r) add(r); else pick.click();
    };
    pick.onchange = () => { const f = pick.files[0]; pick.value = ''; if (f) add(f); };
    end._addPhoto = add;
    shot.append(btn, pick);
    end.append(shot);
    return end;
  }
  // the timer's own button (0.11.60): pause keeps the answers (the draft) and stays on the checklist; tap again to go on
  async function timerToggle() {
    const R = run; if (!R) return;
    const tt = timerTaskOf(R.task); if (!tt) return;
    if (groupRunning(R.task)) {
      await timerPause(tt.id);
      saveRunDraft();
      showToast('Paused — the answers are kept', 'success');
    } else await timerStart(tt.id);
    R.paintTimer?.();
  }
  // Back from a checklist (0.11.91): the timer pauses and the task stays this person's ("Paused · me") when something
  // was entered; a task only opened to look is given back — no time kept, free for anybody
  const addStop = R => { if (R && R.addId) { const id = R.addId; R.addId = null;
    queue([timerEvent(id, 'pause', Math.min(Date.now(), (R.lastAct || Date.now()) + IDLE_MIN * 60000))]).catch(() => {}); } };
  async function leaveRun() {
    const R = run; if (!R) return;
    addStop(R);
    if (R.edit && !R.resume) return;
    const tt = timerTaskOf(R.task); if (!tt) return;
    const entered = R.touched || R.resume || localMin(tt.id) >= 1 || R.answers.size > 0;
    if (!entered) { await timerRelease(tt.id); return; }
    if (timerRunning(tt.id)) await timerPause(tt.id);
  }
  // "Hand over…" under Finish (0.11.91, owner: "2 phones in the same task but not at the same time"): what is answered
  // so far goes to the server as it stands, the task is free again, and the next person continues the same report
  function paintHandOver(on) {
    let a = $('handover');
    if (!a) {
      a = document.createElement('button'); a.id = 'fb-handover'; a.className = 'fb-link fb-notdone'; a.type = 'button';
      a.textContent = 'Hand over to somebody else…';
      ($('pause') || $('finish')).after(a);
      a.onclick = () => handOver();
    }
    a.classList.toggle('hidden', !on);
  }
  async function handOver() {
    const R = run; if (!R) return;
    const tt = timerTaskOf(R.task); if (!tt) return;
    if (!await askSheet({ title: 'Hand this task over?', text: 'What you have entered so far is sent as it stands, your time is kept, and the task is free for the next person to continue and finish.', yes: 'Hand it over', no: 'Keep working' })) return;   // 0.11.147: askSheet
    const cid = R.edit?.run?.client_run_id || R.clientId;
    try {
      const steps = [...R.answers.entries()].filter(([, a]) => a && (a.result || a.value_num != null || (a.value_text != null && a.value_text !== '')))
        .map(([k, a]) => { const blobs = (R.media.get(k) || []).filter(f => f instanceof Blob);
          const saved = (R.media.get(k) || []).filter(f => f && f.saved).map(f => typeof f.saved === 'string' ? { path: f.saved, kind: 'photo' } : f.saved);
          return { ...a, media: saved, ...(blobs.length ? { media_blobs: blobs } : {}), recorded_at: new Date().toISOString() }; })
        .filter(x => Number.isFinite(Number(x.seq)));
      if (steps.length) {
        R.draftCid = cid;
        await queue([{ farm_id: tt.farm_id || farm.id, task_id: tt.id, sop_version_id: tt.sop_version_id || R.task.sop_version_id, client_run_id: cid,
          status: 'partial', ...(R.resume ? { edit: true, append: true } : {}), started_at: R.edit?.run?.started_at || R.started, finished_at: new Date().toISOString(),
          steps, notes: String(document.getElementById('fb-runNote')?.value || '').trim() || null }]);
        clearTimeout(draftTimer);
        const t = Date.now();              // one moment for both (21 Nov 2026): two calls could differ by a millisecond
        await setKV(runDraftKey(R.task), { saved: t, sentSaved: t, cid, answers: [...R.answers.entries()],
          runNote: document.getElementById('fb-runNote')?.value || '', media: [] });
      }
      addStop(R);
      await timerRelease(tt.id);
      await setKV('run_open', null);
      showToast('Handed over — the task is free for the next person', 'success');
      run = null;
      await backFromRun();
    } catch (e) { showToast('Could not hand over — ' + String(e.message || e).slice(0, 80), 'error'); }
  }
  // "Not done…" under Finish (0.11.60): what the task page offered, for the Admin and the task's own people
  function paintNotDone(on) {
    let a = $('notdone');
    if (!a) {
      a = document.createElement('button'); a.id = 'fb-notdone'; a.className = 'fb-link fb-notdone'; a.type = 'button';
      a.textContent = 'Cancel this task…';
      ($('pause') || $('finish')).after(a);
      a.onclick = () => { if (run) swipeNotDone(run.task); };
    }
    a.classList.toggle('hidden', !on);
  }
  // Pause beside Finish (0.11.57): the timer stops and the answers stay (the draft); 0.11.58: it stays on the checklist
  // and turns into Resume — going back to the day is the person's own step; only Finish goes back by itself
  function paintPause(on) {
    let p = $('pause');
    if (!p) {
      p = document.createElement('button'); p.id = 'fb-pause'; p.className = 'btn btn-lg btn-block fb-pausebtn';
      p.style.marginTop = 'var(--space-2)';
      $('finish').after(p);
      p.onclick = async () => {
        const R = run; if (!R) return;
        const tt = timerTaskOf(R.task); if (!tt) return;
        if (groupRunning(R.task)) {
          await timerPause(tt.id);
          saveRunDraft();
          showToast('Paused — the answers are kept', 'success');
        } else {
          await timerStart(tt.id);
        }
        R.paintTimer?.(); paintPause(true);
      };
    }
    p.classList.toggle('hidden', !on);
    nbLabel(p, run && groupRunning(run.task) ? '{i:pause} Pause' : '{i:play} Resume');
  }


//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- feedback on a task. Edit here, then run: python build.py
  // ── feedback on a task (0.11.85, FarmBox 0189; owner 2 Oct 2026) ────────
  // Switched on per farm in Naked Heart (Settings › Task feedback). The feedback button on a task opens this page: say it, write
  // it or show it — voice notes, a note, photos, one short video — about the task, its checklist or the app.
  // It leaves through the outbox (offline too): the files to the evidence bucket, then submit_feedback; the
  // server writes the voice down and puts it in points (Groq). Under the form: what was already said on this
  // task and what the manager answered. What is on the page is kept (KV fbkdraft:<task>) until it is sent,
  // so a phone that closes the app while its camera is open loses nothing.
  const FBK_VOICE_S = 180, FBK_VIDEO_S = 60, FBK_MAX_BYTES = 24 * 1024 * 1024, FBK_PHOTO_PX = 2000;
  const FBK_STATUS = { new: 'Received', accepted: 'Accepted', done: 'Done', rejected: 'Not taken up' };
  const fmtMB = b => (b / 1048576 < 0.1 ? Math.max(1, Math.round(b / 1024)) + ' kB' : (b / 1048576).toFixed(1) + ' MB');
  async function openFeedback(g, fromRun = false) {
    const taskId = g.members?.[0]?.id || g.id, key = 'fbkdraft:' + (g.key || taskId);
    const steps = (await all('steps')).filter(s => s.version_id === g.sop_version_id).sort((a, b) => a.seq - b.seq);
    let draft = null; try { draft = await getKV(key); } catch (e) {}
    const st = { note: draft?.note || '', step: draft?.step || '', items: (draft?.items || []).filter(x => x && x.blob instanceof Blob) };
    const save = () => setKV(key, st.note || st.step || st.items.length ? { note: st.note, step: st.step, items: st.items, at: Date.now() } : null).catch(() => {});
    const scrollBack = window.scrollY;
    let rec = null, recTimer = null, recStart = 0, urls = [], busy = false;
    const freeUrls = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };
    const stopRec = () => { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {} };
    const leave = () => { stopRec(); clearInterval(recTimer); freeUrls(); };

    const box = $('task'); box.textContent = '';
    const hero = el('div', 'hero');
    hero.append(el('h1', null, 'Feedback'),
      el('p', null, [g.title, g.area && !['Whole unit', 'All zones'].includes(g.area) ? g.area : null, fmtDay(g.planned_date)].filter(Boolean).join(' · ')),
      el('p', null, 'What should change — in this task, its checklist or the app? Say it, write it or show it.'));
    box.append(hero);

    // which step it is about (optional)
    if (steps.length) {
      const sel = el('select', 'set-select fb-fbk-step');
      sel.setAttribute('aria-label', 'Which step it is about');
      const o0 = el('option', null, 'About the whole task'); o0.value = ''; sel.append(o0);
      steps.forEach(s => { const o = el('option', null, `Step ${s.seq} — ${s.title}`); o.value = String(s.seq); sel.append(o); });
      sel.value = steps.some(s => String(s.seq) === String(st.step)) ? String(st.step) : '';
      sel.onchange = () => { st.step = sel.value; save(); };
      box.append(sel);
    }

    // the voice note: one big button, the seconds running on it
    const recBtn = el('button', 'btn btn-lg btn-block fb-fbk-rec');
    const paintRec = () => {
      const on = !!rec, s = on ? Math.floor((Date.now() - recStart) / 1000) : 0;
      nbLabel(recBtn, on ? `{i:stop} Stop · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '{i:mic} Record a voice note');
      recBtn.classList.toggle('on', on);
    };
    paintRec();
    recBtn.onclick = async () => {
      if (rec) return stopRec();
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showToast('This phone cannot record here — write the feedback instead', 'error'); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { showToast('The microphone is not allowed — allow it, or write the feedback instead', 'error'); return; }
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const chunks = [];
      let mr;
      try { mr = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 }) : new MediaRecorder(stream); }
      catch (e) { stream.getTracks().forEach(t => t.stop()); showToast('Recording did not start — write the feedback instead', 'error'); return; }
      mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        clearInterval(recTimer); stream.getTracks().forEach(t => t.stop());
        const seconds = Math.round((Date.now() - recStart) / 100) / 10;
        const type = (mr.mimeType || mime || 'audio/webm').split(';')[0];
        rec = null; paintRec();
        const blob = new Blob(chunks, { type });
        if (blob.size < 800 || seconds < 1) { showToast('Too short — nothing was recorded', 'error'); return; }
        st.items.push({ kind: 'audio', blob, seconds }); save(); paintItems();
      };
      rec = mr; recStart = Date.now(); mr.start(); paintRec();
      recTimer = setInterval(() => { paintRec(); if ((Date.now() - recStart) / 1000 >= FBK_VOICE_S) stopRec(); }, 500);
    };
    box.append(recBtn);

    const note = el('textarea', 'fb-runnote fb-fbk-note'); note.rows = 4; note.value = st.note;
    note.placeholder = 'Or write it here';
    note.oninput = () => { st.note = note.value; save(); paintSend(); };
    box.append(note);

    // photos and one short video
    const tools = el('div', 'fb-actions');
    const pickPhoto = el('input'); pickPhoto.type = 'file'; pickPhoto.accept = 'image/*'; pickPhoto.style.display = 'none';
    const pickVideo = el('input'); pickVideo.type = 'file'; pickVideo.accept = 'video/*'; pickVideo.setAttribute('capture', 'environment'); pickVideo.style.display = 'none';
    const photoBtn = el('button', 'fb-btn', '{i:camera} Photo'), videoBtn = el('button', 'fb-btn', '{i:video} Video');
    const addPhoto = async f => {
      let b = f;
      try {
        const big = await shrinkPhoto(f, FBK_PHOTO_PX, null);
        b = (await new Promise(res => big.canvas.toBlob(res, 'image/jpeg', 0.85))) || f;
        big.canvas.width = big.canvas.height = 0;
      } catch (e) { /* the file as it is */ }
      st.items.push({ kind: 'photo', blob: b }); save(); paintItems();
    };
    photoBtn.onclick = async () => {
      let r = null;
      try { r = await takeTrapPhoto('', g.title, 'step'); } catch (e) { r = null; }
      if (r === 'cancel') return;
      if (r) addPhoto(r); else pickPhoto.click();
    };
    pickPhoto.onchange = () => { const f = pickPhoto.files[0]; pickPhoto.value = ''; if (f) addPhoto(f); };
    videoBtn.onclick = () => {
      if (busy) return;
      if (st.items.some(x => x.kind === 'video')) { showToast('One video a feedback — remove the first to take another', 'error'); return; }
      pickVideo.click();
    };
    pickVideo.onchange = async () => {
      let f = pickVideo.files[0]; pickVideo.value = '';
      if (!f) return;
      busy = true; nbLabel(videoBtn, '{i:video} Checking…');
      try {
        const secs = typeof getVideoDuration === 'function' ? await getVideoDuration(f) : null;
        if (secs != null && secs > FBK_VIDEO_S + 3) { showToast(`Keep the video under a minute — this one is ${Math.round(secs)} s`, 'error'); return; }
        // a phone films at ~17 Mbps: made smaller on the phone (720p), or it would not fit the upload
        if (f.size > 8 * 1024 * 1024 && typeof compressVideoFast === 'function') {
          try {
            const small = await compressVideoFast(f, p => { nbLabel(videoBtn, `{i:video} Making it smaller… ${Math.round((p || 0) * 100)}%`); });
            if (small && small.size && small.size < f.size) f = small;
          } catch (e) { console.warn('video not compressed', e); }
        }
        if (f.size > FBK_MAX_BYTES) { showToast(`This video is too big to send (${fmtMB(f.size)}) — make a shorter one`, 'error'); return; }
        st.items.push({ kind: 'video', blob: f, seconds: secs != null ? Math.round(secs * 10) / 10 : null }); save(); paintItems();
      } finally { busy = false; nbLabel(videoBtn, '{i:video} Video'); }
    };
    tools.append(photoBtn, videoBtn, pickPhoto, pickVideo);
    box.append(tools);

    // what is attached: listen, look, remove
    const items = el('div', 'fb-fbk-items');
    function paintItems() {
      freeUrls(); items.textContent = '';
      st.items.forEach((x, i) => {
        const row = el('div', 'fb-fbk-item ' + x.kind);
        const url = URL.createObjectURL(x.blob); urls.push(url);
        let n;
        if (x.kind === 'photo') { n = el('img'); n.alt = 'Photo'; }
        else { n = el(x.kind === 'video' ? 'video' : 'audio'); n.controls = true; n.preload = 'metadata'; if (x.kind === 'video') n.playsInline = true; }
        n.src = url;
        const cap = el('span', 'fb-meta', [x.kind === 'audio' ? 'Voice note' : x.kind === 'video' ? 'Video' : 'Photo',
          x.seconds ? Math.round(x.seconds) + ' s' : null, fmtMB(x.blob.size)].filter(Boolean).join(' · '));
        const rm = el('button', 'fb-link', 'Remove');
        rm.onclick = () => { st.items.splice(i, 1); save(); paintItems(); };
        const foot = el('div', 'fb-fbk-cap'); foot.append(cap, rm);
        row.append(n, foot);
        items.append(row);
      });
      paintSend();
    }
    box.append(items);

    const send = el('button', 'btn btn-primary btn-lg btn-block', 'Send the feedback');
    function paintSend() { send.disabled = !(note.value.trim() || st.items.length); }
    send.onclick = async () => {
      if (rec) { showToast('Stop the recording first', 'error'); return; }
      if (busy) { showToast('The video is still being prepared', 'error'); return; }
      const text = note.value.trim();
      if (!text && !st.items.length) { showToast('Say, write or show something first', 'error'); return; }
      send.disabled = true;
      try {
        if (!farm) farm = await getKV('farm');
        const me = await getKV('me');
        const id = 'fbk-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
        await queue({ __feedback: true, client_run_id: id, farm_id: g.farm_id || farm?.id, task_id: taskId, task_title: g.title,
          sop_id: g.sop_id || null, sop_version_id: g.sop_version_id || null, step_seq: st.step ? Number(st.step) : null, note: text || null,
          author: (await all('workers')).find(w => w.id === me)?.name || session?.user?.email || null,
          app: 'brain', app_version: typeof CURRENT_VERSION !== 'undefined' ? CURRENT_VERSION : null, device: navigator.userAgent.slice(0, 180),
          sent_at: new Date().toISOString(), items: st.items.map(x => ({ kind: x.kind, blob: x.blob, seconds: x.seconds ?? null })) });
        await setKV(key, null);
        showToast(navigator.onLine ? 'Feedback sent ✓ — thank you' : 'Feedback kept — it goes when there is signal', 'success');
        history.back();
      } catch (e) {
        send.disabled = false;
        showToast('Could not keep the feedback — ' + String(e.message || e).slice(0, 60), 'error');
      }
    };
    box.append(send);
    box.append(el('div', 'config-hint', `Voice notes up to ${FBK_VOICE_S / 60} minutes, a video up to a minute. It works offline: it is sent when there is signal${uploadNet() === 'wifi' ? ' (a video waits for Wi-Fi)' : ''}.`));

    // what was already said on this task, and what was answered
    const said = el('div', 'fb-fbk-said');
    box.append(said);
    const paintSaid = async rows => {
      const waiting = (await all('outbox')).filter(r => r.payload?.__feedback && r.payload.task_id === taskId).length;
      said.textContent = '';
      if (!waiting && !(rows || []).length) return;
      said.append(el('div', 'fb-sec', 'Already said on this task'));
      if (waiting) said.append(el('div', 'config-hint', `${waiting} feedback of yours waiting to be sent.`));
      (rows || []).forEach(r => {
        const c = el('div', 'fb-fbk-row');
        const head = el('div', 'fb-fbk-head');
        head.append(el('b', null, r.mine ? 'You' : firstName(r.author) || 'Somebody'),
          el('span', 'fb-meta', new Date(r.sent_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
          el('span', 'fb-chip ' + (r.status === 'done' ? 'ok' : r.status === 'rejected' ? 'skip' : 'todo'), FBK_STATUS[r.status] || r.status));
        c.append(head);
        if (r.step_seq) c.append(el('div', 'fb-meta', `Step ${r.step_seq}${r.step_title ? ' — ' + r.step_title : ''}`));
        const textOf = r.ai_summary || r.note || r.transcript;
        if (textOf) c.append(el('div', 'fb-fbk-text', textOf));
        if ((r.ai_points || []).length) { const ul = el('ul', 'fb-fbk-points'); r.ai_points.forEach(p => ul.append(el('li', null, p))); c.append(ul); }
        const media = [[r.voice, '{i:mic}'], [r.photos, '{i:camera}'], [r.videos, '{i:video}']].filter(([n]) => n).map(([n, i]) => `${i} ${n}`).join('  ');
        if (media || r.ai_status === 'queued') c.append(el('div', 'fb-meta', [media, r.ai_status === 'queued' ? 'being written down…' : null].filter(Boolean).join(' · ')));
        if (r.reply) c.append(el('div', 'fb-fbk-reply', 'Answer: ' + r.reply));
        said.append(c);
      });
    };
    paintSaid(null);
    if (navigator.onLine && session) {
      api('/rest/v1/rpc/task_feedback_for', { method: 'POST', body: JSON.stringify({ p_tasks: (g.members || [{ id: taskId }]).map(m => m.id) }) })
        .then(rows => { if (said.isConnected) paintSaid(rows); }).catch(e => console.warn('feedback list', e));
    }

    paintItems();
    // Back: into the checklist it was opened from (left as it was underneath), the day's scouting, or the day
    show('task', 'Feedback', async () => {
      leave();
      if (fromRun && run) {
        show('run', run.edit ? 'Edit' : isScouting(run.sop) ? 'Scouting' : 'Checklist', () => {});
        run.paintTimer?.();
        window.scrollTo(0, scrollBack);
        return;
      }
      const h = hubOf(await loadGroups(), g.key);     // a zone's card is only ever on its day's scouting page
      return h ? openHub(h) : showWeek();
    });
  }

  // the old task page (kept for reference, no longer opened)
  async function taskPage(key) {
    const groups = await loadGroups();
    const t = findGroup(groups, key);
    if (!t) return;
    const sop = (await all('sops')).find(s => s.id === t.sop_id);
    await refreshSW();
    const box = $('task'); box.textContent = '';
    const hero = el('div', 'hero');
    hero.append(el('h1', null, t.title));
    if (sop?.summary) hero.append(el('p', null, sop.summary));
    box.append(hero);
    if (holdLine(t)) box.append(el('div', 'fb-hold', holdLine(t)));

    const facts = el('div', 'set-group');
    const row = (k, v) => { if (!v) return; const r = el('div', 'set-row');
      r.append(el('span', null, k)); r.append(el('span', null, String(v))); facts.append(r); };
    row('When', `${fmtDay(t.planned_date)} · ${SLOT_WORD[slotOf(t)]}${t.due_time ? ' · ' + hhmm(t.due_time) : ''}`);
    row('Where', [t.zone_name || t.area, zonesOf(t).size > 1 ? [...zonesOf(t)].join(', ') : null].filter(Boolean).join(' · '));
    row('Crop', t.crop_name);
    row('Phase', t.phase_name);
    row('Quantity', t.quantity && !isPosUnit(t.unit) ? fmtQty(t.quantity, t.unit) : null);
    row('Takes', fmtMin(t.minutes));
    const worked = groupMinutes(t);
    if (worked >= 1 || groupRunning(t)) row('Worked', (groupRunning(t) ? 'running · ' : '') + fmtWork(worked) + (isClosed(t.status) ? '' : ' so far'));
    if (sop?.safety_ppe) row('Safety', sop.safety_ppe);
    if (sop?.tools) row('Tools', sop.tools);
    box.append(facts);

    if (t.positions.length) box.append(positionList(t));

    const hasChecklist = !!sop && (sop.validation || 'checklist') !== 'tick';
    if (t.status === 'skipped') {
      const m = t.members.find(x => x.status === 'skipped') || {};
      box.append(el('div', 'config-hint', `Not done — ${reasonWord(m.skip_reason).toLowerCase()}${m.skip_note ? ': ' + m.skip_note : ''}.`));
      const again = el('button', 'btn btn-block', hasChecklist ? 'Do it after all' : 'Mark done after all');
      again.style.marginTop = 'var(--space-2)';
      again.onclick = () => hasChecklist ? startRun(t, sop) : markDone(t);
      box.append(again);
    } else if (t.status === 'done') {
      box.append(el('div', 'config-hint', hasChecklist ? 'Done. What was sent can still be changed.' : 'Done. Nothing more to do here.'));
      if (hasChecklist) {
        const ed = el('button', 'btn btn-lg btn-block', '{i:pencil} Edit what was sent');
        ed.onclick = () => editTask(t, sop);
        box.append(ed);
      }
    } else if ((sop?.validation || 'checklist') === 'tick') {
      const b = el('button', 'btn btn-primary btn-lg btn-block', 'Mark done');
      b.onclick = async () => {
        await markDone(t);
      };
      box.append(b);
    } else {
      const b = el('button', 'btn btn-primary btn-lg btn-block', groupMinutes(t) >= 1 ? 'Continue the checklist' : 'Start checklist');
      b.onclick = () => startRun(t, sop);
      box.append(b);
      if (groupRunning(t)) {
        const pz = el('button', 'btn btn-block', '{i:pause} Pause the timer');
        pz.style.marginTop = 'var(--space-2)';
        pz.onclick = async () => { for (const x of t.members) await timerPause(x.id); taskPage(t.key); };
        box.append(pz);
      }
      box.append(el('div', 'config-hint',
        (sop?.validation === 'checklist_evidence')
          ? 'This one needs evidence: some steps ask for a photo or a reading.'
          : 'Tick each step as you go. The timer starts with the checklist; it works offline.'));
      // a checklist the manager allowed to close with a swipe: the same as a button
      if (sop?.swipe_done && canSwipeDone(t)) {
        const q = el('button', 'btn btn-block', 'Mark done without the checklist');
        q.style.marginTop = 'var(--space-2)';
        q.onclick = () => markDone(t);
        box.append(q);
      }
    }
    // "not done", for the Admin and the task's own people — the swipe, as a button
    if (!isClosed(t.status) && t.status !== 'partial' && maySkip(t)) {
      const nd = el('button', 'btn btn-block', 'Not done…');
      nd.style.marginTop = 'var(--space-2)';
      nd.onclick = () => swipeNotDone(t);
      box.append(nd);
    }
    show('task', 'Task', showWeek);
  }

  // Editing a done task (FarmBox 0141): what the server holds comes back into
  // the checklist; saving sends it again under the same run, which replaces it.
  // The task's people, the Admin or a manager — the server says no to anyone else.
  async function editTask(t, sop) {
    let d = null, kept = null;
    try { kept = await getKV(sentKey(t.members[0].id)); } catch (e) {}
    if (navigator.onLine) {
      try { d = await Promise.race([api('/rest/v1/rpc/run_detail', { method: 'POST', body: JSON.stringify({ p_task: t.members[0].id }) }),
                                    new Promise((_, no) => setTimeout(() => no(new Error('no answer in time')), 6000))]); }
      catch (e) { if (!kept) { showToast('Could not fetch the task — ' + String(e.message || e).slice(0, 60), 'error'); return; } }
    }
    // without signal (0.11.93): what this phone sent or last read for the task — to add to it only; it goes up later
    if (!d) {
      if (!kept) { showToast('Without signal a done task opens only on a phone that sent it or opened it before', 'error'); return; }
      // its report is still in the outbox: saving here goes under the same id and would replace it with what was kept
      // for adding — without the photos not yet uploaded, a harvest's "Last cut", the traps marked taken down. With
      // signal the same case is refused a few lines down; the outbox not readable: as before.
      let stillWaiting = false;
      try { stillWaiting = !!kept.run?.client_run_id && (await all('outbox')).some(r => r.id === kept.run.client_run_id); } catch (e) { stillWaiting = false; }
      if (stillWaiting) { showToast('This report is still waiting to be sent — you can add to it once it has gone', 'info'); return; }
      await startRun(t, sop, { ...kept, addOnly: true });
      showToast('No signal: you can add photos and notes — they go up when there is signal', 'info');
      return;
    }
    if (d.run) setKV(sentKey(t.members[0].id), { ...d, kept: Date.now() }).catch(() => {});
    // 0.11.91: a report still on this phone is not on the server yet — editing now would make a second report
    if (!d || !d.run) {
      const waiting = (await all('outbox')).some(r => r.payload && t.members.some(m => m.id === r.payload.task_id) && !r.payload.__timer && !r.payload.__upload && !r.payload.__feedback);
      if (waiting) { showToast('The report of this task is still waiting to be sent — press Force send, then open it again', 'error'); return; }
    }
    // everybody may add to a done task (FarmBox 0201): photos, notes, answers — nothing already sent is removed;
    // changing or removing what was sent stays with the task's people, the Admin and the managers
    const addOnly = !!d && d.may_edit === false;
    await startRun(t, sop, { ...(d || { run: null }), addOnly });
    if (addOnly) showToast('You can add photos and notes here — what was already sent stays as it is', 'info');
  }

  // Marks every open member of the group done: one tick per task row, so the
  // server sees the same thing whether it grouped the task or the phone did.
  async function markDone(g) {
    const now = new Date().toISOString();
    const open = g.members.filter(m => m.status !== 'done');
    open.forEach(t => { t.status = 'done'; t.done_at = now; });
    await putAll('tasks', open);
    await queue(open.map(t => ({ __tick: true, client_run_id: 'tick-' + t.id, task_id: t.id, actual_minutes: null })));
    showToast('Done ✓', 'success');
    showWeek();
  }


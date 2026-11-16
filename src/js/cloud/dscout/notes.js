//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- Digital scouting: notes, voice notes, the daily reminder. Edit here, then run: python build.py
  // ── notes: typed, or held to record a voice note ──
  const DG_VOICE_S = 120;
  function dgNoteSheet(kind, p, farmId, requestId = null) {
    const o = { note: '', note_level: null };
    let audio = null, rec = null, stream = null, startAt = 0, holding = false;
    return dgSheet(requestId ? 'Your opinion' : 'A comment on this ' + (kind === 'trap' ? 'trap photo' : 'photo'), (card, done) => {
      const ta = el('textarea', 'fb-runnote'); ta.rows = 3; ta.placeholder = 'Write it here';
      const row = el('div', 'fb-note-row'); row.append(ta, riskMenu(o, ta, () => paint()));
      const hold = el('button', 'btn btn-block dg-hold', '{i:mic} Hold to record');
      hold.type = 'button';
      const got = el('div', 'fb-meta');
      // (0.11.142) posted, or posted and asked: the AI (a short answer at once, written words only) or someone of the
      // team; an answer to an opinion asked of me is sent as it is
      const send = el('button', 'fb-btn fb-btn-primary', requestId ? 'Send' : 'Post'), no = el('button', 'fb-btn', 'Cancel');
      const sendAi = requestId ? null : el('button', 'fb-btn', 'Post + ask the AI');
      const sendAsk = requestId ? null : el('button', 'fb-btn', 'Post + ask someone');
      [send, no, sendAi, sendAsk].forEach(b => { if (b) b.type = 'button'; });
      const paint = () => {
        got.textContent = '';
        if (audio) { got.append(document.createTextNode(`Voice note · ${Math.round(audio.seconds)} s `)); const rm = el('button', 'fb-link', 'Remove'); rm.type = 'button'; rm.onclick = () => { audio = null; paint(); }; got.append(rm); }
        const words = !!String(o.note || '').trim();
        send.disabled = !(words || audio);
        if (sendAsk) sendAsk.disabled = send.disabled;
        // the AI reads words: a voice note alone is asked once it is written down, under the comment
        if (sendAi) { sendAi.disabled = !words; sendAi.title = words ? '' : 'Write the comment: a voice note is asked once it is written down'; }
      };
      const stop = () => { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* stopped */ } };
      const start = async () => {
        if (rec) return;
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showToast('This phone cannot record here — write the note instead', 'error'); return; }
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (e) { showToast('The microphone is not allowed — allow it, or write the note instead', 'error'); return; }
        const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
        const chunks = [];
        try { rec = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 }) : new MediaRecorder(stream); }
        catch (e) { stream.getTracks().forEach(x => x.stop()); showToast('Recording did not start — write the note instead', 'error'); return; }
        rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          stream.getTracks().forEach(x => x.stop());
          const seconds = (Date.now() - startAt) / 1000, type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
          rec = null; nbLabel(hold, '{i:mic} Hold to record'); hold.classList.remove('on');
          const blob = new Blob(chunks, { type });
          if (blob.size < 800 || seconds < 1) { showToast('Too short — hold the button while you speak', 'error'); return; }
          audio = { blob, seconds, type }; paint();
        };
        startAt = Date.now(); rec.start(); nbLabel(hold, '{i:stop} Recording — let go to stop'); hold.classList.add('on');
        if (!holding) stop();          // let go while the microphone was being asked for (its first time): no recording
        setTimeout(() => { if (rec && Date.now() - startAt >= DG_VOICE_S * 1000 - 50) stop(); }, DG_VOICE_S * 1000);
      };
      hold.addEventListener('pointerdown', e => { e.preventDefault(); holding = true; start(); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => hold.addEventListener(ev, () => { holding = false; stop(); }));
      let sending = false;                          // one tap sends once
      const post = async mode => {
        if (sending) return;
        sending = true; [send, sendAi, sendAsk].forEach(b => { if (b) b.disabled = true; });
        const body = String(o.note || '').trim(), cref = uuid();
        const ext = fbkExt(audio ? audio.type : '');
        const apath = audio ? `${farmId}/notes/dg-${cref}.${ext}` : null;
        const args = { p: { kind, ref_id: p.id, body: body || null, level: noteLevelOf(o), audio_path: apath, client_ref: 'dg:' + cref,
                            ...(requestId ? { request_id: requestId } : {}) } };
        // asked to the AI: the comment goes straight to the server (the AI answers a comment that is there); without
        // signal, or when that fails, it goes through the outbox as any comment and the AI is asked under it later —
        // the same client_ref makes a second write harmless
        if (mode === 'ai' && !audio) {
          if (navigator.onLine && session) {
            try { const res = await dgRpc('dg_add_note', args); if (res && res.id) { done({ ai: { id: res.id, body } }); return; } }
            catch (e) { /* through the outbox below */ }
          }
          showToast('Posted. Ask the AI under it once there is signal');
        }
        await dgQueue({ rpc: 'dg_add_note', args,
                        // its own chain: one note refused does not hold the others on the same photo
                        uploads: audio ? [{ path: apath, blob: audio.blob, type: audio.type }] : [], voice: !!audio, chain: 'dg:note:' + cref,
                        view: { kind: 'note', farm_id: farmId, ref_id: p.id, body, level: noteLevelOf(o), audio: !!audio } })
          .catch(e => { sending = false; paint(); throw e; });
        done(mode === 'ask' ? { ask: body } : true);
      };
      send.onclick = () => post('post');
      if (sendAi) sendAi.onclick = () => post('ai');
      if (sendAsk) sendAsk.onclick = () => post('ask');
      no.onclick = () => { stop(); done(null); };
      const acts = el('div', 'fb-actions'); acts.append(...[send, sendAi, sendAsk, no].filter(Boolean));
      card.append(row, hold, got, acts);
      paint();
      setTimeout(() => ta.focus(), 50);
    });
  }
  function dgNoteEdit(n, farmId) {
    const o = { note: n.body || n.transcript || '', note_level: n.level || null };
    return dgSheet('Change the note', (card, done) => {
      const ta = el('textarea', 'fb-runnote'); ta.rows = 3; ta.value = o.note;
      const row = el('div', 'fb-note-row'); row.append(ta, riskMenu(o, ta, () => {}));
      const ok = el('button', 'fb-btn fb-btn-primary', 'Save'), no = el('button', 'fb-btn', 'Cancel'); ok.type = no.type = 'button';
      ok.onclick = async () => {
        const body = String(o.note || '').trim();
        if (!body) { showToast('A note needs its words — or delete it', 'error'); return; }
        await dgQueue({ rpc: 'dg_edit_note', args: { p: { id: n.id, body, level: noteLevelOf(o) } }, chain: 'dg:' + n.id,
                        view: { kind: 'note-edit', farm_id: farmId, note_id: n.id, body } });
        done(true);
      };
      no.onclick = () => done(null);
      const acts = el('div', 'fb-actions'); acts.append(ok, no);
      card.append(row, acts);
    });
  }
  // a trap reading with no figure the AI could give (0260, "needs a count"): the count typed, sent as the person's own
  function dgCountRow(it, farmId) {
    const row = el('div', 'fb-actions dg-needcount');
    const cnt = el('input', 'fb-num'); cnt.type = 'number'; cnt.min = '0'; cnt.step = '1'; cnt.placeholder = 'insects';
    cnt.setAttribute('aria-label', 'Insects on this card');
    const ok = el('button', 'fb-btn fb-btn-primary', 'Save the count'); ok.type = 'button';
    ok.onclick = async () => {
      const n = parseInt(cnt.value, 10);
      if (isNaN(n) || n < 0) { showToast('Type the number of insects', 'error'); cnt.focus(); return; }
      ok.disabled = true;
      await dgQueue({ rpc: 'dg_edit_item', args: { p: { kind: 'trap', id: it.id, total: n } }, chain: 'dg:' + it.id,
                      view: { kind: 'edit', farm_id: farmId, ref_id: it.id, fields: { total: n } } });
    };
    row.append(el('span', null, 'The AI could not count this card: count it and type it'), cnt, ok);
    return row;
  }
  // a change by who may: a photo's part and note (its section by the switch); a trap reading's count and note
  function dgChangeSheet(kind, it, farmId) {
    // a trap the AI is still counting, or could not count: no number shown — one typed is the person's own, none
    // leaves it as it is
    const blank = kind === 'trap' && (dgCounting(it) || dgNeedsCount(it) || it.total == null);
    const o = { note: it.note || '', note_level: it.note_level || null, part: it.part, total: blank ? null : it.total };
    return dgSheet('Change', (card, done) => {
      let cnt = null;
      if (kind === 'observation') card.append(dgChips(it.section === 'growth' ? GROWTH_PARTS : PARTS, () => o.part, v => { o.part = v; }));
      else {
        cnt = el('input', 'fb-num'); cnt.type = 'number'; cnt.min = '0'; cnt.value = o.total == null ? '' : String(o.total);
        if (blank) cnt.placeholder = dgCounting(it) ? 'counting…' : 'needs a count';
        const r = el('div', 'fb-actions'); r.append(el('span', null, 'Insects'), cnt); card.append(r);
      }
      const note = el('input', 'fb-note'); note.type = 'text'; note.value = o.note; note.placeholder = 'Note (optional)';
      const row = el('div', 'fb-note-row'); row.append(note, riskMenu(o, note, () => {}));
      card.append(row);
      const ok = el('button', 'fb-btn fb-btn-primary', 'Save'), no = el('button', 'fb-btn', 'Cancel'); ok.type = no.type = 'button';
      ok.onclick = async () => {
        const fields = {};
        const body = String(o.note || '').trim();
        if (body !== String(it.note || '').trim() || noteLevelOf(o) !== noteLevelOf(it)) { fields.note = body; fields.note_level = noteLevelOf(o); }
        if (kind === 'observation' && o.part !== it.part) fields.part = o.part;
        if (kind === 'trap' && !(blank && cnt.value === '')) {
          const n = parseInt(cnt.value, 10);
          if (isNaN(n) || n < 0) { showToast('Type the number of insects', 'error'); return; }
          if (n !== it.total || blank) fields.total = n;
        }
        if (!Object.keys(fields).length) { done(null); return; }
        await dgQueue({ rpc: 'dg_edit_item', args: { p: { kind, id: it.id, ...fields } }, chain: 'dg:' + it.id,
                        view: { kind: 'edit', farm_id: farmId, ref_id: it.id, fields } });
        done(true);
      };
      no.onclick = () => done(null);
      const acts = el('div', 'fb-actions'); acts.append(ok, no);
      card.append(acts);
    });
  }
  // somebody's opinion on a picture: the people of the site, then a question (optional)
  // (0.11.133) asked from a comment: its words are the question, to change or keep
  async function dgAskSheet(kind, p, farmId, question = '') {
    let people = DG.people.get(farmId);
    if (!people && navigator.onLine && session) {
      try { people = await dgRpc('dg_people', { p_farm: farmId }); DG.people.set(farmId, people); setKV('dg_people:' + farmId, people).catch(() => {}); }
      catch (e) { people = null; }
    }
    if (!people) people = await getKV('dg_people:' + farmId).catch(() => null);
    if (!people || !people.length) { showToast(navigator.onLine ? 'The list of people could not be read' : 'Asking someone needs signal the first time', 'error'); return; }
    const D = dgFarmData(farmId).dg || {};
    const chosen = new Set();
    return dgSheet('Ask someone about this ' + (kind === 'trap' ? 'trap photo' : 'photo'), (card, done) => {
      const list = el('div', 'dg-people');
      people.filter(x => x.user_id && x.user_id !== D.me).forEach(x => {
        const b = el('button', 'fb-btn', x.name || 'Somebody'); b.type = 'button'; b.setAttribute('aria-pressed', 'false');
        b.onclick = () => { chosen.has(x.user_id) ? chosen.delete(x.user_id) : chosen.add(x.user_id); b.setAttribute('aria-pressed', String(chosen.has(x.user_id))); };
        list.append(b);
      });
      const q = el('input', 'fb-note'); q.type = 'text'; q.placeholder = 'Your question (optional)'; q.value = String(question || '');
      const ok = el('button', 'fb-btn fb-btn-primary', 'Ask'), no = el('button', 'fb-btn', 'Cancel'); ok.type = no.type = 'button';
      ok.onclick = async () => {
        if (!chosen.size) { showToast('Choose who to ask', 'error'); return; }
        await dgQueue({ rpc: 'dg_ask_opinion', args: { p: { kind, ref_id: p.id, to: [...chosen], question: q.value.trim() || null } }, chain: 'dg:ask:' + p.id,
                        view: { kind: 'ask', farm_id: farmId, ref_id: p.id } });
        showToast('Asked — they see it in their Digital scouting', 'success');
        done(true);
      };
      no.onclick = () => done(null);
      const acts = el('div', 'fb-actions'); acts.append(ok, no);
      card.append(list, q, acts);
    });
  }
  // the photos waiting for my opinion: answered with a note, or dismissed
  async function dgRequests() {
    DG.page = 'requests';
    await dgPaintRequests();
    show('task', 'Your opinion', () => { DG.page = 'day'; dgPaintDay(); $('title').textContent = 'Digital scouting'; });
  }
  async function dgPaintRequests() {
    const box = dgBox();
    const head = el('div', 'hero'); box.append(head);
    head.append(el('h1', null, 'Your opinion'), el('p', null, 'Photos somebody sent you to look at.'));
    if (!DG.reqs.length) { box.append(el('div', 'config-hint', 'Nothing waiting for you.')); dgSwap(box); return; }
    const pend = (await dgPending());
    DG.reqs.forEach(q => {
      const c = el('div', 'fb-step dg-item');
      const ph = q.photo || {};
      const txt = el('div', 'dg-text');
      txt.append(el('b', null, [q.by ? firstName(q.by) + ' asks' : 'Asked', ph.zone, q.kind === 'trap' ? `trap ${shortCode(ph.trap)}${ph.side ? ' · ' + ph.side : ''}` : (ph.section === 'growth' ? 'growth' : 'plant health')].filter(Boolean).join(' · ')));
      if (q.question) txt.append(el('div', 'fb-rv-comment', '“' + q.question + '”'));
      if (ph.note) txt.append(el('div', 'fb-meta', 'Its note: ' + ph.note));
      if (ph.taken_at) txt.append(el('div', 'fb-meta', fmtDay(dgDayOf(ph.taken_at)) + ' ' + new Date(ph.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      const answered = pend.some(r => r.payload.view.kind === 'note' && r.payload.view.ref_id === q.ref_id);
      const acts = el('div', 'fb-actions');
      const open = el('button', 'fb-btn', 'Open the photo'); open.type = 'button';
      open.onclick = () => dgOpenItem(q);
      const ans = el('button', 'fb-btn fb-btn-primary', answered ? 'Answer sending' : 'Answer'); ans.type = 'button'; ans.disabled = answered;
      ans.onclick = () => dgNoteSheet(q.kind, { id: q.ref_id }, q.farm_id, q.id).then(ok => { if (ok) dgPaintRequests(); });
      const dis = el('button', 'fb-link', 'Dismiss'); dis.type = 'button';
      dis.onclick = async () => {
        DG.reqs = DG.reqs.filter(x => x.id !== q.id);
        await dgQueue({ rpc: 'dg_dismiss_request', args: { p_id: q.id }, chain: 'dg:req:' + q.id, view: { kind: 'dismiss', farm_id: q.farm_id } });
        dgPaintRequests();
      };
      acts.append(open, ans, dis);
      txt.append(acts);
      c.append(txt);
      box.append(c);
    });
    dgSwap(box);
  }
  // a request's photo: its day read, then the photo opened as a post (0.11.133); Back comes here again
  async function dgOpenItem(q) {
    const day = q.photo?.taken_at ? dgDayOf(q.photo.taken_at) : DG.day;
    if (day !== DG.day) {
      dgSetDay(day);
      const tok = DG.token;
      await dgRead(true);
      if (tok !== DG.token) return;                 // the person went on meanwhile
    }
    if (dgFindItem(q.ref_id)) return dgOpenPost(q.ref_id, 'requests');
    showToast('This photo is not in the report any more', 'error');
  }

  // ── the daily scouting task as a reminder (0.11.132): its zone's counters on its card, and done by itself on its
  // responsible's own phone once the zone has every minimum ──
  let DG_COUNTS = { day: null, byTask: {} };
  let DG_UNSENT = new Set();                // the task keys of rounds started on this phone and not sent (dgUnsentRounds)
  async function dgSyncCounts() {
    const today = todayISO();
    const isZoneScout = t => /^routine:scouting:/.test(String(t.generation_key || '')) && !/^routine:scouting:all:/.test(String(t.generation_key || ''));
    const tasks = (await all('tasks')).filter(t => t.planned_date === today && t.status !== 'cancelled' && isZoneScout(t));
    if (!tasks.length) return false;
    const byTask = {};
    for (const fid of [...new Set(tasks.map(t => t.farm_id).filter(Boolean))]) {
      const d = await dgRpc('dg_day', { p_farm: fid, p_day: today });
      for (const u of (d && d.units) || []) if (u.task_id) byTask[u.task_id] = { ...u, farm_id: fid };
    }
    const before = JSON.stringify(DG_COUNTS.day === today ? DG_COUNTS.byTask : null);
    DG_COUNTS = { day: today, byTask };
    await setKV('dg_counts', DG_COUNTS);
    // ticked done on its responsible's own phone, as if they ticked it: a task given to the person signed in here only
    const me = await getKV('me');
    if (me) {
      const mineIds = new Set((await all('task_workers')).filter(x => x.worker_id === me).map(x => x.task_id));
      for (const t of tasks) {
        const u = byTask[t.id];
        if (!u || !u.complete || ['done', 'skipped', 'cancelled'].includes(u.task_status) || isClosed(t.status) || !mineIds.has(t.id)) continue;
        await putAll('tasks', [{ ...t, status: 'done', done_at: new Date().toISOString() }]);
        await queue([{ __tick: true, client_run_id: 'tick-' + t.id, task_id: t.id, actual_minutes: null }]);
        showToast(`${u.name || 'The zone'}: every minimum reached — your scouting task is done`, 'success');
      }
    }
    return before !== JSON.stringify(byTask);
  }
  const dgCountsFor = id => (DG_COUNTS.day === todayISO() && DG_COUNTS.byTask[id]) || null;


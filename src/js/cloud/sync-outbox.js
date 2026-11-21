//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- sync, live updates, the outbox. Edit here, then run: python build.py
  // ── sync ────────────────────────────────────────────────────────────────
  let farm = null, syncing = false;
  let cursorGen = 0;                       // raised by a flush that clears the cursor (a report set aside), 0.11.146
  // the feedback button on every task (0.11.85, FarmBox 0189): on while the farm has the feedback switched on; kept for offline days
  let FEEDBACK_ON = null;
  async function feedbackOn() {
    if (FEEDBACK_ON === null) { try { FEEDBACK_ON = !!(await getKV('feedback_on')); } catch (e) { FEEDBACK_ON = false; } }
    return FEEDBACK_ON;
  }
  const fbkExt = type => ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
    'audio/aac': 'aac', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[type] || 'bin');
  async function pickFarm() {
    farm = await getKV('farm');
    if (farm) return farm;
    const rows = await api('/rest/v1/farm?select=id,name,code,timezone&order=code');
    if (!rows.length) throw new Error('your account is not a member of any farm yet');
    farm = rows[0];                       // a franchisor sees several; the first for now
    await setKV('farm', farm);
    return farm;
  }
  // the farm's own day (0.11.146, review of 16 Nov): "today" was the phone's day, and a phone set to UTC or abroad filed
  // the work of 00:00–02:00 on yesterday. farmDay(date or ms, default now) is YYYY-MM-DD in farm.timezone
  // (Johannesburg when the farm is not read yet); addDays moves such a day by n days.
  // 0.11.147: the rule itself is shared with Naked Heart (FarmBox-Platform shared/farm-time.js -> src/js/shared/farm-time.js)
  function farmDay(at) { return farmDayOf(at, (farm && farm.timezone) || 'Africa/Johannesburg'); }
  const addDays = addDaysYmd;

  // what kind of failure it was, for words a worker can use: 'net' = no connection or no answer ("Failed to fetch",
  // "Load failed" on an iPhone, the time limit of api()), 'busy' = the server's own trouble, 'out' = the session ended
  const errKind = e => { const m = String((e && e.message) || e || '');
    return /Failed to fetch|Load failed|NetworkError|network error|no answer in time/i.test(m) ? 'net' : /^5\d\d /.test(m) ? 'busy' : m === 'signed out' ? 'out' : ''; };
  // the tasks this phone has closed and whose report, tick or cancel is still in the outbox
  // read one row at a time, keeping only that task and whether the row is a clock event (21 Nov 2026: all('outbox')
  // loaded every waiting photo's bytes at each sync)
  const outboxLight = () => scan('outbox', r => { const p = r.payload;
    return { task: !r.dead && p && p.task_id && (p.__tick || p.__skip || (!p.__timer && !p.__upload && !p.__clock
        && !p.__feedback && !p.__ghnote && p.status === 'completed')) ? p.task_id : null, clock: !!(p && p.__clock) }; });
  const unsentTasks = rows => new Set(rows.filter(x => x.task).map(x => x.task));
  async function sync(full, quiet) {
    if (syncing || !session) return;
    syncing = true; $('sync').classList.add('spin');
    try {
      await pickFarm();
      const timesBefore = quiet ? JSON.stringify((await getKV('task_times')) || []) : null;
      const gen = cursorGen;
      const since = full ? null : await getKV('cursor');
      // read before the call too (0.11.146): the outbox is sent beside the sync now, and a report that went up while
      // the server answered is no longer in the outbox after it
      let unsentBefore = new Set();
      try { unsentBefore = unsentTasks(await outboxLight()); } catch (e) { /* read again below */ }
      const d = await api('/rest/v1/rpc/sync_since', {
        method: 'POST',
        body: JSON.stringify({ p_farm: farm.id, p_since: since || '-infinity' })
      });
      // a task this phone has closed and not sent yet keeps its own state: a timer start alone touches the task on the
      // server, so its row came back still open and was written over the finished one — the card read "Paused", and
      // opening it gave an empty checklist to do again. Only while its report, tick or cancel is still in the outbox,
      // and never over a task the server cancelled. Anything unexpected here: the server's rows as they came, as before.
      let fromServer = d.tasks;
      let outAfter = null;                     // the read after the call
      try {
        outAfter = await outboxLight();
        const unsent = new Set([...unsentBefore, ...unsentTasks(outAfter)]);
        if (unsent.size && Array.isArray(d.tasks)) {
          const shut = st => st === 'done' || st === 'skipped';
          const had = new Map((await all('tasks')).map(t => [t.id, t]));
          fromServer = d.tasks.map(t => {
            const l = unsent.has(t.id) ? had.get(t.id) : null;
            return l && shut(l.status) && !shut(t.status) && t.status !== 'cancelled'
              ? { ...t, status: l.status, done_at: l.done_at || t.done_at || null,
                  skip_reason: l.skip_reason ?? t.skip_reason ?? null, skip_note: l.skip_note ?? t.skip_note ?? null } : t;
          });
        }
      } catch (e) { fromServer = d.tasks; }
      await putAll('tasks', fromServer);
      // who is on each task: a task that came back brings its whole list, so the old one goes first
      if (d.task_workers) {
        // FarmBox 0087 sends the whole window's list every time; an older server only the changed tasks'
        const whole = !!(d.workers && d.me !== undefined);
        const fresh = d.task_workers.map(x => ({ ...x, id: x.task_id + '|' + x.worker_id }));
        try {
          // in one transaction: the old rows used to go one by one, each in a transaction of its own — several hundred
          // at every minute's sync — and a screen drawn meanwhile read a list with holes: tasks missing under a person's
          // name, cards saying "nobody yet". A whole list replaces the store; a changed task's rows go, then the new
          // ones come — the same end as before. Anything thrown inside undoes it all, and the old way runs below.
          const changed = new Set((d.tasks || []).map(t => t.id));
          await tx('task_workers', 'readwrite', s => {
            try {
              if (whole) { s.clear(); fresh.forEach(r => s.put(r)); }
              else {
                const q = s.getAll();
                q.onsuccess = () => { q.result.filter(x => changed.has(x.task_id)).forEach(x => s.delete(x.id)); fresh.forEach(r => s.put(r)); };
              }
            } catch (e) { try { s.transaction.abort(); } catch (e2) { /* ending already */ } throw e; }
          });
        } catch (e) {
          console.warn('task_workers in one go failed, row by row:', e);
          const came = new Set(whole ? (await all('task_workers')).map(x => x.task_id) : (d.tasks || []).map(t => t.id));
          for (const x of (await all('task_workers')).filter(x => came.has(x.task_id))) await del('task_workers', x.id);
          await putAll('task_workers', fresh);
        }
      }
      await putAll('workers', d.workers);
      // a person removed from the team (FarmBox 0230) is no row any more, and this phone only ever added people: the
      // name stayed in "whose tasks". The server sends everybody at every sync (0087), so who is not in a list that
      // came whole goes; an empty or missing list removes nobody.
      try {
        if (Array.isArray(d.workers) && d.workers.length && d.me !== undefined) {
          const sent = new Set(d.workers.map(w => w.id));
          for (const w of (await all('workers')).filter(w => !sent.has(w.id))) await del('workers', w.id);
        }
      } catch (e) { /* the list stays as it was */ }
      try { await workerPhotos(d.workers); } catch (e) { /* the faces keep the pictures they had */ }
      // who is signed in, from every sync (0.11.103): a phone used by two people kept the first one — an extra
      // scouting of 4 Oct was made under one person's name while its photos were another's
      if (d.me !== undefined) await setKV('me', d.me || null);
      // 0.11.117: no name card — the name is the signed-in person's, from the people database
      try {
        const mine = (d.workers || []).find(x => x.id === d.me);
        if (mine && mine.name && typeof setAuthor === 'function' && typeof getAuthor === 'function' && getAuthor() !== mine.name) setAuthor(mine.name);
      } catch (e) { /* the name stays as it was */ }
      if (Array.isArray(d.task_times)) await setKV('task_times', d.task_times);   // FarmBox 0161
      if (d.clock && !(await outboxLight()).some(x => x.clock)) await setKV('clock', { ...d.clock, at: Date.now() });
      // sister units (FarmBox 0126): the tasks of every unit of the group come in one sync
      await setKV('sisters', Array.isArray(d.sisters) && d.sisters.length > 1 ? d.sisters : null);
      await putAll('sops', d.sops);
      await putAll('versions', d.sop_versions);
      await putAll('steps', d.sop_steps);
      // Phase A: the platform sends one task per crop × zone × date and lists
      // the positions it covers. Older servers send nothing here — fine.
      // FarmBox 0075 sends task_items (every kind: batch, asset, area, trap); older servers only the batches
      await putAll('positions', d.task_items || d.task_positions);
      // IPM: the sticky traps of the farm and the count thresholds
      await putAll('traps', d.sticky_traps);
      if (d.ipm_threshold) await setKV('ipm_threshold', d.ipm_threshold);
      if (Array.isArray(d.scouting_state)) await setKV('scouting_state', d.scouting_state);   // FarmBox 0145
      // FarmBox 0189: the feedback button on every task, while the farm has the feedback switched on
      const fbkWas = !!FEEDBACK_ON;
      if (typeof d.feedback === 'boolean') { FEEDBACK_ON = d.feedback; await setKV('feedback_on', d.feedback); }
      for (const x of (d.deleted || [])) {
        const store = { task: 'tasks', sop: 'sops', sop_version: 'versions', sop_step: 'steps',
                        task_position: 'positions', task_item: 'positions', sticky_trap: 'traps' }[x.table];
        if (store) await del(store, x.id);
        if (x.table === 'task') {
          for (const p of (await all('positions')).filter(p => p.task_id === x.id)) await del('positions', p.id);
          for (const w of (await all('task_workers')).filter(w => w.task_id === x.id)) await del('task_workers', w.id);
        }
      }
      // The server only sends tasks from a week back: anything older on the
      // phone can never be updated again (a cancellation would not arrive), so
      // it goes — done or not. The outbox keeps what is still to upload.
      // the farm's day, not the phone's (0.11.146)
      const todayIs = farmDay(), keepFrom = addDays(todayIs, -7);
      const stale = (await all('tasks')).filter(t => t.planned_date && (t.planned_date < keepFrom
        || (t.local && t.planned_date < todayIs && String(t.generation_key || '').startsWith('extra:scouting:'))));
      for (const t of stale) await del('tasks', t.id);
      if (stale.length) {
        const gone = new Set(stale.map(t => t.id));
        for (const p of (await all('positions')).filter(p => gone.has(p.task_id))) await del('positions', p.id);
        for (const x of (await all('task_workers')).filter(x => gone.has(x.task_id))) await del('task_workers', x.id);
      }
      // a flush that set a report aside meanwhile cleared the cursor for a whole read: that is not undone here (0.11.146)
      if (gen === cursorGen) await setKV('cursor', d.cursor);
      await setKV('synced_at', Date.now());
      // Digital scouting (0.11.132): today's zone counters for the scouting task cards; a task of mine whose zone has
      // every minimum is ticked done here, on my own phone
      let dgMoved = false;
      try { dgMoved = await dgSyncCounts(); } catch (e) { /* the cards keep what they showed */ }
      liveOpen();
      // the reports kept for adding offline go after eight days
      // only the 'sent:' keys, one at a time (21 Nov 2026: all('kv') read every draft's photos too)
      const sentOld = Date.now() - 8 * 86400000;
      for (const id of await scan('kv', r => ((r.v?.kept || 0) < sentOld ? r.id : undefined), IDBKeyRange.bound('sent:', 'sent:\uffff'))) await del('kv', id);
      // not waited for (0.11.146, review of 16 Nov): a flush with full photos runs for minutes, and every sync meanwhile
      // did nothing — the minute's, the live "moved", the ⟳ tap. flush() is one pass at a time by itself.
      flush().catch(e => console.warn('flush:', e));
      // a sync never pulls anybody out of a task or a checklist they have open (0.11.39)
      // the minute's quiet sync (0.11.84) redraws the day only when a task, a name or somebody's timer moved
      const moved = !quiet || dgMoved || (d.tasks || []).length > 0 || (d.deleted || []).length > 0
        || JSON.stringify(d.task_times || []) !== timesBefore || fbkWas !== !!FEEDBACK_ON;
      if ($('task').classList.contains('hidden') && $('run').classList.contains('hidden')) {
        if (moved && !(quiet && document.querySelector('.fb-sheet, .fb-undo.show'))) showWeek(); else paintFoot();
      } else paintFoot();
    } catch (e) {
      console.warn('sync failed:', e);
      // this toast also comes by itself (the app opening, the signal coming back): said in plain words; anything else as before
      if (!quiet) { const k = errKind(e);
        showToast(k === 'net' ? 'No signal — your work is kept on this phone and goes up later'
          : k === 'busy' ? 'The server is busy — your work is kept on this phone, it tries again by itself'
          : k === 'out' ? 'Please sign in again — your work is kept on this phone'
          : 'Sync failed — ' + String(e.message || e).slice(0, 60), 'error'); }
    } finally { syncing = false; $('sync').classList.remove('spin'); }
  }

  // ── live (0.11.93, owner 3 Oct 2026: "add live update") ──────────────────
  // The phones and the consoles of a site share one Supabase Realtime broadcast channel: whoever sent something
  // says "moved", and the others sync at once instead of at the next minute — a task somebody takes shows its lock
  // on the other phones in about a second. Only that one word travels; what moved is read from the database as
  // always. The minute's sync stays underneath for a missed message; the channel is closed while the app is hidden.
  let liveWs = null, liveTopic = null, liveBeat = null, liveRetry = null, liveRef = 0, liveDeb = null, liveSaid = 0;
  const liveSend = (event, payload, t = liveTopic) => {
    if (liveWs && liveWs.readyState === 1) liveWs.send(JSON.stringify({ topic: t, event, ref: String(++liveRef), payload }));
  };
  function liveClose() {
    clearInterval(liveBeat); clearTimeout(liveRetry); liveBeat = liveRetry = null;
    if (liveWs) { liveWs.onclose = null; try { liveWs.close(); } catch (e) {} liveWs = null; }
  }
  async function liveOpen() {
    if (liveWs || !session || document.hidden || !navigator.onLine || !document.body.classList.contains('src-cloud')) return;
    let sis = null; try { sis = await getKV('sisters'); } catch (e) {}
    if (!farm) { try { farm = await getKV('farm'); } catch (e) {} }
    const site = (Array.isArray(sis) && (sis.find(x => x.home) || sis[0]) || farm || {}).id;
    if (!site || liveWs) return;
    liveTopic = 'realtime:fb-live-' + site;
    try { liveWs = new WebSocket(URL_BASE.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + ANON + '&vsn=1.0.0'); }
    catch (e) { liveWs = null; return; }
    const ws = liveWs;
    ws.onopen = () => {
      liveSend('phx_join', { config: { broadcast: { self: false }, presence: { key: '' } } });
      liveBeat = setInterval(() => liveSend('heartbeat', {}, 'phoenix'), 25000);
    };
    ws.onmessage = e => {
      let d; try { d = JSON.parse(e.data); } catch (x) { return; }
      if (d.topic !== liveTopic || d.event !== 'broadcast' || !d.payload || d.payload.event !== 'moved') return;
      clearTimeout(liveDeb);
      liveDeb = setTimeout(() => { if (!document.hidden && navigator.onLine && session && !document.querySelector('.fb-cam')) { sync(false, true); dgSoon(); } }, 1200);
    };
    ws.onclose = () => { clearInterval(liveBeat); if (liveWs === ws) liveWs = null; liveRetry = setTimeout(liveOpen, 20000); };
    ws.onerror = () => { try { ws.close(); } catch (x) {} };
  }
  function liveSay() {
    if (Date.now() - liveSaid < 1000) return;
    liveSaid = Date.now();
    liveSend('broadcast', { type: 'broadcast', event: 'moved', payload: {} });
  }

  // what this phone sent for a task, kept a week (0.11.93): a done task of this phone opens to add to it without signal
  const sentKey = id => 'sent:' + id;
  function keepSent(p) {
    if (!p || !p.task_id || p.status !== 'completed') return;
    const d = { task_id: p.task_id, status: 'done', may_edit: true, kept: Date.now(),
      run: { client_run_id: p.client_run_id, started_at: p.started_at, finished_at: p.finished_at, outcome: p.outcome || null,
             outcome_note: p.outcome_note || null, section_outcomes: p.section_outcomes || null, notes: p.notes || null },
      steps: (p.steps || []).map(s => ({ seq: s.seq, step_id: s.step_id, item_id: s.item_id || null, result: s.result, value_num: s.value_num ?? null,
        value_text: s.value_text ?? null, note: s.note || null, media: (s.media || []).map(m => m.path || m).filter(x => typeof x === 'string') })),
      traps: (p.traps || []).map(t => { const { photo_blob, ...rest } = t; return rest; }),
      observations: p.observations || [],
      harvests: (p.harvests || []).map(h => ({ plan_id: h.plan_id, kg: h.kg })) };
    setKV(sentKey(p.task_id), d).catch(() => {});
  }

  // ── the outbox: nothing a worker records is ever lost ───────────────────
  let outboxDirty = false;                 // something was queued since the running pass read the outbox (doFlush)
  // the photos of a row as plain bytes on an iPhone (a Blob in the browser's database is the weak spot there after a
  // kill, 0.11.99); 0.11.146: the step photos, trap photos and the items of a feedback or a note too, not only the
  // photo rows — unBlob() gives them back when they are sent
  // one photo at a time, and one the phone cannot read stays as it is: Finish still saves the report (the send says
  // what was lost), it used to say "Could not save" with nothing queued
  const packSafe = async (b, type) => {
    if (!(b instanceof Blob)) return b;
    try { return type ? { __ab: await b.arrayBuffer(), type } : await packBlob(b); } catch (e) { return b; }
  };
  async function packRow(u) {
    if (!IS_IOS || !u) return;
    if (u.__upload) u.blob = await packSafe(u.blob);
    if (u.__dg) for (const x of (u.uploads || [])) x.blob = await packSafe(x.blob);
    if (u.__gallery) { u.blob = await packSafe(u.blob); u.thumb = await packSafe(u.thumb); }
    if (Array.isArray(u.steps) && u.steps.some(s => Array.isArray(s.media_blobs))) {
      const steps = [];
      for (const s of u.steps) {
        if (!Array.isArray(s.media_blobs)) { steps.push(s); continue; }
        const mb = [];
        for (const b of s.media_blobs) mb.push(await packSafe(b));
        steps.push({ ...s, media_blobs: mb });
      }
      u.steps = steps;
    }
    if (Array.isArray(u.traps) && u.traps.some(t => t.photo_blob instanceof Blob)) {
      const traps = [];
      for (const t of u.traps) traps.push(t.photo_blob instanceof Blob ? { ...t, photo_blob: await packSafe(t.photo_blob) } : t);
      u.traps = traps;
    }
    // a video stays a Blob: tens of megabytes read into memory at once is what closes the app on an iPhone
    if ((u.__feedback || u.__ghnote) && Array.isArray(u.items)) {
      const items = [];
      for (const x of u.items) items.push(x && x.kind !== 'video' && x.blob instanceof Blob
        ? { ...x, blob: await packSafe(x.blob, x.blob.type || (x.kind === 'audio' || u.__ghnote ? 'audio/webm' : 'image/jpeg')) } : x);
      u.items = items;
    }
  }
  // every row written to the outbox goes through here: its photos packed, and a revision of its own (0.11.146, review
  // of 16 Nov) — Finish after Force send or Hand over, or an edit, writes a newer row under the same id while the older
  // one is being sent, and the pass deleted the newer one as sent or wrote the older one back over it. A pass now
  // writes back or deletes only the row it read (sameRow, in the flush).
  let revN = 0;
  async function queueRows(rows) {
    for (const r of rows) await packRow(r.payload);
    const t = Date.now().toString(36);
    await putAll('outbox', rows.map(r => ({ ...r, rev: `${t}-${++revN}` })));
    outboxDirty = true;
  }
  async function queue(payloads) {
    const list = Array.isArray(payloads) ? payloads : [payloads];
    await queueRows(list.map((payload, i) => ({ id: payload.client_run_id, payload, tries: 0, at: Date.now() + i })));
    list.forEach(p => { if (!p.__timer && !p.__upload && !p.__tick && !p.__skip && !p.__clock && !p.__feedback && !p.__ghnote && !p.__gallery) keepSent(p); });
    // done, not done, or a checklist sent: that task's timer stops (the server stops its own with the task)
    list.forEach(p => { if (p.task_id && (p.__tick || p.__skip || (!p.__timer && !p.__upload && p.status === 'completed'))) timerCloseLocal(p.task_id); });
    outboxDirty = true;                    // a pass already running takes these before it goes on with the photos (doFlush)
    flush().catch(e => console.warn('flush:', e));
  }
  // the full photos: over Wi-Fi only, or Wi-Fi and mobile data (Settings, 0.11.40)
  const uploadNet = () => { try { return localStorage.getItem('fb_upload_net') || 'any'; } catch (e) { return 'any'; } };
  let uploadForce = false;                 // Send everything now: the photos go on whatever connection there is
  function uploadAllowed() {
    if (uploadForce || uploadNet() !== 'wifi') return true;
    const c = navigator.connection;
    if (!c || !c.type || c.type === 'unknown') return true;   // the phone does not say (an iPhone): upload
    return c.type === 'wifi' || c.type === 'ethernet';
  }

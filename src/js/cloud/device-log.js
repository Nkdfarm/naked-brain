//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- this phone, its errors, sending the outbox rows. Edit here, then run: python build.py
  // ── what phone this is, and what went wrong on it (0.11.99, FarmBox 0208) ──
  // Until now a report said nothing of the phone it came from: "a problem on the iPhone" could not be read back. The
  // app says hello once per version and phone, and keeps its last errors (script errors, a checklist that came back
  // from a kill, an outbox row set aside); they go up after a flush, quietly, and are dropped once sent.
  const deviceLine = () => [navigator.userAgent, `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    navigator.deviceMemory ? `mem ${navigator.deviceMemory}` : null, `installed ${window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone ? 'yes' : 'no'}`,
    `gpu ${navigator.gpu ? 'yes' : 'no'}`, `camera ${camMode()}`].filter(Boolean).join(' · ');
  const logRead = () => { try { return JSON.parse(localStorage.getItem('fb_clientlog') || '[]'); } catch (e) { return []; } };
  function clientNote(kind, detail) {
    try {
      const l = logRead(); l.push({ kind, at: new Date().toISOString(), detail: String(detail || '').slice(0, 400) });
      localStorage.setItem('fb_clientlog', JSON.stringify(l.slice(-30)));
    } catch (e) { /* no room: nothing kept */ }
  }
  window.addEventListener('error', e => clientNote('error', `${e.message || 'error'} @ ${String(e.filename || '').split('/').pop()}:${e.lineno || 0}`));
  window.addEventListener('unhandledrejection', e => clientNote('error', 'promise: ' + String(e.reason?.message || e.reason || '').slice(0, 300)));
  let clientLogOff = false;
  async function sendClientLog() {
    if (clientLogOff || !session || !navigator.onLine || !farm) return;
    const hello = CURRENT_VERSION + '|' + navigator.userAgent;
    let said = null; try { said = localStorage.getItem('fb_hello'); } catch (e) {}
    const events = logRead();
    if (said === hello && !events.length) return;
    try {
      await api('/rest/v1/rpc/client_log', { method: 'POST', body: JSON.stringify({ p_farm: farm.id, p: {
        app: 'naked-brain', version: CURRENT_VERSION, device: deviceLine(),
        events: [...(said === hello ? [] : [{ kind: 'hello', at: new Date().toISOString(), detail: '' }]), ...events] } }) });
      try { localStorage.setItem('fb_hello', hello); localStorage.removeItem('fb_clientlog'); } catch (e) {}
    } catch (e) { clientLogOff = true; }                              // a database before 0208, or no signal: not again this visit
  }
  // one pass at a time (0.11.55): online, a network change, the screen coming back and a sync all call it, and two
  // passes at once uploaded the same photos twice and wrote back rows the other had already sent
  let flushing = null;
  function flush() {
    flushing = flushing || doFlush().finally(() => { flushing = null; sendClientLog().catch(() => {}); });
    return flushing;
  }
  // the update by itself waits while something is being sent (0.11.146): a reload cut an upload, and it went up again
  // under a new name, leaving the first file in no report
  window.fbSending = () => !!flushing || !!$('sendall')?.disabled;
  // 0.11.146 (review of 16 Nov): a pass writes back or deletes a row only while the outbox still holds the one it read
  // — a newer row under the same id (Finish after Force send or Hand over, an edit) has another revision and goes in
  // the next pass. Rows from before 0.11.146 have no revision: their time tells them apart.
  const sameRow = (a, b) => !!a && !!b && (a.rev || null) === (b.rev || null) && (a.at || 0) === (b.at || 0);
  const newerRow = () => { outboxDirty = true; const e = new Error('a newer copy of it is waiting on this phone'); e.superseded = true; return e; };
  // one outbox row as it is now, or null (tx() would hand back the request itself for a missing id)
  const outboxRow = id => tx('outbox', 'readonly', s => { const o = { row: null }, q = s.get(id); q.onsuccess = () => { o.row = q.result || null; }; return o; }).then(o => o.row);
  async function outboxKeep(row) {
    let ok = false;
    await tx('outbox', 'readwrite', s => { const q = s.get(row.id); q.onsuccess = () => { ok = sameRow(q.result, row); if (ok) s.put(row); }; });
    if (!ok) throw newerRow();
  }
  async function outboxDone(row) {
    let ok = false;
    await tx('outbox', 'readwrite', s => { const q = s.get(row.id); q.onsuccess = () => { ok = !q.result || sameRow(q.result, row); if (ok && q.result) s.delete(row.id); }; });
    if (!ok) outboxDirty = true;
  }
  // a photo kept on the phone that can no longer be read (an iPhone after a kill) failed like a lost connection at every
  // pass, and the report it rides in never went (0.11.146): tried here once, and said
  async function readable(b) {
    try { const piece = b.slice(0, 1); if (typeof piece.arrayBuffer !== 'function') return true; await piece.arrayBuffer(); return true; }
    catch (e) { return false; }
  }
  const PHOTO_GONE = '410 the photo is no longer on this phone';
  // a row the server refuses for good (a task deleted by a reschedule, a bad value) is set aside, not retried for ever
  // in front of everything else: 4xx other than 401/408/429. Network trouble, 5xx and 429 keep the order and wait.
  const refusedForGood = e => { const m = /^(\d{3}) /.exec(String(e?.message || '')); const st = m ? Number(m[1]) : 0;
                                return st >= 400 && st < 500 && ![401, 408, 429].includes(st); };
  // Something queued while a pass is running used to wait for the whole pass — a report finished while fifteen full
  // photos were going up waited for the last of them, and then for the next minute's sync (the reports first, 0.11.91,
  // only held inside one pass). queue() now raises outboxDirty; a pass that sees it stops before its next photo, and
  // a new pass reads the outbox again: the new report first, then the photos where they were left.
  // It cannot go round for ever: three passes at the most in one flush, and a row that failed in one pass is not
  // tried again in the next (failedNow) — so one flush still tries each row once, as it always did. The third pass
  // no longer stops for what is new: it finishes its photos, and what came meanwhile waits for the next flush, as before.
  async function doFlush() {
    const failedNow = new Set();
    for (let pass = 0; pass < 3; pass++) {
      outboxDirty = false;
      await flushPass(failedNow, pass < 2);
      if (!outboxDirty) break;
    }
  }
  async function flushPass(failedNow, mayStop) {
    if (!session || !navigator.onLine) return;
    if (!farm) farm = await getKV('farm');
    // in the order they were made (the store answers by id: every clock-in sorted before every clock-out)
    // 0.11.91: the reports and the timers first, the full photos after them (a photo that will not go up held every
    // report behind it for two days); a row that fails holds back only what depends on it — its own photos, the
    // later timer events of its task — and the rest still goes
    // a Digital scouting row with a file still to upload counts as a photo (0.11.132): it goes after the reports and
    // the ticks, as the full photos do (0.11.91); its file landed, it counts as a report again
    const isUp = r => r.payload && (r.payload.__upload || r.payload.__gallery || (r.payload.__dg && (r.payload.uploads || []).some(x => !x.done))) ? 1 : 0;
    const chainOf = r => { const u = r.payload || {}; if (u.__dg) return u.chain || 'dg:' + u.client_run_id; return u.__upload ? 'run:' + u.run_client_id : u.__timer ? 'tmr:' + u.task_id : u.__clock ? 'clock' : 'run:' + u.client_run_id; };
    const held = new Set();
    let told = 0;                            // what went up that the others should see at once (live, 0.11.93)
    // 21 Nov 2026: the order from a light read (one row in memory at a time), and each row read whole only at its turn —
    // all('outbox') held the bytes of every waiting photo for the whole pass. Read at its turn, a row taken back
    // meanwhile (a gallery photo discarded, Remove from this phone) is not sent; one rewritten meanwhile goes as it is now.
    const order = (await scan('outbox', r => ({ id: r.id, at: r.at || 0, up: isUp(r) })))
      .sort((a, b) => a.up - b.up || a.at - b.at || String(a.id).localeCompare(String(b.id)));
    for (const o of order) {
      const row = await outboxRow(o.id);
      if (!row) continue;
      if (mayStop && outboxDirty && isUp(row)) break;   // something new is waiting: it goes before the rest of the photos (doFlush)
      if (row.dead) { if (!isUp(row)) held.add(chainOf(row)); continue; }
      // it failed earlier in this same flush: not again now, and what depends on it still waits for it
      if (failedNow.has(row.id)) { if (!isUp(row)) held.add(chainOf(row)); continue; }
      if (held.has(chainOf(row))) continue;
      try {
        if (row.payload.__tick) {
          try { await api('/rest/v1/rpc/complete_task', {
            method: 'POST', body: JSON.stringify({ p_task: row.payload.task_id, p_minutes: row.payload.actual_minutes }) }); }
          catch (e) { if (!(row.payload.quiet && refusedForGood(e))) throw e; }   // an extra the server never had
        }
        else if (row.payload.__clock) {
          try {
            await api('/rest/v1/rpc/clock', { method: 'POST', body: JSON.stringify({ p_farm: farm.id, p_action: row.payload.action,
                                                                                      p_at: row.payload.at, p_client: row.payload.client_run_id }) });
          } catch (e) { if (!/not clocked in|seven days|not one of this farm/.test(String(e.message || e))) throw e; }
        }
        else if (row.payload.__timer) {
          try {
            const r = await api('/rest/v1/rpc/task_timer', { method: 'POST', body: JSON.stringify({ p_task: row.payload.task_id,
              p_action: row.payload.action, p_at: row.payload.at, p_client: row.payload.client_run_id }) });
            // FarmBox 0186: said at the moment the checklist opens — somebody else is on it, or it is already done
            if (row.payload.action === 'start' && Date.now() - new Date(row.payload.at).getTime() < 120000) {
              if (r && r.refused) showToast(`${firstName(r.held_by) || 'Somebody else'} is on this task — your time on it is not counted`, 'error');
              else if (r && r.ignored && r.status === 'done') showToast(`Already done${r.done_by ? ' by ' + firstName(r.done_by) : ''} — check before doing it again`, 'error');
              else if (r && Array.isArray(r.others) && r.others.length) showToast(`${r.others.map(firstName).join(' and ')} ${r.others.length > 1 ? 'are' : 'is'} also on this task now`, 'info');
            }
            if (r && r.refused && row.payload.action === 'start') timerCloseLocal(row.payload.task_id);   // FarmBox 0201: somebody else holds it
          } catch (e) { if (!refusedForGood(e)) throw e; }   // a task gone or closed: the event has nothing left to do
        }
        else if (row.payload.__skip) {
          try { await api('/rest/v1/rpc/skip_task', {
            method: 'POST', body: JSON.stringify({ p_task: row.payload.task_id, p_reason: row.payload.reason, p_note: row.payload.note }) }); }
          catch (e) { if (!(row.payload.quiet && refusedForGood(e))) throw e; }
        }
        else if (row.payload.__ghnote) {
          // a note about the whole greenhouse (0.11.122, FarmBox 0224): its recording goes to the evidence bucket, in the
          // notes' own folder — noted on the row as it lands, so a failure half-way re-sends none twice — then the note
          const u = row.payload;
          for (let i = 0; i < (u.items || []).length; i++) {
            const x = u.items[i], b = unBlob(x.blob);
            if (!(b instanceof Blob) || x.path) continue;
            if (!(await readable(b))) { clientNote('photo_lost', `note ${u.client_run_id}: recording ${i} unreadable, sent without it`); delete x.blob; await outboxKeep(row); continue; }
            const type = (b.type || '').split(';')[0] || 'audio/webm';
            const path = `${u.farm_id || farm.id}/notes/${u.client_run_id}/${i}-${Date.now()}.${fbkExt(type)}`;
            await api('/storage/v1/object/evidence/' + path, { method: 'POST', headers: { 'Content-Type': type }, body: b });
            x.path = path; x.bytes = b.size; delete x.blob;
            await outboxKeep(row);
          }
          await api('/rest/v1/rpc/submit_scout_note', { method: 'POST', body: JSON.stringify({ p: {
            farm_id: u.farm_id || farm.id, client_id: u.client_run_id, day: u.day, text: u.text, task_id: u.scout_task_id || null,
            extra: !!u.extra, author: u.author, app: u.app, app_version: u.app_version, sent_at: u.sent_at,
            media: (u.items || []).filter(x => x.path).map(x => ({ kind: 'audio', path: x.path, bytes: x.bytes, seconds: x.seconds })) } }) });
        }
        else if (row.payload.__feedback) {
          // a feedback on a task (0.11.85, FarmBox 0189): its voice notes, photos and video go to the evidence bucket —
          // each noted on the row as it lands, so a failure half-way re-sends none twice — then the feedback itself
          const u = row.payload;
          if ((u.items || []).some(x => x.kind === 'video' && unBlob(x.blob) instanceof Blob) && !uploadAllowed()) continue;   // a video waits for Wi-Fi
          for (let i = 0; i < (u.items || []).length; i++) {
            const x = u.items[i], b = unBlob(x.blob);
            if (!(b instanceof Blob) || x.path) continue;
            if (!(await readable(b))) { clientNote('photo_lost', `feedback ${u.client_run_id}: ${x.kind} ${i} unreadable, sent without it`); delete x.blob; await outboxKeep(row); continue; }
            const type = (b.type || '').split(';')[0] || { audio: 'audio/webm', photo: 'image/jpeg', video: 'video/mp4' }[x.kind];
            const path = `${u.farm_id || farm.id}/feedback/${u.client_run_id}/${i}-${Date.now()}.${fbkExt(type)}`;
            await api('/storage/v1/object/evidence/' + path, { method: 'POST', headers: { 'Content-Type': type }, body: b });
            x.path = path; x.bytes = b.size; delete x.blob;
            await outboxKeep(row);
          }
          await api('/rest/v1/rpc/submit_feedback', { method: 'POST', body: JSON.stringify({ p: {
            farm_id: u.farm_id || farm.id, client_id: u.client_run_id, task_id: u.task_id, task_title: u.task_title,
            sop_id: u.sop_id, sop_version_id: u.sop_version_id, step_seq: u.step_seq, note: u.note, author: u.author,
            app: u.app, app_version: u.app_version, device: u.device, sent_at: u.sent_at,
            media: (u.items || []).filter(x => x.path).map(x => ({ kind: x.kind, path: x.path, bytes: x.bytes, seconds: x.seconds })) } }) });
        }
        else if (row.payload.__dg) {
          // Digital scouting (0.11.132): the files first, each noted on the row as it lands — a resend uploads none twice,
          // and an answer lost after an upload comes back as "Duplicate" the next time: the file is there — then the call,
          // with the phone's own id, so a call sent twice is the same item. A voice note is then written down.
          const u = row.payload;
          for (const x of (u.uploads || [])) {
            if (x.done) continue;
            const blob = unBlob(x.blob);
            // its file is gone from the phone (0.11.146): set aside and listed, not marked as sent with no file behind it
            if (!(blob instanceof Blob) || !(await readable(blob))) throw new Error(PHOTO_GONE);
            try { await api('/storage/v1/object/evidence/' + x.path, { method: 'POST', headers: { 'Content-Type': x.type || blob.type || 'image/jpeg' }, body: blob }); }
            catch (e) { if (!/Duplicate|already exists/i.test(String(e.message || e))) throw e; }
            x.done = true; x.blob = null;
            try { await outboxKeep(row); } catch (e) { if (e.superseded) throw e; /* not noted: a resend meets "Duplicate", which is taken as done */ }
          }
          const call = () => u.fn ? api('/functions/v1/' + u.fn, { method: 'POST', body: JSON.stringify(u.args || {}) })
                                  : api('/rest/v1/rpc/' + u.rpc, { method: 'POST', body: JSON.stringify(u.args || {}) });
          let res = null;
          try { res = await call(); }
          catch (e) {
            if (u.rpc === 'dg_read_trap' && u.args?.p?.replace_id && refusedForGood(e)) {
              // the earlier photo could not be replaced (not this person's, or gone): the new one is kept beside it
              delete u.args.p.replace_id;
              try { await outboxKeep(row); } catch (e2) { if (e2.superseded) throw e2; /* sent below all the same */ }
              res = await call();
            } else if (dgGoneAlready(u, e)) res = null;    // the item it was about is gone meanwhile: nothing left to do
            else throw e;
          }
          if (u.voice && res && res.id) {
            try { await api('/functions/v1/greenhouse-note', { method: 'POST', body: JSON.stringify({ photo_note_id: res.id }) }); }
            catch (e) {
              // the note is saved; writing it down waits in the outbox
              await putAll('outbox', [{ id: 'dg-voice-' + res.id, tries: 0, at: Date.now(), payload: { __dg: true, client_run_id: 'dg-voice-' + res.id,
                fn: 'greenhouse-note', args: { photo_note_id: res.id }, chain: 'dg-voice-' + res.id, day: u.day } }]);
            }
          }
          dgSent(u, res);
        }
        else if ((row.payload.__upload || row.payload.__gallery) && !uploadAllowed()) continue;   // waits for Wi-Fi
        else if (row.payload.__gallery) await glSend(row);   // a farm photo for the Gallery (0.11.144): its two files, then the photo
        else if (row.payload.__upload) {
          // a full photo after its run: to the evidence bucket, then attached to the reading or the observation
          const u = row.payload, blob = unBlob(u.blob);
          // where it went is noted on the row as it lands, like the photos of the other kinds: when only the attaching
          // failed (the signal went between the two), the same megabytes went up again under a new name and the first
          // file was left in no report. A noted path is used again for 15 minutes only — after 20 a file in no report
          // shows in Naked Heart's unfiled list, where it can be deleted — then the photo goes up afresh, as before.
          const age = Date.now() - (u.path_at || 0);
          const landed = typeof u.path === 'string' && !!u.path && age >= 0 && age < 15 * 60000;
          // no file on the phone and none landed (0.11.146): set aside and listed — it was deleted as sent, with nothing
          // uploaded. A file that landed earlier is still attached when the phone's copy is gone.
          const hasFile = blob instanceof Blob && await readable(blob);
          if (!landed && !hasFile && !(typeof u.path === 'string' && u.path)) throw new Error(PHOTO_GONE);
          if (!landed && hasFile) {
            const path = `${u.farm_id || farm.id}/${u.run_client_id}/${u.kind === 'trap' ? 'trap' : 'scout'}-${String(u.ref).replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}.jpg`;
            await api('/storage/v1/object/evidence/' + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
            u.path = path; u.path_at = Date.now();
            try { await outboxKeep(row); } catch (e) { if (e.superseded) throw e; /* not noted: it goes up again next time, as before */ }
          }
          await api('/rest/v1/rpc/attach_photo', { method: 'POST',
            body: JSON.stringify({ p_kind: u.kind, p_run_client_id: u.run_client_id, p_ref: u.ref, p_path: u.path }) });
        }
        else {
          // step photos kept with the run (0.11.55): each goes up, is noted on its step and taken off the row at once,
          // so a failure half-way re-sends none twice
          for (const st of (row.payload.steps || [])) {
            while (Array.isArray(st.media_blobs) && st.media_blobs.length) {
              const b = unBlob(st.media_blobs[0]);
              if (b instanceof Blob && await readable(b)) {
                const path = `${row.payload.farm_id || farm.id}/${row.payload.client_run_id}/s${st.seq}${st.item_id ? '-' + String(st.item_id).slice(0, 8) : ''}-${Date.now()}.jpg`;
                await api('/storage/v1/object/evidence/' + path, { method: 'POST', headers: { 'Content-Type': b.type || 'image/jpeg' }, body: b });
                (st.media = st.media || []).push({ path, kind: 'photo' });
              } else clientNote('photo_lost', `report ${row.payload.client_run_id}: a photo of step ${st.seq} could not be read, sent without it`);
              st.media_blobs.shift();
              await outboxKeep(row);
            }
            delete st.media_blobs;
          }
          // trap photos that never reached the bucket go first (the run waits if they cannot)
          for (const t of (row.payload.traps || [])) {
            const pb = unBlob(t.photo_blob);
            if (pb instanceof Blob && !t.photo_path) {
              if (await readable(pb)) t.photo_path = await uploadTrapPhoto(row.payload.client_run_id, t.code, pb, row.payload.farm_id);
              else clientNote('photo_lost', `report ${row.payload.client_run_id}: the photo of trap ${t.code} could not be read, sent without it`);
              delete t.photo_blob;
              await outboxKeep(row);
            }
            delete t.photo_blob;
          }
          const sent = await api('/rest/v1/rpc/submit_run', { method: 'POST', body: JSON.stringify({ p: row.payload }) });
          // FarmBox 0186: somebody had already sent this task — this one is kept as a second report
          if (sent && sent.already) {
            const at = sent.already.at ? new Date(sent.already.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            showToast(`Already sent${sent.already.by ? ' by ' + firstName(sent.already.by) : ''}${at ? ' at ' + at : ''} — yours is kept as a second report`, 'info');
          }
          // FarmBox 0212: its task was taken off the plan meanwhile (a replan, a new schedule) — the report is kept all
          // the same, without a task; before 0212 the server refused it and the row was set aside for good
          if (sent && sent.task_gone) {
            showToast('This task was taken off the plan meanwhile — your report is kept', 'info');
            clientNote('task_gone', row.payload.task_id);
          }
        }
        await outboxDone(row);             // only the row that was sent: a newer one under its id stays for the next pass
        if (!isUp(row) && !row.payload.__clock && !row.payload.__feedback) told++;
      } catch (e) {
        if (e && e.superseded) continue;   // a newer row took its place while it was sent: that one goes in the next pass
        const dead = refusedForGood(e);
        if (dead || row.tries === 2) clientNote(dead ? 'refused' : 'retry', `${row.payload.__upload ? 'photo' : row.payload.__gallery ? 'gallery' : row.payload.__timer ? 'timer' : 'report'}: ${String(e.message || e).slice(0, 200)}`);
        // a row taken back while it was being sent (a digital scouting vote changed meanwhile, a gallery photo
        // discarded, Remove from this phone) is not written back: it would come back beside the newer one; nor is the
        // older row written over a newer one under the same id (0.11.146)
        try { await outboxKeep({ ...row, tries: row.tries + 1, error: String(e.message || e).slice(0, 160), dead }); }
        catch (e2) { if (e2.superseded) continue; throw e2; }
        // set aside, and it closed a task: the sync kept that task closed while the report waited. The next sync reads
        // everything again, so the card shows what the server holds instead of "done" for ever.
        if (dead && row.payload && row.payload.task_id) { cursorGen++; try { await setKV('cursor', null); } catch (e2) { /* the next full sync does it */ } }
        failedNow.add(row.id);
        if (!isUp(row)) held.add(chainOf(row));   // its photos and its later timer events wait for it; everything else goes on
        if (!navigator.onLine) break;             // the connection went: no point in trying the rest
      }
    }
    if (told) liveSay();
    paintFoot();
    try { glSoon(); } catch (e) { /* the Gallery part is not there yet */ }
  }


//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the whole greenhouse note. Edit here, then run: python build.py
  // ── the whole greenhouse (0.11.122, FarmBox 0224; owner 12 Oct 2026) ────
  // "a small section for all greenhouse … the human report will be filled just a voice note or text (not mandatory) …
  // another section on the daily scouting with zone All … accessible for the planned scouting and extra scouting".
  // A card "All" on top of a scouting's zones opens this page: say it or write it. It is not a task and not a zone:
  // nothing here counts in the day's scouting, and nothing is asked. It leaves through the outbox (offline too): the
  // recording to the evidence bucket, then submit_scout_note; the server writes the voice down with the farm's own
  // words, and Naked Heart shows it above the zones, where its text can be corrected. What is on the page is kept
  // (KV ghdraft:<unit>:<day>) until it is sent; what this phone sent is listed under the form (KV gh_sent).
  const GH_VOICE_S = 180;
  const ghKey = c => c.farm_id + ':' + c.day;
  const ghNoteId = () => 'ghn-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
  function greenhouseCard(ctx, back) {
    const b = el('button', 'fb-card fb-gh');
    const body = el('div', 'fb-body');
    body.append(el('div', 'fb-name', 'All · whole greenhouse'));
    const meta = el('div', 'fb-meta'); meta.append(el('span', 'fb-where', 'a voice note or a few words · optional'));
    body.append(meta); b.append(body);
    const n = (GH_SENT[ghKey(ctx)] || []).length;
    b.append(n ? el('span', 'fb-chip ok', `${n} sent · add more`) : el('span', 'fb-chip todo', 'Add a note'));
    b.onclick = () => openGreenhouse(ctx, back);
    return b;
  }
  async function openGreenhouse(ctx, back) {
    const key = 'ghdraft:' + ghKey(ctx);
    let draft = null; try { draft = await getKV(key); } catch (e) {}
    const st = { note: draft?.note || '', items: (draft?.items || []).filter(x => x && x.blob instanceof Blob) };
    const save = () => setKV(key, st.note || st.items.length ? { note: st.note, items: st.items, at: Date.now() } : null).catch(() => {});
    let rec = null, recTimer = null, recStart = 0, urls = [];
    const freeUrls = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };
    const stopRec = () => { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {} };
    const leave = () => { stopRec(); clearInterval(recTimer); freeUrls(); };
    const unit = ((await getKV('sisters')) || []).find(u => u.id === ctx.farm_id)?.name || farm?.name || null;

    const box = $('task'); box.textContent = '';
    const hero = el('div', 'hero');
    hero.append(el('h1', null, 'Whole greenhouse'),
      el('p', null, [unit, fmtDay(ctx.day), ctx.extra ? 'extra scouting' : null].filter(Boolean).join(' · ')),
      el('p', null, 'What you saw across the greenhouse today, in your own words — it goes in the daily report, above the zones. Only if you have something to say.'));
    box.append(hero);

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
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showToast('This phone cannot record here — write the note instead', 'error'); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { showToast('The microphone is not allowed — allow it, or write the note instead', 'error'); return; }
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const chunks = [];
      let mr;
      try { mr = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 }) : new MediaRecorder(stream); }
      catch (e) { stream.getTracks().forEach(t => t.stop()); showToast('Recording did not start — write the note instead', 'error'); return; }
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
      recTimer = setInterval(() => { paintRec(); if ((Date.now() - recStart) / 1000 >= GH_VOICE_S) stopRec(); }, 500);
    };
    box.append(recBtn);

    const note = el('textarea', 'fb-runnote fb-fbk-note'); note.rows = 4; note.value = st.note;
    note.placeholder = 'Or write it here';
    note.oninput = () => { st.note = note.value; save(); paintSend(); };
    box.append(note);

    // what was recorded: listen, remove
    const items = el('div', 'fb-fbk-items');
    function paintItems() {
      freeUrls(); items.textContent = '';
      st.items.forEach((x, i) => {
        const row = el('div', 'fb-fbk-item audio');
        const url = URL.createObjectURL(x.blob); urls.push(url);
        const n = el('audio'); n.controls = true; n.preload = 'metadata'; n.src = url;
        const cap = el('span', 'fb-meta', ['Voice note', x.seconds ? Math.round(x.seconds) + ' s' : null, fmtMB(x.blob.size)].filter(Boolean).join(' · '));
        const rm = el('button', 'fb-link', 'Remove');
        rm.onclick = () => { st.items.splice(i, 1); save(); paintItems(); };
        const foot = el('div', 'fb-fbk-cap'); foot.append(cap, rm);
        row.append(n, foot);
        items.append(row);
      });
      paintSend();
    }
    box.append(items);

    const send = el('button', 'btn btn-primary btn-lg btn-block', 'Send the note');
    function paintSend() { send.disabled = !(note.value.trim() || st.items.length); }
    send.onclick = async () => {
      if (rec) { showToast('Stop the recording first', 'error'); return; }
      const text = note.value.trim();
      if (!text && !st.items.length) { showToast('Say or write something first', 'error'); return; }
      send.disabled = true;
      try {
        if (!farm) farm = await getKV('farm');
        const me = await getKV('me');
        const id = ghNoteId();
        await queue({ __ghnote: true, client_run_id: id, farm_id: ctx.farm_id || farm?.id, day: ctx.day, text: text || null,
          scout_task_id: ctx.task_id || null, extra: !!ctx.extra,
          author: (await all('workers')).find(w => w.id === me)?.name || session?.user?.email || null,
          app: 'brain', app_version: typeof CURRENT_VERSION !== 'undefined' ? CURRENT_VERSION : null,
          sent_at: new Date().toISOString(), items: st.items.map(x => ({ kind: 'audio', blob: x.blob, seconds: x.seconds ?? null })) });
        await setKV(key, null);
        const mine = GH_SENT[ghKey(ctx)] || (GH_SENT[ghKey(ctx)] = []);
        mine.push({ at: Date.now(), text: text ? text.slice(0, 200) : null, seconds: st.items.reduce((a, x) => a + (x.seconds || 0), 0) || null });
        for (const k of Object.keys(GH_SENT)) if (!(GH_SENT[k] || []).some(x => x.at > Date.now() - 3 * 86400000)) delete GH_SENT[k];
        setKV('gh_sent', GH_SENT).catch(() => {});
        showToast(navigator.onLine ? 'Note sent ✓' : 'Note kept — it goes when there is signal', 'success');
        history.back();
      } catch (e) {
        send.disabled = false;
        showToast('Could not keep the note — ' + String(e.message || e).slice(0, 60), 'error');
      }
    };
    box.append(send);
    box.append(el('div', 'config-hint', `Voice notes up to ${GH_VOICE_S / 60} minutes. It works offline: it is sent when there is signal. The voice is written down for the report; a word heard wrong can be corrected in Naked Heart. An idea to improve FarmBox goes in Capture › SU reports.`));

    // what this phone already sent about that day
    const mine = GH_SENT[ghKey(ctx)] || [];
    const waiting = (await all('outbox')).filter(r => r.payload?.__ghnote && r.payload.farm_id === ctx.farm_id && r.payload.day === ctx.day).length;
    if (mine.length) {
      const said = el('div', 'fb-fbk-said');
      said.append(el('div', 'fb-sec', 'Already sent from this phone'));
      if (waiting) said.append(el('div', 'config-hint', `${waiting} waiting to be sent.`));
      mine.slice().reverse().forEach(r => {
        const c = el('div', 'fb-fbk-row');
        const head = el('div', 'fb-fbk-head');
        head.append(el('b', null, new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
          el('span', 'fb-meta', r.seconds ? `{i:mic} ${Math.round(r.seconds)} s` : 'written'));
        c.append(head);
        if (r.text) c.append(el('div', 'fb-fbk-text', r.text));
        said.append(c);
      });
      box.append(said);
    }

    paintItems();
    show('task', 'Whole greenhouse', async () => { leave(); return back(); });
  }


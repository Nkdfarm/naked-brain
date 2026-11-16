//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- Send everything now, the footer. Edit here, then run: python build.py
  // ── Send everything now (0.11.87, owner 2 Oct 2026: "a button to send all temporary data now, just in the top") ──
  // What a phone holds that the server has not seen: the outbox (runs and photos waiting, or set aside after a refusal)
  // and the scouting drafts — photos taken in a scouting that was never finished, or added to a done one and left with
  // Back, which nothing sent until Finish. The button sends the outbox whatever the connection (the Wi-Fi-only choice is
  // lifted for this once) and, for every scouting draft, the report as it stands (0.11.88, owner: "send all the daily
  // report by the top button also if not finished yet"): its plant photos, on the run the task already has (nothing of
  // it is replaced — no answers, no OK / not OK) or on a run kept `partial` that Finish completes later (the draft
  // remembers its id). A trap photo of a round is not sent (0260: the traps are read in Digital scouting). Other
  // unfinished checklists are not sent: the result says how many stayed.
  // Force send says what it is before it runs (0.11.107, owner: "change the sending in force send, with a message to
  // advise"): the normal way is Finish inside a task; this one sends whatever the phone holds, complete or not
  function askForce() {
    return new Promise(resolve => {
      const sheet = el('div', 'fb-sheet');
      const box = el('div', 'fb-sheet-card');
      box.append(el('h3', null, 'Send everything now?'));
      box.append(el('p', null, 'The normal way to send is Finish inside a task. Send everything now is for clearing this phone: it sends everything it still holds, as it stands, even if it is not complete.'));
      const ul = el('ul', 'fb-sendlist');
      ['Growth photos without the scale card go with no sizes.',
       'Checklists not finished go half-done; their tasks stay open.',
       'Harvest weights are never forced: finish them in their task.',
       'What cannot be sent at all is listed after, and you may remove it from this phone.'].forEach(t => ul.append(el('li', null, t)));
      const done = v => { sheet.remove(); resolve(v); };
      const no = el('button', 'fb-btn', 'Cancel'); no.type = 'button'; no.onclick = () => done(false);
      const yes = el('button', 'fb-btn fb-btn-primary', 'Send everything now'); yes.type = 'button'; yes.onclick = () => done(true);
      const acts = el('div', 'fb-actions'); acts.append(no, yes);
      box.append(ul, acts);
      sheet.append(box);
      sheet.onclick = e => { if (e.target === sheet) done(false); };
      document.body.append(sheet);
    });
  }
  async function sendAllNow() {
    const btn = $('sendall');
    if (!session) { showToast('Sign in first', 'error'); return; }
    if (!navigator.onLine) { showToast('Sending needs a connection', 'error'); return; }
    const openRun = document.getElementById('fb-run');
    if (openRun && !openRun.classList.contains('hidden')) { showToast('Finish this task or go back first, then Send everything now', 'error'); return; }
    if (!await askForce()) return;
    btn.disabled = true; nbLabel(btn, '{i:upload} Sending…');
    const lines = [];
    const say = (text, bad) => lines.push([text, !!bad]);
    // Send is the forced way (0.11.106, owner 4 Oct 2026: "the manual sending is to force sending also if something is
    // not as required, to wipe the phone"): everything that can go goes as it stands; what cannot be sent at all is
    // listed, and one button removes it from the phone
    const wipe = [];
    const cant = (text, remove) => { lines.push([text, true, true]); wipe.push(remove); };
    try {
      if (!farm) farm = await getKV('farm');
      const kv = await allKV();
      const groups = (await loadGroups()).flatMap(g => g.hub ? [g, ...(g.zones || [])] : [g]);
      // 1. the scouting drafts
      const allTasks = await all('tasks');
      const scoutVer = (groups.find(x => (x.generation_key || x.members?.[0]?.generation_key || '').startsWith('routine:scouting:')) || {}).sop_version_id
        || (allTasks.find(x => String(x.generation_key || '').startsWith('routine:scouting:')) || {}).sop_version_id || null;
      for (const row of kv.filter(r => String(r.id).startsWith('scout2:'))) {
        const draft = row.v || {}, key = String(row.id).slice(7);
        const photos = draft.photos || [];
        if (!photos.length) continue;
        const g = groups.find(x => String(x.key || x.id) === key);
        const fresh = photos.filter(q => q.section !== 'trap' && q.full instanceof Blob && !q.sent);
        // the trap sides taken on this phone and not sent yet: [trap, side key, side]
        const sidesAll = photos.filter(q => q.section === 'trap').flatMap(q => Object.entries(q.sides || {})
          .filter(([, S]) => S && S.full instanceof Blob && !S.sent).map(([k, S]) => [q, k, S]));
        // none is sent any more (0260): the traps are read in Digital scouting, where the AI counts the card — a trap photo
        // of a round of before carries the phone's own count
        const sides = [];
        const trapsLeft = sidesAll.length;
        // its task left the list (cancelled, replanned, older than a week): the photos still go (0.11.90, owner: "how to
        // recover these pics") — on that task when the server still has it, else on a run with no task, which Naked Heart
        // shows under the day's zones by the position written on each photo
        let lone = null;
        if (!g) {
          const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(key);
          lone = (m && allTasks.find(x => x.id === m[0])) || (m ? { id: m[0] } : {});
        }
        const name = g ? (g.area || g.title || 'Scouting') : `A scouting no longer in the list${lone.area ? ' (' + lone.area + ')' : ''}`;
        const noScale = fresh.filter(q => q.section === 'growth' && !q.px_per_mm);
        const go = fresh;                                   // forced: a growth photo without the scale card goes too, with no sizes
        if (go.length || sides.length) {
          try {
            const t = g ? (g.members.find(m => m.status !== 'done') || g.members[0]) : lone;
            let d = null;
            if (t.id) { try { d = await api('/rest/v1/rpc/run_detail', { method: 'POST', body: JSON.stringify({ p_task: t.id }) }); } catch (e) { d = null; } }
            if (!g && !d) t.id = null;                                   // the server no longer has the task
            const done = (d?.status || t.status) === 'done';
            const now = new Date().toISOString();
            const cid = d?.run?.client_run_id || draft.cid || ('run-' + (t.id || 'recovered') + '-' + Date.now());
            const payload = {
              farm_id: t.farm_id || farm.id, task_id: t.id || null, sop_version_id: t.sop_version_id || g?.sop_version_id || scoutVer,
              ...(g?.extraZone ? { extra: true, extra_items: g.extraItems || [] } : {}),
              client_run_id: cid, status: done ? 'completed' : 'partial',
              started_at: d?.run?.started_at || [...go.map(q => q.taken_at), ...sides.map(([q, , S]) => S.taken_at || q.taken_at)].filter(Boolean).sort()[0] || now,
              finished_at: d?.run?.finished_at || now,
              ...(sides.length ? { traps: sides.map(([q, k, S]) => ({ trap_id: q.trap_id || null, code: q.code, side: k, colour: k,
                photo_data: S.thumb || null, photo_path: S.photo_path || null,
                counts: S.counts || {}, total: S.total ?? 0, algo_total: S.algo_total ?? null, algorithm: S.algorithm || null, confidence: S.confidence ?? null,
                corrected: !!S.corrected, replaced: !!q.replaced, new_card: !!q.new_card, lower_ok: !!S.lower_ok, reference: !!S.reference,
                notes: q.note || null, note_level: noteLevelOf(q), read_at: S.taken_at || q.taken_at, code_read: q.code_read || null,
                code_source: q.code_source || null, code_confirmed: !!q.code_ok, gps: null, ai: S.ai || null })) } : {}),
              observations: go.map(q => ({ client_ref: q.ref, section: q.section, part: q.part || 'other', crop_id: q.crop_id || null,
                zone_id: q.zone_id || t.zone_id || (g?.extraZone ? g.zone_id || null : null), item_id: q.item_id || (g?.extraZone ? g.positions?.[0]?.id || null : null), note: q.note || null, note_level: noteLevelOf(q), photo_data: q.thumb || null, photo_path: q.photo_path || null, taken_at: q.taken_at,
                pos_code: parsePos(String(q.pos_code || '').toUpperCase().replace(/\s/g, '')) ? String(q.pos_code).toUpperCase().replace(/\s/g, '') : null,
                gps: null, measures: (q.measures || []).filter(m => m.by !== 'auto' || m.confirmed), px_per_mm: q.px_per_mm ?? null, ai: q.ai || null })),
            };
            await api('/rest/v1/rpc/submit_run', { method: 'POST', body: JSON.stringify({ p: payload }) });
            // the full photos follow through the outbox; the draft keeps what it sent and the run it went to
            const ups = [...sides.filter(([, , S]) => !S.photo_path).map(([q, k, S]) => ({ kind: 'trap', ref: `${q.code}:${k}`, blob: S.full })),
                         ...go.filter(q => !q.photo_path).map(q => ({ kind: 'observation', ref: q.ref, blob: q.full }))];
            // through queueRows (0.11.146): packed on an iPhone, with a revision, as Finish's rows
            await queueRows(ups.map((u, n) => ({ id: `${cid}~up-${Date.now().toString(36)}-s${String(n).padStart(3, '0')}`, tries: 0, at: Date.now() + n,
              payload: { __upload: true, client_run_id: `${cid}~up-s${n}`, run_client_id: cid, farm_id: payload.farm_id, kind: u.kind, ref: u.ref, blob: u.blob } })));
            go.forEach(q => { q.sent = true; });
            sides.forEach(([, , S]) => { S.sent = true; });
            draft.cid = cid;
            await setKV(row.id, draft);
            const what = [go.length ? `${go.length} plant photo${go.length === 1 ? '' : 's'}` : null,
                          sides.length ? `${sides.length} trap side${sides.length === 1 ? '' : 's'} with ${sides.length === 1 ? 'its count' : 'their counts'}` : null].filter(Boolean).join(' and ');
            say(`${name}: ${what} sent${noScale.length ? ` (${noScale.length} growth without the scale card: no sizes)` : ''}${done ? '' : ' — the report is in, not finished: Finish still closes the task'}.`);
          } catch (e) { say(`${name}: ${go.length + sides.length} photo${go.length + sides.length === 1 ? '' : 's'} not sent — ${String(e.message || e).replace(/^\d+ /, '').slice(0, 110)}`, true); }
        }
        // a trap photo of the round is not sent (0260): it is removed, and the trap read again in Digital scouting
        if (trapsLeft) cant(`${name}: ${trapsLeft} trap photo${trapsLeft === 1 ? '' : 's'} cannot be sent — traps are read in Digital scouting now.`, async () => {
          const dr = await getKV(row.id);
          if (!dr) return;
          (dr.photos || []).forEach(q => { if (q.section === 'trap') Object.entries(q.sides || {}).forEach(([k, S]) => {
            if (S && !S.sent) delete q.sides[k]; }); });
          dr.photos = (dr.photos || []).filter(q => q.section !== 'trap' || Object.keys(q.sides || {}).length);
          await setKV(row.id, dr);
        });
      }
      // 1b. the checklists started and not finished, as they stand (0.11.89, owner 2 Oct 2026: "go, just for dev, after
      // will lock it again"): the answers given so far and their photos, on a run kept `partial` — the task stays open and
      // Finish completes the same run. DEV: half a checklist in the records is not a checklist done; to be locked again.
      const allSteps = await all('steps');
      for (const row of kv.filter(r => String(r.id).startsWith('rundraft:'))) {
        const draft = row.v || {}, key = String(row.id).slice(9);
        if (draft.sentSaved && draft.sentSaved === draft.saved) continue;       // nothing new since it was sent
        const g = groups.find(x => String(x.key || x.id) === key);
        const answers = (draft.answers || []).filter(([, a]) => a && (a.result || a.value_num != null || (a.value_text != null && a.value_text !== '')));
        const media = new Map(draft.media || []);
        if (!answers.length && !media.size) continue;
        if (!g) { cant(`A checklist whose task is gone holds ${answers.length} answer${answers.length === 1 ? '' : 's'} — it cannot be sent.`, () => del('kv', row.id)); continue; }
        const name = [g.title, g.area].filter(Boolean).join(' · ') || 'Checklist';
        try {
          const t = g.members.find(m => m.status !== 'done') || g.members[0];
          let d = null;
          try { d = await api('/rest/v1/rpc/run_detail', { method: 'POST', body: JSON.stringify({ p_task: t.id }) }); } catch (e) { d = null; }
          const done = (d?.status || t.status) === 'done';
          const ver = t.sop_version_id || g.sop_version_id;
          const stepOf = seq => allSteps.find(x => x.version_id === ver && Number(x.seq) === Number(seq));
          const at = new Date(draft.saved || Date.now()).toISOString(), now = new Date().toISOString();
          const keys = new Set([...answers.map(([k]) => String(k)), ...[...media.keys()].map(String)]);
          const steps = [...keys].map(k => {
            const a = (answers.find(([x]) => String(x) === k) || [0, {}])[1];
            const [itemId, seqTxt] = k.includes('|') ? k.split('|') : [null, k];
            const seq = a.seq ?? Number(seqTxt);
            const blobs = (media.get(k) || media.get(Number(k)) || []).filter(f => f instanceof Blob);
            return { ...a, seq, step_id: a.step_id || stepOf(seq)?.id || null, item_id: a.item_id || itemId || null,
                     result: a.result || (blobs.length ? 'ok' : null), media: [], ...(blobs.length ? { media_blobs: blobs } : {}), recorded_at: at };
          }).filter(x => Number.isFinite(x.seq) && stepOf(x.seq));
          if (!steps.length) continue;
          const cid = d?.run?.client_run_id || draft.cid || ('run-' + t.id + '-' + Date.now());
          const payload = { farm_id: t.farm_id || farm.id, task_id: t.id, sop_version_id: ver, client_run_id: cid,
            status: done ? 'completed' : 'partial', started_at: d?.run?.started_at || at, finished_at: d?.run?.finished_at || now,
            steps, notes: draft.runNote || null };
          // through the outbox: its photos go up first, then the run (the same road as Finish)
          await queueRows([{ id: cid, payload, tries: 0, at: Date.now() }]);
          await setKV(row.id, { ...draft, cid, sentSaved: draft.saved });
          say(`${name}: ${steps.length} answer${steps.length === 1 ? '' : 's'} sent as ${steps.length === 1 ? 'it stands' : 'they stand'}${done ? '' : ' — not finished: Finish still closes the task'}.`);
        } catch (e) { say(`${name}: not sent — ${String(e.message || e).replace(/^\d+ /, '').slice(0, 110)}`, true); }
      }
      // 1c. never forced (0.11.108): a harvest weight is a record — it closes a batch on a last cut and is taken once per
      // task and batch, so a half-typed one could not be corrected by Finish afterwards; an old trap round without a
      // count would read as zero insects. They are finished in their task, or removed. A feedback draft goes as written.
      for (const row of kv.filter(r => /^(harvdraft|trapdraft):/.test(String(r.id)))) {
        const isHarv = String(row.id).startsWith('harvdraft:'), key = String(row.id).replace(/^(harvdraft|trapdraft):/, '');
        const draft = row.v || {};
        const n = isHarv ? (draft.rows || []).filter(x => Number(x.kg) > 0 || x.final || x.added).length   // an added batch still to weigh too
                         : (draft.traps || []).filter(x => x.photo_data != null).length;
        if (!n) { try { await del('kv', row.id); } catch (e) { /* nothing in it */ } continue; }
        const g = groups.find(x => String(x.key || x.id) === key);
        const what = isHarv ? `${n} harvest weight${n === 1 ? '' : 's'}` : `${n} trap reading${n === 1 ? '' : 's'}`;
        cant(g ? `${[g.title, g.area].filter(Boolean).join(' · ')}: ${what} started and not finished — not forced: open the task and press Finish, or remove ${n === 1 ? 'it' : 'them'}.`
               : `${what} of a task no longer in the list cannot be sent.`, () => del('kv', row.id));
      }
      for (const row of kv.filter(r => String(r.id).startsWith('fbkdraft:'))) {
        const draft = row.v || {}, key = String(row.id).slice(9);
        const items = (draft.items || []).filter(x => x && x.blob instanceof Blob);
        const text = String(draft.note || '').trim();
        if (!text && !items.length) { try { await del('kv', row.id); } catch (e) { /* nothing in it */ } continue; }
        try {
          const g = groups.find(x => String(x.key || x.id) === key);
          const me = await getKV('me');
          const id = 'fbk-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
          await queueRows([{ id, tries: 0, at: Date.now(), payload: { __feedback: true, client_run_id: id, farm_id: g?.farm_id || farm?.id,
            task_id: g?.members?.[0]?.id || null, task_title: g?.title || null, sop_id: g?.sop_id || null, sop_version_id: g?.sop_version_id || null,
            step_seq: draft.step ? Number(draft.step) : null, note: text || null,
            author: (await all('workers')).find(w => w.id === me)?.name || session?.user?.email || null,
            app: 'brain', app_version: typeof CURRENT_VERSION !== 'undefined' ? CURRENT_VERSION : null, device: navigator.userAgent.slice(0, 180),
            sent_at: new Date().toISOString(), items: items.map(x => ({ kind: x.kind, blob: x.blob, seconds: x.seconds ?? null })) } }]);
          await del('kv', row.id);
          say(`A feedback draft${g?.title ? ' on ' + g.title : ''} sent as written.`);
        } catch (e) { say(`A feedback draft not sent — ${String(e.message || e).slice(0, 110)}`, true); }
      }
      for (const row of kv.filter(r => String(r.id).startsWith('ghdraft:'))) {
        const draft = row.v || {}, [farmId, day] = String(row.id).slice(8).split(':');
        const items = (draft.items || []).filter(x => x && x.blob instanceof Blob);
        const text = String(draft.note || '').trim();
        if (!text && !items.length) { try { await del('kv', row.id); } catch (e) { /* nothing in it */ } continue; }
        try {
          const me = await getKV('me');
          const id = ghNoteId();
          await queueRows([{ id, tries: 0, at: Date.now(), payload: { __ghnote: true, client_run_id: id, farm_id: farmId || farm?.id, day: day || todayISO(),
            text: text || null, scout_task_id: null, extra: false,
            author: (await all('workers')).find(w => w.id === me)?.name || session?.user?.email || null,
            app: 'brain', app_version: typeof CURRENT_VERSION !== 'undefined' ? CURRENT_VERSION : null,
            sent_at: new Date().toISOString(), items: items.map(x => ({ kind: 'audio', blob: x.blob, seconds: x.seconds ?? null })) } }]);
          await del('kv', row.id);
          say('A note about the whole greenhouse sent as written.');
        } catch (e) { say(`A whole-greenhouse note not sent — ${String(e.message || e).slice(0, 110)}`, true); }
      }
      // 2. the outbox: what was set aside goes back in, the photos go on any connection
      const before = await all('outbox');
      if (before.some(r => r.dead)) await putAll('outbox', before.filter(r => r.dead).map(r => ({ ...r, dead: false })));
      uploadForce = true;
      try { await flush(); await flush(); } finally { uploadForce = false; }
      const after = await all('outbox');
      const went = before.length - after.filter(r => before.some(b => b.id === r.id)).length;
      if (went > 0) say(`${went} item${went === 1 ? '' : 's'} went up (reports and their full photos).`);
      // what the server answered and said no to (set aside, or an error with a status) cannot go by trying again: it is
      // offered for removal. What never reached the server (no signal, a time-out) waits for the next Send.
      // 0.11.146: only a refusal for good — a 5xx, 429 or 401 last time is the server's trouble or a sign-in, and goes later
      const said = r => r.dead || refusedForGood({ message: r.error });
      const refused = after.filter(said), left = after.filter(r => !said(r));
      if (left.length) say(`${left.length} still waiting for a connection — press Send everything now again.`, true);
      refused.forEach(r => cant(`${/^410 /.test(String(r.error || '')) ? 'Cannot be sent' : 'Refused by the server'}: ${String(r.error || 'no reason given').replace(/^\d+ /, '').slice(0, 140)}`, () => del('outbox', r.id)));
      if (!lines.length) say('Nothing was waiting on this phone: everything had already been sent.');
      sync(false, true).catch(() => {});
    } catch (e) { say('Send stopped: ' + String(e.message || e).slice(0, 140), true); }
    btn.disabled = false; nbLabel(btn, '{i:upload} Send all');
    paintFoot();
    const sheet = el('div', 'fb-sheet');
    const box = el('div', 'fb-sheet-card');
    box.append(el('h3', null, 'Sent from this phone'));
    const ul = el('ul', 'fb-sendlist');
    lines.forEach(([text, bad, gone]) => { const li = el('li', bad ? 'bad' : null, text); if (gone) li.dataset.cant = '1'; ul.append(li); });
    const ok = el('button', 'fb-btn fb-btn-primary', 'Close'); ok.type = 'button'; ok.onclick = () => sheet.remove();
    const acts = el('div', 'fb-actions'); acts.append(ok);
    if (wipe.length) {
      // what cannot be sent can only be removed — one tap, and the phone holds nothing it cannot send
      const rm = el('button', 'fb-btn', `Remove ${wipe.length === 1 ? 'it' : 'these ' + wipe.length} from this phone`); rm.type = 'button';
      rm.onclick = async () => {
        rm.disabled = true;
        let n = 0;
        for (const remove of wipe) { try { await remove(); n++; } catch (e) { console.warn('remove:', e); } }
        ul.querySelectorAll('li[data-cant]').forEach(li => li.remove());
        ul.append(el('li', null, `${n} removed from this phone.`));
        rm.remove(); paintFoot();
      };
      acts.append(rm);
    }
    box.append(ul, acts);
    sheet.append(box);
    sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
    document.body.append(sheet);
  }

  async function paintFoot() {
    const all_ = await all('outbox');
    const dead = all_.filter(r => r.dead), rows = all_.filter(r => !r.dead);
    const photos = rows.filter(r => r.payload?.__upload || r.payload?.__gallery).length;
    const pending = rows.length - photos;
    const at = await getKV('synced_at');
    const foot = $('foot');
    foot.textContent = [
      at ? 'Synced ' + new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not synced yet',
      pending ? `${pending} waiting to upload` : null,
      photos ? `${photos} photo${photos > 1 ? 's' : ''} ${uploadAllowed() ? 'still uploading' : 'waiting for Wi-Fi'}` : null,
      dead.length ? `${dead.length} could not be sent — tap to try again` : null
    ].filter(Boolean).join(' · ');
    foot.classList.toggle('fb-foot-bad', !!dead.length);
    // "could not be sent" sat under a week of cards, where nobody looked: above the list while something is set
    // aside, back at the bottom once nothing is
    try { const at = dead.length ? $('next') : $('empty'); if (at && foot.previousElementSibling !== at) at.after(foot); } catch (e) { /* stays where it is */ }
    foot.title = dead.map(r => r.error).filter(Boolean).join('\n');
    // tap: the rows set aside go back in the queue once more (0.11.55)
    foot.onclick = dead.length ? async () => { await putAll('outbox', dead.map(r => ({ ...r, dead: false }))); flush(); } : null;
  }

  function paintAccount() {
    const row = document.getElementById('fb-accountRow');
    if (!row) return;
    row.style.display = session ? '' : 'none';
    const who = document.getElementById('fb-account');
    if (who) who.textContent = session?.user?.email || '';
  }


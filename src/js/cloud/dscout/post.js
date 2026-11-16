//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- Digital scouting: the post and a case from a post. Edit here, then run: python build.py
  // ── the post: the photo large, the AI's reading with Agree / Disagree, the conversation, a comment at the bottom ──
  // where an item is in what was read: its farm, its zone, its kind
  function dgFindItem(id) {
    for (const [farmId, fd] of DG.data) {
      for (const u of ((fd && fd.rep) || {}).units || []) {
        const ph = (u.photos || []).find(x => x.id === id), tr = ph ? null : (u.traps || []).find(x => x.id === id);
        if (ph || tr) return { p: ph || tr, kind: ph ? 'observation' : 'trap', farmId, unitId: u.unit_id || u.zone_id };
      }
    }
    // (0.11.134) a post of the feed, of any of its last days: the answer on screen first
    for (const k of [dgFeedKey(), ...DG.feed.answers.keys()]) {
      const A = DG.feed.answers.get(k), p = ((A && A.items) || []).find(x => x.id === id);
      if (p) return { p, kind: p.kind === 'trap' ? 'trap' : 'observation', farmId: A.farm_id || k.split(':')[0], unitId: p.zone_id || null, feed: true };
    }
    // the post on screen, as it was when opened: a re-read feed may have moved it off its pages (verified green, a vote
    // taken back, past the period) — it stays open
    if (DG.post && DG.post.id === id && DG.post.found) return DG.post.found;
    return null;
  }
  // every copy of an item that was read (the day's report, the feed's answers): a new count goes on all of them
  function dgCopies(id) {
    const out = [];
    for (const fd of DG.data.values()) for (const u of ((fd && fd.rep) || {}).units || []) [...(u.photos || []), ...(u.traps || [])].forEach(x => { if (x.id === id) out.push(x); });
    for (const A of DG.feed.answers.values()) ((A && A.items) || []).forEach(x => { if (x.id === id) out.push(x); });
    const kept = DG.post && DG.post.id === id && DG.post.found && DG.post.found.p;   // the open post's own copy
    if (kept && !out.includes(kept)) out.push(kept);
    return out;
  }
  function dgPatchSocial(id, s) {
    dgCopies(id).forEach(x => { x.social = s; });
    if (DG.post && DG.post.id === id && DG.post.thread) DG.post.thread.social = s;
  }
  // one comment's reactions as the server answered them: the AI's reading, the photographer's note, a comment, a chat message
  function dgPatchReactions(T, target, tid, r) {
    if (target === 'ai') T.ai_reactions = r;
    else if (target === 'own') { if (T.own) T.own.reactions = r; }
    else (T.thread || []).forEach(x => { if (x.id === tid && (target === 'note' ? x.type === 'note' : x.type !== 'note')) x.reactions = r; });
  }
  async function dgOpenPost(id, from = 'zone') {
    const f = dgFindItem(id);
    if (!f) { showToast('This photo is not in the report any more', 'error'); return; }
    if (DG.page === 'zone') DG.zoneY = window.scrollY;
    if (DG.page === 'feed') DG.feed.y = window.scrollY;
    DG.page = 'post';
    if (from !== 'feed') DG.unitKey = { farmId: f.farmId, unitId: f.unitId };
    const P = DG.post = { kind: f.kind, id, from, thread: DG.threads.get(id) || null, sig: '', stale: false, asking: new Set(), found: f };
    // (0.11.142) when this post was last opened on this phone: the comments since are marked new
    let seen = {};
    try { seen = (await getKV('dg_seen')) || {}; } catch (e) { seen = {}; }
    P.seenAt = seen[id] || null;
    await dgPaintPost();
    show('task', f.kind === 'trap' ? `Trap ${shortCode(f.p.code)}` : 'Photo', () => dgLeavePost());
    await dgReadThread();
    if (DG.post === P && !P.stale && P.thread) {
      seen[id] = new Date().toISOString();
      const keep = Object.entries(seen).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 300);   // the last 300 posts
      setKV('dg_seen', Object.fromEntries(keep)).catch(() => {});
    }
    if (DG.post === P && dgOpen() && !document.querySelector('.fb-sheet, .fb-cam, .fb-viewer')) { await dgPaintPost(); DG.lastSig = await dgPageSig(); }
  }
  // back from the post: to the zone where it was left, to the feed at its place and sort, or to the photos waiting for
  // my opinion
  async function dgLeavePost() {
    const P = DG.post; DG.post = null;
    if (P && P.from === 'requests') { DG.page = 'requests'; await dgPaintRequests(); $('title').textContent = 'Your opinion'; window.scrollTo(0, 0); return; }
    if (P && P.from === 'feed') {
      await dgPaintFeed(); $('title').textContent = 'Digital scouting'; window.scrollTo(0, DG.feed.y || 0);
      // a vote, a comment, a verification or a case made from the post: the feed read again (its place kept, dgSwap)
      if (DG.feed.dirty) await dgFeedAgain();
      return;
    }
    DG.page = 'zone';
    await dgPaintZone();
    const u = DG.unitKey ? dgUnit(DG.unitKey.farmId, DG.unitKey.unitId) : null;
    $('title').textContent = u?.name || 'Zone';
    window.scrollTo(0, DG.zoneY || 0);
  }
  // the conversation of the post (dg_photo_thread): kept as read last when there is no signal
  async function dgReadThread() {
    const P = DG.post;
    if (!P) return;
    if (!navigator.onLine || !session) { P.stale = true; return; }
    try {
      const t = await dgRpc('dg_photo_thread', { p_kind: P.kind, p_id: P.id });
      if (DG.post !== P) return;
      P.thread = t; P.sig = JSON.stringify(t); P.stale = false; DG.threads.set(P.id, t);
    } catch (e) { if (DG.post === P) P.stale = true; }
  }
  // a face, or the first letter of the name; the G1's for the AI
  function dgFace(workerId, name, ai) {
    if (ai) return dgG1Face();
    if (workerId && WORKERS.has(workerId)) return faceOf(workerId);
    const s = el('span', 'dg-init'); s.textContent = (String(name || '').trim()[0] || '?').toUpperCase();
    return s;
  }
  // the full photo from the evidence bucket, on the person's own sign-in; its small copy without signal
  async function dgFullPhoto(p, img, title) {
    if (img.classList.contains('loading')) return;
    const small = img.getAttribute('src');
    if (p.photo_path && navigator.onLine && session) {
      img.classList.add('loading');
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const cut = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
      let big = null;
      try {
        const r = await fetch(URL_BASE + '/storage/v1/object/authenticated/evidence/' + p.photo_path,
                              { headers: { apikey: ANON, Authorization: 'Bearer ' + session.access_token }, ...(ctl ? { signal: ctl.signal } : {}) });
        if (r.ok) big = await r.blob();
      } catch (e) { big = null; }
      finally { clearTimeout(cut); img.classList.remove('loading'); }
      if (big && big.size) { photoViewer(big, { title }); return; }
    }
    if (small) photoViewer(small, { title });
  }
  async function dgPaintPost() {
    const P = DG.post;
    const box = dgBox();
    const f = P ? dgFindItem(P.id) : null;
    if (!f) { box.append(el('div', 'config-hint', 'This photo is not in the report any more.')); dgSwap(box); return; }
    const { p, kind, farmId } = f;
    const D0 = dgFarmData(farmId).dg;
    // a post of another day, from the feed: the day's rule of who may change it is that day's, not the page's
    const D = f.feed && D0 ? { ...D0, is_today: (p.day || dgDayOf(p.taken_at)) === todayISO() } : D0;
    const pend = (await dgPending()).filter(r => r.payload.view.farm_id === farmId);
    const mine = pend.filter(r => r.payload.view.ref_id === p.id);
    const { it, removing, edit } = dgEdited(p, mine);
    const T = P.thread && P.thread.id === p.id ? P.thread : null;
    const post = el('div', 'dg-post');
    // the photo, large: a tap opens it full size, with zoom
    const title = kind === 'trap' ? `Trap ${shortCode(p.code)}` : 'Plant photo';
    const img = el('img', 'dg-post-img'); img.alt = title; img.dataset.thumb = p.id;
    { const t0 = dgThumb(p.id, p.photo_data); if (t0) img.src = t0; }
    img.onclick = () => dgFullPhoto(p, img, title);
    post.append(img);
    // who · zone · part (or trap and side) · time
    const zone = dgUnit(farmId, f.unitId)?.name || p.zone || null;
    // a feed post says no section (dg_post_json): its part only
    const noSection = !!f.feed && !it.section;
    const what = kind === 'trap' ? [`Trap ${shortCode(it.code)}`, it.side].filter(Boolean).join(' · ')
                                 : [noSection ? null : it.section === 'growth' ? 'Growth' : 'Plant health', dgPartWord(it.part)].filter(Boolean).join(' · ');
    const head = el('div', 'dg-post-head');
    head.append(el('b', null, [p.by ? firstName(p.by) : null, zone, what, dgWhen(p.taken_at)].filter(Boolean).join(' · ')));
    const more = kind === 'trap' ? [dgTrapFigure(it), p.reference ? 'reference photo' : null]
                                 : [(it.measures || []).map(m => `${m.what} ${m.mm} mm`).join(', ') || null];
    more.push(removing ? 'deleting — sending' : Object.keys(edit).length ? 'change sending' : null);
    if (more.some(Boolean)) head.append(el('div', 'fb-meta', more.filter(Boolean).join(' · ')));
    post.append(head);
    // a card the AI could not count (0260): who may change it types the count here — the person's figure, the rates follow
    if (kind === 'trap' && !removing && dgNeedsCount(it) && dgMayChange(p, D)) post.append(dgCountRow(it, farmId));
    // what the item view had: Ask someone; Change, the section and Delete by who may
    if (!removing) {
      const acts = el('div', 'fb-actions dg-acts');
      const ab = el('button', 'fb-btn', '{i:user} Ask someone'); ab.type = 'button'; ab.onclick = () => dgAskSheet(kind, p, farmId);
      acts.append(ab);
      if (dgMayChange(p, D)) {
        if (kind === 'observation' && !noSection) {
          const to = it.section === 'growth' ? 'health' : 'growth';
          const sw = el('button', 'fb-btn', it.section === 'growth' ? 'Is plant health' : 'Is growth'); sw.type = 'button';
          sw.title = 'Move it to ' + (to === 'growth' ? 'Growth' : 'Plant health');
          sw.onclick = () => dgQueue({ rpc: 'dg_edit_item', args: { p: { kind, id: p.id, section: to } }, chain: 'dg:' + p.id,
                                      view: { kind: 'edit', farm_id: farmId, ref_id: p.id, fields: { section: to } } });
          acts.append(sw);
        }
        const ch = el('button', 'fb-btn', '{i:pencil} Change'); ch.type = 'button'; ch.onclick = () => dgChangeSheet(kind, it, farmId);
        const del = el('button', 'fb-link', 'Delete'); del.type = 'button';
        del.onclick = async () => {
          if (!confirm(kind === 'trap' ? 'Delete this trap photo? It goes to Removed photos.' : 'Delete this photo? It goes to Removed photos.')) return;
          await dgQueue({ rpc: 'remove_photo', args: { p_kind: kind, p_id: p.id, p_reason: 'Deleted on the phone (Digital scouting)' }, chain: 'dg:' + p.id,
                          view: { kind: 'remove', farm_id: farmId, ref_id: p.id } });
          if (DG.page === 'post' && DG.post === P) history.back();          // back on the zone, the photo marked as deleting
        };
        acts.append(ch, del);
      }
      post.append(acts);
    }
    // (0.11.142, FarmBox 0261) the post as a comment flow, as in a social app (owner 23 Oct 2026: "First comment by ai
    // (initially summarized in one line and with the complete explanation under), second comment is the human note done
    // by the user take the pic, other comments by users … every body can like, dislike, pensive each comment"): the AI's
    // reading, the verified diagnosis when there is one, the note of who took the photo, then everybody's comments with
    // the AI's answers under the comment they answer — each with its reactions
    const ai = T ? T.ai : dgAiDone(kind, p) ? (kind === 'trap' ? { species: p.species, total: p.ai_total, notes: p.ai_notes } : p.ai) : null;
    const social = dgSocialWith(T ? T.social : p.social, dgPendReact(mine, 'ai', null), dgPendNotes(mine)) || dgSocialWith({}, undefined, 0);
    const thread = T ? (T.thread || []) : (Array.isArray(p.notes) ? p.notes : []).map(n => ({ type: 'note', ...n }));
    const V = social.verified && typeof social.verified === 'object' ? social.verified : null;
    // who may verify (a manager or the agronomist) and who may open a case (everybody but workers and trainees): the
    // post's own answer when read, else the feed's
    const feedSays = flag => [...DG.feed.answers.values()].some(A => A && A.farm_id === farmId && A[flag]);
    const mayVerify = T && 'may_verify' in T ? !!T.may_verify : feedSays('may_verify');
    const mayCase = T && 'may_case' in T ? !!T.may_case : feedSays('may_case');
    if (mayCase && !removing) {
      const zoneId = p.zone_id || dgUnit(farmId, f.unitId)?.zone_id || null;
      const ca = el('div', 'fb-actions dg-acts dg-case-acts');
      const oc = el('button', 'fb-btn', '{i:alert} Open a case'); oc.type = 'button'; oc.onclick = () => dgCaseOpen(kind, p, farmId, zoneId);
      const ac = el('button', 'fb-btn', 'Add to a case'); ac.type = 'button'; ac.onclick = () => dgCaseAdd(kind, p, farmId, zoneId);
      ca.append(oc, ac);
      post.append(ca);
    }
    // the note of who took the photo: the thread's when read (with its reactions), else the photo's own; a change still
    // sending wins
    const own0 = T && T.own ? T.own : null;
    const ownWords = String(('note' in edit ? it.note : own0 ? own0.body : it.note) || '').trim();
    const own = ownWords ? { ...(own0 || { by: p.by, worker_id: p.worker_id, by_user: p.by_user, at: p.taken_at }), type: 'own', body: ownWords,
                             level: 'note' in edit ? it.note_level : own0 ? own0.level : it.note_level } : null;
    const pendNotes = mine.filter(r => r.payload.view.kind === 'note');
    const n = thread.length + (own ? 1 : 0) + pendNotes.filter(r => !r.dead).length;
    post.append(el('div', 'fb-sec dg-h', n ? `Comments · ${n}` : 'Comments'));
    if (!T || P.stale) post.append(el('div', 'fb-meta', navigator.onLine && session ? (T ? 'Could not be read again — as read before.' : 'Reading the comments…')
                                                                                  : 'No signal: the comments as read before.'));
    const list = el('div', 'dg-thread');
    const ctx = { P, kind, p, farmId, D, pend, mayVerify, verifiedId: V ? V.id : null, removing };
    list.append(dgAiMsg(kind, ai, T, social, ctx));
    // (0.11.134) the verified diagnosis: the comment a manager or the agronomist marked, right under the AI's reading,
    // in full when the conversation has it
    if (V) {
      const full = thread.find(x => x.type === 'note' && x.id === V.id);
      const vb = el('div', 'dg-post-verified' + (NOTE_LEVELS.some(([v]) => v === V.level) ? ' r-' + V.level : ''));
      vb.append(el('div', 'fb-sec', 'Verified diagnosis'));
      const w = el('div', 'dg-ai-text'); w.textContent = (full && (full.body || full.transcript)) || V.body || ''; vb.append(w);
      vb.append(el('div', 'fb-meta', [V.by ? firstName(V.by) : null, V.verified_by ? 'verified by ' + firstName(V.verified_by) : 'verified'].filter(Boolean).join(' · ')));
      list.append(vb);
    }
    if (own) list.append(dgPostMsg(own, 0, ctx));
    dgThreadOrder(thread).forEach(({ item, depth }) => list.append(dgPostMsg(item, depth, ctx)));
    pendNotes.forEach(r => list.append(dgPendingMsg(r)));
    post.append(list);
    // a comment of my own, typed or held to record: posted, or posted and asked to the AI or someone of the team
    if (!removing) {
      const w = el('button', 'btn btn-block dg-write', '{i:message} Write a comment'); w.type = 'button';
      w.onclick = async () => {
        const r = await dgNoteSheet(kind, p, farmId);
        if (r && r.ai && DG.post === P) { await dgReadThread(); await dgAskAi(P, kind, p, r.ai); }
        else if (r && r.ask != null) dgAskSheet(kind, p, farmId, r.ask);
      };
      post.append(w, el('div', 'fb-meta dg-write-hint', 'Typed, or hold to record. Post it, or post it and ask the AI (a short answer at once) or someone of the team.'));
    }
    box.append(post);
    dgSwap(box);
  }
  // the AI's reading, first in the flow: one line — its findings by gravity and the first sentence of what it says — and
  // the whole reading under "See the full reading"; reactions as on any comment (they replace Agree / Disagree)
  function dgAiMsg(kind, ai, T, social, ctx) {
    const { P, p } = ctx;
    const m = el('div', 'dg-msg ai dg-ai-reading');
    if (!ai) {
      const b0 = dgBlock(null, dgG1Face(), 'Not read by the AI yet');
      b0.lastChild.prepend(el('span', 'dg-msg-who', 'AI'));
      m.append(b0);
      return m;
    }
    const chip = dgAiChips(kind, kind === 'trap' ? { ai_status: 'done', species: ai.species } : { ai_status: 'done', ai })[0] || null;
    const first = dgFirstSentence(kind === 'trap' ? ai.notes : ai.summary);
    const line = [chip ? chip.text.replace(/^AI: /, '') : null, first].filter(Boolean).join(' — ');
    const b = dgBlock(chip ? chip.level : null, dgG1Face(), line || (kind === 'trap' ? 'No insect named.' : 'Nothing it could name.'));
    b.lastChild.prepend(el('span', 'dg-msg-who', 'AI · the reading'));
    m.append(b);
    // the whole reading, as it was the post's section until 0.11.141
    const full = el('div', 'dg-ai-full'); full.hidden = !P.aiOpen;
    if (kind === 'trap') {
      const sp = dgInsectsByGravity(Array.isArray(ai.species) ? ai.species : []);      // the pests first (0.11.137)
      if (sp.length) {
        const row = el('div', 'dg-tags');
        sp.forEach(x => row.append(dgBlock(x.beneficial ? 'green' : 'yellow', dgG1Face(), `${x.common || x.name || 'insect'}${x.count != null ? ' ' + x.count : ''}`,
                                           { title: x.name && x.common && x.name !== x.common ? x.name : '' })));
        full.append(row);
      }
      if (ai.total != null) full.append(el('div', 'dg-ai-text', `About ${ai.total} insect${ai.total === 1 ? '' : 's'}.`));
      if (ai.notes) { const t = el('div', 'dg-ai-text'); t.textContent = ai.notes; full.append(t); }
    } else {
      if (ai.summary) { const s = el('div', 'dg-ai-text'); s.textContent = ai.summary; full.append(s); }
      const fs = dgByGravity(Array.isArray(ai.findings) ? ai.findings : []).map(o => o.x);      // the most serious first (0.11.137)
      if (!fs.length && ai.healthy !== false) full.append(dgBlock('green', dgG1Face(), 'Healthy'));
      fs.forEach(x => {
        const r = el('div', 'dg-finding');
        r.append(dgBlock(dgRisk(x.severity, x.kind), dgG1Face(), `${x.name || x.code}${x.severity != null && DG_SEV[x.severity] ? ' · ' + DG_SEV[x.severity] : ''}`));
        if (x.evidence) { const e = el('span', 'fb-meta'); e.textContent = x.evidence; r.append(e); }
        full.append(r);
      });
      const rest = [ai.stage ? `Stage: ${ai.stage}.` : '', (ai.measures || []).length ? 'Sizes: ' + ai.measures.map(x => `${x.what} ${x.mm} mm`).join(', ') + '.' : '', ai.recommendation || ''].filter(Boolean).join(' ');
      if (rest) { const s = el('div', 'dg-ai-text'); s.textContent = rest; full.append(s); }
      if (ai.quality && ai.quality !== 'ok') full.append(el('div', 'fb-meta', 'The photo is ' + ai.quality));
    }
    const acts = el('div', 'dg-msg-acts');
    acts.append(dgReactRow(ctx, 'ai', null, T && T.ai_reactions ? T.ai_reactions : social.ai));
    if (full.childNodes.length) {
      const tog = el('button', 'fb-link dg-ai-tog', P.aiOpen ? 'Hide the full reading' : 'See the full reading'); tog.type = 'button';
      tog.onclick = () => { P.aiOpen = !P.aiOpen; full.hidden = !P.aiOpen; tog.textContent = P.aiOpen ? 'Hide the full reading' : 'See the full reading'; };
      acts.append(tog);
    }
    m.append(acts, full);
    return m;
  }
  // like, dislike, not sure under a comment: mine pressed, the same again takes it back; "Who" lists them
  function dgReactRow(ctx, target, tid, server) {
    const { kind, p, farmId, pend, D, removing } = ctx;
    const r = dgReactWith(server, dgPendReact(pend.filter(x => x.payload.view.ref_id === p.id), target, tid));
    const row = el('span', 'dg-react');
    DG_REACTS.forEach(([k, emo, word]) => {
      const b = document.createElement('button'); b.className = 'dg-rb' + (r.mine === k ? ' on' : ''); b.type = 'button';
      b.textContent = r[k] ? `${emo} ${r[k]}` : emo;
      b.setAttribute('aria-pressed', String(r.mine === k));
      b.setAttribute('aria-label', word + (r[k] ? ' · ' + r[k] : ''));
      b.disabled = !!removing || !D;
      b.onclick = () => dgReact(kind, p, farmId, target, tid, r.mine, k);
      row.append(b);
    });
    if (r.who.length) {
      const w = el('button', 'fb-link dg-who', 'Who'); w.type = 'button';
      w.onclick = () => dgSheet('Reactions', (card, done) => {
        r.who.forEach(x => { const e = (DG_REACTS.find(([k]) => k === x.reaction) || [0, ''])[1]; card.append(el('div', 'dg-who-line', `${e}  ${firstName(x.by) || x.by || 'Somebody'}`)); });
        const c = el('button', 'fb-btn', 'Close'); c.type = 'button'; c.onclick = () => done(null);
        const a = el('div', 'fb-actions'); a.append(c); card.append(a);
      });
      row.append(w);
    }
    return row;
  }
  // one message of the flow: the note of who took the photo, a comment, a question asked to the AI (in Naked Heart's
  // chat, or "More detail" here), or an AI answer — each with its reactions
  function dgPostMsg(n, depth, ctx) {
    const { P, kind, p, farmId, D, pend, mayVerify = false, verifiedId = null } = ctx;
    const isAi = n.type === 'ai', isNote = n.type === 'note', isOwn = n.type === 'own';
    // the verified diagnosis (0.11.134): by the photo's counts when they say one, else by the comment itself
    const verified = isNote && !!n.id && (verifiedId ? n.id === verifiedId : !!n.verified_at);
    const m = el('div', 'dg-msg' + (isAi ? ' ai' : '') + (isOwn ? ' own' : '') + (depth ? ' reply' : '') + (verified ? ' verified' : ''));
    const gone = isNote && pend.some(r => r.payload.view.kind === 'note-delete' && r.payload.view.note_id === n.id);
    const editedTo = isNote ? pend.filter(r => r.payload.view.kind === 'note-edit' && r.payload.view.note_id === n.id).pop() : null;
    const words = editedTo ? editedTo.payload.view.body : (n.body || n.transcript || '');
    // a comment or the photographer's note without a colour reads as yellow, as on Naked Heart; a question and an AI
    // answer have none
    const lv = isNote || isOwn ? (NOTE_LEVELS.some(([v]) => v === n.level) ? n.level : 'yellow') : null;
    const b = dgBlock(lv, dgFace(n.worker_id, n.by, isAi), words);
    const t = b.lastChild;
    const who = el('span', 'dg-msg-who');
    who.textContent = [isAi ? 'AI' : (firstName(n.by) || 'Somebody'), isOwn ? 'took the photo' : null, dgWhen(n.at)].filter(Boolean).join(' · ');
    // new since this post was last opened on this phone, not mine
    if (P.seenAt && n.at && new Date(n.at) > new Date(P.seenAt) && !(D && D.me && n.by_user === D.me)) who.append(el('span', 'dg-new', ' · new'));
    t.prepend(who);
    if (n.audio_path) {
      const play = el('button', 'fb-link', '{i:play} Listen'); play.type = 'button';
      play.onclick = () => dgPlay(n.audio_path, play);
      t.append(document.createTextNode(words ? ' ' : ''), play);
      if (!n.transcript && n.voice_status !== 'done' && n.voice_status !== 'failed') t.append(el('span', 'dg-sending', ' writing it down…'));
    }
    m.append(b);
    const acts = el('div', 'dg-msg-acts');
    if (!gone && (isOwn || n.id)) acts.append(dgReactRow(ctx, isOwn ? 'own' : isNote ? 'note' : 'chat', isOwn ? null : n.id, n.reactions));
    // an AI answer is short by default: more on it on request
    if (isAi && n.id) {
      if (P.asking.has('more:' + n.id)) acts.append(el('span', 'dg-sending', 'The AI is answering…'));
      else { const mo = el('button', 'fb-link', 'More detail'); mo.type = 'button'; mo.onclick = () => dgMoreDetail(P, kind, p, n); acts.append(mo); }
    }
    if (isNote) {
      if (verified) acts.append(el('span', 'dg-tagline dg-vtag', n.verified_by ? 'Verified by ' + firstName(n.verified_by) : 'Verified diagnosis'));
      if (n.asked_ai) acts.append(el('span', 'dg-tagline', 'sent to the AI'));
      if (gone) acts.append(el('span', 'dg-sending', 'deleting'));
      else {
        // a manager or the agronomist marks it as the photo's verified diagnosis, or takes that back
        if (mayVerify && n.id) {
          const v = el('button', 'fb-link', verified ? 'Unverify' : 'Verify'); v.type = 'button';
          v.onclick = () => dgVerify(P, n, !verified);
          acts.append(v);
        }
        // my comment, once posted: I decide whether the AI or somebody of the team should see it
        if (n.id && D && D.me && n.by_user === D.me) {
          if (P.asking.has(n.id)) acts.append(el('span', 'dg-sending', 'The AI is answering…'));
          else if (!n.asked_ai) {
            const a = el('button', 'fb-link', 'Ask the AI'); a.type = 'button';
            if (!String(n.body || n.transcript || '').trim()) { a.disabled = true; a.title = 'Once the voice note is written down'; }
            a.onclick = () => dgAskAi(P, kind, p, n);
            acts.append(a);
          }
          const s = el('button', 'fb-link', 'Ask someone'); s.type = 'button';
          s.onclick = () => dgAskSheet(kind, p, farmId, words);
          acts.append(s);
        }
        if (dgNoteMayChange(n, D, todayISO())) {
          const ch = el('button', 'fb-link', 'Change'); ch.type = 'button';
          ch.onclick = () => dgNoteEdit(n, farmId);
          const del = el('button', 'fb-link', 'Delete'); del.type = 'button';
          del.onclick = () => { if (!confirm('Delete this comment?')) return;
            dgQueue({ rpc: 'dg_delete_note', args: { p_id: n.id }, chain: 'dg:' + n.id, view: { kind: 'note-delete', farm_id: farmId, ref_id: p.id, note_id: n.id } }); };
          acts.append(ch, del);
        }
      }
    }
    if (acts.childNodes.length) m.append(acts);
    return m;
  }
  // a comment of mine still on this phone
  function dgPendingMsg(r) {
    const v = r.payload.view;
    const m = el('div', 'dg-msg sending');
    const b = dgBlock(v.level || 'yellow', dgFace(null, 'You'), v.body || (v.audio ? 'Voice note' : ''));
    const who = el('span', 'dg-msg-who', 'You · ');
    who.append(el('span', 'dg-sending' + (r.dead ? ' bad' : ''), r.dead ? 'could not be sent' : 'sending'));
    b.lastChild.prepend(who);
    m.append(b);
    return m;
  }
  // a reaction: the same again takes it back. Through the outbox, on its own chain a comment: a later one replaces one
  // still waiting — the earlier row is taken out, and a row already on its way goes first on the same chain (as the
  // votes did, 0.11.133)
  async function dgReact(kind, p, farmId, target, tid, mine, pressed) {
    const reaction = dgNextReaction(mine, pressed);
    const same = x => x.payload && x.payload.__dg && x.payload.rpc === 'dg_react' && x.payload.view && x.payload.view.ref_id === p.id
                      && x.payload.view.target === target && (x.payload.view.target_id || null) === (tid || null);
    try { for (const r of (await all('outbox')).filter(same)) await del('outbox', r.id); }
    catch (e) { /* kept: both go, in order, and the later one stays */ }
    await dgQueue({ rpc: 'dg_react', args: { p: { kind, ref_id: p.id, target, target_id: tid || null, reaction } },
                    chain: 'dg:react:' + p.id + ':' + target + ':' + (tid || ''),
                    view: { kind: 'react', farm_id: farmId, ref_id: p.id, target, target_id: tid || null, reaction } });
  }
  // more on a short AI answer: asked to the AI as a question of mine in the flow, the long answer under it
  async function dgMoreDetail(P, kind, p, n) {
    if (!navigator.onLine || !session) { showToast('Needs signal', 'error'); return; }
    const key = 'more:' + n.id;
    if (P.asking.has(key)) return;
    P.asking.add(key);
    if (DG.post === P) await dgPaintPost();
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const cut = ctl ? setTimeout(() => ctl.abort(), 120000) : null;
    const said = dgFirstSentence(n.body);
    try {
      const r = await api('/functions/v1/photo-chat', { method: 'POST', body: JSON.stringify({ kind, id: p.id,
        message: `More detail, please, on your answer${said ? ': "' + said + '"' : ''}` }), ...(ctl ? { signal: ctl.signal } : {}) });
      if (r && r.error) throw new Error(r.error);
    } catch (e) { showToast('The AI did not answer: ' + dgWhy(e), 'error'); }
    finally { clearTimeout(cut); P.asking.delete(key); }
    DG.feed.dirty = true;
    if (DG.post !== P) return;
    await dgReadThread();
    if (DG.post === P && dgOpen() && !document.querySelector('.fb-sheet, .fb-cam, .fb-viewer')) await dgPaintPost();
    dgSoon(300);
  }
  // a comment of mine sent to the AI, on my word only (photo-chat, a short answer kept under that comment)
  async function dgAskAi(P, kind, p, n) {
    if (!navigator.onLine || !session) { showToast('Needs signal', 'error'); return; }
    if (P.asking.has(n.id)) return;
    P.asking.add(n.id);
    if (DG.post === P) await dgPaintPost();
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const cut = ctl ? setTimeout(() => ctl.abort(), 120000) : null;
    try {
      const r = await api('/functions/v1/photo-chat', { method: 'POST', body: JSON.stringify({ kind, id: p.id, note_id: n.id, brief: true }), ...(ctl ? { signal: ctl.signal } : {}) });
      if (r && r.error) throw new Error(r.error);
    } catch (e) {
      // the function answers {"ok":false,"error":"…"}; 409: answered already (by another phone, or after this one gave up)
      let why = String((e && e.message) || e).replace(/^\d+ /, '');
      try { const j = JSON.parse(why); if (j && j.error) why = String(j.error); } catch (e2) { /* plain words already */ }
      if (!/^409 /.test(String((e && e.message) || ''))) showToast('The AI did not answer: ' + why.slice(0, 120), 'error');
    } finally { clearTimeout(cut); P.asking.delete(n.id); }
    DG.feed.dirty = true;
    if (DG.post !== P) return;
    await dgReadThread();
    if (DG.post === P && dgOpen() && !document.querySelector('.fb-sheet, .fb-cam, .fb-viewer')) await dgPaintPost();
    dgSoon(300);                                   // the card's counts on the zone page
  }
  // what the server said, in its own words: PostgREST answers "400 {"message": …}"
  function dgWhy(e) {
    let why = String((e && e.message) || e || '').replace(/^\d{3} /, '');
    try { const j = JSON.parse(why); if (j && (j.message || j.error)) why = String(j.message || j.error); } catch (e2) { /* plain words already */ }
    return why.slice(0, 120);
  }
  // (0.11.134) a comment marked as its photo's verified diagnosis, or unmarked (dg_verify_note): a manager or the
  // agronomist, with signal — not left in the outbox: the next person reads the post as it is now. The photo's new
  // counts go on its cards at once, as a vote's do (dgSent); the conversation is read again
  async function dgVerify(P, n, on) {
    if (!navigator.onLine || !session) { showToast('Needs signal', 'error'); return; }
    if (P.verifying) return;
    P.verifying = true;
    try {
      const s = await dgRpc('dg_verify_note', { p: { note_id: n.id, on } });
      if (s && typeof s === 'object') dgPatchSocial(P.id, s);
      showToast(on ? 'Verified: it now stands under the AI\'s reading' : 'No longer the verified diagnosis', 'success');
    } catch (e) { showToast((on ? 'Not verified: ' : 'Still verified: ') + dgWhy(e), 'error'); }
    finally { P.verifying = false; }
    DG.feed.dirty = true;
    if (DG.post !== P) return;
    await dgReadThread();
    if (DG.post === P && dgOpen() && !document.querySelector('.fb-sheet, .fb-cam, .fb-viewer')) await dgPaintPost();
    dgSoon(300);
  }

  // ── a case from a post (0.11.134; Naked Heart's "Open a case from this photo" and "Add to this case"): everybody but
  // workers and trainees (may_case), with signal; the photo becomes a point on the case's curve ──
  const DG_CASE_KINDS = [['pest', 'Pest'], ['disease', 'Disease'], ['disorder', 'Disorder']];
  const dgSevChips = o => dgChips(DG_SEV.map((w, i) => [String(i), w]), () => o.sev, v => { o.sev = v; });
  async function dgCaseOpen(kind, p, farmId, zoneId) {
    if (!navigator.onLine || !session) { showToast('Needs signal', 'error'); return null; }
    let cat;
    try { cat = DG.catalog || (DG.catalog = await dgRpc('pest_catalog', {})); }
    catch (e) { showToast('The list of pests could not be read: ' + dgWhy(e), 'error'); return null; }
    const list = (Array.isArray(cat) ? cat : []).filter(c => c && DG_CASE_KINDS.some(([k]) => k === c.kind));
    if (!list.length) { showToast('The list of pests is empty', 'error'); return null; }
    const guess = dgCaseGuess(kind, p);
    // the AI's pest when the catalogue knows it; otherwise nothing chosen — a case is not opened on the list's first pest
    const o = { code: list.some(c => c.code === guess.code) ? guess.code : '', sev: String(guess.severity) };
    const r = await dgSheet('Open a case from this ' + (kind === 'trap' ? 'trap photo' : 'photo'), (card, done) => {
      card.append(el('div', 'fb-meta', 'The photo becomes the first point of the case.'));
      const sel = el('select', 'fb-num dg-select'); sel.setAttribute('aria-label', 'What it is');
      const none = document.createElement('option'); none.value = ''; none.textContent = 'Choose what it is'; sel.append(none);
      DG_CASE_KINDS.forEach(([k, word]) => {
        const g = document.createElement('optgroup'); g.label = word;
        list.filter(c => c.kind === k).forEach(c => { const op = document.createElement('option'); op.value = c.code; op.textContent = c.label || c.code; g.append(op); });
        if (g.childNodes.length) sel.append(g);
      });
      sel.value = o.code; sel.onchange = () => { o.code = sel.value; };
      const ta = el('textarea', 'fb-runnote'); ta.rows = 2; ta.placeholder = 'What was seen, how widespread (optional)';
      const ok = el('button', 'fb-btn fb-btn-primary', 'Open the case'), no = el('button', 'fb-btn', 'Cancel'); ok.type = no.type = 'button';
      let sending = false;
      ok.onclick = async () => {
        if (sending) return;
        if (!sel.value) { showToast('Choose what it is first', 'error'); return; }
        if (!navigator.onLine || !session) { showToast('Needs signal', 'error'); return; }
        sending = true; ok.disabled = true;
        try {
          const c = await dgRpc('open_case', { p: { farm_id: farmId, code: sel.value, severity: Number(o.sev), note: ta.value.trim(),
                                                    zone_id: zoneId || null, from_kind: kind, from_id: p.id } });
          showToast('Case opened' + (c && c.title ? ': ' + c.title : ''), 'success');
          done(c || true);
        } catch (e) { sending = false; ok.disabled = false; showToast('The case was not opened: ' + dgWhy(e), 'error'); }
      };
      no.onclick = () => done(null);
      const acts = el('div', 'fb-actions'); acts.append(ok, no);
      card.append(sel, el('div', 'fb-meta', 'How bad now'), dgSevChips(o), ta, acts);
    });
    if (r) { DG.feed.dirty = true; dgSoon(300); }    // its risk dot changes
    return r;
  }
  async function dgCaseAdd(kind, p, farmId, zoneId) {
    if (!navigator.onLine || !session) { showToast('Needs signal', 'error'); return null; }
    let cs;
    try { cs = (((await dgRpc('cases', { p_farm: farmId, p_include_closed: false })) || {}).cases || []).filter(c => c && c.status !== 'closed'); }
    catch (e) { showToast('The cases could not be read: ' + dgWhy(e), 'error'); return null; }
    if (!cs.length) { showToast('No open case on this farm — open one from this photo', 'info'); return null; }
    // the cases of the photo's zone first
    cs = cs.map((c, i) => [c, i]).sort((a, b) => ((b[0].zone_id === zoneId && !!zoneId) - (a[0].zone_id === zoneId && !!zoneId)) || a[1] - b[1]).map(([c]) => c);
    const o = { id: null, sev: String(dgCaseGuess(kind, p).severity) };
    const r = await dgSheet('Add this ' + (kind === 'trap' ? 'trap photo' : 'photo') + ' to a case', (card, done) => {
      const box = el('div', 'dg-cases');
      const paint = () => [...box.childNodes].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === o.id)));
      cs.forEach(c => {
        const b = el('button', 'fb-btn'); b.type = 'button'; b.dataset.v = c.id;
        b.textContent = (c.title || c.label || 'Case') + (zoneId && c.zone_id === zoneId ? ' · this zone' : '');
        b.onclick = () => { o.id = c.id; paint(); };
        box.append(b);
      });
      paint();
      const ok = el('button', 'fb-btn fb-btn-primary', 'Add'), no = el('button', 'fb-btn', 'Cancel'); ok.type = no.type = 'button';
      let sending = false;
      ok.onclick = async () => {
        if (sending) return;
        if (!o.id) { showToast('Choose a case', 'error'); return; }
        if (!navigator.onLine || !session) { showToast('Needs signal', 'error'); return; }
        sending = true; ok.disabled = true;
        try {
          await dgRpc('add_case_point', { p_case: o.id, p_kind: kind, p_ref: p.id, p_severity: Number(o.sev), p_count: null, p_note: null });
          const c = cs.find(x => x.id === o.id);
          showToast('Added to the case' + (c && c.title ? ': ' + c.title : '') + ' — it is on its curve', 'success');
          done(true);
        } catch (e) { sending = false; ok.disabled = false; showToast('Not added: ' + dgWhy(e), 'error'); }
      };
      no.onclick = () => done(null);
      const acts = el('div', 'fb-actions'); acts.append(ok, no);
      card.append(box, el('div', 'fb-meta', 'How bad on this photo'), dgSevChips(o), acts);
    });
    if (r) { DG.feed.dirty = true; dgSoon(300); }
    return r;
  }
  // a recording of the evidence bucket, played on the person's own sign-in
  async function dgPlay(path, btn) {
    if (!navigator.onLine || !session) { showToast('Listening needs signal', 'error'); return; }
    btn.disabled = true;
    try {
      const r = await fetch(URL_BASE + '/storage/v1/object/authenticated/evidence/' + path, { headers: { apikey: ANON, Authorization: 'Bearer ' + session.access_token } });
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch (e) { showToast('This recording could not be played', 'error'); }
    finally { btn.disabled = false; }
  }


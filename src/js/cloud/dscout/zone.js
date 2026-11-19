//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- Digital scouting: a zone. Edit here, then run: python build.py
  // ── a zone ──
  async function dgZone(farmId, unitId) {
    // the trap photos start folded in each zone opened (they stay as left while the page is read again)
    DG.page = 'zone'; DG.unitKey = { farmId, unitId }; DG.post = null;
    await dgPaintZone();
    const u = dgUnit(farmId, unitId);
    // Back with something still missing (today): said first — Stay keeps the page
    show('task', u?.name || 'Zone', () => dgLeaveZone());
  }
  async function dgLeaveZone() {
    const { farmId, unitId } = DG.unitKey || {};
    const D = dgFarmData(farmId).dg;
    const views = (await dgPending()).filter(r => !r.dead && r.payload.view.farm_id === farmId && r.payload.view.unit_id === unitId).map(r => r.payload.view);
    const u = dgWithPending(dgUnit(farmId, unitId), views);
    const miss = D && D.is_today && u ? dgMissing(u).text : '';
    // back on the day: the phone's step back is already taken, its entry (Back = leave Digital scouting) stays
    const go = async () => { DG.page = 'day'; DG.unitKey = null; $('title').textContent = 'Digital scouting'; await dgPaintDay(); window.scrollTo(0, 0); };
    if (!miss) return go();
    const sheet = el('div', 'fb-sheet'), card = el('div', 'fb-sheet-card');
    card.append(el('h3', null, 'Leave this zone?'), el('div', 'fb-meta', miss));
    const stay = el('button', 'fb-btn fb-btn-primary', 'Stay'), leave = el('button', 'fb-btn', 'Leave');
    stay.type = leave.type = 'button';
    // the phone's Back has already gone a step: Stay puts the step back, so the next Back asks again
    const restay = () => { sheet.remove(); backStack.push(() => dgLeaveZone()); history.pushState({ fb: 'task', depth: backStack.length }, ''); };
    // Back once more over this question is Leave: the popstate handler puts back the step it takes, so Back after it
    // closes Digital scouting as expected
    stay.onclick = restay; sheet._close = () => { sheet.remove(); go(); };
    leave.onclick = () => { sheet.remove(); go(); };
    const acts = el('div', 'fb-actions'); acts.append(stay, leave); card.append(acts);
    sheet.append(card); document.body.append(sheet);
  }
  // the items of a unit: the report's, with what this phone has not sent yet on top
  function dgThumb(id, fallback) { return DG.thumbs.get(id) || fallback || ''; }
  async function dgPaintZone() {
    const { farmId, unitId } = DG.unitKey || {};
    const fd = dgFarmData(farmId), D = fd.dg, u = dgUnit(farmId, unitId), ru = dgRepUnit(farmId, unitId);
    const box = dgBox();
    if (!D || !u) { box.append(el('div', 'config-hint', 'This zone could not be read.')); dgSwap(box); return; }
    const pend = (await dgPending()).filter(r => r.payload.view.farm_id === farmId);
    const pendHere = pend.filter(r => r.payload.view.unit_id === unitId);
    const hero = el('div', 'hero');
    hero.append(el('h1', null, u.name || 'Zone'), el('p', null, fmtDay(DG.day) + (fd.stale ? ' · no signal, as read before' : '')));
    box.append(hero);
    if (u.task_id && DG.unsent.some(x => x.key === 'srv:' + u.task_id)) box.append(dgUnsentBox(DG.unsent.filter(x => x.key === 'srv:' + u.task_id)));
    const adds = pendHere.filter(r => !r.dead && ['photo', 'trap'].includes(r.payload.view.kind)).length;
    const uNow = dgWithPending(u, pendHere.filter(r => !r.dead).map(r => r.payload.view));    // as it will be once sent
    box.append(dgCounterLine(uNow, adds ? `${adds} sending` : ''));
    const miss = dgMissing(uNow).text;
    if (miss && D.is_today) box.append(el('div', 'fb-meta dg-missline', miss));
    const canAdd = dgCanAdd(D), canFile = dgCanFile(D);
    if (canAdd) {
      const add = el('button', 'btn btn-primary btn-lg btn-block', '{i:camera} Add a photo');
      add.onclick = () => dgAddPhoto(farmId, u, ru);
      box.append(add);
    }
    // after the walk: photos from the phone's gallery, several at once, each into the day it was taken (0.11.150)
    if (canFile) {
      const gal = el('button', 'btn btn-block' + (canAdd ? '' : ' btn-primary btn-lg'), '{i:image} Add photos from the gallery');
      gal.onclick = () => dgAddFromGallery(farmId, u, ru);
      box.append(gal);
    }

    // the traps of the unit: one row of chips, nothing under them (owner 22 Oct 2026: "remove the traps collapsed line,
    // traps pics could be added and seen by clicking on the trap id … remove the double colour trap dot, just a yellow
    // and blue dots and the dots trap box will change from red to green when both pics are collected, remove also the 6
    // of 6 text"): a chip is red until every side is in, green after, grey when not read today; its dots are the card's
    // sides, filled once photographed. A tap photographs a trap with no photo yet, else opens its photos (dgTrapGallery);
    // how many traps are done is in the counter line on top
    const tl = (u.traps || {}).list || [];
    const tlNow = (uNow.traps || {}).list || [];
    const traps = (ru?.traps || []).slice().sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)));
    const tPend = pendHere.filter(r => r.payload.view.kind === 'trap');
    if (tl.length || traps.length || tPend.length) {
      box.append(el('div', 'fb-sec dg-h', 'Traps'));
      if (tl.length) {
        const chips = el('div', 'dg-tchips');
        tl.forEach(t0 => {
          const t = tlNow.find(x => x.trap_id === t0.trap_id) || t0;       // as it will be once this phone has sent its photos
          const waiting = pendHere.filter(r => r.payload.view.trap_id === t0.trap_id);
          const shots = dgTrapShots(t0, traps, tPend);
          const st = dgTrapState(t);
          const b = el('button', 'dg-tchip ' + st + (waiting.some(r => r.dead) ? ' bad' : waiting.length ? ' wait' : ''));
          b.type = 'button';
          b.append(el('b', null, dgTrapName(t)));
          const dots = el('span', 'dg-dots');
          dgTrapDots(t).forEach(d => dots.append(el('span', 'dg-sdot ' + d.state + ' ' + (d.side || (t.colour === 'blue' ? 'blue' : 'yellow')))));
          b.append(dots);
          b.title = [dgTrapName(t), ...dgTrapDots(t).map(d => (d.side ? d.side + ' side: ' : '') + ({ ok: 'photographed', todo: 'to photograph', skip: 'not read today' }[d.state])),
                     t.skipped && t.skipped !== 'sending' ? 'not read: ' + t.skipped : null,
                     waiting.length ? (waiting.some(r => r.dead) ? 'could not be sent' : 'sending') : null].filter(Boolean).join(' · ');
          b.setAttribute('aria-label', b.title);
          b.disabled = !canFile && !shots.length && !(D.may_change_all && t.skipped);
          b.onclick = () => (canFile && !shots.length && !t.skipped ? dgReadTrap(farmId, u, ru, t0, !canAdd) : dgTrapGallery(farmId, u, ru, t0, t, D, shots, pend));
          chips.append(b);
        });
        box.append(chips);
      }
      // a trap photo of no chip here (a trap moved or retired since): its card, as before
      const lone = traps.filter(p => !tl.some(t0 => dgTrapOf(p, t0))), lonePend = tPend.filter(r => !tl.some(t0 => t0.trap_id === r.payload.view.trap_id));
      lonePend.forEach(r => box.append(dgPendingCard(r)));
      lone.forEach(p => box.append(dgItemCard('trap', p, farmId, D, pend)));
    }

    // the photos: plant health first, then growth, the newest first
    const photos = (ru?.photos || []).slice();
    const pPend = pendHere.filter(r => r.payload.view.kind === 'photo');
    const bySec = sec => photos.filter(p => (p.section === 'growth') === (sec === 'growth')).sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)));
    for (const [sec, label] of [['health', 'Plant health'], ['growth', 'Growth']]) {
      const items = bySec(sec), waiting = pPend.filter(r => (r.payload.view.section === 'growth') === (sec === 'growth'));
      if (!items.length && !waiting.length) continue;
      box.append(el('div', 'fb-sec dg-h', `${label} · ${items.length + waiting.length}`));
      waiting.forEach(r => box.append(dgPendingCard(r)));
      items.forEach(p => box.append(dgItemCard('observation', p, farmId, D, pend)));
    }
    if (!photos.length && !traps.length && !pPend.length && !tPend.length) box.append(el('div', 'config-hint', canAdd ? 'Nothing yet today: add a photo or tap a trap.' : canFile ? 'Nothing on this day yet: add its photos from the gallery, or tap a trap.' : 'Nothing on this day.'));
    dgSwap(box);
  }
  // a report's trap photo belongs to a chip's trap: by the trap's id when the photo carries it, else by its code
  const dgTrapOf = (p, t0) => (p.trap_id && t0.trap_id ? p.trap_id === t0.trap_id : p.code === t0.code);
  // a trap's photos of the day: this phone's own still sending first, then the sides in their order (yellow, blue), the
  // newest first within a side
  const DG_SIDE_ORDER = { yellow: 0, blue: 1 };
  function dgTrapShots(t0, traps, tPend) {
    const sent = (traps || []).filter(p => dgTrapOf(p, t0))
      .sort((a, b) => ((DG_SIDE_ORDER[a.side] ?? 2) - (DG_SIDE_ORDER[b.side] ?? 2)) || String(b.taken_at).localeCompare(String(a.taken_at)))
      .map(p => ({ p }));
    return [...(tPend || []).filter(r => r.payload.view.trap_id === t0.trap_id).map(r => ({ r })), ...sent];
  }
  // a trap's photos as a gallery (owner 22 Oct 2026: "when open a trap pic you can see the other one in a gallery
  // style"): one beside the other, a swipe from side to side, each with its count, the AI's and the people's blocks
  // and the comments; a tap opens it as a post. Under them: photograph a side, not read today (or that undone)
  async function dgTrapGallery(farmId, u, ru, t0, t, D, shots, pend) {
    const canAdd = dgCanAdd(D), canFile = dgCanFile(D), name = dgTrapName(t);
    const out = await dgSheet(`Trap ${name}`, (card, done) => {
      const sides = dgTrapDots(t).map(d => (d.side ? d.side[0].toUpperCase() + d.side.slice(1) + ' side ' : '')
        + ({ ok: 'photographed', todo: 'to photograph', skip: 'not read today' }[d.state]));
      card.append(el('div', 'fb-meta', [...sides, t.skipped && t.skipped !== 'sending' ? t.skipped : null].filter(Boolean).join(' · ')));
      if (shots.length) {
        const gal = el('div', 'dg-gal');
        shots.forEach(({ p, r }) => {
          const g = el('div', 'dg-gal-item' + (r ? ' pending' : ' tap'));
          const img = el('img', 'dg-gal-img'); img.alt = '';
          if (r) {
            const v = r.payload.view;
            if (v.thumb) img.src = v.thumb;
            g.append(img, el('b', null, [v.side ? v.side + ' side' : null, dgTrapFigure({ total: v.total, corrected: !!v.corrected, sending: true })].filter(Boolean).join(' · ')),
                     el('div', 'fb-meta', r.dead ? 'could not be sent' : 'sending'));
          } else {
            const mine = pend.filter(x => x.payload.view.ref_id === p.id);
            const { it } = dgEdited(p, mine);
            g.dataset.ref = p.id;
            img.dataset.thumb = p.id;
            { const t1 = dgThumb(p.id, p.photo_data); if (t1) img.src = t1; }
            g.append(img, el('b', null, dgItemTitle('trap', it, p)), el('div', 'fb-meta', [dgHm(p.taken_at), p.by ? firstName(p.by) : null].filter(Boolean).join(' · ')));
            const blocks = dgChipRow('trap', p, it);
            if (blocks) g.append(blocks);
            const sl = dgSocialText(dgSocialWith(p.social, dgPendReact(mine, 'ai', null), dgPendNotes(mine)));
            if (sl) g.append(el('div', 'dg-social', sl));
            g.setAttribute('role', 'button'); g.tabIndex = 0;
            g.onclick = () => done({ post: p.id });
            g.onkeydown = e => { if (e.key === 'Enter') done({ post: p.id }); };
          }
          gal.append(g);
        });
        card.append(gal);
        if (shots.length > 1) card.append(el('div', 'fb-meta', 'Swipe for the other photo · tap one to open it'));
      }
      const acts = el('div', 'fb-actions');
      const btn = (label, v, primary) => { const b = el('button', 'fb-btn' + (primary ? ' fb-btn-primary' : ''), label); b.type = 'button'; b.onclick = () => done(v); acts.append(b); };
      if (canFile && !t.skipped) {
        const todo = dgTrapDots(t).filter(d => d.state === 'todo'), ic = canAdd ? '{i:camera} ' : '{i:image} ';
        btn(t.colour === 'both' ? (todo.length ? `${ic}The ${todo.map(d => d.side).join(' and ')} side` : `${ic}A side again`)
                                : (todo.length ? (canAdd ? `${ic}Photograph it` : `${ic}Its photo from the gallery`) : `${ic}Again`), 'read', true);
      }
      if (canAdd || D.may_change_all) {
        if (t.skipped && t.skipped !== 'sending') btn('Read after all', 'unskip');
        else if (!t.skipped) btn('Not read today…', 'skip');
      }
      btn('Close', null);
      card.append(acts);
    });
    if (!out) return;
    if (out.post) return dgOpenPost(out.post, 'zone');
    if (out === 'read') return dgReadTrap(farmId, u, ru, t0, !canAdd);
    if (out === 'skip') return dgSkip(farmId, u, t0);
    if (out === 'unskip') return dgUnskip(farmId, u, t0);
  }
  // an item this phone made and has not sent yet
  function dgPendingCard(r) {
    const v = r.payload.view;
    const c = el('div', 'fb-step dg-item pending');
    const img = el('img', 'dg-img'); img.alt = ''; if (v.thumb) img.src = v.thumb;
    const txt = el('div', 'dg-text');
    txt.append(el('b', null, v.kind === 'trap' ? `Trap ${v.code || ''}${v.side ? ' · ' + v.side : ''} · ${dgTrapFigure({ total: v.total, corrected: !!v.corrected, sending: true })}${v.reference ? ' · reference' : ''}` : `${v.section === 'growth' ? 'Growth' : 'Plant health'}${v.part ? ' · ' + v.part : ''}`));
    txt.append(el('span', 'dg-sending' + (r.dead ? ' bad' : ''), r.dead ? 'could not be sent: ' + String(r.error || '').replace(/^\d+ /, '').slice(0, 90) : 'sending…'));
    if (v.note) { const n = el('div', 'fb-rv-comment'); const lv = noteLevelOf(v); if (lv) n.append(el('span', 'fb-risk-dot ' + lv)); n.append(document.createTextNode('“' + v.note + '”')); txt.append(n); }
    c.append(img, txt);
    return c;
  }
  // a photo or a trap reading of the report, as a compact card (0.11.133): what it is, when and who, the AI's chips and
  // the person's note as small coloured blocks, the counts of the conversation; a tap opens it as a post
  function dgEdited(p, mine) {
    const removing = mine.some(r => r.payload.view.kind === 'remove');
    const edit = mine.filter(r => r.payload.view.kind === 'edit').map(r => r.payload.view.fields || {}).reduce((a, x) => ({ ...a, ...x }), {});
    const it = { ...p, ...('section' in edit ? { section: edit.section } : {}), ...('part' in edit ? { part: edit.part } : {}),
                 ...('note' in edit ? { note: edit.note, note_level: edit.note_level } : {}), ...('total' in edit ? { total: edit.total, corrected: true } : {}) };
    return { it, removing, edit };
  }
  const dgPendNotes = mine => mine.filter(x => x.payload.view.kind === 'note' && !x.dead).length;
  const dgPartWord = part => (PARTS.find(x => x[0] === part) || GROWTH_PARTS.find(x => x[0] === part) || [0, part])[1];
  const dgHm = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  // a time on the page's own day as 10:25, any other with its date
  const dgWhen = iso => !iso ? '' : (dgDayOf(iso) === DG.day ? '' : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ') + dgHm(iso);
  // where a trap's figure comes from (counting v5, 0.11.138): the AI's count, the AI still counting, or typed by a
  // person — nothing said for an older reading. Since FarmBox 0260 (owner 23 Oct 2026: "why we want to have the phone
  // counting? we can remove it to avoid confusion") the phone sends no count of its own: a card (…-card.jpg) goes with
  // no figure and gets the AI's; "counting…" while the AI is still to count it (sending, queued, running, or no status
  // yet), "needs a count" when the AI could not (failed, or skipped after three tries) — a person types it then
  const dgCardOnly = it => /-card\.jpe?g$/i.test(String(it.photo_path || ''));
  const dgAiWaiting = it => it.ai_count_status == null || it.ai_count_status === 'queued' || it.ai_count_status === 'running';
  // no figure of a person or of the AI: none at all, or the phone's hidden placeholder on a card sent by 0.11.138–0.11.140
  // whose AI status is known (the report and, since 0258, a post carry it). An older reading counted on its whole photo
  // keeps its number, which the AI does not replace (0256)
  const dgNoFigure = it => !it.corrected && (it.total == null || (dgCardOnly(it) && 'ai_count_status' in it && it.ai_count_status !== 'done'));
  const dgCounting = it => !it.corrected && (!!it.sending || (dgNoFigure(it) && dgAiWaiting(it)));
  const dgNeedsCount = it => !it.sending && dgNoFigure(it) && !dgAiWaiting(it);
  const dgCountWord = it => it.corrected ? 'typed' : dgCounting(it) ? 'counting…' : dgNeedsCount(it) ? 'needs a count'
    : it.ai_count_status === 'done' ? (it.ai_count == null || it.ai_count === it.total ? 'AI' : '') : '';
  const dgTrapFigure = it => {
    if (dgCounting(it)) return 'counting…';
    if (dgNeedsCount(it) || it.total == null) return 'needs a count';
    const w = dgCountWord(it);
    return `${it.total} insect${it.total === 1 ? '' : 's'}${w ? ` (${w})` : ''}`;
  };
  function dgItemTitle(kind, it, p) {
    if (kind === 'trap') return [`Trap ${shortCode(it.code)}`, it.side, dgTrapFigure(it), p.reference ? 'reference photo' : null].filter(Boolean).join(' · ');
    return [it.section === 'growth' ? 'Growth' : 'Plant health', dgPartWord(it.part), (it.measures || []).map(m => `${m.what} ${m.mm} mm`).join(', ') || null].filter(Boolean).join(' · ');
  }
  // the AI's face: the G1's, as on Naked Heart (ui.js G1_SVG)
  const DG_G1_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#e3f6fa"/>'
    + '<path d="M4 66C6 54 18 50.5 32 50.5S58 54 60 66z" fill="#7d8b9b"/><path d="M24 46h16v9H24z" fill="#0b0e13"/>'
    + '<path d="M32 5.5c12.5 0 20.5 8.5 20.5 21 0 13-7.5 26-20.5 28.5C19 53.5 11.5 40.5 11.5 26.5 11.5 14 19.5 5.5 32 5.5z" fill="#0b0e13"/>'
    + '<path d="M19 15.5Q32 9.5 45 15.5C54 26 44 48 32 49.5 20 48 10 26 19 15.5z" fill="none" stroke="#3fe0ff" stroke-opacity=".28" stroke-width="5" stroke-linejoin="round"/>'
    + '<path d="M19 15.5Q32 9.5 45 15.5C54 26 44 48 32 49.5 20 48 10 26 19 15.5z" fill="#05070a" stroke="#4fe6ff" stroke-width="2" stroke-linejoin="round"/>'
    + '<circle cx="26" cy="19" r="1.1" fill="#1f7f99"/><circle cx="32" cy="18.3" r="1.1" fill="#1f7f99"/><circle cx="38" cy="19" r="1.1" fill="#1f7f99"/>'
    + '<path d="M22.5 25.5h19" fill="none" stroke="#9ff3ff" stroke-width="2.6" stroke-linecap="round"/>'
    + '<circle cx="32" cy="32.5" r="3.2" fill="#1a232f" stroke="#536478" stroke-width=".8"/><circle cx="32" cy="32.5" r="1.3" fill="#05070a"/>'
    + '<circle cx="33" cy="31.5" r=".5" fill="#cfe9ff"/></svg>';
  const dgG1Face = () => { const b = el('span', 'dg-g1'); b.innerHTML = DG_G1_SVG; b.title = 'The AI'; return b; };
  // one note as Naked Heart's block (0.11.136, owner 22 Oct 2026: the same look as Naked Heart for the AI's and the
  // people's notes): the risk colour, the face inside on the left, the words clamped to two lines under a picture
  function dgBlock(level, face, words, { clamp = false, title = '' } = {}) {
    const b = el('div', 'dg-block' + (level ? ' r-' + level : ''));
    const t = el('span', 'dg-block-text' + (clamp ? ' clamp' : '')); t.textContent = words;
    if (face) b.append(face);
    b.append(t);
    if (title) b.title = title;
    return b;
  }
  // under a picture: the AI's blocks (at most two) and the person's note, one under the other
  // under a picture, the start of its comment flow (0.11.143, owner 23 Oct 2026: "rule is to show up to the 3 first
  // comments"): the AI's comment, the note of who took the photo, then the team's first comments, three blocks at most
  const DG_CARD_COMMENTS = 3;
  function dgChipRow(kind, p, it) {
    const row = el('div', 'dg-tags');
    dgAiChips(kind, p).forEach(x => row.append(dgBlock(x.level, dgG1Face(), x.text.replace(/^AI: /, ''), { clamp: true, title: x.title || x.text })));
    const lv = noteLevelOf(it);
    if (lv) {
      const words = String(it.note).trim();
      row.append(dgBlock(lv, p.worker_id || p.by ? dgFace(p.worker_id, p.by) : null, words, { clamp: true, title: (p.by ? firstName(p.by) + ': ' : '') + words }));
    }
    dgFirstComments(p, DG_CARD_COMMENTS - row.childNodes.length).forEach(n => {
      const words = String(n.body || n.transcript || '').trim() || 'Voice note';
      row.append(dgBlock(NOTE_LEVELS.some(([v]) => v === n.level) ? n.level : 'yellow', dgFace(n.worker_id, n.by), words,
                         { clamp: true, title: (n.by ? firstName(n.by) + ': ' : '') + words }));
    });
    return row.childNodes.length ? row : null;
  }
  // the team's first comments of a photo, oldest first, as many as there is room for
  const dgFirstComments = (p, room) => room > 0 && Array.isArray(p && p.notes)
    ? p.notes.slice().sort((a, b) => (new Date(a.at).getTime() || 0) - (new Date(b.at).getTime() || 0)).slice(0, room) : [];
  function dgItemCard(kind, p, farmId, D, pend) {
    const mine = pend.filter(r => r.payload.view.ref_id === p.id);
    const { it, removing, edit } = dgEdited(p, mine);
    const c = el('div', 'fb-step dg-item' + (removing ? ' gone' : ''));
    c.dataset.ref = p.id;
    const img = el('img', 'dg-img'); img.alt = ''; img.dataset.thumb = p.id;
    { const t0 = dgThumb(p.id, p.photo_data); if (t0) img.src = t0; }
    const txt = el('div', 'dg-text');
    txt.append(el('b', null, dgItemTitle(kind, it, p)));
    txt.append(el('div', 'fb-meta', [dgHm(p.taken_at), p.by ? firstName(p.by) : null, removing ? 'deleting — sending' : Object.keys(edit).length ? 'change sending' : null].filter(Boolean).join(' · ')));
    const chips = dgChipRow(kind, p, it);
    if (chips) txt.append(chips);
    const s = dgSocialWith(p.social, dgPendReact(mine, 'ai', null), dgPendNotes(mine));
    const ver = dgVerifiedTag(s && s.verified);              // (0.11.134) the verified diagnosis, in short
    if (ver) txt.append(ver);
    const sl = dgSocialText(s);
    if (sl) txt.append(el('div', 'dg-social', sl));
    c.append(img, txt);
    if (!removing) {
      c.classList.add('tap'); c.setAttribute('role', 'button'); c.tabIndex = 0;
      c.onclick = () => dgOpenPost(p.id, 'zone');
      c.onkeydown = e => { if (e.key === 'Enter') dgOpenPost(p.id, 'zone'); };
    }
    return c;
  }


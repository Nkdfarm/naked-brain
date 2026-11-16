//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- Digital scouting: writing through the outbox, a plant photo, a trap. Edit here, then run: python build.py
  // ── writing: through the outbox, the file first, the phone's own id on every call ──
  async function dgQueue({ rpc, args, uploads = [], chain, view, voice = false }) {
    const id = 'dg-' + uuid();
    await queue({ __dg: true, client_run_id: id, rpc, args, uploads, chain: chain || ('dg:' + id), view, voice, day: DG.day || todayISO() });
    if (dgOpen()) { const y = window.scrollY; if (DG.page === 'zone') await dgPaintZone(); else if (DG.page === 'post') await dgPaintPost(); window.scrollTo(0, y); }
  }
  // the flush sent one: the page reads again (the report has it now, under its own id)
  function dgSent(u, res) {
    const data = u && u.args && u.args.p && u.args.p.photo_data;
    if (res && res.id && data && u.day === DG.day) { DG.thumbs.set(res.id, data); DG.asked.add(res.id); }
    // a vote answers with the photo's new counts: on its card and its post at once, before the report is read again
    // (0.11.134) on every copy read: the day's report and the feed's answers
    if (u && (u.rpc === 'dg_vote' || u.rpc === 'dg_react') && res && typeof res === 'object') {
      const ref = u.args && u.args.p && u.args.p.ref_id;
      if (ref) dgPatchSocial(ref, res);
      // (0.11.142) the comment's own reactions on the open post, before the conversation is read again
      if (u.rpc === 'dg_react' && res.reactions && DG.post && DG.post.id === ref && DG.post.thread) dgPatchReactions(DG.post.thread, res.target, res.target_id, res.reactions);
    }
    if (u && u.__dg) DG.feed.dirty = true;         // the feed is read again when it is next on screen
    dgSoon();
  }

  // a person to choose from a sheet, with a promise
  function dgSheet(title, build) {
    return new Promise(res => {
      const sheet = el('div', 'fb-sheet'), card = el('div', 'fb-sheet-card');
      let over = false;
      const done = v => { if (over) return; over = true; sheet.remove(); res(v); };
      card.append(el('h3', null, title));
      build(card, done);
      sheet.append(card);
      sheet._close = () => done(null);
      sheet.onclick = e => { if (e.target === sheet) done(null); };
      document.body.append(sheet);
    });
  }
  // the photo from the gallery when the camera gives none
  function dgPickFile() {
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
      document.body.append(inp);
      inp.onchange = () => { const f = inp.files[0] || null; inp.remove(); res(f); };
      inp.addEventListener('cancel', () => { inp.remove(); res(null); });
      inp.click();
    });
  }

  // ── a plant photo: the camera, the scale card decides (growth with sizes, else plant health), then its details ──
  async function dgAddPhoto(farmId, u, ru) {
    const r = await takeTrapPhoto('', 'A plant — close and in focus. For a size: the scale card beside it, flat, at the same distance', 'health');
    if (r === 'cancel') return;
    const f = r || await dgPickFile();
    if (!f) return;
    let big;
    try { big = await shrinkPhoto(f, FULL_PX, null); } catch (e) { showToast('That photo could not be read — try again', 'error'); return; }
    const p = { taken_at: dgTakenAt(f), full_w: big.canvas.width, full_h: big.canvas.height, measures: [], note: '', note_level: null };
    p.thumb = shrinkCanvas(big.canvas, 640, 0.6);
    p.full = await new Promise(res => big.canvas.toBlob(res, 'image/jpeg', FULL_Q));
    const c1600 = scaleCanvas(big.canvas, 1600), cw = c1600.width;
    if (c1600 !== big.canvas) freeCanvas(big.canvas);
    big = null;
    let m = null;
    try { m = await findMarker(c1600); } catch (e) { m = null; }
    freeCanvas(c1600);
    if (!p.full) { showToast('That photo could not be kept — try again', 'error'); return; }
    // the scale card in the picture: growth, measured by two taps (the same tool as the round's)
    if (m && !m.error) {
      p.px_per_mm = Math.round(m.ppm * (p.full_w / cw) * 1000) / 1000;
      p.scale_source = 'marker'; p.scale_quad = m.quad; p.section = 'growth';
      await new Promise(res => measurePhoto(p, res));
    } else p.section = 'health';
    const crops = (ru?.crops || []);
    p.part = p.section === 'growth' ? (crops.length && crops.every(c => HEAD_RE.test(c.name || '')) ? 'head' : 'fruit') : 'leaf';
    const ok = await dgSheet(p.section === 'growth' ? 'Growth photo' : 'Plant health photo', (card, done) => {
      const img = el('img', 'dg-img big'); img.src = p.thumb; img.alt = '';
      img.onclick = () => photoViewer(p.full, { title: p.section === 'growth' ? 'Growth photo' : 'Plant health photo' });
      card.append(img, dgZoomButton(() => img.onclick()));
      if (p.section === 'growth') card.append(el('div', 'fb-meta', p.measures.length ? 'Sizes: ' + p.measures.map(x => `${x.what} ${x.mm} mm`).join(', ') : 'The scale card is in the picture: it goes in Growth.'));
      else card.append(el('div', 'fb-meta', m && m.error ? 'The scale card reader is not on this phone yet (it needs signal once): it goes in Plant health.' : 'No scale card in the picture: it goes in Plant health.'));
      card.append(dgChips(p.section === 'growth' ? GROWTH_PARTS : PARTS, () => p.part, v => { p.part = v; }));
      const note = el('input', 'fb-note'); note.type = 'text'; note.placeholder = 'Note (optional): what you see';
      const row = el('div', 'fb-note-row'); row.append(note, riskMenu(p, note, () => {}));
      card.append(row);
      const save = el('button', 'fb-btn fb-btn-primary', 'Save'), drop = el('button', 'fb-btn', 'Leave it out');
      save.type = drop.type = 'button';
      save.onclick = () => done(true); drop.onclick = () => done(false);
      const acts = el('div', 'fb-actions'); acts.append(save, drop); card.append(acts);
    });
    if (!ok) return;
    const day = DG.day, cref = uuid(), path = dgPath(farmId, day, 'scout', cref);
    const crop = crops.length === 1 ? crops[0].id : null;
    const level = noteLevelOf(p);
    await dgQueue({
      rpc: 'dg_add_photo',
      args: { p: { farm_id: farmId, client_ref: cref, zone_id: u.zone_id, system_id: u.system_id || null, photo_path: path, photo_data: p.thumb,
                   taken_at: p.taken_at, part: p.part, measures: p.measures, px_per_mm: p.px_per_mm ?? null, crop_id: crop,
                   note: String(p.note || '').trim() || null, note_level: level, ...(p.section === 'growth' ? { section: 'growth' } : {}) } },
      uploads: [{ path, blob: p.full, type: 'image/jpeg' }], chain: 'dg:' + cref,
      view: { kind: 'photo', farm_id: farmId, unit_id: u.unit_id, section: p.section, part: p.part, thumb: p.thumb, note: String(p.note || '').trim(), note_level: level }
    });
    showToast(navigator.onLine ? 'Saved — sending' : 'Saved on this phone — it goes when there is signal', 'success');
  }
  function dgChips(list, get, set) {
    const row = el('div', 'fb-actions dg-chips');
    const paint = () => [...row.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === get())));
    list.forEach(([v, l]) => { const b = el('button', 'fb-btn', l); b.type = 'button'; b.dataset.v = v; b.onclick = () => { set(v); paint(); }; row.append(b); });
    paint();
    return row;
  }

  // the photo just taken, full size, to look closely before it is saved (0.11.135, owner 22 Oct 2026: "possibility to
  // zoom on the pic after take the photo for a deep check")
  function dgZoomButton(open) {
    const b = el('button', 'fb-btn', 'Zoom in: check the photo up close'); b.type = 'button'; b.onclick = open;
    return b;
  }
  // ── a trap: each side photographed, counted, checked, then sent on its own ──
  // the count of one side (the round's own reader: countInsects, the light and the whole-card checks)
  // when a photo was taken: a file from the gallery says it (lastModified) — kept when it is of the last day and a half;
  // the in-app camera's still is now
  const dgTakenAt = f => { const t = Number(f && f.lastModified); return t && t <= Date.now() + 6e4 && Date.now() - t < 36 * 36e5 ? new Date(t).toISOString() : new Date().toISOString(); };
  // counting v5 (0.11.138, FarmBox 0254; owner 22–23 Oct 2026): the server's AI counts every trap photo — the card
  // alone, cropped from the full photo, counted far better than the phone (164 photos counted by eye). Since the next
  // version (owner 23 Oct 2026: "crop properly the pic to the card and send only the cropped pic on database … we do
  // not need the phone counting, it is confusing for the user") the card IS the side's photo: one file, <photo>-card.jpg
  // (the server takes a photo of that name as the card itself), at the size the AI reads whole: the long side at most
  // 2576 px and at most 4784 tiles of 28 px, shrunk until both hold. The phone's own count is not shown any more.
  const DG_CARD_PX = 2576, DG_CARD_TILES = 4784, DG_CARD_MARGIN = 0.03;
  function dgCardSize(w, h) {
    const tiles = (a, b) => Math.ceil(a / 28) * Math.ceil(b / 28);
    let k = Math.min(1, DG_CARD_PX / Math.max(w, h), Math.sqrt(DG_CARD_TILES * 784 / Math.max(1, w * h)));
    let W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    while (tiles(W, H) > DG_CARD_TILES) { k *= 0.99; W = Math.max(1, Math.round(w * k)); H = Math.max(1, Math.round(h * k)); }
    return [W, H];
  }
  const dgCardPath = path => String(path).replace(/\.jpe?g$/i, '') + '-card.jpg';
  // the side's photo: the card's box ~3 % round it (box null: the whole photo) at that size, as a JPEG at 0.92, and its
  // 640 px copy for the report. The photo's canvas is given back as soon as the part kept is drawn, the part's after
  // it is encoded: the camera opens next for the other side (the 0.11.110 memory notes)
  async function dgCardBlob(canvas, box) {
    let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
    if (box != null) {
      if (!Array.isArray(box) || box.length !== 4) return null;
      const [x0, y0, x1, y1] = box, mx = DG_CARD_MARGIN * (x1 - x0), my = DG_CARD_MARGIN * (y1 - y0);
      sx = Math.max(0, Math.floor(x0 - mx)); sy = Math.max(0, Math.floor(y0 - my));
      sw = Math.min(canvas.width, Math.ceil(x1 + mx)) - sx; sh = Math.min(canvas.height, Math.ceil(y1 + my)) - sy;
    }
    if (sw < 28 || sh < 28) return null;
    const [W, H] = dgCardSize(sw, sh);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    let blob = null, thumb = null;
    try {
      c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, W, H);
      freeCanvas(canvas);
      thumb = shrinkCanvas(c, 640, 0.6);
      blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    } catch (e) { blob = null; }
    freeCanvas(c);
    return blob ? { blob, thumb } : null;
  }
  // one side: the phone finds the card (countInsects: its box, the rows seen, the light) and keeps the card cropped from
  // the photo — S.full and S.thumb, S.card true. Its count is not kept: the card goes with no figure, the AI counts it
  // (0260). No card found, or the card clearly not whole (part outside, more than a row missing): S.card false, nothing kept
  // (S.full null) and the sheet asks for a retake; on a photo taken again (again true) the whole photo, made small the
  // same way, so the person may keep it and type the count
  async function dgSide(file, colour, again) {
    let big;
    try { big = await shrinkPhoto(file, FULL_PX, null); } catch (e) { return null; }
    const S = { taken_at: dgTakenAt(file), card: false, full: null, thumb: null };
    let box = null;
    try {
      const r = countInsects(big.canvas, { colour: colour || cardColour(scaleCanvas(big.canvas, 800)) });
      box = r.card_box || null;
      const few = r.rows_seen != null && r.rows_seen < GRID_ROWS - 1;
      const lc = lightCheck(r);
      if (r.partial) S.check = 'part of the card is outside the photo — retake it with the whole card';
      else if (box && few) S.check = `only ${Math.max(0, Math.round(r.rows_seen))} of the card's ${GRID_ROWS} rows are in the photo — retake it with the whole card`;
      else if (lc) S.check = lc;
      S.card = !!box && !r.partial && !few;
    } catch (e) { /* no card found: a retake */ }
    let kept = S.card ? await dgCardBlob(big.canvas, box) : null;
    if (!kept) {
      S.card = false;
      if (big.canvas.width && again) kept = await dgCardBlob(big.canvas, null);
      else if (big.canvas.width) { try { S.thumb = shrinkCanvas(big.canvas, 640, 0.6); } catch (e) { S.thumb = null; } }   // shown, not kept
    }
    freeCanvas(big.canvas);                         // (given back already when a part of it was kept)
    if (kept) { S.full = kept.blob; S.thumb = kept.thumb; }
    return S.full || (!again && S.thumb) ? S : null;
  }
  async function dgReadTrap(farmId, u, ru, t) {
    let sides = t.colour === 'both' ? ['yellow', 'blue'].filter(s => !t[s]) : [null];
    if (t.colour === 'both' && !sides.length) {
      const pick = await dgSheet(`Trap ${dgTrapName(t)} — which side again?`, (card, done) => {
        const acts = el('div', 'fb-actions');
        [['yellow', 'Yellow side'], ['blue', 'Blue side']].forEach(([v, l]) => { const b = el('button', 'fb-btn', l); b.type = 'button'; b.onclick = () => done(v); acts.append(b); });
        const no = el('button', 'fb-btn', 'Cancel'); no.type = 'button'; no.onclick = () => done(null); acts.append(no);
        card.append(acts);
      });
      if (!pick) return;
      sides = [pick];
    }
    // missed: photos of this side with no whole card found — from the second on, the person may keep the photo
    for (let i = 0, missed = 0; i < sides.length; i++) {
      const side = sides[i];
      const r = await takeTrapPhoto(t.code, `Trap ${dgTrapName(t)}${side ? ' — the ' + side + ' side' : ''}: square-on, the whole card, top to bottom`, 'trap');
      if (r === 'cancel') return;
      const f = r || await dgPickFile();
      if (!f) return;
      const S = await dgSide(f, side || (t.colour === 'blue' ? 'blue' : 'yellow'), missed > 0);
      if (!S) { showToast('That photo could not be read — try again', 'error'); i--; continue; }
      const out = await dgTrapSheet(farmId, u, ru, t, side, S);
      if (out === 'retake') { if (!S.card) missed++; i--; continue; }
      if (out !== 'saved') return;
      missed = 0;
    }
  }
  // one side: the card cropped from the photo, the check when there is one, New card or Replaced if the person says so,
  // then sent. Counting v5 (0.11.138): no more question from the phone's count against the card's history — "fewer
  // than this card already had … a new card?", "Keep N" and the reference picture on a 0 came from a count that reads
  // glare as insects and misses gnats; the server counts the card with the AI and works out the rates. Since the next
  // version no phone count is shown: the AI's is the figure, unless the person counted the card and types it (then
  // theirs stands). No whole card in the photo: Retake; on a photo taken again the person may keep it, the count typed
  async function dgTrapSheet(farmId, u, ru, t, side, S) {
    const D = dgFarmData(farmId).dg;
    const st = { total: null, new_card: false, replaced: false, note: '', note_level: null };
    const earlier = (ru?.traps || []).filter(r => r.code === t.code && (r.side || null) === (side || null));
    return dgSheet(`Trap ${dgTrapName(t)}${side ? ' · ' + side + ' side' : ''}`, (card, done) => {
      const img = el('img', 'dg-img big'); img.src = S.thumb; img.alt = '';
      img.onclick = () => photoViewer(S.full || S.thumb, { title: `Trap ${dgTrapName(t)}` });
      card.append(img, dgZoomButton(() => img.onclick()));
      if (S.check) card.append(el('span', 'fb-chip late', S.check));
      const btn = (l, fn, primary) => { const b = el('button', 'fb-btn' + (primary ? ' fb-btn-primary' : ''), l); b.type = 'button'; b.onclick = fn; return b; };
      if (!S.full) {                                // no whole card, first photo: nothing to keep — take it again
        if (!S.check) card.append(el('span', 'fb-chip late', 'the card was not found — retake it with the whole card, square-on'));
        card.append(el('div', 'fb-meta', 'Only the card is sent, for the AI to count: take the photo again with the whole card in it.'));
        const a0 = el('div', 'fb-actions'); a0.append(btn('Retake', () => done('retake'), true), btn('Cancel', () => done(null)));
        card.append(a0);
        return;
      }
      const cnt = el('input', 'fb-num'); cnt.type = 'number'; cnt.min = '0'; cnt.step = '1'; cnt.value = '';
      cnt.setAttribute('aria-label', 'Insects on this side');
      if (S.card) {
        card.append(el('div', 'fb-meta dg-guess', 'The AI counts the card when it is sent.'));
        cnt.placeholder = 'optional';
        const crow = el('div', 'fb-actions'); crow.append(el('span', null, 'I counted it myself'), cnt);
        card.append(crow);
      } else {                                      // kept without the card: the person's count is the figure
        card.append(el('div', 'fb-meta dg-guess', 'The card was still not found. Retake it, or keep this photo and type the number of insects you count on the card: the AI counts only a card.'));
        const crow = el('div', 'fb-actions'); crow.append(el('span', null, 'Insects'), cnt);
        card.append(crow);
      }
      const toggle = (l, key, title) => {
        const b = btn(l, () => { st[key] = !st[key]; b.setAttribute('aria-pressed', String(st[key])); });
        b.title = title; b.setAttribute('aria-pressed', 'false');
        return b;
      };
      cnt.oninput = () => { const n = parseInt(cnt.value, 10); st.total = isNaN(n) ? null : n; };
      const nc = toggle('New card', 'new_card', 'A new card was put up before this photo: every insect on it counts as new');
      const rep = toggle('Replaced', 'replaced', 'The card was changed after this photo: the next count starts from nothing');
      const note = el('input', 'fb-note'); note.type = 'text'; note.placeholder = 'Comment (optional): torn, wet, missing…';
      const nrow = el('div', 'fb-note-row'); nrow.append(note, riskMenu(st, note, () => {}));
      const rrow = el('div', 'fb-actions'); rrow.append(nc, rep);
      card.append(rrow, nrow);
      let saving = false;                           // one tap saves once: a second tap made a second reading
      const save = btn(S.card ? 'Save' : 'Keep it', async () => {
        if (saving) return;
        if (st.total != null && st.total < 0) st.total = null;
        if (!S.card && st.total == null) { showToast('Type the number of insects', 'error'); cnt.focus(); return; }
        saving = true; save.disabled = true;
        // that side already photographed today: in its place, or beside it — asked only when the earlier photo is one
        // this person may replace (theirs today, or a manager); somebody else's is kept, the new one goes beside it
        let replaceId = null;
        const prev = earlier.filter(r => r.id && dgMayChange(r, D)).pop();
        if (prev) {
          const how = await dgSheet('This side was already photographed today', (c2, d2) => {
            c2.append(el('div', 'fb-meta', 'Replace the earlier photo or keep both?'));
            const a = el('div', 'fb-actions');
            const r1 = el('button', 'fb-btn fb-btn-primary', 'Replace'), r2 = el('button', 'fb-btn', 'Keep both'), r3 = el('button', 'fb-btn', 'Cancel');
            r1.type = r2.type = r3.type = 'button';
            r1.onclick = () => d2('replace'); r2.onclick = () => d2('both'); r3.onclick = () => d2(null);
            a.append(r1, r2, r3); c2.append(a);
          });
          if (!how) { saving = false; save.disabled = false; return; }
          if (how === 'replace') replaceId = prev.id;
        }
        const cref = uuid(), path0 = dgPath(farmId, DG.day, 'trap-' + (side || t.colour || 'card'), cref);
        // the one file of the side: the card, named …-card.jpg (the server counts it as the card itself); a photo kept
        // without the card under the plain name, so the server knows it is not one
        const path = S.card ? dgCardPath(path0) : path0;
        // a number typed is the person's own and stands; none typed: no figure at all — the card waits for the AI's count
        // (0260). The phone sends no count of its own: no counts, algo_total, algorithm or confidence
        const typed = st.total != null;
        const level = noteLevelOf(st);
        await dgQueue({
          rpc: 'dg_read_trap',
          // a one-sided card is sent with no side, so it stays one-sided
          args: { p: { farm_id: farmId, client_ref: cref, trap_id: t.trap_id, code: t.code, ...(side ? { side } : {}), ...(typed ? { total: st.total } : {}),
                       corrected: typed, photo_path: path, photo_data: S.thumb,
                       reference: false, new_card: !!st.new_card, replaced: !!st.replaced, lower_ok: false,
                       notes: String(st.note || '').trim() || null, note_level: level, read_at: S.taken_at, ...(replaceId ? { replace_id: replaceId } : {}) } },
          uploads: [{ path, blob: S.full, type: 'image/jpeg' }],
          chain: 'dg:' + cref,
          // while sending, a figure only when typed: otherwise the AI is still to count it
          view: { kind: 'trap', farm_id: farmId, unit_id: u.unit_id, trap_id: t.trap_id, code: dgTrapName(t), side, total: typed ? st.total : null, corrected: typed,
                  thumb: S.thumb, note: String(st.note || '').trim(), note_level: level }
        }).catch(e => { saving = false; save.disabled = false; throw e; });
        done('saved');
      }, !!S.card);
      // no card: Retake first, keeping the photo second
      const acts = el('div', 'fb-actions');
      if (S.card) acts.append(save, btn('Retake', () => done('retake')), btn('Cancel', () => done(null)));
      else acts.append(btn('Retake', () => done('retake'), true), save, btn('Cancel', () => done(null)));
      card.append(acts);
    });
  }
  // the zone's traps to say one is not read today, or to undo that (0.11.133: the traps are chips, the link is one)
  // a trap not read today, with why — handled, not missing
  async function dgSkip(farmId, u, t) {
    const why = await dgSheet(`Trap ${dgTrapName(t)} not read today`, (card, done) => {
      const a = el('div', 'fb-actions');
      ['Fallen', 'Missing', 'No access'].forEach(w => { const b = el('button', 'fb-btn', w); b.type = 'button'; b.onclick = () => done(w); a.append(b); });
      const other = el('input', 'fb-note'); other.type = 'text'; other.placeholder = 'Or say why';
      const ok = el('button', 'fb-btn fb-btn-primary', 'Save'); ok.type = 'button';
      ok.onclick = () => { const v = other.value.trim(); if (!v) { showToast('Say why the trap is not read', 'error'); return; } done(v); };
      const no = el('button', 'fb-btn', 'Cancel'); no.type = 'button'; no.onclick = () => done(null);
      const b2 = el('div', 'fb-actions'); b2.append(ok, no);
      card.append(a, other, b2);
    });
    if (!why) return;
    await dgQueue({ rpc: 'dg_skip_trap', args: { p: { trap_id: t.trap_id, reason: why, day: DG.day } }, chain: 'dg:skip:' + t.trap_id,
                    view: { kind: 'skip', farm_id: farmId, unit_id: u.unit_id, trap_id: t.trap_id } });
  }
  async function dgUnskip(farmId, u, t) {
    await dgQueue({ rpc: 'dg_unskip_trap', args: { p_trap: t.trap_id, p_day: DG.day }, chain: 'dg:skip:' + t.trap_id,
                    view: { kind: 'unskip', farm_id: farmId, unit_id: u.unit_id, trap_id: t.trap_id } });
  }


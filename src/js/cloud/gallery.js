//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the Gallery tab. Edit here, then run: python build.py
  // ── Gallery (0.11.144, FarmBox 0265) ────────────────────────────────────
  // The farm's photos in one place (owner, 29 Oct 2026): a label, a machine, a delivery, a receipt — taken or chosen on
  // the phone, tagged, sent. Two sizes are made on the phone (the photo at 2000 px, a 480 px copy to browse), both
  // wait in the outbox as a `__gallery` row and go up to the bucket farm-gallery, then add_farm_photo writes the row
  // with the phone's own id (the same id names the files: sent twice, one photo). Under the buttons: my photos still
  // on the phone, then the farm's latest, 30 at a time. A database without 0265 answers 404 / PGRST202: said quietly.
  const GL_TAGS = [['label', 'Label'], ['equipment', 'Equipment'], ['pest', 'Pest'], ['delivery', 'Delivery'],
                   ['receipt', 'Receipt'], ['crop', 'Crop'], ['other', 'Other']];
  const GL_FULL_PX = 2000, GL_FULL_Q = 0.85, GL_THUMB_PX = 480, GL_THUMB_Q = 0.8, GL_PAGE = 30;
  const GL = { draft: [], tag: 'other', note: '', preparing: 0, sending: null, busy: false, pick: null,
               rows: [], more: false, loading: false, off: false, live: false, err: '', at: 0, refetch: false,
               urls: new Map(), signedAt: 0, mine: [] };
  const $gl = id => document.getElementById('gl-' + id);
  const glTagName = t => (GL_TAGS.find(x => x[0] === t) || [t, String(t || 'other')])[1];
  // the database has no gallery yet (0265 not applied): its function or its bucket is not there
  const glMissing = e => /PGRST202|Could not find the function|Bucket not found/i.test(String((e && e.message) || e || ''));
  // the words of a refusal without its status and its JSON: '403 {"message":"new row violates …"}' → 'new row violates …'
  function glErrText(s) {
    let t = String(s || '').replace(/^\d{3}\s*/, '');
    try { const j = JSON.parse(t); t = j.message || j.error || j.hint || t; }
    catch (e) { const m = /"message"\s*:\s*"([^"]*)/.exec(t); if (m) t = m[1]; }   // a refusal cut at 160 characters
    return String(t).slice(0, 140);
  }
  // yyyy-mm in the farm's time zone: the folder a photo goes in
  function glMonth(ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit' })
      .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}`;
  }
  const glWhen = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const glEncode = (canvas, q) => new Promise(res => canvas.toBlob(res, 'image/jpeg', q));

  // a chosen or taken photo, made into the two sizes (shrinkPhoto decodes it once, straight at the size wanted)
  async function glPrepare(file) {
    const big = await shrinkPhoto(file, GL_FULL_PX, null);
    const cv = big.canvas;
    const main = await glEncode(cv, GL_FULL_Q);
    const tc = scaleCanvas(cv, GL_THUMB_PX);
    const thumb = await glEncode(tc, GL_THUMB_Q);
    const width = cv.width, height = cv.height;
    if (tc !== cv) freeCanvas(tc);
    freeCanvas(cv);
    if (!main || !thumb) throw new Error('not a picture');
    // a file chosen from the phone remembers when it was taken; a photo from the camera is of now
    const lm = file instanceof File ? file.lastModified : 0;
    const taken = lm > Date.UTC(2015, 0, 1) && lm <= Date.now() + 86400000 ? lm : Date.now();
    return { main, thumb, width, height, bytes: main.size, taken, url: URL.createObjectURL(thumb) };
  }
  async function glAdd(files) {
    const list = [...files].filter(Boolean);
    if (!list.length) return;
    GL.preparing += list.length; glPaintAdd();
    let bad = 0;
    for (const f of list) {
      try { GL.draft.push(await glPrepare(f)); }
      catch (e) { bad++; console.warn('gallery photo', e); }
      GL.preparing--; glPaintAdd();
    }
    if (bad) showToast(bad === 1 ? 'That photo could not be read' : `${bad} photos could not be read`, 'error');
  }
  async function glTake() {
    let r = null;
    try { r = await takeTrapPhoto('', 'Farm photo — close enough to read what matters', 'gallery'); } catch (e) { r = null; }
    if (r === 'cancel') return;
    if (r) glAdd([r]); else GL.pick.click();   // no camera to give: the phone's own picker
  }
  function glDrop(d) {
    try { URL.revokeObjectURL(d.url); } catch (e) { /* gone already */ }
    GL.draft = GL.draft.filter(x => x !== d);
    glPaintAdd();
  }
  // Send: each photo becomes a row of the outbox, then the flush takes them (nothing is lost without signal)
  async function glSendDraft() {
    if (!GL.draft.length || GL.busy || GL.preparing) return;
    if (!farm) { try { farm = await getKV('farm'); } catch (e) { farm = null; } }
    if (!farm) { showToast('Open Tasks once while online, so the app knows your farm', 'error'); return; }
    GL.busy = true; glPaintAdd();
    try {
      const note = GL.note.trim().slice(0, 300) || null;
      const rows = GL.draft.map(d => {
        const ref = uuid(), dir = `${farm.id}/${glMonth(d.taken)}/${ref}`;
        return { __gallery: true, client_run_id: ref, farm_id: farm.id, path: dir + '.jpg', thumb_path: dir + '-t.jpg',
                 tag: GL.tag, note, taken_at: new Date(d.taken).toISOString(), width: d.width, height: d.height, bytes: d.bytes,
                 blob: d.main, thumb: d.thumb };
      });
      await queue(rows);
      GL.draft.forEach(d => { try { URL.revokeObjectURL(d.url); } catch (e) { /* gone already */ } });
      GL.draft = []; GL.tag = 'other'; GL.note = '';
      showToast(rows.length === 1 ? 'Photo kept on the phone — sending' : `${rows.length} photos kept on the phone — sending`, 'success');
    } catch (e) { showToast('The phone could not keep the photos: ' + String(e.message || e).slice(0, 100), 'error'); }
    GL.busy = false; glPaintAdd(); glPaintMine();
  }

  // ── the buttons, and the photos about to be sent
  function glPaintAdd() {
    const box = $gl('add');
    if (!box) return;
    box.textContent = '';
    if (!session) return;
    if (!GL.pick) {
      GL.pick = el('input'); GL.pick.type = 'file'; GL.pick.accept = 'image/jpeg,image/png,image/webp'; GL.pick.multiple = true; GL.pick.style.display = 'none';
      GL.pick.onchange = () => { const fs = [...GL.pick.files]; GL.pick.value = ''; glAdd(fs); };
    }
    const row = el('div', 'gl-add');
    const take = el('button', 'fb-btn', '{i:camera} Take photo'), choose = el('button', 'fb-btn', '{i:image} Choose photos');
    take.type = choose.type = 'button';
    take.onclick = glTake; choose.onclick = () => GL.pick.click();
    row.append(take, choose, GL.pick);
    box.append(row);
    if (GL.preparing) box.append(el('div', 'fb-meta', `Getting ${GL.preparing} photo${GL.preparing === 1 ? '' : 's'} ready…`));
    if (!GL.draft.length) return;
    const card = el('div', 'gl-draft');
    const strip = el('div', 'gl-strip');
    GL.draft.forEach(d => {
      const th = el('div', 'gl-th'), im = el('img'); im.src = d.url; im.alt = 'Photo to send';
      const x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', 'Take this photo out'); x.onclick = () => glDrop(d);
      th.append(im, x); strip.append(th);
    });
    card.append(strip);
    const tags = el('div', 'gl-tags');
    GL_TAGS.forEach(([k, name]) => {
      const b = el('button', 'fb-btn', name); b.type = 'button'; b.setAttribute('aria-pressed', String(GL.tag === k));
      b.onclick = () => { GL.tag = k; tags.querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', String(o === b))); };
      tags.append(b);
    });
    const note = el('textarea', 'gl-note'); note.rows = 2; note.maxLength = 300; note.placeholder = 'A short note (optional)'; note.value = GL.note;
    note.oninput = () => { GL.note = note.value; };
    const acts = el('div', 'fb-actions');
    acts.style.marginTop = 'var(--space-3)';
    const n = GL.draft.length;
    const send = el('button', 'fb-btn gl-send', GL.busy ? 'Keeping…' : `{i:upload} Send ${n === 1 ? 'the photo' : n + ' photos'}`);
    send.type = 'button'; send.disabled = GL.busy || !!GL.preparing; send.onclick = glSendDraft;
    const clear = el('button', 'fb-btn', 'Clear'); clear.type = 'button'; clear.disabled = GL.busy;
    clear.onclick = () => { GL.draft.slice().forEach(d => { try { URL.revokeObjectURL(d.url); } catch (e) { /* gone already */ } }); GL.draft = []; GL.note = ''; GL.tag = 'other'; glPaintAdd(); };
    acts.append(send, clear);
    card.append(tags, note, acts);
    box.append(card);
  }

  // ── the flush: one gallery row. The files first, each noted on the row as it lands (a resend uploads none twice, and a
  // file that went up while the answer was lost meets "Duplicate": it is there), then the photo with the phone's own id.
  async function glSend(row) {
    const u = row.payload;
    GL.sending = row.id; glSoon();
    try {
      const put = async (key, path, flag, keep) => {
        if (u[flag]) return;
        const blob = unBlob(u[key]);
        if (!(blob instanceof Blob)) throw new Error('410 the photo is no longer on this phone');
        try { await api('/storage/v1/object/farm-gallery/' + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }); }
        catch (e) { if (!/Duplicate|already exists/i.test(String(e.message || e))) throw e; }
        u[flag] = true; if (!keep) u[key] = null;           // the small copy stays for the list until the photo is written
        try { await putAll('outbox', [row]); } catch (e) { /* not noted: a resend meets "Duplicate", taken as done */ }
      };
      await put('blob', u.path, 'up_main', false);
      await put('thumb', u.thumb_path, 'up_thumb', true);
      await api('/rest/v1/rpc/add_farm_photo', { method: 'POST', body: JSON.stringify({ p: {
        farm_id: u.farm_id, path: u.path, thumb_path: u.thumb_path, taken_at: u.taken_at, tag: u.tag, note: u.note,
        width: u.width, height: u.height, bytes: u.bytes, client_ref: u.client_run_id } }) });
    } catch (e) {
      // no gallery on the server yet: the photo waits, as for a lost signal — not set aside as refused
      if (glMissing(e)) throw new Error('The gallery is not available yet');
      throw e;
    } finally { GL.sending = null; }
    glSoon(true);
  }

  // ── my photos waiting to send, with their state
  async function glPaintMine() {
    const box = $gl('mine');
    if (!box) return;
    let rows = [];
    try { rows = (await all('outbox')).filter(r => r.payload && r.payload.__gallery).sort((a, b) => (a.at || 0) - (b.at || 0)); } catch (e) { rows = []; }
    GL.mine.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* gone already */ } });
    GL.mine = [];
    box.textContent = '';
    if (!rows.length) return;
    box.append(el('div', 'fb-sec gl-head', `On this phone · ${rows.length}`));
    for (const r of rows) {
      const u = r.payload, card = el('div', 'fb-card gl-row');
      const t = unBlob(u.thumb);
      if (t instanceof Blob) { const url = URL.createObjectURL(t); GL.mine.push(url); const im = el('img'); im.src = url; im.alt = ''; card.append(im); }
      else card.append(el('div', 'gl-ph', '{i:image}'));
      const body = el('div', 'fb-body');
      const name = el('div', 'fb-name', glTagName(u.tag));
      const state = el('div', 'fb-meta');
      let bad = false, text;
      if (GL.sending === r.id) text = 'Sending…';
      else if (r.dead) { bad = true; text = 'Not sent — ' + glErrText(r.error); }
      else if (!navigator.onLine) text = 'Waiting for a connection';
      else if (!uploadAllowed()) text = 'Waiting for Wi-Fi';
      else if (r.error && !/^\d{3} /.test(r.error)) text = /not available yet/.test(r.error) ? 'Waiting — the gallery is not available yet' : 'Will try again — ' + glErrText(r.error);
      else text = 'Waiting to send';
      state.textContent = [text, u.note ? '“' + u.note.slice(0, 60) + '”' : null].filter(Boolean).join(' · ');
      if (bad) state.classList.add('gl-bad');
      body.append(name, state);
      card.append(body);
      const acts = el('div', 'fb-actions');
      if (r.dead) {
        const again = el('button', 'fb-btn', 'Try again'); again.type = 'button';
        again.onclick = async () => { again.disabled = true; try { await putAll('outbox', [{ ...r, dead: false }]); } catch (e) { /* as it was */ } flush().catch(() => {}); glSoon(); };
        acts.append(again);
      }
      const drop = el('button', 'fb-btn', 'Discard'); drop.type = 'button';
      drop.disabled = GL.sending === r.id;   // a send under way would write it back
      drop.onclick = async () => {
        if (GL.sending === r.id) return;
        if (!confirm('Take this photo off the phone? It will not be sent.')) return;
        try { await del('outbox', r.id); } catch (e) { showToast('Could not remove it: ' + String(e.message || e).slice(0, 80), 'error'); }
        glSoon();
      };
      acts.append(drop);
      card.append(acts);
      box.append(card);
    }
  }

  // ── the farm's latest
  // Signed in one request (as the console's unfiled list does): { path → address } for what the list shows.
  async function glSign(paths) {
    const out = new Map();
    if (!paths.length) return out;
    try {
      const res = await api('/storage/v1/object/sign/farm-gallery', { method: 'POST', body: JSON.stringify({ expiresIn: 3600, paths }) });
      (res || []).forEach(x => { if (x && x.signedURL && x.path) out.set(x.path, URL_BASE + '/storage/v1' + x.signedURL); });
    } catch (e) { /* the tiles stay empty */ }
    return out;
  }
  async function glOpenPhoto(p) {
    if (!navigator.onLine) { showToast('Offline — the photo shows when back online', 'info'); return; }
    const url = (await glSign([p.path])).get(p.path);
    if (!url) { showToast('That photo could not be opened — try again', 'error'); return; }
    photoViewer(url, { title: [glTagName(p.tag), p.by].filter(Boolean).join(' · '), scale: p.note || null });
  }
  function glPaintFarm() {
    const box = $gl('farm');
    if (!box) return;
    box.textContent = '';
    box.append(el('div', 'fb-sec gl-head', 'The farm'));
    const say = (t, bad) => { const d = el('div', 'fb-meta' + (bad ? ' gl-bad' : '')); d.textContent = t; box.append(d); };
    if (!session) { say('Sign in under Tasks to see the gallery.'); return; }
    if (GL.off) { say('The gallery is not available yet.'); return; }
    if (!GL.rows.length) {
      if (GL.loading) say('Loading…');
      else if (GL.err) say(GL.err, true);
      else if (GL.live) say('No photos yet — be the first.');
      else say('Offline — the gallery shows when back online');
      return;
    }
    if (!GL.live) say('Offline — showing the last list.');
    else if (GL.err) say(GL.err, true);
    const grid = el('div', 'gl-grid');
    GL.rows.forEach(p => {
      const tile = el('button', 'gl-tile'); tile.type = 'button';
      const url = GL.urls.get(p.thumb_path);
      if (url && GL.live) { const im = el('img'); im.src = url; im.alt = glTagName(p.tag) + ' photo'; im.loading = 'lazy'; im.decoding = 'async'; tile.append(im); }
      else tile.append(el('div', 'gl-ph', '{i:image}'));
      const chip = el('span', 'fb-chip'); chip.textContent = glTagName(p.tag);
      const who = el('div', 'fb-meta'); who.textContent = [p.by, glWhen(p.taken_at || p.created_at)].filter(Boolean).join(' · ');
      tile.append(chip, who);
      if (p.note) { const n = el('div', 'fb-meta gl-clip'); n.textContent = p.note; tile.append(n); }
      tile.onclick = () => glOpenPhoto(p);
      grid.append(tile);
    });
    box.append(grid);
    if (GL.more && GL.live) {
      const more = el('button', 'fb-btn', GL.loading ? 'Loading…' : 'More'); more.type = 'button'; more.disabled = GL.loading;
      more.style.marginTop = 'var(--space-3)';
      more.onclick = () => glLoadFarm(true);
      box.append(more);
    }
  }
  // the last first page, kept for the days without signal
  async function glFromCache(fm, more) {
    // More pressed with no signal: the pages already loaded stay on screen (the kept first page would drop them)
    if (more && GL.rows.length) { GL.err = 'No signal — more photos load when it is back'; return; }
    GL.live = false; GL.rows = []; GL.more = false;
    try { const c = await getKV('gallery_list'); if (c && c.farm === fm.id && Array.isArray(c.photos)) GL.rows = c.photos; } catch (e) { /* none kept */ }
  }
  async function glLoadFarm(more) {
    if (GL.loading) return;
    GL.loading = true; GL.err = ''; glPaintFarm();
    try {
      if (!session) return;
      if (navigator.onLine && !farm) { try { await pickFarm(); } catch (e) { /* the kept farm below */ } }
      const fm = farm || await getKV('farm');
      if (!fm) { GL.err = 'Open Tasks once while online, so the app knows your farm'; return; }
      if (!navigator.onLine) { await glFromCache(fm, more); return; }
      const p = { limit: GL_PAGE };
      if (more && GL.rows.length) p.before = GL.rows[GL.rows.length - 1].created_at;
      let r;
      try { r = await api('/rest/v1/rpc/farm_photos', { method: 'POST', body: JSON.stringify({ p_farm: fm.id, p }) }); }
      catch (e) {
        if (glMissing(e)) { GL.off = true; GL.rows = []; return; }                                // a database before 0265
        if (errKind(e) === 'net') { await glFromCache(fm, more); return; }
        GL.err = 'The gallery could not be loaded — ' + glErrText(e && e.message); return;
      }
      GL.off = false; GL.live = true; GL.at = Date.now();
      const got = (r && r.photos) || [];
      GL.rows = more ? GL.rows.concat(got.filter(x => !GL.rows.some(y => y.id === x.id))) : got;
      GL.more = !!(r && r.more);
      if (!more) { try { await setKV('gallery_list', { farm: fm.id, at: Date.now(), photos: got }); } catch (e) { /* not kept */ } }
      // the addresses last an hour: after 50 minutes the list is signed again
      if (Date.now() - GL.signedAt > 50 * 60000) { GL.urls = new Map(); GL.signedAt = Date.now(); }
      GL.loading = false; glPaintFarm();                                                          // the names first, the pictures as they are signed
      const miss = GL.rows.map(x => x.thumb_path).filter(x => x && !GL.urls.has(x));
      (await glSign(miss)).forEach((u, k) => GL.urls.set(k, u));
    } finally { GL.loading = false; glPaintFarm(); }
  }
  // the outbox changed, or a photo went up: the waiting list is read again; the farm's list too when a photo landed
  let glTimer = null;
  function glSoon(refetch) {
    if (refetch) GL.refetch = true;
    clearTimeout(glTimer);
    glTimer = setTimeout(() => {
      if (!document.body.classList.contains('mode-gallery')) return;   // galleryOpen reads everything when the tab opens
      glPaintMine();
      if (GL.refetch) { GL.refetch = false; glLoadFarm(false); }
    }, 250);
  }
  // the tab opens (setAppMode): the buttons, my waiting photos, the farm's latest (not again within half a minute)
  window.galleryOpen = () => {
    glPaintAdd(); glPaintMine();
    if (GL.refetch || Date.now() - GL.at > 30000 || !GL.rows.length) { GL.refetch = false; glLoadFarm(false); } else glPaintFarm();
  };
  $gl('sync')?.addEventListener('click', () => { if (!navigator.onLine) { showToast('Offline — the gallery shows when back online', 'info'); return; } flush().catch(() => {}); glPaintMine(); glLoadFarm(false); });
  addEventListener('online', () => { glSoon(); if (document.body.classList.contains('mode-gallery')) glLoadFarm(false); });
  addEventListener('offline', () => glSoon());


//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- a photo full screen, measuring by hand. Edit here, then run: python build.py
  // ── a photo full screen (0.11.52): pinch, wheel or double-tap to zoom (to 8×), drag to move ──
  // a smaller copy of a photo Blob for looking at: decoded at that size (jpegSize), the photo itself when already small
  async function viewCopy(blob, maxSide) {
    const dims = await jpegSize(blob).catch(() => null);
    if (!dims || Math.max(dims.w, dims.h) <= maxSide) return blob;
    const [w, h] = dims.orient >= 5 ? [dims.h, dims.w] : [dims.w, dims.h];
    const opt = { imageOrientation: 'from-image', resizeQuality: 'high' };
    if (w >= h) opt.resizeWidth = maxSide; else opt.resizeHeight = maxSide;
    const bmp = await createImageBitmap(blob, opt);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
    return await new Promise(r => c.toBlob(b => r(b || blob), 'image/jpeg', 0.92));
  }
  function photoViewer(src, { title = '', measure = null, scale = null, outline = null, pick = null } = {}) {
    const ov = el('div', 'fb-viewer');
    const stage = el('div', 'fb-viewer-stage');
    const img = el('img'); img.alt = title; img.draggable = false; img.decoding = 'async';
    let url = null, closed = false;
    // a ≤ 2000 px copy, not the 4000 px photo (0.11.92, review of 30 Sept): decoding the full one in the viewer was
    // ~64 MB of pixels on a phone whose camera had just used its memory. Taps are fractions, so pick() is unchanged.
    if (src instanceof Blob) {
      viewCopy(src, 2000).catch(() => src).then(b => { if (closed) return; url = URL.createObjectURL(b); img.src = url; });
    } else img.src = src || '';
    stage.append(img);
    const head = el('div', 'fb-viewer-head');
    head.append(el('b', null, title), el('span', 'fb-meta', scale || 'Pinch or double-tap to zoom'));
    const bar = el('div', 'fb-viewer-bar');
    const fitB = el('button', 'fb-btn', 'Fit'); fitB.type = 'button';
    const close = el('button', 'fb-btn fb-btn-primary', 'Close'); close.type = 'button';
    if (measure) { const m = el('button', 'fb-btn', '{i:ruler} Measure'); m.type = 'button'; m.onclick = () => { done(); measure(); }; bar.append(m); }
    // the phone's outline over the photo, and "tap the fruit" to measure another object (0.11.53)
    let picking = false;
    if (outline) {
      const o = el('button', 'fb-btn', 'Outline'); o.type = 'button'; o.setAttribute('aria-pressed', 'false');
      o.onclick = () => { const on = o.getAttribute('aria-pressed') !== 'true'; o.setAttribute('aria-pressed', String(on)); img.src = on ? outline : (url || src || ''); };
      bar.append(o);
    }
    if (pick) {
      const rm = el('button', 'fb-btn', '{i:square} Re-measure'); rm.type = 'button';
      rm.onclick = () => { picking = true; rm.setAttribute('aria-pressed', 'true'); head.lastChild.textContent = 'Tap the fruit or leaf to measure'; };
      bar.append(rm);
    }
    bar.append(fitB, close);
    ov.append(stage, head, bar);
    document.body.append(ov);
    let s = 1, tx = 0, ty = 0;
    const clamp = () => {
      const w = img.clientWidth, h = img.clientHeight, W = stage.clientWidth, H = stage.clientHeight;
      const mx = Math.max(0, (w * s - W) / 2), my = Math.max(0, (h * s - H) / 2);
      tx = Math.min(mx, Math.max(-mx, tx)); ty = Math.min(my, Math.max(-my, ty));
    };
    const apply = () => { clamp(); img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; };
    const centre = (x, y) => { const r = stage.getBoundingClientRect(); return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 }; };
    const zoomAt = (to, c) => { to = Math.min(8, Math.max(1, to)); tx = c.x - (c.x - tx) * (to / s); ty = c.y - (c.y - ty) * (to / s); s = to; if (s === 1) tx = ty = 0; apply(); };
    const pts = new Map();
    let base = null, lastTap = 0, moved = false;
    const snap = () => {
      const a = [...pts.values()];
      base = { s, tx, ty, a: a.map(p => ({ ...p })),
               d: a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0,
               mid: a.length > 1 ? centre((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2) : centre(a[0].x, a[0].y) };
    };
    stage.onpointerdown = e => { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* nothing to capture */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; snap(); };
    stage.onpointermove = e => {
      if (!pts.has(e.pointerId) || !base) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const a = [...pts.values()];
      if (a.length > 1 && base.d) {
        const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mid = centre((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
        const to = Math.min(8, Math.max(1, base.s * d / base.d));
        tx = mid.x - (base.mid.x - base.tx) * (to / base.s); ty = mid.y - (base.mid.y - base.ty) * (to / base.s); s = to;
        moved = true; apply();
      } else if (a.length === 1) {
        const dx = a[0].x - base.a[0].x, dy = a[0].y - base.a[0].y;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (s > 1) { tx = base.tx + dx; ty = base.ty + dy; apply(); }
      }
    };
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size) { snap(); return; }
      if (!moved && picking) {                        // Re-measure: this tap says which object
        const r = img.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) { done(); pick([x, y]); }
        base = null; return;
      }
      if (!moved) {                                   // a tap: two in a row zoom in, or back out
        const now = Date.now();
        if (now - lastTap < 320) { zoomAt(s > 1.5 ? 1 : 3, centre(e.clientX, e.clientY)); lastTap = 0; } else lastTap = now;
      }
      base = null;
    };
    stage.onpointerup = up; stage.onpointercancel = up;
    stage.onwheel = e => { e.preventDefault(); zoomAt(s * (e.deltaY < 0 ? 1.25 : 0.8), centre(e.clientX, e.clientY)); };
    fitB.onclick = () => { s = 1; tx = ty = 0; apply(); };
    const done = () => { closed = true; ov.remove(); if (url) URL.revokeObjectURL(url); document.removeEventListener('keydown', key); };
    ov._close = done;   // Back closes the viewer and its listeners
    const key = e => { if (e.key === 'Escape') done(); };
    document.addEventListener('keydown', key);
    close.onclick = done;
  }

  // ── measuring: two taps = one size ─────────────────────────────────────
  // On the scale card the phone knows the scale already. Without one (0.11.48, owner's tape-measure photos:
  // "not dimensions collected"), the scale is set first on a ruler or tape in the photo: tap two marks far
  // apart (0 and 30), say how many centimetres lie between them, and every size after is read against that.
  // ── two lines by hand (0.11.99, owner 4 Oct 2026: "the dimension algo is too long") ──
  // The blue line has a handle at each end: drag them onto the two ends of the fruit, leaf or head. The pink line stays
  // at a right angle to it: drag its handles to the edges, anywhere along the blue one. Millimetres are read live against
  // the scale card (in its plane) or the ruler. No model, no download, nothing to wait for. Moving a line keeps its
  // size; a tap on a size switches it. `outline` (when the phone has graphics acceleration) opens the outline tool.
  async function lineTool(p, done, outline) {
    if (!(p.full instanceof Blob) || !p.px_per_mm || document.querySelector('.fb-measure, .fb-cam')) return;
    let bmp;
    try { bmp = await createImageBitmap(p.full, { resizeWidth: 1600, resizeQuality: 'medium' }); }
    catch (e) { try { bmp = await createImageBitmap(p.full); } catch (e2) { showToast('This photo could not be opened', 'error'); return; } }
    const BW = bmp.width, BH = bmp.height;
    const L = p.lines || {};
    let A = { x: (L.a?.[0] ?? 0.3) * BW, y: (L.a?.[1] ?? 0.5) * BH }, B = { x: (L.b?.[0] ?? 0.7) * BW, y: (L.b?.[1] ?? 0.5) * BH };
    let t = L.t ?? 0.5, v1 = (L.v1 ?? -0.07) * BW, v2 = (L.v2 ?? 0.07) * BW;
    const had = n => (p.measures || []).some(m => m.line === n && m.confirmed);
    let keepL = had('longest'), keepW = had('across');
    const ov = el('div', 'fb-cam fb-measure fb-lines');
    const cv = document.createElement('canvas'); cv.style.touchAction = 'none';
    const hint = el('div', 'fb-cam-hint', 'Drag the blue ends onto the two ends of what you measure, the pink ends onto its edges');
    const bar = el('div', 'fb-cam-bar fb-measure-bar');
    ov.append(cv, hint, bar);
    document.body.append(ov);
    const k = Math.min(ov.clientWidth / BW, (ov.clientHeight - 150) / BH);
    cv.width = Math.round(BW * k); cv.height = Math.round(BH * k);
    cv.style.margin = '40px auto 0'; cv.style.display = 'block';
    const geo = () => {
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, u = { x: dx / len, y: dy / len }, n = { x: -u.y, y: u.x };
      const M = { x: A.x + dx * t, y: A.y + dy * t };
      return { u, n, len, C: { x: M.x + n.x * v1, y: M.y + n.y * v1 }, D: { x: M.x + n.x * v2, y: M.y + n.y * v2 } };
    };
    const mm = (a, b) => Math.round(mmBetween(p, a, b, BW, BH));
    let grab = null, finger = null;
    const draw = () => {
      const g = cv.getContext('2d'), G = geo();
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      if (p.scale_quad && p.scale_source === 'marker') {
        g.strokeStyle = '#3ddc84'; g.lineWidth = 2; g.beginPath();
        p.scale_quad.forEach(([x, y], i) => { const X = x * cv.width, Y = y * cv.height; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
        g.closePath(); g.stroke();
      }
      const seg = (a, b, col, on) => {
        g.strokeStyle = col; g.lineWidth = on ? 4 : 3; g.setLineDash(on ? [] : [10, 7]);
        g.beginPath(); g.moveTo(a.x * k, a.y * k); g.lineTo(b.x * k, b.y * k); g.stroke(); g.setLineDash([]);
        for (const q of [a, b]) {
          g.beginPath(); g.arc(q.x * k, q.y * k, 13, 0, 7); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fill(); g.lineWidth = 3; g.strokeStyle = col; g.stroke();
          g.beginPath(); g.arc(q.x * k, q.y * k, 3, 0, 7); g.fillStyle = col; g.fill();
        }
      };
      seg(A, B, '#00e5ff', keepL); seg(G.C, G.D, '#ff4081', keepW);
      // the spot under the finger, enlarged, in the corner away from it
      if (grab && finger) {
        const R = 58, lx = finger.x * k < cv.width / 2 ? cv.width - R - 10 : R + 10, ly = R + 10, src = 46 / k;
        g.save(); g.beginPath(); g.arc(lx, ly, R, 0, 7); g.clip();
        g.drawImage(bmp, finger.x - src / 2, finger.y - src / 2, src, src, lx - R, ly - R, 2 * R, 2 * R);
        g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(lx - 12, ly); g.lineTo(lx + 12, ly); g.moveTo(lx, ly - 12); g.lineTo(lx, ly + 12); g.stroke();
        g.restore(); g.beginPath(); g.arc(lx, ly, R, 0, 7); g.strokeStyle = grab === 'A' || grab === 'B' ? '#00e5ff' : '#ff4081'; g.lineWidth = 3; g.stroke();
      }
    };
    const bL = el('button', 'fb-btn fb-size-pick longest'); bL.type = 'button';
    const bW = el('button', 'fb-btn fb-size-pick across'); bW.type = 'button';
    const save = el('button', 'fb-btn fb-btn-primary', 'Save'); save.type = 'button';
    const auto = el('button', 'fb-btn', '✦ Outline it for me'); auto.type = 'button';
    const cancel = el('button', 'fb-btn', 'Not now'); cancel.type = 'button';
    const paintBar = () => {
      const G = geo();
      bL.textContent = `${keepL ? '✓ ' : ''}Longest ${mm(A, B)} mm`; bL.setAttribute('aria-pressed', String(keepL));
      bW.textContent = `${keepW ? '✓ ' : ''}Across ${mm(G.C, G.D)} mm`; bW.setAttribute('aria-pressed', String(keepW));
      save.disabled = !(keepL || keepW);
      save.textContent = keepL && keepW ? 'Save both' : keepL ? 'Save longest' : keepW ? 'Save across' : 'Move a line, or tap a size';
    };
    bL.onclick = () => { keepL = !keepL; draw(); paintBar(); };
    bW.onclick = () => { keepW = !keepW; draw(); paintBar(); };
    const at = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
    cv.onpointerdown = e => {
      const f = at(e), G = geo(), near = 34 / k;
      let best = null, bd = near;
      for (const [name, q] of [['A', A], ['B', B], ['C', G.C], ['D', G.D]]) { const d = Math.hypot(q.x - f.x, q.y - f.y); if (d < bd) { bd = d; best = name; } }
      if (!best) return;
      grab = best; finger = f;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
      e.preventDefault(); draw();
    };
    cv.onpointermove = e => {
      if (!grab) return;
      const f = at(e); f.x = Math.min(BW, Math.max(0, f.x)); f.y = Math.min(BH, Math.max(0, f.y)); finger = f;
      if (grab === 'A') { A = f; keepL = true; }
      else if (grab === 'B') { B = f; keepL = true; }
      else {
        const G = geo(), rx = f.x - A.x, ry = f.y - A.y;
        t = Math.min(1, Math.max(0, (rx * G.u.x + ry * G.u.y) / G.len));
        const off = rx * G.n.x + ry * G.n.y;
        if (grab === 'C') v1 = off; else v2 = off;
        keepW = true;
      }
      draw(); paintBar();
    };
    const drop = () => { if (!grab) return; grab = null; finger = null; draw(); };
    cv.onpointerup = drop; cv.onpointercancel = drop;
    const shut = () => { ov.remove(); bmp.close?.(); done?.(); };
    save.onclick = () => {
      const G = geo(), scale = p.scale_source || 'marker';
      p.measures = [...(p.measures || []).filter(m => !m.line),
        ...(keepL ? [{ what: 'length', line: 'longest', mm: mm(A, B), by: 'hand', scale, confirmed: true }] : []),
        ...(keepW ? [{ what: 'width', line: 'across', mm: mm(G.C, G.D), by: 'hand', scale, confirmed: true }] : [])];
      p.lines = { a: [A.x / BW, A.y / BH], b: [B.x / BW, B.y / BH], t, v1: v1 / BW, v2: v2 / BW };
      // what was measured, on the photo's card
      const v = document.createElement('canvas'), vk = Math.min(1, 900 / Math.max(cv.width, cv.height));
      v.width = Math.round(cv.width * vk); v.height = Math.round(cv.height * vk);
      v.getContext('2d').drawImage(cv, 0, 0, v.width, v.height);
      p.auto_view = v.toDataURL('image/jpeg', 0.75); freeCanvas(v);
      p.auto_state = 'done'; p.auto_algo = 'lines-hand'; p.size_ok = true;
      shut();
    };
    auto.onclick = () => { shut(); outline(); };
    cancel.onclick = shut;
    bar.append(bL, bW, save);
    if (outline) bar.append(auto);
    bar.append(cancel);
    draw(); paintBar();
  }

  async function measurePhoto(p, done) {
    let bmp;
    try { bmp = await createImageBitmap(p.full, { resizeWidth: 1600, resizeQuality: 'medium' }); }
    catch (e) { showToast('This photo could not be opened', 'error'); return; }
    let ppm = p.px_per_mm ? p.px_per_mm * (bmp.width / p.full_w) : null;
    let calibrating = !ppm;
    const ov = el('div', 'fb-cam fb-measure');
    const cv = document.createElement('canvas');
    const hint = el('div', 'fb-cam-hint', '');
    const bar = el('div', 'fb-cam-bar fb-measure-bar');
    const close = el('button', 'fb-btn', 'Done');
    ov.append(cv, hint, bar);
    document.body.append(ov);
    const fit = () => {
      const W = ov.clientWidth, H = ov.clientHeight - 120;
      const k = Math.min(W / bmp.width, H / bmp.height);
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.style.margin = '40px auto 0'; cv.style.display = 'block';
      return k;
    };
    const s = fit();
    let a = null, b = null, saved = '';
    const idle = () => calibrating
      ? 'No scale card found: tap two marks on the ruler or tape, far apart — like 0 and 30'
      : (saved || 'Tap the two ends of what you measure');
    const draw = () => {
      const g = cv.getContext('2d');
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      g.lineWidth = 3; const col = calibrating ? '#ff4fb0' : '#ffeb3b'; g.strokeStyle = col; g.fillStyle = col;
      if (p.scale_quad && p.scale_source === 'marker') {            // the card the phone found, outlined in green
        g.save(); g.strokeStyle = '#3ddc84'; g.lineWidth = 3; g.beginPath();
        p.scale_quad.forEach(([x, y], i) => { const X = x * bmp.width * s, Y = y * bmp.height * s; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
        g.closePath(); g.stroke(); g.restore();
      }
      for (const q of [a, b].filter(Boolean)) { g.beginPath(); g.arc(q.x * s, q.y * s, 7, 0, 7); g.fill(); }
      if (a && b) { g.beginPath(); g.moveTo(a.x * s, a.y * s); g.lineTo(b.x * s, b.y * s); g.stroke(); }
    };
    const paintBar = () => {
      bar.textContent = '';
      if (calibrating && a && b) {
        hint.textContent = 'How far apart are the two marks?';
        const cm = el('input', 'fb-num'); cm.type = 'number'; cm.min = '0.5'; cm.step = '0.5'; cm.inputMode = 'decimal';
        cm.value = String(p.scale_cm || 10); cm.setAttribute('aria-label', 'Centimetres between the two marks');
        const set = el('button', 'fb-btn fb-btn-primary', 'Set the scale'); set.type = 'button';
        set.onclick = () => {
          const v = parseFloat(String(cm.value).replace(',', '.'));
          const px = Math.hypot(b.x - a.x, b.y - a.y);
          if (!(v > 0) || px < 20) { showToast('Tap two marks further apart and give the centimetres between them', 'error'); return; }
          ppm = px / (v * 10);
          p.px_per_mm = Math.round(ppm * (p.full_w / bmp.width) * 1000) / 1000; p.scale_source = 'ruler'; p.scale_cm = v;
          if (p.section === 'growth') run?.sc?.sizeCheck?.(p);        // the scale is set: tap the fruit to measure it
          calibrating = false; a = b = null; saved = `Scale set: ${v} cm on the ruler. Now tap the two ends of what you measure.`;
          draw(); paintBar(); saveScDraft();
        };
        bar.append(cm, el('span', 'fb-cam-end', 'cm'), set);
      } else if (!calibrating && a && b) {
        const mm = Math.round(p.scale_source === 'ruler' ? Math.hypot(b.x - a.x, b.y - a.y) / ppm : mmBetween(p, a, b, bmp.width, bmp.height));
        hint.textContent = `${mm} mm — what is it?`;
        MEASURE_WHAT.forEach(([v, l]) => {
          const k = el('button', 'fb-btn', l); k.type = 'button';
          k.onclick = () => { p.measures = [...(p.measures || []), { what: v, mm, scale: p.scale_source || 'marker' }]; a = b = null;
            saved = `Saved: ${l.toLowerCase()} ${mm} mm. Tap two more points, or Done.`; draw(); paintBar(); saveScDraft(); };
          bar.append(k);
        });
      } else hint.textContent = idle();
      if (!calibrating && p.scale_source === 'ruler') {
        const again = el('button', 'fb-link', 'Set the scale again'); again.type = 'button';
        again.onclick = () => { calibrating = true; a = b = null; saved = ''; draw(); paintBar(); };
        bar.append(again);
      }
      bar.append(close);
    };
    cv.onclick = e => {
      const r = cv.getBoundingClientRect();
      const pt = { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
      if (!a || (a && b)) { a = pt; b = null; } else b = pt;
      draw(); paintBar();
    };
    close.onclick = () => { ov.remove(); bmp.close?.(); done?.(); };
    draw(); paintBar();
  }

  // The traps of the list not photographed today, before the scouting closes: Taken down (replaced or
  // removed — it leaves the list; a new card is simply photographed), Forgot (photograph it now), or
  // Can't reach it today with a reason, which goes to the manager.
  function missingTraps(missing) {
    const sc = run.sc;
    const sheet = el('div', 'fb-sheet');
    const card = el('div', 'fb-sheet-card fb-missing');
    card.append(el('h3', null, `${missing.length} trap${missing.length === 1 ? '' : 's'} not photographed today`),
                el('div', 'config-hint', 'Every trap is checked on a trap day. For each one:'));
    const cont = el('button', 'fb-btn fb-btn-primary', 'Continue');
    const ready = () => missing.every(t => { const x = sc.status.get(t.id); return x && (x.status === 'taken_down' || String(x.note || '').trim()); });
    const paintCont = () => { cont.disabled = !ready(); };
    missing.forEach(t => {
      const row = el('div', 'fb-miss-row');
      const pc = parseTrapCode(t.code);
      row.append(el('div', 'fb-miss-code', shortCode(t.code)), el('div', 'fb-meta', pc.ok ? `${pc.n} · row ${pc.row} · ${pc.metres} m` : ''));
      const acts = el('div', 'fb-actions');
      const down = el('button', 'fb-btn', 'Taken down'); down.type = 'button';
      down.title = 'Replaced or removed: this card leaves the list';
      const forgot = el('button', 'fb-btn', 'Forgot — photograph it'); forgot.type = 'button';
      const far = el('button', 'fb-link', 'Can’t reach it today'); far.type = 'button';
      const note = el('input', 'fb-note hidden'); note.type = 'text'; note.placeholder = 'Why? (the manager is told)';
      const paint = () => {
        const x = sc.status.get(t.id);
        down.setAttribute('aria-pressed', String(x?.status === 'taken_down'));
        note.classList.toggle('hidden', x?.status !== 'unreachable');
        far.textContent = x?.status === 'unreachable' ? 'Can’t reach it today ✓' : 'Can’t reach it today';
        paintCont();
      };
      down.onclick = () => { sc.status.set(t.id, { status: 'taken_down' }); paint(); saveScDraft(); };
      far.onclick = () => { sc.status.set(t.id, { status: 'unreachable', note: sc.status.get(t.id)?.note || '' }); paint(); note.focus(); saveScDraft(); };
      note.value = sc.status.get(t.id)?.note || '';
      note.oninput = () => { sc.status.set(t.id, { status: 'unreachable', note: note.value }); paintCont(); saveScDraft(); };
      forgot.onclick = () => { sc.status.delete(t.id); saveScDraft(); sheet.remove(); sc.tab = 'trap'; document.querySelector('.fb-sc-tab')?.click(); sc.shoot?.('trap', t); };
      acts.append(down, forgot, far);
      row.append(acts, note);
      card.append(row);
      paint();
    });
    const back = el('button', 'fb-btn', 'Back'); back.type = 'button';
    back.onclick = () => sheet.remove();
    cont.onclick = () => { if (!ready()) return; sheet.remove(); finishScouting(); };
    const bar = el('div', 'fb-actions'); bar.style.justifyContent = 'flex-end'; bar.style.marginTop = 'var(--space-3)';
    bar.append(back, cont);
    card.append(bar);
    sheet.append(card);
    document.body.append(sheet);
    paintCont();
  }


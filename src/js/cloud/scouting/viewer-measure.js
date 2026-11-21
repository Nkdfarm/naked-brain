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
  async function measurePhoto(p, done) {
    let bmp;
    try { bmp = await createImageBitmap(p.full, { resizeWidth: 1600, resizeQuality: 'medium' }); }
    catch (e) { showToast('This photo could not be opened', 'error'); done?.(); return; }   // the caller waits for done (21 Nov 2026)
    let ppm = p.px_per_mm ? p.px_per_mm * (bmp.width / p.full_w) : null;
    let calibrating = !ppm;
    const ov = el('div', 'fb-cam fb-measure');
    const cv = document.createElement('canvas');
    const hint = el('div', 'fb-cam-hint', '');
    const bar = el('div', 'fb-cam-bar fb-measure-bar');
    const close = el('button', 'fb-btn', 'Done');
    ov.append(cv, hint, bar);
    document.body.append(ov);
    ov._close = () => close.onclick();   // Back (screens.js) closes it as Done does: the photo's caller is not left waiting
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
          calibrating = false; a = b = null; saved = `Scale set: ${v} cm on the ruler. Now tap the two ends of what you measure.`;
          draw(); paintBar();
        };
        bar.append(cm, el('span', 'fb-cam-end', 'cm'), set);
      } else if (!calibrating && a && b) {
        const mm = Math.round(p.scale_source === 'ruler' ? Math.hypot(b.x - a.x, b.y - a.y) / ppm : mmBetween(p, a, b, bmp.width, bmp.height));
        hint.textContent = `${mm} mm — what is it?`;
        MEASURE_WHAT.forEach(([v, l]) => {
          const k = el('button', 'fb-btn', l); k.type = 'button';
          k.onclick = () => { p.measures = [...(p.measures || []), { what: v, mm, scale: p.scale_source || 'marker' }]; a = b = null;
            saved = `Saved: ${l.toLowerCase()} ${mm} mm. Tap two more points, or Done.`; draw(); paintBar(); };
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


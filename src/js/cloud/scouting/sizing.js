//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- old scouting: how it works, sizing v1/v2, SAM. Edit here, then run: python build.py
  // ── How the scouting works (0.11.44): the working principle, one tap away ──
  function howItWorks() {
    const d = el('details', 'fb-how');
    try { d.open = localStorage.getItem('fb_how_open') === '1'; } catch (e) {}
    d.ontoggle = () => { try { localStorage.setItem('fb_how_open', d.open ? '1' : '0'); } catch (e) {} };
    d.append(el('summary', null, 'How the scouting works'));
    const list = el('ol');
    [
      ['Today\u2019s sections are the tabs.', 'Each tab has a dot: red while it is required today and its minimum is not reached yet, green when it is, or when it is not required today (it says not today, and still opens: more is always welcome). The minimum: 2 plant-health photos; 2 growth photos. Health every working day, Growth on Tuesday and Thursday (set in the console). One missed on its day comes back the next day.'],
      ['Work in parallel.', 'Walk the greenhouse once and photograph what you meet — a sick plant, a fruit to measure — each in its tab, in any order. Switching tab loses nothing, and neither does the app closing: it comes back as you left it.'],
      ['Traps.', 'Traps are read in Digital scouting: the Traps tab opens it on this zone. There each card is photographed and the AI counts it.'],
      ['One zone a task.', 'Each zone has its own scouting task (Zone 1, 2, 3, 4.1, 4.2): its photos, its OK.'],
      ['Health.', 'Anything that looks wrong: the zone comes from the task; write the row and metres if you want (B6), choose the part, add a note. With the scale card in the photo the phone says Scale detected and measures the fruit or leaf by itself ({i:square}, the object framed in the middle); tap the photo, then Re-measure and tap the right object if it took another; two taps with {i:ruler} measure by hand; Estimate the size asks the AI. Tap any photo to zoom.'],
      ['Growth.', 'Fruit or leaves with the scale card beside them (the black 5 cm square, flat, the same distance from the phone, the whole square in the photo): the phone finds it and outlines it in green; {i:ruler} Measure, then tap the two ends — the size is read in the card\u2019s plane, so a tilted card still measures right. The size the phone takes by itself is a suggestion. No card? A ruler or tape along the fruit works too: tap two marks on it, say the centimetres between them, then measure.'],
      ['AI note.', 'Only when you press it, one photo at a time; it needs signal.'],
      ['Each tab ends the same way.', 'At the bottom of Health and Growth: a green line says the section is OK. Something wrong? Tap it — it turns red — and say what in the note under it; the manager is told.'],
      ['Review.', 'The Review tab shows everything captured — every photo with its sizes, position, AI note and comment, and each section’s result. Tap a photo to zoom, a line to go back to it.'],
      ['Finish.', 'The result follows by itself: every section OK = OK; a section left red is asked about once and sent as not OK with its note. The phone says what is still missing: a section under its minimum is asked about once.'],
      ['No signal?', 'Everything is kept on the phone and sent later; the full photos follow over the connection chosen in Settings.'],
    ].forEach(([b, t]) => { const li = el('li'); li.append(el('b', null, b + ' '), nbFrag(t)); list.append(li); });
    d.append(list);
    return d;
  }

  // ── the size of the fruit or leaf, measured on the phone (0.11.53, owner: "yes automatic estimation … not library
  // available?") ── Google's MediaPipe interactive segmenter (MagicTouch, free, on the phone, cached for offline days)
  // (0.11.76: sizing v2 below — the card found and left out, points round it, the centre line's length.) It
  // outlines the object at a point: the photo's centre, where the fruit or leaf is framed, then points round it when the
  // outline runs edge to edge (a tape, a stem, the whole canopy). The outline keeps only its piece at the point and, when
  // it holds two clearly different hues (a cucumber and the yellow tape beside it), the larger one. Length = its main
  // axis; thickness = the median width of its middle slices for a fruit, the widest slice for a leaf; in millimetres from
  // the scale (the card's square or the ruler the person set). Checked on FarmLab's two cucumber photos: 274 and 349 mm
  // against the tape's 277 and ~360. A tap in the zoom viewer measures another object.
  const MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';
  let segP = null;
  function segmenter() {
    if (!segP) segP = (async () => {
      const mp = await import(MP_URL + '/vision_bundle.mjs');
      const files = await mp.FilesetResolver.forVisionTasks(MP_URL + '/wasm');
      const opts = d => ({ baseOptions: { modelAssetPath: SEG_MODEL, ...(d ? { delegate: d } : {}) }, outputCategoryMask: true, outputConfidenceMasks: false });
      // the graphics chip first (0.11.76: ~100 ms an outline instead of ~900 on the processor), the processor if it fails
      try { return await mp.InteractiveSegmenter.createFromOptions(files, opts('GPU')); }
      catch (e) { return mp.InteractiveSegmenter.createFromOptions(files, opts(null)); }
    })().catch(e => { segP = null; throw e; });
    return segP;
  }
  const segmentAt = (seg, canvas, x, y) => new Promise(res => seg.segment(canvas, { keypoint: { x, y } }, r => {
    const m = r.categoryMask, w = m.width, h = m.height, a = m.getAsUint8Array().slice(); m.close?.();
    res({ w, h, a, fg: a[Math.round(y * (h - 1)) * w + Math.round(x * (w - 1))] });
  }));
  // the connected piece at the seed (or the largest), 4-neighbour
  function maskPiece(mask, w, h, seed) {
    const lab = new Int32Array(w * h), st = new Int32Array(w * h); let id = 0, best = 0, bestN = 0;
    for (let p = 0; p < w * h; p++) {
      if (!mask[p] || lab[p]) continue;
      id++; let sp = 0, n = 0; st[sp++] = p; lab[p] = id;
      while (sp) { const q = st[--sp]; n++; const qx = q % w;
        if (qx > 0 && mask[q - 1] && !lab[q - 1]) { lab[q - 1] = id; st[sp++] = q - 1; }
        if (qx < w - 1 && mask[q + 1] && !lab[q + 1]) { lab[q + 1] = id; st[sp++] = q + 1; }
        if (q >= w && mask[q - w] && !lab[q - w]) { lab[q - w] = id; st[sp++] = q - w; }
        if (q < w * (h - 1) && mask[q + w] && !lab[q + w]) { lab[q + w] = id; st[sp++] = q + w; } }
      if (n > bestN) { bestN = n; best = id; }
    }
    const keep = seed >= 0 && lab[seed] ? lab[seed] : best, out = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) if (lab[p] === keep) out[p] = 1;
    return out;
  }
  function cleanMask(r, x, y, rgba) {
    const { w, h, a, fg } = r, on = new Uint8Array(w * h);
    for (let i = 0; i < a.length; i++) if (a[i] === fg) on[i] = 1;
    let m = maskPiece(on, w, h, Math.round(y * (h - 1)) * w + Math.round(x * (w - 1)));
    const idx = []; for (let p = 0; p < w * h; p += 7) if (m[p]) idx.push(p);
    if (idx.length < 200) return m;
    // two colours: by hue, not brightness (chromaticity r/(r+g+b), g/(r+g+b)) — the shaded side of a cucumber is the same
    // green as its lit side and must stay; the yellow tape beside it is another colour and goes
    const col = p => { const r = rgba[p * 4], g = rgba[p * 4 + 1], bl = rgba[p * 4 + 2], t = r + g + bl + 1; return [r / t, g / t]; };
    const d2 = (c, k) => (c[0] - k[0]) ** 2 + (c[1] - k[1]) ** 2;
    let c1 = null, c2 = null, lo = 1e9, hi = -1;
    idx.forEach(p => { const c = col(p), v = c[0] - c[1]; if (v < lo) { lo = v; c1 = c; } if (v > hi) { hi = v; c2 = c; } });
    let n1 = 0, n2 = 0;
    for (let it = 0; it < 8; it++) {
      const s1 = [0, 0], s2 = [0, 0]; n1 = n2 = 0;
      idx.forEach(p => { const c = col(p); if (d2(c, c1) <= d2(c, c2)) { n1++; s1[0] += c[0]; s1[1] += c[1]; } else { n2++; s2[0] += c[0]; s2[1] += c[1]; } });
      if (n1) c1 = s1.map(v => v / n1); if (n2) c2 = s2.map(v => v / n2);
    }
    if (Math.sqrt(d2(c1, c2)) > 0.07 && Math.min(n1, n2) / (n1 + n2) > 0.08) {
      const keepC = n1 >= n2 ? c1 : c2, dropC = n1 >= n2 ? c2 : c1, m2 = new Uint8Array(w * h);
      for (let p = 0; p < w * h; p++) if (m[p]) { const c = col(p); if (d2(c, keepC) <= d2(c, dropC)) m2[p] = 1; }
      m = maskPiece(m2, w, h, -1);
    }
    return m;
  }
  let sizeBusy = Promise.resolve();
  // ── sizing v2 (0.11.76, owner 30 Sept 2026: "the scale algorithm is not good … very low errors") ──
  // On FarmLab's photos of 30 Sept the marker was found right (7.9 and 11.0 px a mm) but the object measured was the
  // white card itself: the photo's centre falls between the fruit and the card held beside it. Now:
  //   1. the card is found from the marker outwards (the white paper round it) and never counts as the object;
  //   2. candidate points round the card (the card lies beside the fruit or leaf), on green, not on sky or paper;
  //      each is outlined and the outlines are scored — a fruit is long, solid, near the card and clear of the photo's
  //      edges; a leaf is large and solid — the best is kept;
  //   3. the length is the centre line's length (a curved cucumber measured along its curve, not its chord), the
  //      thickness is measured across that line.
  // A tap still measures another object; the outline is on the photo so a wrong one shows at once.
  // the card, from the marker: the printed card is 95 × 68 mm with its 50 mm marker 7 mm from the top left, so its outline
  // is the marker's plane mapped back onto the photo (a tilted card included); a card printed beside it (above, below,
  // left or right on the sheet, often cut out together) counts too when that area of the photo is white paper
  function cardMask(rgba, w, h, quad) {
    const img = quad.map(([x, y]) => [x * w, y * h]);
    const hm = homography([[0, 0], [MARKER_MM, 0], [MARKER_MM, MARKER_MM], [0, MARKER_MM]], img);
    if (!hm) return null;
    const toImg = (u, v) => applyH(hm, u, v);
    const polyOf = (u0, v0, u1, v1) => [toImg(u0, v0), toImg(u1, v0), toImg(u1, v1), toImg(u0, v1)];
    const inPoly = (poly, x, y) => { let sgn = 0; for (let i = 0; i < 4; i++) { const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % 4];
      const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (c !== 0) { const s1 = Math.sign(c); if (sgn && s1 !== sgn) return false; sgn = s1; } } return true; };
    const lum = i => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    const own = polyOf(-7, -7, 88, 61);
    // the paper's own brightness: the card's text area (right of the marker)
    const ref = []; for (let u = 62; u <= 84; u += 4) for (let v = 5; v <= 50; v += 5) { const [x, y] = toImg(u, v); const px = Math.round(x), py = Math.round(y);
      if (px >= 0 && py >= 0 && px < w && py < h) ref.push(lum((py * w + px) * 4)); }
    ref.sort((p, q) => p - q); const white = ref.length ? ref[Math.floor(ref.length * 0.7)] : 200;
    const paper = (px, py) => { if (px < 0 || py < 0 || px >= w || py >= h) return false; const i = (py * w + px) * 4, mx = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]), mn = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
      return lum(i) > 0.72 * white && mx - mn < 45; };
    const polys = [own], near = [[0, -68], [0, 68], [-95, 0], [95, 0]].map(([du, dv]) => polyOf(-7 + du, -7 + dv, 88 + du, 61 + dv));
    const pts = [own, ...near].flat();
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0])))), x1 = Math.min(w - 1, Math.ceil(Math.max(...pts.map(p => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1])))), y1 = Math.min(h - 1, Math.ceil(Math.max(...pts.map(p => p[1]))));
    const m = new Uint8Array(w * h), st = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inPoly(own, x + 0.5, y + 0.5)) { m[y * w + x] = 1; st.push(y * w + x); }
    // the paper joined to the card, only where another card may lie (so a fruit in front of that place stays whole)
    const may = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && near.some(p => inPoly(p, x + 0.5, y + 0.5));
    while (st.length) {
      const p = st.pop(), px = p % w, py = (p - px) / w;
      for (const [qx, qy] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (m[q] || !paper(qx, qy) || !may(qx, qy)) continue;
        m[q] = 1; st.push(q);
      }
    }
    const side = Math.hypot(img[1][0] - img[0][0], img[1][1] - img[0][1]);
    let bx0 = w, bx1 = 0, by0 = h, by1 = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m[y * w + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    return { m, w, h, x0: bx0, x1: bx1, y0: by0, y1: by1, side, polys, paper };
  }
  // points worth outlining: on green, off the card, the sky and the edges, nearest the card first, spread out
  // points worth outlining (0.11.80, tested on 450 COCO crops): rings round the card — the fruit or head is held
  // beside it — in every direction and of any colour (only paper, sky and deep shadow are skipped: a ripe tomato is red,
  // a banana yellow), then the middle of the photo and a coarse grid; nearest the card first, spread out
  function sizeCandidates(rgba, w, h, card) {
    const out = [];
    const okPx = (px, py) => {
      if (card && card.m[py * w + px]) return false;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) {
        const qx = Math.min(w - 1, Math.max(0, px + dx)), qy = Math.min(h - 1, Math.max(0, py + dy)), i = (qy * w + qx) * 4;
        r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
      }
      r /= n; g /= n; b /= n;
      const l = 0.299 * r + 0.587 * g + 0.114 * b, sat = Math.max(r, g, b) - Math.min(r, g, b);
      return !(l > 212 && sat < 40) && l > 22;
    };
    if (card) {
      const cx = (card.x0 + card.x1) / 2, cy = (card.y0 + card.y1) / 2, hw = (card.x1 - card.x0) / 2, hh = (card.y1 - card.y0) / 2;
      [0.3, 0.75, 1.3, 2.1, 3.2].forEach((k, ring) => {
        for (let a = 0; a < 16; a++) {
          const t = (a + (ring % 2) * 0.5) / 16 * 2 * Math.PI, dx = Math.cos(t), dy = Math.sin(t);
          const edge = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
          const px = Math.round(cx + dx * (edge + k * card.side)), py = Math.round(cy + dy * (edge + k * card.side));
          if (px < 0.02 * w || py < 0.02 * h || px > 0.98 * w || py > 0.98 * h) continue;
          if (okPx(px, py)) out.push([px / (w - 1), py / (h - 1), ring]);
        }
      });
    }
    for (let gy = 1; gy < 8; gy++) for (let gx = 1; gx < 6; gx++) {
      const x = gx / 6, y = gy / 8, px = Math.round(x * (w - 1)), py = Math.round(y * (h - 1));
      if (okPx(px, py)) out.push([x, y, 10 + Math.hypot(x - 0.5, y - 0.5)]);
    }
    out.sort((p, q) => p[2] - q[2]);
    const pick = [];
    for (const c of out) { if (pick.every(p => Math.hypot(p[0] - c[0], (p[1] - c[1]) * h / w) > 0.035)) pick.push(c); if (pick.length >= 26) break; }
    return pick.map(c => [c[0], c[1]]);
  }
  // a square box filter on a mask: erode (all in the box) or dilate (any in the box), radius r
  function boxMask(m, w, h, r, erode) {
    const I = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += m[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w - 1, x + r), ya = Math.max(0, y - r), yb = Math.min(h - 1, y + r);
      const sum = I[(yb + 1) * (w + 1) + xb + 1] - I[ya * (w + 1) + xb + 1] - I[(yb + 1) * (w + 1) + xa] + I[ya * (w + 1) + xa];
      out[y * w + x] = erode ? (sum === (xb - xa + 1) * (yb - ya + 1) ? 1 : 0) : (sum > 0 ? 1 : 0);
    }
    return out;
  }
  // the fruit's piece without the leaves it touches: open (erode, keep the seed's piece, dilate) by a fifth of its width
  function openAt(m, w, h, seed, r) {
    if (r < 2) return m;
    // only the object's box (and a margin) is filtered: the rest of the photo is empty
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let i = 0; i < m.length; i++) if (m[i]) { const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return m;
    x0 = Math.max(0, x0 - r - 1); y0 = Math.max(0, y0 - r - 1); x1 = Math.min(w - 1, x1 + r + 1); y1 = Math.min(h - 1, y1 + r + 1);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cm = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) cm[y * cw + x] = m[(y + y0) * w + x + x0];
    const e = boxMask(cm, cw, ch, r, true);
    const sx = seed % w - x0, sy = (seed - seed % w) / w - y0;
    let s0 = sy * cw + sx;
    if (!(sx >= 0 && sy >= 0 && sx < cw && sy < ch) || !e[s0]) { let best = -1, bd = 1e9;
      for (let y = Math.max(0, sy - 3 * r); y <= Math.min(ch - 1, sy + 3 * r); y++) for (let x = Math.max(0, sx - 3 * r); x <= Math.min(cw - 1, sx + 3 * r); x++)
        if (e[y * cw + x]) { const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = y * cw + x; } }
      if (best < 0) return m; s0 = best; }
    const piece = maskPiece(e, cw, ch, s0), d = boxMask(piece, cw, ch, r, false);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = (y + y0) * w + x + x0; out[i] = d[y * cw + x] & m[i]; }
    return out;
  }
  // the centre line's length and the thickness across it; area, fill, whether it runs to the photo's edges
  function outlineSize2(m, w, h, part) {
    let n = 0, sx = 0, sy = 0, edge = 0; const xs = [], ys = [];
    for (let i = 0; i < m.length; i++) if (m[i]) { const px = i % w, py = (i - px) / w; n++; sx += px; sy += py; xs.push(px); ys.push(py);
      if (px < 2 || py < 2 || px > w - 3 || py > h - 3) edge++; }
    if (n < 50) return null;
    const mx = sx / n, my = sy / n; let cxx = 0, cyy = 0, cxy = 0;
    for (let i = 0; i < n; i += 3) { const dx = xs[i] - mx, dy = ys[i] - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ux = Math.cos(ang), uy = Math.sin(ang);
    const along = new Float32Array(n), across = new Float32Array(n);
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; along[i] = dx * ux + dy * uy; across[i] = -dx * uy + dy * ux; }
    const srt = Float32Array.from(along).sort(), lo = srt[Math.floor(n * 0.002)], hi = srt[Math.min(n - 1, Math.floor(n * 0.998))], L = Math.max(1, hi - lo);
    const B = 60, mins = new Array(B).fill(Infinity), maxs = new Array(B).fill(-Infinity), cnt = new Array(B).fill(0);
    for (let i = 0; i < n; i++) { const b = Math.min(B - 1, Math.max(0, Math.floor((along[i] - lo) / L * B))); cnt[b]++;
      if (across[i] < mins[b]) mins[b] = across[i]; if (across[i] > maxs[b]) maxs[b] = across[i]; }
    const step = L / B, valid = cnt.map(c => c > 0);
    const cen = mins.map((v, b) => valid[b] ? (v + maxs[b]) / 2 : null);
    // smooth the centre line over 5 slices
    const sm = cen.map((v, b) => { if (v == null) return null; let s = 0, k = 0; for (let j = b - 2; j <= b + 2; j++) if (cen[j] != null) { s += cen[j]; k++; } return s / k; });
    let arc = 0, prev = null; const line = [];
    for (let b = 0; b < B; b++) {
      if (sm[b] == null) continue;
      const a = lo + (b + 0.5) * step;
      if (prev) arc += Math.hypot(a - prev[0], sm[b] - prev[1]);
      prev = [a, sm[b]]; line.push([mx + ux * a - uy * sm[b], my + uy * a + ux * sm[b]]);
    }
    arc += step;                                                        // the half slices at both ends
    const widths = [];
    for (let b = 0; b < B; b++) {
      if (!valid[b]) continue;
      const b0 = Math.max(0, b - 2), b1 = Math.min(B - 1, b + 2);
      const slope = sm[b1] != null && sm[b0] != null ? (sm[b1] - sm[b0]) / ((b1 - b0) * step || 1) : 0;
      widths.push((maxs[b] - mins[b]) * Math.cos(Math.atan(slope)));
    }
    const mid = widths.slice(Math.floor(widths.length * 0.2), Math.ceil(widths.length * 0.8)).sort((p, q) => p - q);
    const W = part === 'leaf' ? [...widths].sort((p, q) => p - q)[Math.floor(widths.length * 0.9)] : mid[Math.floor(mid.length * 0.4)];
    const Wmax = [...widths].sort((p, q) => p - q)[Math.floor(widths.length * 0.9)];
    const len = part === 'fruit' ? arc : L;                        // a head or a leaf: its greatest extent, not a path
    // solidity: the outline's area against its convex hull (a fruit ~0.95, a lobed leaf ~0.75, a patch of background less)
    const rowMin = new Map(), rowMax = new Map(); let bx0 = w, bx1 = 0, by0 = h, by1 = 0;
    for (let i = 0; i < n; i++) { const x = xs[i], y = ys[i];
      if (!rowMin.has(y) || x < rowMin.get(y)) rowMin.set(y, x); if (!rowMax.has(y) || x > rowMax.get(y)) rowMax.set(y, x);
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    const hp = []; for (const [y, x] of rowMin) { hp.push([x, y]); hp.push([rowMax.get(y) + 1, y]); }
    hp.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of hp) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = hp.length - 1; i >= 0; i--) { const p = hp[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    let ha = 0; for (let i = 0; i < hull.length; i++) { const p = hull[i], q = hull[(i + 1) % hull.length]; ha += p[0] * q[1] - q[0] * p[1]; }
    const solidity = Math.min(1, n / Math.max(1, Math.abs(ha) / 2));
    return { L: len, chord: L, arc, W: part === 'head' ? Wmax : W, area: n / (w * h), npx: n, fill: n / Math.max(1, len * (part === 'head' ? Wmax : W)),
             edge: edge / n, mx, my, line, ux, uy, solidity, bx0, bx1, by0, by1 };
  }
  function sizeScore(s, card, w, h, part) {
    const side = card ? card.side : Math.max(w, h) * 0.1;
    const gap = card ? Math.max(0, card.x0 - s.bx1, s.bx0 - card.x1, card.y0 - s.by1, s.by0 - card.y1) : 0;
    const near = 1 / (1 + gap / (0.8 * side));
    const rel = s.npx / (side * side);                              // against the marker's 5 × 5 cm square
    const clear = s.edge > 0.02 ? 0.25 : 1;                          // an outline running off the photo: canopy, table, background
    const sol = s.solidity ?? Math.min(1, s.fill);
    if (part === 'leaf') return Math.sqrt(s.area) * sol * near * clear;
    const sizeOK = part === 'head' ? (rel > 0.5 && rel < 90 ? 1 : 0.2) : (rel > 0.12 && rel < 70 ? 1 : 0.2);
    const shape = part === 'head' ? (s.L / Math.max(1, s.W) <= 2.2 ? 1 : 0.4) : 1;
    return Math.pow(sol, 4) * near * clear * sizeOK * shape * (0.6 + 0.4 * Math.min(1, rel / 2));
  }
  // ── SAM (0.11.81, owner 30 Sept 2026: "it is not working … a more reliable and strong library"; what failed: "Wrong
  // outline"). A tap is a prompt for Segment Anything — SlimSAM (Xenova/slimsam-77-uniform, quantised) through
  // transformers.js, loaded once and kept offline in transformers.js's own cache. The photo is encoded once, while the
  // person looks for the fruit; each tap is then fast. SAM answers three outlines (a part, the object, the object and what
  // is round it) with its own score: the best is drawn, Bigger / Smaller switch. More taps refine it — outside the outline
  // adds that part, inside it takes that part out — which MagicTouch (one point, one answer) could not do. MagicTouch
  // stays as the fallback when SAM cannot load (offline before its first use).
  const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
  const SAM_ID = 'Xenova/slimsam-77-uniform';
  // SAM runs in a Web Worker that is thrown away when it is not needed (0.11.82, owner: "impossible to have a second
  // picture, it is crashing with Aw, Snap"). In the page itself the model, the ONNX runtime's memory (WebAssembly memory
  // never shrinks), its graphics buffers (on a phone the same RAM) and every photo's encoding stayed alive after a
  // measurement — the next camera stream and 4000 px photo then ran the page out of memory. Ending the worker gives all
  // of it back: when the sheet closes, when the camera opens, when the app goes to the background, and 2 minutes idle.
  // In the worker: the graphics chip when the browser has WebGPU (half precision when it can), the processor otherwise;
  // one photo's encoding at a time.
  function samWorkerMain() {
    let S = null, cur = null;
    async function load(m, wasm) {
      if (S) return S;
      const tf = await import(m.url);
      tf.env.allowLocalModels = false;
      let tries = [['q8', 'wasm']];
      if (!wasm && self.navigator.gpu) {
        const ad = await self.navigator.gpu.requestAdapter().catch(() => null);
        if (ad) tries = [[ad.features.has('shader-f16') ? 'fp16' : 'fp32', 'webgpu'], ...tries];
      }
      let model = null, device = null, err = null;
      for (const [dtype, dev] of tries) {
        try { model = await tf.SamModel.from_pretrained(m.model, { dtype, device: dev }); device = dev; break; } catch (e) { err = e; }
      }
      if (!model) throw err;
      const processor = await tf.AutoProcessor.from_pretrained(m.model);
      S = { tf, model, processor, device };
      return S;
    }
    self.onmessage = async ({ data: m }) => {
      try {
        if (m.type === 'encode') {
          cur = null;                                                     // one photo at a time
          let s = await load(m, m.wasm);
          const inputs = await s.processor(new s.tf.RawImage(new Uint8ClampedArray(m.rgba), m.w, m.h, 4).rgb());
          let emb;
          try { emb = await s.model.get_image_embeddings(inputs); }
          catch (e) {                                                     // the graphics chip refused: the processor
            if (s.device !== 'webgpu') throw e;
            try { await s.model.dispose(); } catch (e2) { /* gone anyway */ }
            S = null; s = await load(m, true);
            emb = await s.model.get_image_embeddings(inputs);
          }
          try { inputs.pixel_values.dispose(); } catch (e) { /* not every build has dispose */ }
          cur = { key: m.key, emb, original_sizes: inputs.original_sizes, reshaped_input_sizes: inputs.reshaped_input_sizes };
          self.postMessage({ id: m.id, ok: true, device: s.device });
        } else if (m.type === 'decode') {
          if (!S || !cur || cur.key !== m.key) throw new Error('not encoded');
          const [rh, rw] = cur.reshaped_input_sizes[0];
          const input_points = new S.tf.Tensor('float32', Float32Array.from(m.points.flatMap(q => [q[0] * rw, q[1] * rh])), [1, 1, m.points.length, 2]);
          const input_labels = new S.tf.Tensor('int64', BigInt64Array.from(m.points.map(q => BigInt(q[2]))), [1, 1, m.points.length]);
          const out = await S.model({ ...cur.emb, input_points, input_labels });
          const masks = await S.processor.post_process_masks(out.pred_masks, cur.original_sizes, cur.reshaped_input_sizes);
          const t = masks[0], d = t.data, bits = new Uint8Array(d.length);
          for (let i = 0; i < d.length; i++) bits[i] = d[i] ? 1 : 0;
          self.postMessage({ id: m.id, ok: true, dims: Array.from(t.dims), scores: Array.from(out.iou_scores.data), masks: bits }, [bits.buffer]);
        }
      } catch (e) { self.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e) }); }
    };
  }
  let samW = null, samSeq = 0, samIdle = null, samCur = null, samReady = false, samWasm = false, samDevice = null;
  // loaded once on this phone: its files are then read from the phone's storage (kept across updates)
  const samKnown = () => { try { return localStorage.getItem('fb_sam_ok') === '1'; } catch (e) { return false; } };
  try { samDevice = localStorage.getItem('fb_sam_dev') || null; } catch (e) { /* private mode */ }
  const samPend = new Map(), samState = new WeakMap();
  function samWorker() {
    if (!samW) {
      const url = URL.createObjectURL(new Blob(['(' + samWorkerMain.toString() + ')();'], { type: 'text/javascript' }));
      const w = new Worker(url, { type: 'module' });
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      w.onmessage = ({ data }) => {
        const r = samPend.get(data.id); if (!r) return;
        samPend.delete(data.id); data.ok ? r.res(data) : r.rej(new Error(data.error));
      };
      w.onerror = e => { e.preventDefault?.(); samRelease(new Error(e.message || 'the outline tool stopped')); };
      samW = w;
    }
    return samW;
  }
  function samCall(msg, transfer) {
    clearTimeout(samIdle);
    return new Promise((res, rej) => {
      const id = ++samSeq; samPend.set(id, { res, rej });
      samWorker().postMessage({ ...msg, id, url: TF_URL, model: SAM_ID, wasm: samWasm }, transfer || []);
    }).finally(() => { clearTimeout(samIdle); if (samW && !samPend.size) samIdle = setTimeout(() => samRelease(), 120000); });
  }
  // the worker ended: its model, runtime, graphics buffers and the photo's encoding go with it; the MagicTouch fallback too
  function samRelease(err) {
    clearTimeout(samIdle); samIdle = null;
    if (samW) { samW.terminate(); samW = null; }
    samReady = false;                                               // the next photo prepares the tool again (from storage)
    const e = err || new Error('released');
    samPend.forEach(r => r.rej(e)); samPend.clear();
    samCur = null;
    if (segP) { const sp = segP; segP = null; sp.then(g => { try { g.close(); } catch (x) { /* closed */ } }, () => {}); }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) samRelease(); });
  // the photo at 1024 px (kept here for the card and the drawing) and SAM's encoding of it in the worker, for the photo on
  // screen only (keyed by the photo itself, so a retake starts again)
  function samPrepare(p) {
    if (samCur && samCur.full === p.full && samW) return samCur.job;
    const cur = { full: p.full, key: Math.random().toString(36).slice(2) };
    cur.job = (async () => {
      const k = Math.min(1, 1024 / Math.max(p.full_w || 1024, p.full_h || p.full_w || 1024));
      const bmp = await createImageBitmap(p.full, { resizeWidth: Math.max(1, Math.round((p.full_w || 1024) * k)), resizeQuality: 'medium' });
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); bmp.close?.();
      const rgba = cx.getImageData(0, 0, c.width, c.height).data;
      const copy = new Uint8ClampedArray(rgba);
      const r = await samCall({ type: 'encode', key: cur.key, rgba: copy.buffer, w: c.width, h: c.height }, [copy.buffer]);
      samReady = true; samDevice = r.device; if (r.device === 'wasm') samWasm = true;
      try { localStorage.setItem('fb_sam_ok', '1'); localStorage.setItem('fb_sam_dev', r.device); } catch (e) { /* private mode */ }
      return { c, rgba, key: cur.key };
    })();
    cur.job.catch(() => { if (samCur === cur) samCur = null; });
    samCur = cur;
    return cur.job;
  }
  // points [[x, y, 1 = the object | 0 = not the object]] as fractions of the photo; want +1 / −1 = the next bigger /
  // smaller of SAM's outlines than the one on screen
  function samMeasure(p, points, want) {
    const job = sizeBusy.then(async () => {
      if (!(p.full instanceof Blob) || !p.px_per_mm) return null;
      const { c, rgba, key: ek } = await samPrepare(p);
      const W = c.width, H = c.height;
      const out = await samCall({ type: 'decode', key: ek, points });
      const n = out.dims[1], mh = out.dims[2], mw = out.dims[3], data = out.masks, scores = out.scores;
      if (mw !== W || mh !== H) throw new Error(`mask ${mw}×${mh} for a ${W}×${H} photo`);
      const ppm = p.px_per_mm * (W / (p.full_w || W));
      const part = p.part === 'leaf' ? 'leaf' : p.part === 'head' ? 'head' : 'fruit';
      const card = p.scale_quad && p.scale_source === 'marker' ? cardMask(rgba, W, H, p.scale_quad) : null;
      const pos = points.filter(q => q[2] === 1), seedOf = q => Math.round(q[1] * (H - 1)) * W + Math.round(q[0] * (W - 1));
      const cands = [];
      for (let i = 0; i < n; i++) {
        // the card is never the object; the piece joined to a tap of the object
        const m = new Uint8Array(W * H), o = i * W * H;
        for (let q = 0; q < W * H; q++) if (data[o + q] && !(card && card.m[q])) m[q] = 1;
        const seed = pos.map(seedOf).find(x => m[x]);
        if (seed == null) continue;
        const piece = maskPiece(m, W, H, seed);
        const sz = outlineSize2(piece, W, H, part);
        if (sz) cands.push({ i, m: piece, s: sz, score: scores[i], npx: sz.npx, seed });
      }
      if (!cands.length) { samState.delete(p); return null; }
      const key = JSON.stringify(points), prev = samState.get(p);
      // SAM's own score, an outline running off the photo (canopy, table) less likely
      const rank = x => x.score * (x.s.edge > 0.02 ? 0.6 : 1);
      let pick = cands.reduce((b, x) => rank(x) > rank(b) ? x : b);
      if (want && prev && prev.key === key) {
        const bigger = cands.filter(x => x.npx > prev.npx * 1.08).sort((a, b) => a.npx - b.npx)[0];
        const smaller = cands.filter(x => x.npx < prev.npx / 1.08).sort((a, b) => b.npx - a.npx)[0];
        pick = (want > 0 ? bigger : smaller) || cands.find(x => x.i === prev.i) || pick;
      }
      let { m, s: sz } = pick;
      if (part === 'fruit' || part === 'head') {                      // a stalk or a leaf joined by a thin bridge
        const m2 = openAt(m, W, H, pick.seed, Math.round(sz.W * (part === 'head' ? 0.12 : 0.2)));
        const s2 = m2 !== m && outlineSize2(m2, W, H, part);
        if (s2 && s2.npx > 0.85 * sz.npx) { m = m2; sz = s2; }
      }
      samState.set(p, { points, key, i: pick.i, npx: pick.npx, m, w: W, h: H,
        bigger: cands.some(x => x.npx > pick.npx * 1.08), smaller: cands.some(x => x.npx < pick.npx / 1.08) });
      return sizeResult(c, { w: W, h: H }, m, sz, part, ppm, card, [pos[0][0], pos[0][1]], points, 'size-sam');
    });
    sizeBusy = job.catch(() => {});
    return job;
  }
  function autoMeasure(p, point, want) {
    if (point && Array.isArray(point[0])) return samMeasure(p, point, want).catch(e => {
      if (e && e.message === 'released') return null;
      console.warn('SAM', e); samState.delete(p);
      const q = point.find(x => x[2] === 1) || point[0];
      return mtMeasure(p, [q[0], q[1]]);
    });
    return mtMeasure(p, point);
  }
  function mtMeasure(p, point) {
    const job = sizeBusy.then(async () => {
      if (!(p.full instanceof Blob) || !p.px_per_mm) return null;
      const seg = await segmenter();
      const k = Math.min(1, 1024 / Math.max(p.full_w || 1024, p.full_h || p.full_w || 1024));
      const bmp = await createImageBitmap(p.full, { resizeWidth: Math.max(1, Math.round((p.full_w || 1024) * k)), resizeQuality: 'medium' });
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); bmp.close?.();
      const rgba = cx.getImageData(0, 0, c.width, c.height).data;
      const ppm = p.px_per_mm * (c.width / (p.full_w || c.width));
      const part = p.part === 'leaf' ? 'leaf' : p.part === 'head' ? 'head' : 'fruit';
      const card = p.scale_quad && p.scale_source === 'marker' ? cardMask(rgba, c.width, c.height, p.scale_quad) : null;
      const pts = point ? [point] : sizeCandidates(rgba, c.width, c.height, card);
      let best = null; const seen = [];
      for (const [x, y] of pts) {
        // a point inside an object already outlined is the same object: not outlined again
        if (seen.some(o => o.m[Math.round(y * (o.h - 1)) * o.w + Math.round(x * (o.w - 1))])) continue;
        const r = await segmentAt(seg, c, x, y);
        let m = cleanMask(r, x, y, rgba);
        // the card and the hands are never part of the object
        { const kx = c.width / r.w, ky = c.height / r.h;
          for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.w; xx++) {
            const q = yy * r.w + xx; if (!m[q]) continue;
            const cx0 = Math.min(c.width - 1, Math.round(xx * kx)), cy0 = Math.min(c.height - 1, Math.round(yy * ky));
            if (card && card.m[cy0 * c.width + cx0]) { m[q] = 0; continue; }
            const i = (cy0 * c.width + cx0) * 4, R = rgba[i], G = rgba[i + 1], Bl = rgba[i + 2];
            if (R > 90 && R > G && G > Bl && R - G >= 12 && R - G <= 75 && G - Bl >= 5 && G - Bl <= 65) { m[q] = 0; continue; }   // skin
            if (card && card.paper(cx0, cy0)) m[q] = 0;                     // any white paper
          }
          const seedP = Math.round(y * (r.h - 1)) * r.w + Math.round(x * (r.w - 1));
          if (!m[seedP]) continue;                                          // the point fell on the card or a hand
          m = maskPiece(m, r.w, r.h, seedP);
        }
        let s = outlineSize2(m, r.w, r.h, part);
        if (!s) continue;
        if (part === 'fruit' || part === 'head') {                      // cut the bridges into the leaves behind it
          const seedP = Math.round(y * (r.h - 1)) * r.w + Math.round(x * (r.w - 1));
          const m2 = openAt(m, r.w, r.h, seedP, Math.round(s.W * (part === 'head' ? 0.12 : 0.2)));
          const s2 = m2 !== m && outlineSize2(m2, r.w, r.h, part);
          if (s2 && s2.npx > 0.4 * s.npx) { m = m2; s = s2; }
        }
        if (!point && (s.area < 0.003 || s.area > 0.5)) continue;
        const pmm = ppm * r.w / c.width;
        if (!point && part === 'fruit' && (s.W / pmm < 8 || s.L / Math.max(1, s.W) > 25)) continue;   // a stem, a string
        if (!point && part === 'head' && s.W / pmm < 30) continue;                                       // a head is 3 cm at least
        const score = point ? 1 : sizeScore(s, card && { x0: card.x0 * r.w / c.width, x1: card.x1 * r.w / c.width, y0: card.y0 * r.h / c.height, y1: card.y1 * r.h / c.height, side: card.side * r.w / c.width }, r.w, r.h, part);
        seen.push({ m, w: r.w, h: r.h });
        if (!best || score > best.score) best = { score, s, m, r, x, y };
        if (point) break;

      }
      if (!best) return null;
      return sizeResult(c, best.r, best.m, best.s, part, ppm, card, [best.x, best.y], null, 'size-v2');
    });
    sizeBusy = job.catch(() => {});
    return job;
  }
  // two straight lines on an outline (0.11.98, owner 4 Oct 2026: "the dimensions are not correct for strange shape crops …
  // just 2 straight lines: the first the longest from detected borders and the second at 90 degrees from the longest"):
  // the longest = the two border points farthest apart; across = the longest border-to-border line at a right angle to it
  function twoLines(m, w, h) {
    const pts = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!m[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) pts.push([x, y]);
    }
    if (pts.length < 8) return null;
    const srt = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of srt) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (let i = srt.length - 1; i >= 0; i--) { const q = srt[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    let A = hull[0], B = hull[0], best = -1;
    for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) {
      const d = (hull[i][0] - hull[j][0]) ** 2 + (hull[i][1] - hull[j][1]) ** 2;
      if (d > best) { best = d; A = hull[i]; B = hull[j]; }
    }
    const L = Math.sqrt(best); if (L < 4) return null;
    const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
    // across: per slice along the longest line, from the border on one side to the border on the other
    const n = Math.ceil(L) + 1, lo = new Float32Array(n).fill(Infinity), hi = new Float32Array(n).fill(-Infinity);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {          // every pixel of the outline: no slice is left thin
      if (!m[y * w + x]) continue;
      const dx = x - A[0], dy = y - A[1], t = Math.min(n - 1, Math.max(0, Math.round(dx * ux + dy * uy))), v = -dx * uy + dy * ux;
      if (v < lo[t]) lo[t] = v; if (v > hi[t]) hi[t] = v;
    }
    const span = t => (hi[t] >= lo[t] ? hi[t] - lo[t] : -1);
    let bt = -1, bw = -1;
    for (let t = 1; t < n - 1; t++) {                                  // the middle of three slices: one stray pixel is not a width
      const three = [[span(t - 1), t - 1], [span(t), t], [span(t + 1), t + 1]].sort((p, q) => p[0] - q[0])[1];
      if (three[0] > bw) { bw = three[0]; bt = three[1]; }
    }
    if (bt < 0) return null;
    const cx = A[0] + ux * bt, cy = A[1] + uy * bt;
    const C = [cx - uy * lo[bt], cy + ux * lo[bt]], D = [cx - uy * hi[bt], cy + ux * hi[bt]];
    return { A, B, C, D, L: L + 1, W: Math.hypot(D[0] - C[0], D[1] - C[1]) + 1 };
  }
  // the contour on a copy of the photo; the taps too (green = the object, red = not the object)
  function sizeResult(c, r, m, s, part, ppm, card, point, points, algorithm) {
      // the contour on a copy of the photo (0.11.79): the object's edge drawn, its length and its width lines labelled in
      // millimetres, the card framed — so what was measured shows at a glance
      const v = document.createElement('canvas'); const vk = Math.min(1, 900 / Math.max(c.width, c.height));
      v.width = Math.round(c.width * vk); v.height = Math.round(c.height * vk);
      const vx = v.getContext('2d'); vx.drawImage(c, 0, 0, v.width, v.height);
      const kv = v.width / r.w, pmm = ppm * r.w / c.width;
      const tint = document.createElement('canvas'); tint.width = r.w; tint.height = r.h;
      const tx = tint.getContext('2d'), im = tx.createImageData(r.w, r.h);
      for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.w; xx++) {
        const i = yy * r.w + xx; if (!m[i]) continue;
        const edgeP = xx === 0 || yy === 0 || xx === r.w - 1 || yy === r.h - 1 || !m[i - 1] || !m[i + 1] || !m[i - r.w] || !m[i + r.w];
        const o = i * 4;
        if (edgeP) { im.data[o] = 255; im.data[o + 1] = 235; im.data[o + 2] = 59; im.data[o + 3] = 255; }
        else { im.data[o] = 255; im.data[o + 1] = 0; im.data[o + 2] = 200; im.data[o + 3] = 40; }
      }
      tx.putImageData(im, 0, 0);
      vx.imageSmoothingEnabled = false;
      // the edge a little thicker than one pixel of the mask
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) vx.drawImage(tint, dx, dy, v.width, v.height);
      vx.imageSmoothingEnabled = true;
      const label = (t, x, y) => {
        vx.font = 'bold 22px system-ui, sans-serif'; const tw = vx.measureText(t).width;
        const lx = Math.min(v.width - tw - 12, Math.max(4, x - tw / 2)), ly = Math.min(v.height - 8, Math.max(26, y));
        vx.fillStyle = 'rgba(0,0,0,0.72)'; vx.fillRect(lx - 6, ly - 22, tw + 12, 30);
        vx.fillStyle = '#fff'; vx.fillText(t, lx, ly);
      };
      // the two straight lines: the longest in blue, the one across it in pink
      const tl = twoLines(m, r.w, r.h);
      if (!tl) return null;
      const P = q => [q[0] * kv, q[1] * kv], [A, B, C, D] = [tl.A, tl.B, tl.C, tl.D].map(P);
      const seg = (a, b, col) => { vx.strokeStyle = col; vx.lineWidth = 4; vx.beginPath(); vx.moveTo(a[0], a[1]); vx.lineTo(b[0], b[1]); vx.stroke();
        [a, b].forEach(q => { vx.beginPath(); vx.arc(q[0], q[1], 6, 0, 2 * Math.PI); vx.fillStyle = col; vx.fill(); }); };
      seg(A, B, '#00e5ff'); seg(C, D, '#ff4081');
      const Lmm = Math.round(tl.L / pmm), Wmm = Math.round(tl.W / pmm);
      label(`Longest ${Lmm} mm`, A[0], A[1] - 14);
      label(`Across ${Wmm} mm`, D[0] + 60, D[1] + 30);
      if (card) { vx.strokeStyle = '#00e676'; vx.lineWidth = 2; card.polys.forEach(pl => { vx.beginPath(); pl.forEach(([px, py], i) => i ? vx.lineTo(px * vk, py * vk) : vx.moveTo(px * vk, py * vk)); vx.closePath(); vx.stroke(); }); }
      (points || []).forEach(([px, py, lab]) => {
        const x = px * v.width, y = py * v.height;
        vx.beginPath(); vx.arc(x, y, 11, 0, 2 * Math.PI); vx.fillStyle = lab ? '#00c853' : '#ff1744'; vx.fill();
        vx.lineWidth = 3; vx.strokeStyle = '#fff'; vx.stroke();
        vx.fillStyle = '#fff'; vx.fillRect(x - 6, y - 1.5, 12, 3); if (lab) vx.fillRect(x - 1.5, y - 6, 3, 12);
      });
      return { length_mm: Lmm, width_mm: Wmm, point,
               view: v.toDataURL('image/jpeg', 0.78), algorithm: 'lines-v3', part };
  }


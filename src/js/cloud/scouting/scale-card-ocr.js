//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- old scouting: scale card, trap code OCR, handwriting, AI note. Edit here, then run: python build.py
  // ── the scale card (0.11.69): a printed marker whose black square is exactly 50 mm ──
  // The magenta square was found by its colour, which printers and greenhouse light change, and the card had
  // two squares close together (owner: "not square detection, wrong size"). The card is now an ArUco marker
  // (MIP 36h12, id 0; console/scale-card.html): js-aruco2 (MIT, from jsDelivr, cached for offline days by the
  // service worker) finds its four corners in any light; a homography from those corners to the 50 × 50 mm square
  // measures two taps in the card's plane, so a tilted card still measures right. The object must be beside the
  // card, at the same distance from the phone — the one error no algorithm can remove.
  const MARKER_MM = 50;
  const ARUCO = 'https://cdn.jsdelivr.net/npm/js-aruco2@2.0.0/src/';
  let arP = null;
  function arDetector() {
    if (!arP) arP = (async () => {
      if (!window.CV) await loadScript(ARUCO + 'cv.js');
      if (!window.AR) await loadScript(ARUCO + 'aruco.js');
      return new window.AR.Detector({ dictionaryName: 'ARUCO_MIP_36h12' });
    })().catch(e => { arP = null; throw e; });
    return arP;
  }
  // the 3 × 3 homography taking four image points to four plane points (a small Gauss–Jordan on 8 unknowns)
  function homography(src, dst) {
    const A = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
    }
    const h = A.map((row, i) => row[8] / row[i]);
    return [...h, 1];
  }
  const applyH = (h, x, y) => { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
  // the marker in a photo: its corners (as fractions of the photo), px per mm at the card, how square it looks
  async function findMarker(canvas) {
    let det;
    try { det = await arDetector(); } catch (e) { return { error: 'offline' }; }
    const W = canvas.width, H = canvas.height, big = Math.max(W, H);
    for (const w of [960, 1600, 640]) {                     // the long side tried: the detector likes cells of ~8–30 px
      const c = w >= big ? canvas : scaleCanvas(canvas, w);
      let ms = [];
      try { ms = det.detect(c.getContext('2d').getImageData(0, 0, c.width, c.height)); } catch (e) { ms = []; }
      // only the FarmBox card's own marker (0.11.80): id 0, seen as a square, black and white inside. The old magenta
      // card's square and the marks of a tape were once taken for it (28–29 Sept), giving a wrong scale
      ms = ms.filter(m => m.id === 0 && markerLooksRight(c, m.corners));
      if (!ms.length) { if (w >= big) break; continue; }
      const k = W / c.width;
      const area = m => { const q = m.corners; let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p.x * n.y - n.x * p.y; } return Math.abs(a) / 2; };
      const m = ms.sort((x, y) => area(y) - area(x))[0];
      const q = m.corners.map(p => [p.x * k, p.y * k]);
      const sides = q.map((p, i) => Math.hypot(q[(i + 1) % 4][0] - p[0], q[(i + 1) % 4][1] - p[1]));
      const side = sides.reduce((a, b) => a + b, 0) / 4;
      if (side < 40) return null;                           // too small to trust
      if (Math.max(...sides) / Math.min(...sides) > 1.45) return null;   // no flat square seen at an angle is this distorted
      return { ppm: side / MARKER_MM, quad: q.map(([x, y]) => [x / W, y / H]), skew: Math.max(...sides) / Math.min(...sides), side: Math.round(side) };
    }
    return null;
  }
  // the marker is black and white: its inside sampled through its plane has no colour (the magenta square has)
  function markerLooksRight(canvas, corners) {
    const q = corners.map(p => [p.x, p.y]);
    const hm = homography([[0, 0], [8, 0], [8, 8], [0, 8]], q);
    if (!hm) return false;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(canvas.width - 1, Math.ceil(Math.max(...xs))), y1 = Math.min(canvas.height - 1, Math.ceil(Math.max(...ys)));
    if (x1 <= x0 || y1 <= y0) return false;
    const d = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data, W = x1 - x0 + 1;
    let sat = 0; const ls = [];
    for (let v = 0.5; v < 8; v += 1) for (let u = 0.5; u < 8; u += 1) {       // the centre of each of the 8 × 8 cells
      const [x, y] = applyH(hm, u, v), px = Math.round(x) - x0, py = Math.round(y) - y0;
      if (px < 0 || py < 0 || px >= W || py > y1 - y0) continue;
      const i = (py * W + px) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      sat += Math.max(r, g, b) - Math.min(r, g, b); ls.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
    if (ls.length < 40) return false;
    // in sunlight the black prints grey: dark and light are read against the marker's own range
    const lo = Math.min(...ls), hi = Math.max(...ls), mid = (lo + hi) / 2;
    const dark = ls.filter(l => l < mid).length, light = ls.length - dark;
    return sat / ls.length < 55 && hi - lo >= 45 && dark >= 20 && light >= 4;   // grey cells, black ones (the border) and white ones
  }
  // mm between two points of a photo drawn w × h, against the marker's plane (or the plain px/mm)
  function mmBetween(p, a, b, w, h) {
    if (p.scale_quad && p.scale_source === 'marker') {
      const hm = homography(p.scale_quad.map(([x, y]) => [x * w, y * h]), [[0, 0], [MARKER_MM, 0], [MARKER_MM, MARKER_MM], [0, MARKER_MM]]);
      if (hm) { const A = applyH(hm, a.x, a.y), B = applyH(hm, b.x, b.y); return Math.hypot(B[0] - A[0], B[1] - A[1]); }
    }
    const ppm = p.px_per_mm * (w / (p.full_w || w));
    return Math.hypot(b.x - a.x, b.y - a.y) / ppm;
  }
  const scaleWords = p => p.scale_source === 'ruler' ? 'scale set on the ruler'
    : p.scale_source === 'marker' ? 'Scale card found' + (p.scale_skew > 1.3 ? ' · card tilted, sizes less sure' : '')
    : p.scale_source === 'card' ? 'Scale detected · 5 cm square' : '';

  // ── reading the trap's code off the card ────────────────────────────────
  // Tesseract.js, loaded from jsDelivr the first time a trap is photographed and
  // kept by the service worker for offline days (its language file is kept by
  // Tesseract itself). What it reads is matched to this unit's trap codes,
  // allowing the usual look-alikes (O/0, I/1, S/5, B/8, Z/2, G/6) and one wrong
  // character — never a code the farm does not have. Nothing is sent anywhere.
  let ocrP = null;
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.append(s); });
  }
  // the reader's worker holds some tens of MB: it is ended before the phone's own camera opens (0.11.110) and loads
  // again when a code is next read (its files are kept by the service worker)
  function ocrRelease() {
    const was = ocrP; if (!was) return;
    ocrP = null;
    ocrBusy = ocrBusy.then(() => was.then(w => w.terminate()).catch(() => {}));
  }
  function ocr() {
    if (!ocrP) ocrP = (async () => {
      if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
      const w = await window.Tesseract.createWorker('eng', 1);
      await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', tessedit_pageseg_mode: '11' });
      return w;
    })().catch(e => { ocrP = null; throw e; });
    return ocrP;
  }
  const LOOK = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6', T: '7' };
  const canon = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const alike = (a, b) => a === b || LOOK[a] === b || LOOK[b] === a || (LOOK[a] && LOOK[a] === LOOK[b]);
  function codeDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : alike(a[i - 1], b[j - 1]) ? 0.25 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
    }
    return d[a.length][b.length];
  }
  // A trap's code (FarmBox 0147): where it hangs — 1B6 = zone (or bay) 1, row B, 6 m from the corridor.
  // One trap per position, whatever card hangs there; the app keeps each card's start itself (the first
  // photo, Replaced, or the count falling hard). A date written after a D on an older card is dropped.
  function parseTrapCode(raw) {
    const v = String(raw || '').toUpperCase().replace(/[\s\-_.·/]/g, '');
    const m = /^([0-9]+)([A-Z]+)([0-9]+(?:,[0-9]+)?)(?:D[0-9]{4}(?:[0-9]{4})?)?$/.exec(v);
    if (!m) return { ok: false, code: v };
    const spot = m[1] + m[2] + m[3];
    return { ok: true, code: spot, spot, n: m[1], row: m[2], metres: m[3].replace(',', '.') };
  }
  const shortCode = c => String(c || '').replace(/D\d{4}(?:\d{4})?$/, '');
  // what the text reader saw, bent into a position: digits where digits belong, letters where letters do
  const TO_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6', T: '7' };
  const TO_LETTER = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G', '7': 'T' };
  function coerceCode(raw) {
    const s0 = canon(raw).replace(/D\d{4}(?:\d{4})?$/, '');
    if (s0.length < 3 || s0.length > 6) return null;
    const dig = x => [...x].map(c => /\d/.test(c) ? c : TO_DIGIT[c] || '?').join('');
    const let_ = x => [...x].map(c => /[A-Z]/.test(c) ? c : TO_LETTER[c] || '?').join('');
    for (let zl = 1; zl <= 2; zl++) for (let rl = 1; rl <= 2; rl++) {
      const ml = s0.length - zl - rl;
      if (ml < 1 || ml > 2) continue;
      const code = dig(s0.slice(0, zl)) + let_(s0.slice(zl, zl + rl)) + dig(s0.slice(zl + rl));
      if (/\?/.test(code)) continue;
      const p = parseTrapCode(code);
      if (p.ok && +p.metres <= 200) return p;
    }
    return null;
  }
  function matchCode(words, traps) {
    const w = words.map(canon).filter(x => x.length >= 1);
    const cands = new Set();
    w.forEach((x, i) => { cands.add(x); if (w[i + 1]) cands.add(x + w[i + 1]); if (w[i + 2]) cands.add(x + w[i + 1] + w[i + 2]); });
    const forms = t => [...new Set([canon(t.code), canon(shortCode(t.code))])];
    const scored = traps.map(t => ({ trap: t, d: Math.min(Infinity, ...[...cands].filter(c => c.length >= 2).flatMap(c => forms(t).map(f => codeDistance(c, f)))) }))
      .sort((a, b) => a.d - b.d);
    // one wrong character is enough when no other code is near; up to one and a half when every other code is far off
    const gap = scored[1] ? scored[1].d - scored[0].d : Infinity;
    if (!scored.length || !((scored[0].d <= 1 && gap >= 0.5) || (scored[0].d <= 1.5 && gap >= 1.25))) return null;
    return scored[0].trap;
  }
  // ── the handwritten code (0.11.47, owner: "the text detection of id in traps looks not working …
  // the trap id is written by hand in capital letters") ──────────────────────────────────────────
  // Reading the whole photo made the text reader wade through the grid, the insects and the card's
  // edge for loose words, and a marker code was lost among them. So the code is found first: the
  // printed grid lines are wiped (anything thinner than 0.8 mm), what is left is split into shapes,
  // and a letter is a shape 5–45 mm tall that is a stroke, not a solid blob (an insect is solid and
  // under 9 mm). Letters standing side by side on one line (or one above the other, for a code
  // written down the card) are the code. The line is redrawn black on white, its own strokes only,
  // and read at three sizes in two line modes (the reader does best with letters ~28 px tall; read
  // one by one, single letters came back empty); each reading is bent into the shape of a position
  // (zone digits · row letters · metre digits) and the readings vote.
  // opts.head: only the card's header band (its top quarter, above the grid: no printed lines there, so nothing is
  // wiped and a pen's thin strokes stay whole — 0.11.54, the owner writes the code in the same clear spot from now on)
  function findWriting(canvas, colour, opts = {}) {
    const W = canvas.width, H = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const blue = colour === 'blue';
    const isCard = i => { const r = d[i], g = d[i + 1], b = d[i + 2];
      return blue ? (b > 110 && b > r + 40 && b > g + 10) : (r > 140 && g > 110 && b < 120 && r - b > 60 && g - b > 40); };
    const xs = [], ys = []; let n = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (isCard((y * W + x) * 4) && ++n % 7 === 0) { xs.push(x); ys.push(y); }
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (xs.length > 50) {
      xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
      const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
      x0 = q(xs, 0.02); x1 = q(xs, 0.98); y0 = q(ys, 0.02); y1 = q(ys, 0.98);
    }
    const ppm = Math.max(x1 - x0 + 1, y1 - y0 + 1) / 250;              // a 25 cm card, near enough to size letters
    if (opts.head) {
      // the header ends at the first printed grid line: the first row, past the top tenth, dark across most of the card
      const cw = x1 - x0 + 1, lim = y0 + Math.round(0.4 * (y1 - y0));
      let cut = y0 + Math.round(0.27 * (y1 - y0));
      for (let y = y0 + Math.round(0.1 * (y1 - y0)); y < lim; y++) {
        let dark = 0;
        for (let x = x0; x <= x1; x += 2) { const i = (y * W + x) * 4; if (!isCard(i) && 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 105) dark++; }
        if (dark * 2 > 0.6 * cw) { cut = y - Math.round(0.01 * (y1 - y0)); break; }
      }
      y1 = cut;
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const mask = new Uint8Array(bw * bh);
    // ink: in the header, anything well darker than the card itself (a thin pen stroke blends into the card's colour and
    // would pass for card); elsewhere dark and not card-coloured
    let inkBelow = 105;
    if (opts.head) {
      const ls = [];
      for (let y = 0; y < bh; y += 3) for (let x = 0; x < bw; x += 3) { const i = ((y + y0) * W + x + x0) * 4; if (isCard(i)) ls.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); }
      ls.sort((a, b) => a - b);
      if (ls.length > 50) inkBelow = 0.62 * ls[ls.length >> 1];
    }
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = ((y + y0) * W + x + x0) * 4, lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (opts.head ? lum < inkBelow : (!isCard(i) && lum < 105)) mask[y * bw + x] = 1;
    }
    // the printed grid: a line under 0.8 mm thick, at any tilt (a marker stroke is 1.5 mm and more). A pixel
    // goes when its run of dark across or down is that thin — where the grid crosses a letter the letter stays
    const thin = Math.max(3, Math.round(0.8 * ppm)), hr = new Uint16Array(bw * bh), vr = new Uint16Array(bw * bh);
    for (let y = 0; y < bh; y++) { let s = -1; for (let x = 0; x <= bw; x++) { const on = x < bw && mask[y * bw + x]; if (on && s < 0) s = x; if (!on && s >= 0) { for (let k = s; k < x; k++) hr[y * bw + k] = x - s; s = -1; } } }
    for (let x = 0; x < bw; x++) { let s = -1; for (let y = 0; y <= bh; y++) { const on = y < bh && mask[y * bw + x]; if (on && s < 0) s = y; if (!on && s >= 0) { for (let k = s; k < y; k++) vr[k * bw + x] = y - s; s = -1; } } }
    if (!opts.head) for (let i = 0; i < mask.length; i++) if (mask[i] && Math.min(hr[i], vr[i]) <= thin) mask[i] = 0;
    // shapes (8-neighbour), each pixel labelled
    const lab = new Int32Array(bw * bh), stack = new Int32Array(bw * bh), shapes = [];
    for (let p = 0; p < bw * bh; p++) {
      if (!mask[p] || lab[p]) continue;
      const id = shapes.length + 1; let sp = 0, cnt = 0, mnx = bw, mxx = 0, mny = bh, mxy = 0;
      stack[sp++] = p; lab[p] = id;
      while (sp) {
        const q = stack[--sp]; cnt++;
        const qx = q % bw, qy = (q - qx) / bw;
        if (qx < mnx) mnx = qx; if (qx > mxx) mxx = qx; if (qy < mny) mny = qy; if (qy > mxy) mxy = qy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const r = ny * bw + nx;
          if (mask[r] && !lab[r]) { lab[r] = id; stack[sp++] = r; }
        }
      }
      shapes.push({ id, n: cnt, x: mnx, y: mny, w: mxx - mnx + 1, h: mxy - mny + 1 });
    }
    const lines = [];
    for (const vertical of opts.head ? [false] : [false, true]) {
      // a letter: 5–45 mm along the line's height, a stroke rather than a blob
      const T = s => vertical ? { a: s.y, b: s.x, la: s.h, lb: s.w } : { a: s.x, b: s.y, la: s.w, lb: s.h };
      const cand = shapes.filter(s => {
        const t = T(s), fill = s.n / (s.w * s.h), thin = Math.max(s.w, s.h) >= 3 * Math.min(s.w, s.h);
        return t.lb >= 5 * ppm && t.lb <= 45 * ppm && t.la <= 40 * ppm && (fill <= 0.62 || thin) && s.n >= 20;
      }).map(s => ({ s, ...T(s) }));
      // pieces of one letter (a broken stroke) stand over each other along the line
      cand.sort((u, v) => u.a - v.a);
      const chars = [];
      for (const c of cand) {
        const prev = chars.find(ch => Math.min(ch.a + ch.la, c.a + c.la) - Math.max(ch.a, c.a) > 0.6 * Math.min(ch.la, c.la)
                                       && Math.min(ch.b + ch.lb, c.b + c.lb) - Math.max(ch.b, c.b) > -0.3 * Math.max(ch.lb, c.lb));
        if (prev) { const a = Math.min(prev.a, c.a), b = Math.min(prev.b, c.b);
          prev.la = Math.max(prev.a + prev.la, c.a + c.la) - a; prev.lb = Math.max(prev.b + prev.lb, c.b + c.lb) - b; prev.a = a; prev.b = b; prev.ids.push(c.s.id); }
        else chars.push({ a: c.a, b: c.b, la: c.la, lb: c.lb, ids: [c.s.id] });
      }
      chars.sort((u, v) => u.a - v.a);
      // letters on one line: overlapping across the line, of a like height, close along it
      const used = new Set();
      for (let i = 0; i < chars.length; i++) {
        if (used.has(i)) continue;
        const g = [chars[i]]; used.add(i);
        for (let j = i + 1; j < chars.length; j++) {
          if (used.has(j)) continue;
          const last = g[g.length - 1], c = chars[j];
          const over = Math.min(last.b + last.lb, c.b + c.lb) - Math.max(last.b, c.b);
          const ratio = c.lb / last.lb, gap = c.a - (last.a + last.la);
          if (over >= 0.45 * Math.min(last.lb, c.lb) && ratio > 0.45 && ratio < 2.2 && gap <= 1.1 * Math.max(last.lb, c.lb)) { g.push(c); used.add(j); }
        }
        if (g.length >= 2 && g.length <= 8) {
          const hs = g.map(c => c.lb).sort((a, b) => a - b);
          lines.push({ vertical, chars: g, score: Math.min(g.length, 6) * hs[hs.length >> 1] - (g.length > 6 ? 50 : 0) });
        }
      }
    }
    lines.sort((a, b) => b.score - a.score);
    // redraw black on white, the letter's own pixels only, turned to read left to right
    const draw = (ids, a0, b0, la, lb, vertical, turn) => {
      const set = new Set(ids), k = 64 / lb, pad = 18;
      const c = document.createElement('canvas');
      c.width = Math.round(la * k) + 2 * pad; c.height = 64 + 2 * pad;
      const cx = c.getContext('2d', { willReadFrequently: true });
      const img = cx.createImageData(c.width, c.height); img.data.fill(255);
      for (let v = 0; v < c.height; v++) for (let u = 0; u < c.width; u++) {
        const A = a0 + (u - pad) / k, B = b0 + (v - pad) / k;
        // across the card as it is; written down the card (tops to the right) turned back a quarter;
        // written up the card (tops to the left) turned the other way
        let X, Y;
        if (!vertical) { X = A; Y = B; }
        else if (!turn) { Y = A; X = 2 * b0 + lb - B; }
        else { X = B; Y = 2 * a0 + la - A; }
        X = Math.round(X); Y = Math.round(Y);
        if (X < 0 || Y < 0 || X >= bw || Y >= bh) continue;
        if (set.has(lab[Y * bw + X])) { const o = (v * c.width + u) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 0; }
      }
      cx.putImageData(img, 0, 0);
      return c;
    };
    const out = [];
    for (const L of lines.slice(0, 2)) {
      const a0 = L.chars[0].a, a1 = Math.max(...L.chars.map(c => c.a + c.la));
      const b0 = Math.min(...L.chars.map(c => c.b)), b1 = Math.max(...L.chars.map(c => c.b + c.lb));
      for (const turn of L.vertical ? [false, true] : [false]) {
        out.push({
          line: draw(L.chars.flatMap(c => c.ids), a0, b0, a1 - a0, b1 - b0, L.vertical, turn),
          box: L.vertical ? { x: (b0 + x0) / W, y: (a0 + y0) / H, w: (b1 - b0) / W, h: (a1 - a0) / H }
                          : { x: (a0 + x0) / W, y: (b0 + y0) / H, w: (a1 - a0) / W, h: (b1 - b0) / H },
        });
      }
    }
    return out;
  }
  const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', DIGITS = '0123456789', LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let ocrBusy = Promise.resolve();
  function readTrapCode(canvas, traps) {
    const job = ocrBusy.then(() => readTrapCodeNow(canvas, traps));
    ocrBusy = job.catch(() => {});
    return job;
  }
  // the drawn line (letters 64 px tall, 18 px margin) at another letter height
  function atHeight(c, h) {
    const pad = Math.round(h * 0.6), k = h / 64, o = document.createElement('canvas');
    o.width = Math.round((c.width - 36) * k) + 2 * pad; o.height = h + 2 * pad;
    const x = o.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height); x.imageSmoothingQuality = 'high';
    x.drawImage(c, 18, 18, c.width - 36, 64, pad, pad, o.width - 2 * pad, h);
    return o;
  }
  async function readTrapCodeNow(canvas, traps) {
    const w = await ocr();
    const one = async (img, psm) => {
      await w.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: ALNUM });
      const { data } = await w.recognize(img);
      return { text: canon(data.text), conf: data.confidence || 0 };
    };
    // the readings vote — for a trap of the unit, and for the position they spell — and the reading
    // stops as soon as two agree (a reading takes about a second on a phone; six of them would be slow)
    const reads = [], known = new Map(), fresh = new Map();
    const vote = r => {
      const m = traps.length ? matchCode([r.text], traps) : null;
      if (m) { const t = known.get(m.id) || { trap: m, v: 0, n: 0, box: r.box }; t.v += 1 + r.conf / 100; t.n++; known.set(m.id, t); }
      const f = coerceCode(r.text);
      if (f) { const t = fresh.get(f.code) || { f, v: 0, n: 0, box: r.box }; t.v += 1 + r.conf / 100; t.n++; fresh.set(f.code, t); }
    };
    // two readings agreeing on a new position stop the reading only when it is unlike every trap of the unit:
    // "1Z6" beside 1B6 and 1E6 is a trap misread, not a new card, and the other sizes may still settle it
    const unlike = code => traps.every(t => codeDistance(code, canon(shortCode(t.code))) >= 1.5);
    const agreed = () => [...known.values()].some(t => t.n >= 2) || (!known.size && [...fresh.values()].some(t => t.n >= 2 && unlike(t.f.code)));
    const TRIES = [[28, '7'], [36, '7'], [48, '7'], [28, '13'], [36, '13'], [48, '13']];
    // at most six readings in all: a card the reader cannot make out must not keep it busy (the AI reads it next).
    // The header band first (the code's usual spot, nothing wiped), then the whole card.
    let tries = 0;
    const colour = cardColour(canvas);
    try {
      for (const pass of [{ head: true }, {}]) {
        for (const L of findWriting(canvas, colour, pass)) {
          for (const [h, psm] of TRIES) {
            if (++tries > 6) break;
            const r = await one(atHeight(L.line, h), psm);
            if (!r.text) continue;
            reads.push({ ...r, box: L.box }); vote(reads[reads.length - 1]);
            if (agreed()) break;
          }
          if (agreed()) break;
        }
        if (agreed() || tries > 6) break;
      }
    } catch (e) { console.warn('writing finder', e); }
    const top = m => [...m.values()].sort((x, y) => y.v - x.v)[0] || null;
    let K = top(known), F = top(fresh);
    // a trap of the unit, unless the readings clearly spell another position (a new card)
    if (K && F && F.f.code !== shortCode(K.trap.code) && F.v > 2 * K.v) K = null;
    // near a trap of the unit but not settled on one: no proposal — the person picks it or presses Read with AI
    if (!K && F && traps.length && !unlike(F.f.code)) F = null;
    let list = [];
    if (!reads.length) {
      // no writing found: the whole photo, sparse words, as before
      await w.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: ALNUM });
      const { data } = await w.recognize(scaleCanvas(canvas, 1400));
      const words = (data.words || []).map(x => x.text).filter(Boolean);
      list = words.length ? words : String(data.text || '').split(/\s+/);
      const m = traps.length ? matchCode(list, traps) : null;
      if (m) K = { trap: m, box: null };
      if (!K) for (const c of [...list, ...list.slice(0, -1).map((x, i) => x + list[i + 1])]) { const f = coerceCode(c); if (f) { F = { f, box: null }; break; } }
    }
    const seen = (reads.slice().sort((x, y) => y.conf - x.conf)[0]?.text) || canon(list.join(' '));
    return { text: seen.slice(0, 24), trap: K?.trap || null, fresh: K ? null : F?.f || null, box: (K || F)?.box || null };
  }

  // ── the AI note on one photo, only when pressed ─────────────────────────
  async function photoBase64(p) {
    if (p.full instanceof Blob) {
      const bmp = await createImageBitmap(p.full, { resizeWidth: 1568, resizeQuality: 'high' });
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.();
      return c.toDataURL('image/jpeg', 0.85);
    }
    return p.thumb || null;                            // a photo brought back to edit: its 640 px copy
  }
  function aiText(p) {
    const a = p.ai; if (!a) return '';
    if (p.section === 'trap') {
      const sp = (a.species || []).slice(0, 3).map(s => `${s.common || s.name} ${s.count}`).join(', ');
      return [a.notes, sp ? `Seen: ${sp}.` : '', a.total != null ? `About ${a.total} insects.` : ''].filter(Boolean).join(' ');
    }
    const sizes = (a.measures || []).map(m => `${m.what} ${m.mm} mm`).join(', ');
    return [a.summary, a.stage ? `Stage: ${a.stage}.` : '', sizes ? `Sizes: ${sizes}.` : '', a.recommendation].filter(Boolean).join(' ');
  }

  function cardColour(canvas) {
    const W = canvas.width, H = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    let y = 0, b = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      const r = d[i], g = d[i + 1], bl = d[i + 2];
      if (r > 140 && g > 110 && bl < 120 && r - bl > 60 && g - bl > 40) y++;
      else if (bl > 110 && bl > r + 40 && bl > g + 10) b++;
    }
    return b > y ? 'blue' : 'yellow';
  }


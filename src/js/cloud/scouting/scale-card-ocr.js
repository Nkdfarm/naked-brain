//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the scale card (a printed marker), sizes in its plane, a trap's short code, a card's colour. Edit here, then run: python build.py
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
  // a script from jsDelivr (the marker reader), kept by the service worker for offline days
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.append(s); });
  }
  const shortCode = c => String(c || '').replace(/D\d{4}(?:\d{4})?$/, '');
  // the colour of a sticky card in a photo (Digital scouting's trap side)
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


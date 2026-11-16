//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the printed grid as ruler, counting insects. Edit here, then run: python build.py
  // ── the printed grid as the ruler (0.11.49, owner: "each trap small square is 23 mm × 23 mm") ──
  // The card's length was the scale, taken as 25 cm — but the card is photographed in a hand, cut by
  // the frame or at a slant, and FarmLab's cards were read ~30 % small that way, every insect a class
  // too big. The grid is printed at 23 mm, so its spacing in the photo is the scale. The grid's lines
  // are thin dark runs (long one way, thin the other); their spacing is found by autocorrelation strip
  // by strip — a strip a square tall is short enough that a tilted line stays in step — and the strips'
  // autocorrelations are added, so a slant or an offset between strips costs nothing. Across and down
  // are measured apart and averaged (a slanted photo shortens one); no grid found → the card's length.
  const GRID_MM = 23, GRID_ROWS = 7;      // FarmLab's Insect Science cards: 4 × 7 squares of 23 mm
  // ── counting insects on a sticky trap (blobs-v3, 0.11.70) ────────────────
  // The check of 30 Sept 2026 (owner: "check if the current algorithm counting is correct"): on FarmLab's cards the
  // old count took the printed header — logo, "STICKY TRAP", the phone number, a punched hole — for 17–35 insects,
  // lost the insects touching a grid line (they merged with the grid) and those along the card's edge (its box cut the
  // outer 3 %), and dropped thrips-sized specks as dust at 1600 px. Now:
  // 1. the card: the long run of rows and columns that are mostly card colour, on a small copy — its real edges;
  // 2. the count runs at about 12 px a mm (a thrips is ~1 mm), up to the full 4000 px photo;
  // 3. inside the card, row by row between its own left and right edge (no leaf in a corner of the box);
  // 4. the printed grid found as lines — long, thin dark runs, across or down, a card tilted a few degrees
  //    included — its spacing is the scale (23 mm a square) and its first line across ends the header;
  // 5. the lines and their crossings are wiped, so an insect on a line stays and a crossing is no insect;
  // 6. what is left is grouped (8-neighbour) and counted by size: tiny < 1.5 mm (thrips), small < 3 (whitefly,
  //    gnats), medium < 6 (aphids, leaf miners), large ≤ 9; bigger is writing, a leaf or a finger.
  // A count of dark specks, not a species identification: the person corrects it and says what they mostly are.
  // the working copies of a count (the small one, the 12 px/mm one, a brightened one) are given back when it ends
  // (0.11.110): they were left for the garbage collector, which had not run when the camera opened for the next side
  const countScratch = []; let countDepth = 0;
  const scratch = (c, src) => { if (c !== src) countScratch.push(c); return c; };
  function countInsects(canvas, trap) {
    countDepth++;
    try { return countInsects0(canvas, trap); }
    finally { if (--countDepth === 0) { countScratch.splice(0).forEach(c => { if (c !== canvas) freeCanvas(c); }); } }
  }
  function countInsects0(canvas, trap) {
    const blue = trap.colour === 'blue';
    const cardOf = d => i => { const r = d[i], g = d[i + 1], b = d[i + 2];
      // relative to the light: the lower half of a card is often in shade
      // (a yellow card has red about as high as green, a sunlit leaf much less; a blue card is bluer than the sky)
      return blue ? (b > 80 && b > r + 35 && b > g + 10) : (r > 95 && g > 75 && r > 0.82 * g && r - b > 50 && g - b > 35); };
    const empty = { counts: { tiny: 0, small: 0, medium: 0, large: 0 }, total: 0, blobs: [], confidence: 0, algorithm: 'blobs-v4', scale: 'none', px_per_mm: null, card_box: null };
    // 1. the card, on a small copy
    const sm = scratch(scaleCanvas(canvas, 800), canvas), sw = sm.width, sh = sm.height;
    const sd = sm.getContext('2d').getImageData(0, 0, sw, sh).data, sIs = cardOf(sd);
    // how light the photo is: its 95th brightest pixel (0.11.71). A dark photo is brightened once and counted
    // again — the colour test needs a lit card — and says so, because a dim photo hides the smallest insects
    const hist = new Uint32Array(256); let hN = 0;
    for (let i = 0; i < sd.length; i += 16) { hist[Math.min(255, Math.round(0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2]))]++; hN++; }
    let p95 = 255; for (let v = 255, acc = 0; v >= 0; v--) { acc += hist[v]; if (acc >= 0.05 * hN) { p95 = v; break; } }
    if (!trap.gain && p95 < 150) {
      const gain = Math.min(4, 210 / Math.max(20, p95));
      const r = countInsects(scratch(brighten(canvas, gain), canvas), { ...trap, gain });
      r.light = { ...(r.light || {}), gain: Math.round(gain * 10) / 10, photo_p95: p95 };
      return r;
    }
    empty.light = { photo_p95: p95, gain: trap.gain || null };
    const colN = new Uint32Array(sw), rowN = new Uint32Array(sh); let tot = 0;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (sIs((y * sw + x) * 4)) { colN[x]++; rowN[y]++; tot++; }
    if (tot < 400) return empty;
    // the longest run of mostly-card rows (or columns), a short break bridged: a row lying on a printed grid line
    // has almost no card colour in it, and the card does not end there
    const longest = (arr, frac) => {
      let mx = 0; for (const v of arr) if (v > mx) mx = v;
      const gap = Math.max(4, Math.round(arr.length * 0.02));
      let best = [0, -1], s = -1, lastOn = -1e9;
      for (let k = 0; k <= arr.length; k++) {
        const on = k < arr.length && arr[k] >= frac * mx;
        if (on) { if (s < 0 || k - lastOn > gap) s = k; lastOn = k; if (lastOn - s > best[1] - best[0]) best = [s, lastOn]; }
      }
      return best;
    };
    const [cx0, cx1] = longest(colN, 0.2), [cy0, cy1] = longest(rowN, 0.2);
    if (cx1 - cx0 < 20 || cy1 - cy0 < 20) return empty;
    // the card's box on the canvas given (counting v5, 0.11.138): the phone crops it for the AI's count (dgCardBlob)
    const fx = canvas.width / sw, fy = canvas.height / sh;
    const cardBox = [Math.max(0, Math.floor(cx0 * fx)), Math.max(0, Math.floor(cy0 * fy)),
                     Math.min(canvas.width, Math.ceil((cx1 + 1) * fx)), Math.min(canvas.height, Math.ceil((cy1 + 1) * fy))];
    // the light round the card: a card held against the sky is lit from behind
    let bgSum = 0, bgN = 0, bgBright = 0;
    for (let y = 0; y < sh; y += 3) for (let x = 0; x < sw; x += 3) {
      if (x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1) continue;
      const i = (y * sw + x) * 4, l = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
      bgSum += l; bgN++; if (l > 235) bgBright++;
    }
    // 2. the working copy: ~12 px a mm from the card's short side (about 100 mm), never upscaled, at most 4000 px
    const estSm = Math.min(cx1 - cx0, cy1 - cy0) / 100;
    const want = Math.min(4000, Math.max(canvas.width, canvas.height), Math.round(Math.max(sw, sh) * 12 / Math.max(estSm, 0.01)));
    const C = scratch(scaleCanvas(canvas, want), canvas), kk = C.width / sw;
    const X0 = Math.max(0, Math.floor((cx0 - 2) * kk)), Y0 = Math.max(0, Math.floor((cy0 - 2) * kk));
    const BW = Math.min(C.width, Math.ceil((cx1 + 3) * kk)) - X0, BH = Math.min(C.height, Math.ceil((cy1 + 3) * kk)) - Y0;
    const d = C.getContext('2d').getImageData(X0, Y0, BW, BH).data, isC = cardOf(d);
    const est = estSm * kk;                                 // px a mm, roughly (±30 %): tolerances only
    // 3. each row's own card edges (the first and last run of card colour 3 px long)
    const L = new Int32Array(BH).fill(-1), R = new Int32Array(BH).fill(-1);
    let lumSum = 0, lumN = 0, cardRows = 0, satSum = 0, sampN = 0, glareN = 0, hardN = 0;
    for (let y = 0; y < BH; y++) {
      let run = 0;
      for (let x = 0; x < BW; x++) { if (isC((y * BW + x) * 4)) { if (++run >= 3) { L[y] = x - 2; break; } } else run = 0; }
      run = 0;
      for (let x = BW - 1; x >= 0; x--) { if (isC((y * BW + x) * 4)) { if (++run >= 3) { R[y] = x + 2; break; } } else run = 0; }
      if (L[y] >= 0) cardRows++;
      if (y % 7 === 0 && L[y] >= 0) for (let x = L[y]; x <= R[y]; x += 11) {
        const i = (y * BW + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2], l = 0.299 * r + 0.587 * g + 0.114 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        sampN++; if (l > 215 && mx - mn < 60) glareN++;              // washed white: the card's colour lost in a reflection
        if (l > 238 && mx - mn < 30) hardN++;                        // blown white: nothing of the card left
        if (isC(i)) { lumSum += l; satSum += mx - mn; lumN++; }
      }
    }
    const cardLum = lumN ? lumSum / lumN : 200;
    const light = { card_lum: Math.round(cardLum), card_sat: lumN ? Math.round(satSum / lumN) : null,
                    glare_pct: sampN ? Math.round(glareN / sampN * 1000) / 10 : 0,
                    blown_pct: sampN ? Math.round(hardN / sampN * 1000) / 10 : 0,
                    bg_lum: bgN ? Math.round(bgSum / bgN) : null, bg_bright_pct: bgN ? Math.round(bgBright / bgN * 1000) / 10 : 0 };
    const darkLim = Math.min(125, 0.62 * cardLum);           // a dimmer photo: a dimmer insect
    const mask = new Uint8Array(BW * BH);
    for (let y = 0; y < BH; y++) {
      if (L[y] < 0) continue;
      for (let x = L[y]; x <= R[y]; x++) {
        const i = (y * BW + x) * 4;
        if (!isC(i) && 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < darkLim) mask[y * BW + x] = 1;
      }
    }
    const hr = new Uint16Array(BW * BH), vr = new Uint16Array(BW * BH);
    const runs = () => {
      for (let y = 0; y < BH; y++) { let s = -1; for (let x = 0; x <= BW; x++) { const on = x < BW && mask[y * BW + x]; if (on && s < 0) s = x; if (!on && s >= 0) { const n = Math.min(65535, x - s); for (let k = s; k < x; k++) hr[y * BW + k] = n; s = -1; } } }
      for (let x = 0; x < BW; x++) { let s = -1; for (let y = 0; y <= BH; y++) { const on = y < BH && mask[y * BW + x]; if (on && s < 0) s = y; if (!on && s >= 0) { const n = Math.min(65535, y - s); for (let k = s; k < y; k++) vr[k * BW + x] = n; s = -1; } } }
    };
    runs();
    // 4. the printed lines: long and thin, a tilt of a few degrees allowed (a band of rows or columns)
    const longE = 5 * est, thinE = 2.2 * est;
    const hl = new Uint8Array(BW * BH), vl = new Uint8Array(BW * BH);
    for (let p = 0; p < BW * BH; p++) if (mask[p]) {
      if (hr[p] >= longE && vr[p] <= thinE) hl[p] = 1;
      if (vr[p] >= longE && hr[p] <= thinE) vl[p] = 1;
    }
    // coverage: how much of the card's width (or height) a line crosses within a band
    const lines = (across) => {
      const len = across ? BH : BW, other = across ? BW : BH, band = Math.max(3, Math.round(0.06 * other));
      const cov = new Float32Array(len);
      // per line of the other direction, where its line pixels are; a position is covered when any lies within ±band/2
      const last = new Int32Array(other).fill(-1e9), next = new Int32Array(other).fill(1e9);
      const hits = []; for (let o = 0; o < other; o++) hits.push([]);
      for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) { const p = y * BW + x; if (across ? hl[p] : vl[p]) hits[across ? x : y].push(across ? y : x); }
      const width = new Float32Array(len);
      for (let t = 0; t < len; t++) width[t] = across ? (L[t] >= 0 ? R[t] - L[t] + 1 : 0) : cardRows;
      for (let o = 0; o < other; o++) {
        const h = hits[o]; if (!h.length) continue;
        let j = 0;
        for (let t = 0; t < len; t++) {
          while (j < h.length && h[j] < t - band / 2) j++;
          if (j < h.length && h[j] <= t + band / 2) cov[t]++;
        }
      }
      const out = []; let s = -1;
      for (let t = 0; t <= len; t++) {
        const on = t < len && width[t] > 0 && cov[t] >= (across ? 0.45 * width[t] : 0.3 * Math.max(1, cardRows));   // glare breaks the lines down
        if (on && s < 0) s = t;
        if (!on && s >= 0) { out.push([s, t - 1, (s + t - 1) / 2]); s = -1; }
      }
      // one line: runs closer than 8 mm merge
      const merged = [];
      for (const r of out) { const m = merged[merged.length - 1]; if (m && r[0] - m[1] < 8 * est) { m[1] = r[1]; m[2] = (m[0] + m[1]) / 2; } else merged.push(r.slice()); }
      merged.cov = cov; merged.width = width;
      return merged;
    };
    const H = lines(true), V = lines(false);
    const spacingOf = ls => { const g = []; for (let i = 1; i < ls.length; i++) { const s = ls[i][2] - ls[i - 1][2]; if (s > 15 * est && s < 35 * est) g.push(s); }
      g.sort((a, b) => a - b); return g.length ? { px: g[Math.floor(g.length / 2)], n: g.length } : null; };
    const sH = spacingOf(H), sV = spacingOf(V);
    let ppm = null, scale = 'card';
    if (sH && sV) ppm = Math.abs(sH.px - sV.px) / Math.min(sH.px, sV.px) <= 0.15 ? (sH.px * sH.n + sV.px * sV.n) / (sH.n + sV.n) / GRID_MM : (sH.n >= sV.n ? sH.px : sV.px) / GRID_MM;
    else if (sH || sV) ppm = (sH || sV).px / GRID_MM;
    if (ppm) scale = 'grid'; else ppm = est;
    // where the grid starts: the first line across that is one square from the next (not the card's top edge or a
    // finger), and where the lines down begin — which the header's print and writing cannot imitate
    const S = ppm * GRID_MM, tiltM = Math.round(0.03 * BW);
    let chain = null;
    for (let i = 0; i < H.length - 1; i++) { const g = H[i + 1][2] - H[i][2]; if (H[i][2] > BH * 0.02 && Math.abs(g - S) < 0.15 * S) { chain = H[i]; break; } }
    // up from there, a square at a time, while a line — however broken by glare — is where the next one should be,
    // never beyond the card's rows (FarmLab's Insect Science cards: 7 rows of 23 mm squares, GRID_ROWS)
    const lastH = H.length ? H[H.length - 1][2] : null, maxSpan = (GRID_ROWS + 0.25) * S;
    if (chain) {
      let cur = chain, g = S;
      const i0 = H.indexOf(chain); if (i0 >= 0 && H[i0 + 1]) g = H[i0 + 1][2] - chain[2];
      for (let step = 0; step < 8; step++) {
        const want = cur[2] - g, lo = Math.max(0, Math.round(want - 0.2 * g)), hi = Math.round(want + 0.2 * g);
        if (hi < BH * 0.02) break;
        let bt = -1, bv = 0;
        for (let t = lo; t <= hi && t < BH; t++) { const w = H.width[t] || BW; const v = H.cov[t] / Math.max(1, w); if (v > bv) { bv = v; bt = t; } }
        if (bt < 0 || bv < 0.15 || (lastH != null && lastH - bt > maxSpan)) break;
        let a = bt, b = bt; while (a > 0 && H.cov[a - 1] / Math.max(1, H.width[a - 1] || BW) >= 0.5 * bv) a--; while (b < BH - 1 && H.cov[b + 1] / Math.max(1, H.width[b + 1] || BW) >= 0.5 * bv) b++;
        g = cur[2] - (a + b) / 2; cur = [a, b, (a + b) / 2];
        if (g < 0.7 * S) break;
      }
      chain = cur;
    }
    const vTops = [];
    for (const v of V) {
      const xa = Math.max(0, Math.round(v[0] - 0.03 * BH)), xb = Math.min(BW - 1, Math.round(v[1] + 0.03 * BH));
      const rowHas = new Uint8Array(BH);
      for (let y = 0; y < BH; y++) for (let x = xa; x <= xb; x++) if (vl[y * BW + x]) { rowHas[y] = 1; break; }
      // the longest stretch of the line, gaps under 3 mm bridged: its start is the grid's top here
      let best = [0, -1], s0 = -1, lastOn = -1e9;
      for (let y = 0; y <= BH; y++) {
        if (y < BH && rowHas[y]) { if (s0 < 0 || y - lastOn > 3 * ppm) s0 = y; lastOn = y; if (lastOn - s0 > best[1] - best[0]) best = [s0, lastOn]; }
      }
      if (best[1] - best[0] > 2 * S) vTops.push(best[0]);
    }
    vTops.sort((a, b) => a - b);
    const vTop = vTops.length >= 2 ? vTops[Math.floor(vTops.length / 2)] : null;
    let gridTop = null, gridBy = 'none';
    if (chain && vTop != null && vTop < chain[2] - 0.7 * S && (lastH == null || lastH - vTop <= maxSpan)) { gridTop = vTop; gridBy = 'lines down'; }   // lines above not seen at all
    else if (chain) { gridTop = Math.round(chain[2]); gridBy = 'line'; }
    else if (vTop != null) { gridTop = vTop; gridBy = 'lines down'; }
    else { const f = H.find(l => l[2] > BH * 0.03 && l[2] < BH * 0.5); if (f) { gridTop = f[1]; gridBy = 'first line'; } }
    // the card's rows are known: when fewer than 7 are seen above the bottom line and the card is whole at the bottom,
    // the top lines are lost in glare — the grid starts 7 squares above its bottom line
    const bottomWhole = !(cy1 >= sh - 2);
    if (lastH != null && bottomWhole && BH - lastH < 1.2 * S && (gridTop == null || (lastH - gridTop) < (GRID_ROWS - 0.5) * S)) {
      gridTop = Math.max(0, Math.round(lastH - GRID_ROWS * S)); gridBy = 'rows up';
    }
    const top = gridTop != null && gridTop < BH * 0.55 ? Math.min(BH - 1, gridTop + Math.round(0.012 * BW) + Math.round(ppm)) : 0;
    // the card cut by the photo's edge: fewer insects than on the card, whatever the counting
    const edges = [cy0 <= 1 && 'top', cy1 >= sh - 2 && 'bottom', cx0 <= 1 && 'left', cx1 >= sw - 2 && 'right'].filter(Boolean);
    const rowsSeen = gridTop != null ? Math.round((BH - gridTop) / S * 10) / 10 : null;
    // 5. the lines and their crossings out, then the thin rims they leave
    const longP = 6 * ppm, thinP = Math.max(2, 1.4 * ppm);
    for (let p = 0; p < BW * BH; p++) if (mask[p] && ((hr[p] >= longP && vr[p] <= thinP) || (vr[p] >= longP && hr[p] <= thinP) || (hr[p] >= longP && vr[p] >= longP))) mask[p] = 0;
    // 6. the specks left, below the header, 8-neighbour
    const counts = { tiny: 0, small: 0, medium: 0, large: 0 }, blobs = [];
    const seen = new Uint8Array(BW * BH), stack = new Int32Array(BW * BH);
    const minArea = Math.max(4, Math.round(0.3 * ppm * ppm)), minLen = 0.7 * ppm;
    for (let p = top * BW; p < BW * BH; p++) {
      if (!mask[p] || seen[p]) continue;
      let sp = 0, n = 0, minx = BW, maxx = 0, miny = BH, maxy = 0;
      stack[sp++] = p; seen[p] = 1;
      while (sp) {
        const q = stack[--sp]; n++;
        const qx = q % BW, qy = (q - qx) / BW;
        if (qx < minx) minx = qx; if (qx > maxx) maxx = qx; if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < top || nx >= BW || ny >= BH) continue;
          const r = ny * BW + nx;
          if (mask[r] && !seen[r]) { seen[r] = 1; stack[sp++] = r; }
        }
      }
      const w = maxx - minx + 1, h = maxy - miny + 1, big = Math.max(w, h), small = Math.min(w, h);
      if (n < minArea || big < minLen) continue;                    // dust, a pen dot
      if (small < 0.35 * ppm) continue;                             // a sliver: the rim of a wiped line
      if (big > 4.5 * small + 3) continue;                          // a piece of line left over, a scratch: an insect is at most ~3 : 1
      const mm = big / ppm;
      if (mm > 9) continue;                                         // writing, a leaf, a finger
      blobs.push([X0 + minx, Y0 + miny, w, h, Math.round(mm * 10) / 10]);
      if (mm < 1.5) counts.tiny++; else if (mm < 3) counts.small++; else if (mm < 6) counts.medium++; else counts.large++;
    }
    // blobs-v4 (0.11.135, owner 22 Oct 2026: "stop counting the very small thrips (not consistent), focus on medium and
    // big insects … show the tiny just for info"): the total is small + medium + large; the tiny (< 1.5 mm) are still
    // counted apart, shown as "not counted", to see later whether they can be followed
    const total = counts.small + counts.medium + counts.large;
    const area = (cx1 - cx0) * (cy1 - cy0);
    return { counts, total, blobs, confidence: Math.round(Math.min(1, tot / Math.max(1, area)) * 100) / 100, algorithm: 'blobs-v4',
             scale, px_per_mm: Math.round(ppm * 1000) / 1000, header_px: top, grid_by: gridBy, partial: edges.length ? edges.join(',') : null, rows_seen: rowsSeen, work_px: want, lines: [H.length, V.length], light,
             card_box: cardBox };
  }
  window.fbCountInsects = countInsects;   // for support: count a canvas from the console
  function brighten(canvas, gain) {
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d');
    if ('filter' in x) { x.filter = `brightness(${gain})`; x.drawImage(canvas, 0, 0); x.filter = 'none'; return c; }
    x.drawImage(canvas, 0, 0);
    const im = x.getImageData(0, 0, c.width, c.height), a = im.data;
    for (let i = 0; i < a.length; i += 4) { a[i] = Math.min(255, a[i] * gain); a[i + 1] = Math.min(255, a[i + 1] * gain); a[i + 2] = Math.min(255, a[i + 2] * gain); }
    x.putImageData(im, 0, 0);
    return c;
  }
  // Is the light good enough to trust the count? (0.11.71, owner 30 Sept 2026.) Limits from FarmLab's 20 real
  // photos (card 97–189 bright, glare ≤ 1 % but one sheen at 9.5 %, blown white ≤ 0.2 %, background blown ≤ 7 %) against the same
  // photos darkened, with a reflection and held against the sky. Null = nothing to say.
  function lightCheck(r) {
    const l = r?.light || {};
    if (r?.scale === 'none') return l.photo_p95 != null && l.photo_p95 < 60
      ? 'too dark to find the card — more light, or step out of the shade'
      : 'the card was not found — the whole card in the photo, square-on, close enough to fill most of it';
    if (l.bg_bright_pct >= 25 && l.bg_lum - l.card_lum >= 60) return 'the card is against the light — turn so the light falls on the card, not behind it';
    if (l.glare_pct >= 12 || l.blown_pct >= 3) return `glare on ${Math.round(l.glare_pct)} % of the card — tilt it a little or step aside from the light`;
    if (l.card_lum != null && l.card_lum < 75) return 'the card is dark — more light, or turn it towards the light';
    if (l.gain) return 'the photo was dark — counted after brightening it; with more light the smallest insects count better';
    return null;
  }
  // The key of an answer: the step's seq, or item|seq when the checklist runs

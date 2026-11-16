//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the camera, shrinking a photo, a trap photo's upload. Edit here, then run: python build.py
  // A photo scaled down on a canvas: the data URL to keep, the canvas to count on.
  // Decoded ONCE, as a bitmap that is closed at once (0.11.8): a 12–50 MP phone
  // photo decoded twice through <img> was enough to push the app out of memory
  // on the phone. createImageBitmap also applies the EXIF rotation.
  async function shrinkPhoto(file, maxSide, quality) {
    let src;
    // an iPhone: through <img>, which always turns the photo the right way up there
    if (IS_IOS) { try { src = await loadImage(file); } catch (e) { src = null; } }
    // decoded straight at the size wanted (0.11.92, review of 30 Sept): a 50 MP gallery photo used to be decoded whole
    // (~200 MB) before it was shrunk. The JPEG's header says its size and rotation; Chrome rotates first and then
    // resizes, so the long side of the rotated picture is the one asked for (tested with an EXIF-6 JPEG).
    const dims = src ? null : await jpegSize(file).catch(() => null);
    if (dims) {
      const [w, h] = dims.orient >= 5 ? [dims.h, dims.w] : [dims.w, dims.h];
      if (Math.max(w, h) > maxSide) {
        const opt = { imageOrientation: 'from-image', resizeQuality: 'high' };
        if (w >= h) opt.resizeWidth = maxSide; else opt.resizeHeight = maxSide;
        try { src = await createImageBitmap(file, opt); } catch (e) { src = null; }
      }
    }
    if (!src) {
      try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { src = await loadImage(file); }
    }
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    const k = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    if (src.close) src.close();
    return { dataUrl: quality == null ? null : c.toDataURL('image/jpeg', quality), canvas: c };
  }
  // a JPEG's width, height and EXIF orientation from its first 256 KB, without decoding it; null for anything else
  async function jpegSize(file) {
    if (!file || !/jpe?g/i.test(file.type || '')) return null;
    const d = new DataView(await file.slice(0, 262144).arrayBuffer());
    if (d.byteLength < 4 || d.getUint16(0) !== 0xFFD8) return null;
    let i = 2, orient = 1;
    while (i + 4 <= d.byteLength) {
      if (d.getUint8(i) !== 0xFF) return null;
      const m = d.getUint8(i + 1), len = d.getUint16(i + 2);
      if (m === 0xE1 && i + 10 < d.byteLength && d.getUint32(i + 4) === 0x45786966) {          // 'Exif'
        const t = i + 10, le = d.getUint16(t) === 0x4949;
        const u16 = o => d.getUint16(o, le), u32 = o => d.getUint32(o, le);
        if (t + 8 < d.byteLength) {
          const ifd = t + u32(t + 4), n = ifd + 2 <= d.byteLength ? u16(ifd) : 0;
          for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (e + 10 > d.byteLength) break; if (u16(e) === 0x0112) { orient = u16(e + 8); break; } }
        }
      }
      if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {             // a start of frame
        if (i + 9 > d.byteLength) return null;
        return { h: d.getUint16(i + 5), w: d.getUint16(i + 7), orient };
      }
      i += 2 + len;
    }
    return null;
  }
  function scaleCanvas(canvas, maxSide) {
    const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    if (k === 1) return canvas;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * k)); c.height = Math.max(1, Math.round(canvas.height * k));
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }
  // the full trap photo goes to the evidence bucket: <farm>/<run>/trap-<code>-<time>.jpg
  async function uploadTrapPhoto(runId, code, blob, farmId) {
    const path = `${farmId || farm.id}/${runId}/trap-${String(code).replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}.jpg`;
    await api('/storage/v1/object/evidence/' + path, {
      method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob
    });
    return path;
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not a picture')); };
      im.src = url;
    });
  }
  // The camera inside the app (0.11.10). Opening the phone's camera app was
  // what got Naked Brain killed on Android — the app comes back empty, at the
  // start screen. A live preview, a shutter, the frame drawn on a canvas at
  // the app never leaves. Resolves the photo as a Blob, 'cancel' when the
  // person backs out, null when the browser has no camera to give (then the
  // phone's own camera/gallery is used).
  // the full photo kept for the console's zoom and the AI: the camera's still capped at
  // FULL_PX on the long side (about 15 px/mm on a trap card — beyond that the lens, not
  // the pixels, limits the detail, and a 50 MP file can push the app out of memory)
  // 0.11.99: 3000 px on an iPhone (a 4000 px working canvas is 48 MB, and an iPhone gives a web app far less)
  // 0.11.110: 3000 px on every phone — a Samsung S24 FE (8 GB) closed the app at the second photo with its own camera
  // open (client_log: "resumed", twice); a 4000 px working canvas is 48 MB, its pixels read out another 48
  // 0.11.111: 4000 px again on Android (owner: "important for insect detection"), with the in-app camera; 3000 on an iPhone
  const FULL_PX = IS_IOS ? 3000 : 4000, FULL_Q = 0.9;
  // Lens, close-up and zoom (0.11.41, owner: "open the camera in macro mode"). A web app cannot
  // press the Macro button of the phone's own camera app; it can pick another back lens (on many
  // phones the ultra-wide is the macro one — some makers hide it from every app but their own),
  // ask the lens to focus as near as it can, and zoom. Each control shows only where the phone
  // offers it, and the choice is remembered on this phone for each kind of photo (traps, plant
  // health, growth), so the close-up can stay on for plant health alone.
  const camPrefKey = p => 'fb_cam_' + (p || 'other');
  const camPref = p => { try { return JSON.parse(localStorage.getItem(camPrefKey(p)) || '{}') || {}; } catch (e) { return {}; } };
  const saveCamPref = (p, v) => { try { localStorage.setItem(camPrefKey(p), JSON.stringify(v)); } catch (e) {} };
  const lensName = (d, i) => {
    const l = String(d?.label || '');
    if (/ultra ?wide/i.test(l)) return 'Ultra-wide';
    if (/macro/i.test(l)) return 'Macro';
    if (/tele/i.test(l)) return 'Tele';
    if (/dual|triple/i.test(l)) return 'Auto';
    return i === 0 ? 'Main' : `Lens ${i + 1}`;
  };
  const fmtZoom = v => (Math.round(Number(v) * 10) / 10) + '×';
  const canFocusBy = caps => !!(caps.focusDistance && caps.focusDistance.max > caps.focusDistance.min && (caps.focusMode || []).includes('manual'));
  const fmtFocus = v => v >= 1 ? `≈ ${(Math.round(v * 10) / 10)} m` : `≈ ${Math.round(v * 100)} cm`;
  // How sharp the frame is (0.11.46): the mean of its 300 steepest one-pixel steps over the
  // patch's contrast. A sharp edge rises in a pixel or two (0.5–1.2); a blurred one over many
  // (under 0.25 once the blur is ~2 px on the preview, ~4 px on the 4000 px photo). A flat
  // patch (a bare card) says nothing, and nothing is said about it.
  const BLUR_BELOW = 0.25;
  function sharpness(g, w, h) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    const at = q => { let n = 0; const t = g.length * q; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= t) return v; } return 255; };
    const range = at(0.98) - at(0.02);
    if (range < 25) return null;
    const gh = new Uint32Array(256);
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const i = y * w + x, v = g[i];
      gh[Math.max(Math.abs(g[i + 1] - v), Math.abs(g[i + w] - v))]++;
    }
    let need = 300, sum = 0, n = 0;
    for (let v = 255; v >= 0 && need > 0; v--) { const k = Math.min(gh[v], need); sum += k * v; n += k; need -= k; }
    return (sum / Math.max(1, n)) / range;
  }
  // a 400 px patch of the live frame at its own pixels, round the focus point
  function frameSharpness(video, pt) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const S = Math.min(400, vw, vh);
    const sx = Math.max(0, Math.min(vw - S, Math.round((pt?.x ?? 0.5) * vw - S / 2)));
    const sy = Math.max(0, Math.min(vh - S, Math.round((pt?.y ?? 0.5) * vh - S / 2)));
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(video, sx, sy, S, S, 0, 0, S, S);
    const d = cx.getImageData(0, 0, S, S).data, g = new Uint8Array(S * S);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return sharpness(g, S, S);
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // The in-app camera (0.11.10, lenses 0.11.41). 0.11.46 (owner: "focus is still in auto mode … not
  // very sharp"): tap the screen to focus there, and the shutter focuses once more before it fires;
  // a Focus slider (near ↔ far) where the phone lets the app hold the focus, instead of the old
  // Close-up that pinned it at the nearest distance; the still is asked for at its largest up to
  // FULL_PX; a blurred frame asks whether to retake; and "Phone camera" hands over to the phone's
  // own camera app for its macro and its processing (a run killed meanwhile comes back from its draft).
  // which camera (0.11.99): the phone's own on an iPhone — a web app gets only a video frame there, with no focus or
  // close-up — the in-app one elsewhere; Settings › Camera changes it
  const camMode = () => (IS_IOS ? 'phone' : 'app');   // 0.11.112: no setting any more (owner 5 Oct 2026); an earlier choice is not read
  function phoneCamera() {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); inp.style.display = 'none';
      document.body.append(inp);
      let back = false;
      const settle = v => { if (back) return; back = true; inp.remove(); window.removeEventListener('focus', onFocus); resolve(v); };
      // came back without a photo — not on an iPhone, which can take longer than this to hand the photo over
      const onFocus = () => setTimeout(() => settle(inp.files?.[0] || 'cancel'), 1500);
      inp.onchange = () => settle(inp.files?.[0] || 'cancel');
      inp.addEventListener('cancel', () => settle('cancel'));
      if (!IS_IOS) window.addEventListener('focus', onFocus);
      inp.click();
    });
  }
  let camOpenAt = 0;         // when the in-app camera was last asked to open (ms); 0 once it is on screen or gave up
  function takeTrapPhoto(code, hintText, purpose = 'trap') {
    if (camMode() === 'phone') return phoneCamera();
    // one camera at a time: the picture comes on screen about a second after the tap, and a second tap in between
    // opened a second camera under the first — it "came back" after the photo and gave the same trap two cards.
    // camOpenAt is a time, not a switch: whatever happens below, it stops counting after four seconds by itself.
    if (Math.abs(Date.now() - camOpenAt) < 4000 || document.querySelector('.fb-cam')) return Promise.resolve('cancel');
    camOpenAt = Date.now();
    return new Promise(async resolve0 => {
      const resolve = v => { camOpenAt = 0; resolve0(v); };
      if (!navigator.mediaDevices?.getUserMedia) return resolve(null);
      const pref = camPref(purpose);
      if (pref.closeup && !pref.focus) { pref.focus = { manual: true, d: null }; delete pref.closeup; }   // 0.11.41's Close-up
      const openCam = deviceId => navigator.mediaDevices.getUserMedia({ audio: false, video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        width: { ideal: 4096 }, height: { ideal: 3072 } } });
      let stream;
      try { stream = await openCam(pref.deviceId); }
      catch (e) {
        if (!pref.deviceId) { console.warn('camera refused', e); return resolve(null); }
        try { stream = await openCam(null); } catch (e2) { console.warn('camera refused', e2); return resolve(null); }
      }
      // the back lenses, now that the camera is allowed (the browser hides their names before)
      let lenses = [];
      try { lenses = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && /back|rear|environment/i.test(d.label)); }
      catch (e) { /* none listed */ }

      const ov = el('div', 'fb-cam');
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.muted = true; video.srcObject = stream;
      const hint = el('div', 'fb-cam-hint', hintText || `Trap ${code} — square-on, the whole card and its code in the picture`);
      const ring = el('div', 'fb-cam-ring'); ring.hidden = true;
      const ctl = el('div', 'fb-cam-ctl');
      const bar = el('div', 'fb-cam-bar');
      const cancel = el('button', 'fb-btn', 'Cancel');
      const shutter = el('button', 'fb-cam-shutter'); shutter.setAttribute('aria-label', 'Take the photo');
      const native = el('button', 'fb-btn', '{i:camera} Phone camera');
      native.title = "Use the phone's own camera app — its macro and its sharpening";
      // a photo already taken with the phone's own camera app (0.11.135, owner 22 Oct 2026: "a solution to avoid the
      // samsung camera memory saturation"): shot outside Naked Brain, it is in the gallery whatever Android closes
      const gallery = el('button', 'fb-btn', '{i:image}'); gallery.type = 'button';
      gallery.title = "A photo from the gallery — taken first with the phone's camera app"; gallery.setAttribute('aria-label', 'Photo from the gallery');
      bar.append(cancel, shutter, native, gallery);
      ov.append(video, hint, ring, ctl, bar);
      document.body.append(ov);
      camOpenAt = 0;                                      // on screen: from here the picture itself stops a second camera
      const track = () => stream.getVideoTracks()[0];
      const caps = () => track().getCapabilities?.() || {};
      const remember = () => saveCamPref(purpose, pref);
      let done = false;
      const stop = () => { try { stream.getTracks().forEach(x => x.stop()); } catch (e) {} ov.remove(); };
      const finish = v => { if (done) return; done = true; stop(); resolve(v); };
      ov._close = () => finish('cancel');   // the phone's Back closes the camera, stream and all (0.11.55)
      let point = null;                                   // the last place tapped, 0–1 of the frame
      const manual = () => !!pref.focus?.manual && canFocusBy(caps());
      const autoMode = c => (c.focusMode || []).includes('continuous') ? 'continuous' : (c.focusMode || []).includes('single-shot') ? 'single-shot' : null;

      async function apply(adv) {
        try { await track().applyConstraints({ advanced: [adv] }); return true; }
        catch (e) {
          if (adv.pointsOfInterest) { const { pointsOfInterest, ...rest } = adv; if (Object.keys(rest).length) return apply(rest); }
          console.warn('camera settings', e); return false;
        }
      }
      // one focus pass, on the point when there is one (single-shot where offered, else the continuous one)
      async function focusOnce(pt) {
        const c = caps(), modes = c.focusMode || [];
        if (manual() || !modes.length) return false;
        const adv = { focusMode: modes.includes('single-shot') ? 'single-shot' : autoMode(c) };
        if (pt) adv.pointsOfInterest = [pt];               // dropped by apply() where the phone refuses it
        return apply(adv);
      }
      // the remembered zoom and focus, on whichever lens is open
      async function applyPrefs() {
        const c = caps(), adv = {};
        if (c.zoom && pref.zoom) adv.zoom = Math.min(c.zoom.max, Math.max(c.zoom.min, pref.zoom));
        if (manual()) {
          const lo = c.focusDistance.min, hi = Math.min(c.focusDistance.max, 1.5);
          adv.focusMode = 'manual'; adv.focusDistance = Math.min(hi, Math.max(lo, pref.focus.d ?? lo));
        } else if (autoMode(c)) adv.focusMode = autoMode(c);
        if (Object.keys(adv).length) await apply(adv);
      }
      function paintTools() {
        ctl.textContent = '';
        const t = track(), c = caps(), set = t.getSettings?.() || {};
        const row = el('div', 'fb-cam-tools');
        if (lenses.length > 1) {
          const i = Math.max(0, lenses.findIndex(d => d.deviceId === set.deviceId));
          const b = el('button', 'fb-btn', `⟳ ${lensName(lenses[i], i)} · ${i + 1}/${lenses.length}`);
          b.title = 'Switch to the next back lens — on many phones the ultra-wide one focuses closest';
          b.onclick = () => switchTo(lenses[(i + 1) % lenses.length].deviceId);
          row.append(b);
        }
        if (canFocusBy(c)) {
          const b = el('button', 'fb-btn', manual() ? 'Focus: by hand' : 'Focus: auto');
          b.setAttribute('aria-pressed', String(manual()));
          b.title = 'Auto: tap the screen where it should be sharp. By hand: slide from near to far.';
          b.onclick = async () => {
            pref.focus = { manual: !manual(), d: pref.focus?.d ?? null }; remember();
            await applyPrefs(); paintTools();
          };
          row.append(b);
        }
        if (row.children.length) ctl.append(row);
        if (manual()) {
          const lo = c.focusDistance.min, hi = Math.min(c.focusDistance.max, 1.5);
          const f = el('div', 'fb-cam-zoom');
          const r = el('input'); r.type = 'range'; r.min = String(lo); r.max = String(hi); r.step = String(c.focusDistance.step || 0.01);
          r.value = String(Math.min(hi, Math.max(lo, pref.focus.d ?? set.focusDistance ?? lo))); r.setAttribute('aria-label', 'Focus distance');
          const lab = el('span', 'fb-cam-zval', fmtFocus(Number(r.value)));
          r.oninput = () => {
            lab.textContent = fmtFocus(Number(r.value));
            pref.focus.d = Number(r.value); remember();
            apply({ focusMode: 'manual', focusDistance: Number(r.value) });
          };
          f.append(el('span', 'fb-cam-end', 'near'), r, el('span', 'fb-cam-end', 'far'), lab);
          ctl.append(f);
        }
        if (c.zoom && c.zoom.max > c.zoom.min) {
          const z = el('div', 'fb-cam-zoom');
          const max = Math.min(c.zoom.max, 10);
          const r = el('input'); r.type = 'range'; r.min = String(c.zoom.min); r.max = String(max); r.step = String(c.zoom.step || 0.1);
          r.value = String(set.zoom ?? c.zoom.min); r.setAttribute('aria-label', 'Zoom');
          const lab = el('span', 'fb-cam-zval', fmtZoom(r.value));
          const setZoom = v => {
            r.value = String(v); lab.textContent = fmtZoom(v); pref.zoom = Number(v); remember();
            apply({ zoom: Number(v) });
          };
          r.oninput = () => setZoom(r.value);
          z.append(lab, r);
          [1, 2].filter(v => v >= c.zoom.min && v <= max).forEach(v => {
            const q = el('button', 'fb-btn fb-cam-q', v + '×'); q.onclick = () => setZoom(v); z.append(q);
          });
          ctl.append(z);
        }
      }
      async function switchTo(id) {
        try { stream.getTracks().forEach(x => x.stop()); } catch (e) {}
        try { stream = await openCam(id); }
        catch (e) {
          showToast('That lens could not be opened', 'error');
          try { stream = await openCam(null); } catch (e2) { finish(null); return; }
        }
        video.srcObject = stream;
        pref.deviceId = track().getSettings?.().deviceId || id; pref.zoom = null; remember();
        point = null; await applyPrefs(); paintTools();
      }
      await applyPrefs(); paintTools();

      // tap to focus: where the finger lands on the picture (object-fit: cover crops its edges)
      let ringTimer = null;
      video.addEventListener('click', async ev => {
        const r = video.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        const k = Math.max(r.width / vw, r.height / vh), dw = vw * k, dh = vh * k;
        const x = (ev.clientX - r.left - (r.width - dw) / 2) / dw, y = (ev.clientY - r.top - (r.height - dh) / 2) / dh;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        point = { x, y };
        if (manual()) { pref.focus.manual = false; remember(); await applyPrefs(); paintTools(); }   // a tap means "auto, here"
        ring.hidden = false; ring.className = 'fb-cam-ring';
        ring.style.left = ev.clientX + 'px'; ring.style.top = ev.clientY + 'px';
        clearTimeout(ringTimer);
        const ok = await focusOnce(point);
        if (!ok) { ring.hidden = true; showToast('This phone does not let the app choose where to focus', 'info'); return; }
        ringTimer = setTimeout(() => { ring.className = 'fb-cam-ring ok'; ringTimer = setTimeout(() => { ring.hidden = true; }, 900); }, 700);
      });

      cancel.onclick = () => finish('cancel');
      // the phone's own camera app: the page lets go of the camera first
      native.onclick = () => {
        try { stream.getTracks().forEach(x => x.stop()); } catch (e) {}
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); inp.style.display = 'none';
        document.body.append(inp);
        let back = false;
        const settle = v => { if (back) return; back = true; inp.remove(); window.removeEventListener('focus', onFocus); finish(v); };
        const onFocus = () => setTimeout(() => settle(inp.files?.[0] || 'cancel'), 1500);   // came back without a photo
        inp.onchange = () => settle(inp.files?.[0] || 'cancel');
        inp.addEventListener('cancel', () => settle('cancel'));
        window.addEventListener('focus', onFocus);
        inp.click();
      };
      gallery.onclick = () => {
        try { stream.getTracks().forEach(x => x.stop()); } catch (e) {}
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';     // no capture: the picker, not a camera
        document.body.append(inp);
        let back = false;
        const settle = v => { if (back) return; back = true; inp.remove(); finish(v); };
        inp.onchange = () => settle(inp.files?.[0] || 'cancel');
        inp.addEventListener('cancel', () => settle('cancel'));
        inp.click();
      };

      // the still: focus once more, judge the frame, then the camera's own photo at its largest up to
      // FULL_PX (ImageCapture, Chrome on Android) — a 50 MP still would push the app out of memory —
      // else the preview frame at its size
      async function takeStill() {
        let blob = null;
        if (window.ImageCapture) {
          const ic = new ImageCapture(track());
          let opts;
          try {
            const pc = await ic.getPhotoCapabilities();
            if (pc?.imageWidth?.max && pc?.imageHeight?.max) {
              const w = Math.min(pc.imageWidth.max, FULL_PX);
              opts = { imageWidth: w, imageHeight: Math.round(w * pc.imageHeight.max / pc.imageWidth.max) };
            }
          } catch (e) { /* no photo capabilities */ }
          try { blob = await ic.takePhoto(opts); }
          catch (e) { if (opts) { try { blob = await ic.takePhoto(); } catch (e2) { console.warn('takePhoto', e2); } } else console.warn('takePhoto', e); }
        }
        if (!blob) {
          const w = video.videoWidth, h = video.videoHeight;
          if (!w || !h) return null;
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(video, 0, 0);
          blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
        }
        return blob;
      }
      function askBlurred(blob) {
        const box = el('div', 'fb-cam-blur');
        box.append(el('b', null, 'This photo looks blurred — retake?'),
          el('span', null, point ? 'Hold still, tap the card to focus, then shoot.' : 'Hold still, tap where it should be sharp, then shoot.'));
        const row = el('div', 'fb-actions');
        const again = el('button', 'fb-btn fb-btn-primary', 'Retake');
        const keep = el('button', 'fb-btn', 'Keep it');
        row.append(again, keep); box.append(row); ov.append(box);
        again.onclick = async () => { box.remove(); shutter.disabled = false; await applyPrefs(); };
        keep.onclick = () => finish(blob);
      }
      shutter.onclick = async () => {
        shutter.disabled = true;
        if (!video.videoWidth) { showToast('The camera is still starting — try again', 'error'); shutter.disabled = false; return; }
        if (await focusOnce(point)) await wait(650);
        let score = null;
        try { score = frameSharpness(video, point); } catch (e) { /* cannot read the frame */ }
        const blob = await takeStill();
        if (!blob) { showToast('The photo could not be taken — try again', 'error'); shutter.disabled = false; return; }
        if (score != null && score < BLUR_BELOW) { console.info('blur score', score.toFixed(2)); askBlurred(blob); return; }
        finish(blob);
      };
    });
  }

  // a smaller copy of an already-shrunk canvas: no second decode of the photo
  function shrinkCanvas(canvas, maxSide, quality) {
    const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * k)); c.height = Math.max(1, Math.round(canvas.height * k));
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', quality);
    freeCanvas(c);
    return url;
  }

  // the old trap round's draft (its round was removed on 17 Nov 2026): Finish still clears one, Send everything now
  // lists what is left in one and removes it
  const trapDraftKey = task => 'trapdraft:' + (task.key || task.id);

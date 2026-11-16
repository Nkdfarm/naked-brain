//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- a batch label scanned. CLOSES it. Edit here, then run: python build.py
  // ── a batch's label, scanned (FarmBox 0234, Naked Brain 0.11.127) ───────────
  // The label Naked Heart prints carries https://brain.nkd.farm/#/lot/<batch id> as a QR and the lot code in big
  // letters. The scan button reads the QR with the phone's own reader where it has one (Android) and with jsQR
  // elsewhere (iPhone); a code can be typed instead ("26-0412", or just "412"). The card asks the server: it reads
  // only, and needs a connection (owner 14 Oct 2026: "we are 5g everywhere, no needed off line at this stage").
  const LOT_RE = /#\/lot\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const JSQR_SRC = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  let jsqrP = null;
  const loadJsQR = () => jsqrP || (jsqrP = new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = JSQR_SRC; s.async = true;
    s.onload = () => (window.jsQR ? ok(window.jsQR) : no(new Error('the QR reader did not load')));
    s.onerror = () => { jsqrP = null; no(new Error('the QR reader did not load')); };
    document.head.append(s);
  }));
  const rpcLot = (name, body) => api('/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(body) });

  // what was read or typed: a label's link, a lot code, or only its number
  async function openLotText(text) {
    const s = String(text || '').trim();
    if (!s) return;
    const m = LOT_RE.exec(s);
    if (m) return showLot(m[1]);
    if (/^https?:\/\//i.test(s)) { showToast('Not a FarmBox batch label', 'error'); return; }
    if (!navigator.onLine) { showToast('No connection — the batch is read from the farm', 'error'); return; }
    let found = [];
    try { found = await rpcLot('lot_find', { p_code: s }) || []; }
    catch (e) { showToast('Could not look it up — ' + String(e.message || e).replace(/^\d+ /, '').slice(0, 80), 'error'); return; }
    if (!found.length) { showToast(`No batch with the lot code ${s}`, 'error'); return; }
    if (found.length === 1) return showLot(found[0].id);
    // the same number in two years, or in two units of a site: the person chooses
    const box = $('lot'); box.textContent = '';
    box.append(el('div', 'fb-lot-h', `${found.length} batches answer to ${s}`));
    const list = el('div', 'set-group');
    found.forEach(f => {
      const b = el('button', 'fb-btn', `${f.lot_code} · ${f.crop} · ${f.zone} ${f.position}${f.farm ? ' · ' + f.farm : ''}`);
      b.style.cssText = 'display:block;width:100%;text-align:left;margin:6px 0';
      b.onclick = () => showLot(f.id);
      list.append(b);
    });
    box.append(list);
    show('lot', 'Which batch?', () => showWeek());
  }

  function scanLot() {
    if (document.querySelector('.fb-cam')) return;
    readLotLabel().then(v => { if (v) openLotText(v); });
  }
  // The label's reader (0.11.128, out of scanLot): the camera with the phone's own QR reader or jsQR, and a field to
  // type the code. Gives back what was read or typed, or null when the person cancels; without a camera it asks for
  // the code. Used by the Tasks scanner (which opens the batch's card) and by a harvest task (which adds the batch).
  function readLotLabel({ go: goWord = 'Open', prompt: ask = 'Lot code (for example 26-0412, or just 412)' } = {}) {
    if (document.querySelector('.fb-cam')) return Promise.resolve(null);
    const typed = () => prompt(ask) || null;
    if (!navigator.mediaDevices?.getUserMedia) return Promise.resolve(typed());
    return new Promise(resolve => { (async () => {
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
      catch (e) { console.warn('camera refused', e); resolve(typed()); return; }
      const ov = el('div', 'fb-cam');
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.muted = true; video.srcObject = stream;
      const hint = el('div', 'fb-cam-hint', 'The QR of a batch label inside the square');
      const frame = el('div', 'fb-scan-frame');
      const type = el('form', 'fb-scan-type');
      const code = document.createElement('input');
      code.placeholder = 'or type the lot code'; code.autocomplete = 'off'; code.setAttribute('autocapitalize', 'characters');
      const go = el('button', 'fb-btn', goWord); go.type = 'submit';
      type.append(code, go);
      const bar = el('div', 'fb-cam-bar');
      const cancel = el('button', 'fb-btn', 'Cancel');
      bar.append(cancel);
      ov.append(video, hint, frame, type, bar);
      document.body.append(ov);
      let done = false;
      const finish = v => {
        if (done) return; done = true;
        try { stream.getTracks().forEach(x => x.stop()); } catch (e) { /* stopped */ }
        ov.remove();
        resolve(v || null);
      };
      ov._close = () => finish(null);            // the phone's Back closes the camera
      cancel.onclick = () => finish(null);
      type.onsubmit = e => { e.preventDefault(); finish(code.value); };

      // the phone's own reader when it reads QR codes, else jsQR on a smaller copy of the frame
      let detect = null;
      try {
        if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
          const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
          detect = async () => ((await bd.detect(video))[0] || {}).rawValue || null;
        }
      } catch (e) { detect = null; }
      if (!detect) {
        let jsQR;
        try { jsQR = await loadJsQR(); }
        catch (e) { hint.textContent = 'The QR reader did not load — type the lot code below'; return; }
        const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
        detect = async () => {
          const w = Math.min(video.videoWidth, 800); if (!w) return null;
          const h = Math.round(video.videoHeight * w / video.videoWidth);
          cv.width = w; cv.height = h; cx.drawImage(video, 0, 0, w, h);
          const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
          return r ? r.data : null;
        };
      }
      const tick = async () => {
        if (done) return;
        let text = null;
        if (video.readyState >= 2) { try { text = await detect(); } catch (e) { text = null; } }
        if (text) { try { navigator.vibrate?.(60); } catch (e) { /* no buzz */ } finish(text); return; }
        setTimeout(tick, 200);
      };
      tick();
    })().catch(e => { console.warn('label reader', e); resolve(null); }); });
  }

  const lotDay = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
  function lotWeek(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return 'wk ' + Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  }

  async function showLot(id) {
    const box = $('lot'); box.textContent = '';
    box.append(el('div', 'fb-meta', 'Reading the batch…'));
    show('lot', 'Batch', () => showWeek());
    if (!navigator.onLine) { box.textContent = ''; box.append(el('div', 'fb-lot-hold', '{i:alert} No connection — the batch is read from the farm. Try again with signal.')); return; }
    let c;
    try { c = await rpcLot('lot_card', { p_plan: id }); }
    catch (e) {
      box.textContent = '';
      const why = String(e.message || e);
      box.append(el('div', 'fb-lot-hold', /42501|not a member/.test(why) ? '{i:lock} This batch belongs to a farm you are not part of.'
        : /P0002|no such batch/.test(why) ? '{i:alert} No such batch: it may have been removed.' : '{i:alert} Could not read it — ' + why.replace(/^\d+ /, '').slice(0, 120)));
      return;
    }
    if ($('lot').classList.contains('hidden')) return;   // the person left meanwhile
    box.textContent = '';
    $('title').textContent = c.lot_code ? 'Lot ' + c.lot_code : 'Batch';
    const STATE = { proposed: 'Proposed', validated: 'Planned', active: 'Growing', harvested: 'Harvested', cancelled: 'Cancelled' };

    const head = el('div', 'hero');
    head.append(el('div', 'fb-lot-code', c.lot_code || 'No lot code yet'));
    head.append(el('h1', null, c.crop?.name || ''));
    head.append(el('p', null, [c.crop?.variety, STATE[c.status] || c.status, c.farm].filter(Boolean).join(' · ')));
    box.append(head);

    // the spray waiting period comes first: it decides whether this batch may be cut
    if (c.harvest_after) box.append(el('div', 'fb-lot-hold', `{i:alert} No harvest before ${lotDay(c.harvest_after)} — a spray's waiting period`));

    const group = (title, rows) => {
      const g = el('div', 'set-group');
      rows.filter(r => r && r[1] != null && r[1] !== '').forEach(([k, v]) => { const r = el('div', 'set-row'); r.append(el('span', null, k), el('span', null, String(v))); g.append(r); });
      if (!g.childNodes.length) return;
      box.append(el('div', 'fb-lot-h', title), g);
    };
    const p = c.place || {}, d = c.dates || {}, ex = c.expected || {}, hv = c.harvests || {};
    group('Where', [['Zone', p.zone], ['System', p.system], ['Table', p.position],
                    ['Plants', ex.plants ? Math.round(Number(ex.plants)).toLocaleString() : null]]);
    group('Dates', [
      [c.nursery === 'external' ? 'Seedlings in' : 'Sown', d.received ? lotDay(d.received) : d.sow ? lotDay(d.sow) + ' (planned)' : null],
      ['Transplanted', d.transplanted ? `${lotDay(d.transplanted)} · ${lotWeek(d.transplanted)}` : d.transplant_planned ? `${lotDay(d.transplant_planned)} (planned)` : null],
      ['In the ground', d.days_in_ground != null ? `${d.days_in_ground} days` : null],
      ['Harvest', d.harvest_from ? `${lotDay(d.harvest_from)}${d.harvest_to && d.harvest_to !== d.harvest_from ? ' – ' + lotDay(d.harvest_to) : ''} · ${lotWeek(d.harvest_from)}` : null],
      ['Harvest in', d.days_to_harvest != null ? `${d.days_to_harvest} days` : null]]);

    const cuts = hv.list || [];
    group('Harvest', [['Expected', ex.yield_kg ? `${Math.round(Number(ex.yield_kg))} kg` : null],
                      ['Harvested', cuts.length ? `${Number(hv.kg || 0).toLocaleString()} kg in ${cuts.length} cut${cuts.length === 1 ? '' : 's'}` : 'nothing yet'],
                      ['Waste', Number(hv.waste_kg) ? `${Number(hv.waste_kg)} kg` : null],
                      ['Last cut', cuts.length ? lotDay(cuts[cuts.length - 1].date) : null]]);

    const cases = c.cases || [];
    box.append(el('div', 'fb-lot-h', 'Open cases'));
    const cg = el('div', 'set-group');
    if (!cases.length) cg.append(el('div', 'fb-meta', 'None on its zone'));
    cases.forEach(x => { const r = el('div', 'set-row'); r.append(el('span', null, x.label || x.title), el('span', null, `${x.severity} · since ${lotDay(String(x.opened).slice(0, 10))}`)); cg.append(r); });
    box.append(cg);

    const sprays = c.sprays || [];
    const sprayDone = sprays.filter(s => s.status === 'done'), sprayNext = sprays.filter(s => s.status !== 'done');
    const sprayRow = (s, doneOne) => { const r = el('div', 'set-row');
      r.append(el('span', null, (doneOne ? '{i:check} ' : '') + (s.product || 'Treatment')),
               el('span', null, `${lotDay(String(doneOne ? (s.done_at || s.date) : s.date).slice(0, 10))}${s.phi_days ? ' · wait ' + s.phi_days + ' d' : ''}`));
      return r; };
    box.append(el('div', 'fb-lot-h', 'Sprays'));
    const sg = el('div', 'set-group');
    if (!sprays.length) sg.append(el('div', 'fb-meta', 'None on its tables'));
    sprayDone.forEach(s => sg.append(sprayRow(s, true)));
    if (sprayNext.length) { sg.append(el('div', 'fb-meta', 'To apply')); sprayNext.forEach(s => sg.append(sprayRow(s, false))); }
    box.append(sg);

    const next = c.next_tasks || [];
    box.append(el('div', 'fb-lot-h', 'Next tasks'));
    const tg = el('div', 'set-group');
    if (!next.length) tg.append(el('div', 'fb-meta', 'Nothing planned'));
    next.forEach(t => { const r = el('div', 'set-row');
      r.append(el('span', null, t.title), el('span', null, `${fmtDay(t.date)}${(t.people || []).length ? ' · ' + t.people.join(', ') : ''}`)); tg.append(r); });
    box.append(tg);

    const again = el('button', 'fb-btn', '{i:qr} Scan another');
    again.style.marginTop = 'var(--space-4)';
    again.onclick = () => scanLot();
    box.append(again, el('div', 'fb-meta', `Read at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
  }

  // a label scanned with the phone's own camera opens the app at #/lot/<id>
  function openLotFromHash() {
    const m = LOT_RE.exec(location.hash || '');
    if (!m) return false;
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* kept */ }
    showLot(m[1]);
    return true;
  }
  $('scan')?.addEventListener('click', () => { if (!session) { showToast('Sign in first', 'error'); return; } scanLot(); });

  window.fbOpen = fbOpen;
  setSource('cloud');   // 0.11.117: Tasks are the platform's, for everybody — the Notion / cloud choice is gone from Settings
  netPill();
})();

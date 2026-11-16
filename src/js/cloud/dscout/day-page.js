//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- Digital scouting: reading the day, the page. Edit here, then run: python build.py
  // ── reading the day ──
  const DG = { day: null, farms: [], data: new Map(), thumbs: new Map(), asked: new Set(), page: null, unitKey: null, timer: null,
               reqs: [], people: new Map(), reading: false, again: false, token: 0, lastSig: '', unsent: [],
               post: null, threads: new Map(), zoneY: 0, catalog: null,
               // the feed (0.11.134): the answers read, one per farm, sort and period (dgFeedKey); the scroll it was left at
               view: 'zones', feed: { farmId: null, sort: 'attention', days: 7, answers: new Map(), tok: 0, loading: false, failed: null, y: 0, dirty: false } };
  const dgRpc = (name, args) => api('/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args) });
  const dgOpen = () => !!DG.page && !$('task').classList.contains('hidden') && !!$('task').querySelector(':scope > .dg-page');
  // a page is built aside, with its own marker (another page that paints the view takes it away), then put in place at
  // once — no empty view between two reads — keeping the scroll; the pictures fill in as they land
  const dgBox = () => { const f = document.createDocumentFragment(); f.append(el('span', 'dg-page hidden')); return f; };
  function dgSwap(frag) { const y = window.scrollY; $('task').replaceChildren(frag); window.scrollTo(0, y); dgFillThumbs(); }
  function dgFillThumbs() {
    document.querySelectorAll('#fb-task img[data-thumb], .fb-sheet img[data-thumb]').forEach(img => { const d = DG.thumbs.get(img.dataset.thumb); if (d && img.getAttribute('src') !== d) img.src = d; });
  }
  // the day changes: what was read for the other day, and its pictures, are let go; an older read still on its way is
  // not written over the new day (DG.token)
  function dgSetDay(d) { DG.token++; DG.day = d; DG.data = new Map(); DG.thumbs = new Map(); DG.asked = new Set(); DG.lastSig = ''; }
  async function dgFarmList() {
    let sis = []; try { sis = (await getKV('sisters')) || []; } catch (e) { sis = []; }
    if (sis.length > 1) return sis.map(s => ({ id: s.id, name: s.name }));
    const f = farm || await getKV('farm').catch(() => null);
    return f ? [{ id: f.id, name: f.name }] : [];
  }
  // the counters (light, every 20 s) and, when they moved or something was sent, the report and its new pictures
  async function dgRead(withReport) {
    const day = DG.day, tok = DG.token;
    for (const f of DG.farms) {
      if (tok !== DG.token) return;
      const key = 'dg_cache:' + f.id + ':' + day;
      const cur = DG.data.get(f.id) || {};
      try {
        if (!navigator.onLine || !session) throw new Error('offline');
        const dg = await dgRpc('dg_day', { p_farm: f.id, p_day: day });
        const sig = JSON.stringify(dg.units || []);
        let rep = cur.rep || null;
        if (withReport || !rep || sig !== cur.sig) rep = await dgRpc('scouting_day_light', { p_farm: f.id, p_day: day });
        if (tok !== DG.token) return;
        const fresh = { dg, rep, sig, repSig: rep === cur.rep ? cur.repSig : JSON.stringify(rep?.units || []), at: Date.now(), stale: false };
        DG.data.set(f.id, fresh);
        if (rep !== cur.rep) dgVoiceAgain(rep, dg.me);
        setKV(key, fresh).catch(() => {});
        dgThumbsFor(f.id, day, tok, rep);          // not awaited: the page is painted first, the pictures fill in
      } catch (e) {
        if (tok !== DG.token) return;
        // no signal: what this phone read last for that day, said as such
        if (!cur.dg) { const kept = await getKV(key).catch(() => null); if (kept && tok === DG.token) DG.data.set(f.id, { ...kept, stale: true }); }
        else DG.data.set(f.id, { ...cur, stale: true });
      }
    }
    if (navigator.onLine && session && DG.farms[0]) {
      try { const r = (await dgRpc('dg_my_requests', { p_farm: DG.farms[0].id })) || []; if (tok === DG.token) DG.reqs = r; } catch (e) { /* kept as it was */ }
    }
    try { DG.unsent = await dgUnsentRounds(); } catch (e) { DG.unsent = []; }
  }
  // the small copies of the day's pictures not on this phone: asked once (a picture with none is not asked for again
  // at every read); a failed ask (no signal) is asked again next time
  function dgThumbsFor(farmId, day, tok, rep) {
    const want = (rep?.units || []).flatMap(u => [...(u.photos || []), ...(u.traps || [])]).map(x => x.id)
      .filter(id => id && !DG.thumbs.has(id) && !DG.asked.has(id));
    if (!want.length || !navigator.onLine || !session) return;
    want.forEach(id => DG.asked.add(id));
    dgRpc('scouting_thumbs', { p_farm: farmId, p_day: day }).then(th => {
      if (tok !== DG.token) return;
      Object.entries(th?.photos || {}).forEach(([id, data]) => { if (data) DG.thumbs.set(id, data); });
      dgFillThumbs();
    }).catch(() => { if (tok === DG.token) want.forEach(id => DG.asked.delete(id)); });
  }
  // (6) a round of the daily scouting started on this phone before Digital scouting, with photos never sent: said, with
  // Send it (Force send, which sends that round as it stands) — read without its photos, from the draft's own row
  async function dgUnsentRounds() {
    const keys = (await tx('kv', 'readonly', s => s.getAllKeys())).filter(k => /^scout2:/.test(String(k)));
    const out = [];
    for (const k of keys) {
      const v = await getKVraw(k).catch(() => null);
      const n = ((v && v.photos) || []).reduce((a, q) => a + (q.section === 'trap'
        ? Object.values(q.sides || {}).filter(S => S && !S.sent && (S.full || S.photo_path)).length : (q.sent ? 0 : 1)), 0);
      if (n) out.push({ key: String(k).slice(7), n });
    }
    return out;
  }
  function dgUnsentBox(list) {
    const n = list.reduce((a, x) => a + x.n, 0);
    const b = el('div', 'fb-hold dg-unsent');
    b.append(el('span', null, `An earlier round on this phone was not sent (${n} photo${n === 1 ? '' : 's'}). `));
    const go = el('button', 'fb-btn fb-btn-primary', '{i:upload} Send it'); go.type = 'button';
    go.onclick = e => { e.stopPropagation(); sendAllNow(); };
    b.append(go);
    return b;
  }
  // what the page shows, in one line: a read that changed nothing is not painted again (no flicker)
  async function dgPageSig() {
    const pend = (await dgPending()).map(r => [r.id, !!r.dead, (r.payload.uploads || []).map(x => !!x.done)]);
    return JSON.stringify([DG.page, DG.unitKey, DG.day, [...DG.data].map(([k, v]) => [k, v.sig, v.repSig, !!v.stale]),
                           pend, DG.reqs.map(q => q.id), DG.unsent.map(x => x.key + ':' + x.n),
                           DG.post ? [DG.post.kind, DG.post.id, DG.post.sig, !!DG.post.stale, [...DG.post.asking]] : null,
                           DG.page === 'feed' || DG.post?.from === 'feed' ? dgFeedSig() : null]);
  }
  // a voice note of mine not written down a minute after it was made (the call to write it down was lost, or failed on
  // the network): asked again, once each time the report is read; without signal the call waits in the outbox
  const dgVoiceStuck = (n, me, now = Date.now()) => !!n && !!n.audio_path && n.by_user === me && now - new Date(n.at).getTime() > 60000
    && (n.voice_status === 'queued' || (n.voice_status === 'failed' && /fetch|network|time(d)? ?out|abort|5\d\d|ECONN|socket/i.test(String(n.voice_error || ''))));
  function dgVoiceAgain(rep, me) {
    const asked = new Set();
    (rep?.units || []).forEach(u => [...(u.photos || []), ...(u.traps || [])].forEach(i => (Array.isArray(i.notes) ? i.notes : []).forEach(n => {
      if (asked.has(n.id) || !dgVoiceStuck(n, me)) return;
      asked.add(n.id);
      const later = () => queue({ __dg: true, client_run_id: 'dg-voice-' + n.id, fn: 'greenhouse-note', args: { photo_note_id: n.id },
                                  chain: 'dg-voice-' + n.id, day: DG.day }).catch(() => {});
      if (!navigator.onLine || !session) { later(); return; }
      api('/functions/v1/greenhouse-note', { method: 'POST', body: JSON.stringify({ photo_note_id: n.id }) })
        .catch(e => { if (errKind(e) === 'net') later(); });
    })));
  }
  // the items still on this phone (the outbox), for the page: shown at once, marked "sending"
  async function dgPending() {
    try { return (await all('outbox')).filter(r => r.payload && r.payload.__dg && r.payload.view && r.payload.day === DG.day); }
    catch (e) { return []; }
  }
  let dgDeb = null;
  // something of the page was sent, or the live signal said "moved": read again soon, the report too
  function dgSoon(ms = 700) {
    if (!dgOpen()) return;
    clearTimeout(dgDeb);
    dgDeb = setTimeout(() => dgRefresh(true).catch(() => {}), ms);
  }
  async function dgRefresh(withReport) {
    if (!dgOpen()) return;
    if (DG.reading) { DG.again = DG.again || withReport; return; }
    const tok = DG.token;
    DG.reading = true;
    try {
      await dgRead(withReport);
      if (DG.page === 'post') await dgReadThread();
      // the feed: read again when something was sent or the live signal said "moved" — not at every 20 s tick
      if (withReport && (DG.page === 'feed' || DG.post?.from === 'feed')) await dgReadFeed();
    } finally { DG.reading = false; }
    if (!dgOpen() || tok !== DG.token) return;
    if (document.querySelector('.fb-sheet, .fb-cam, .fb-viewer')) return;   // never redrawn under a sheet, the camera or a photo
    const sig = await dgPageSig();
    if (sig !== DG.lastSig) {
      if (DG.page === 'zone') await dgPaintZone(); else if (DG.page === 'post') await dgPaintPost();
      else if (DG.page === 'requests') await dgPaintRequests(); else if (DG.page === 'feed') await dgPaintFeed(); else await dgPaintDay();
      DG.lastSig = sig;
    }
    if (DG.again) { DG.again = false; dgSoon(300); }
  }
  // every 20 s while the page is on screen and there is signal (the live "moved" signal reads at once)
  function dgTick() {
    clearInterval(DG.timer);
    DG.timer = setInterval(() => {
      if (!dgOpen()) { clearInterval(DG.timer); DG.timer = null; return; }
      // only while Tasks is the section on screen (not Capture or Daily) and the app is in front
      if (!document.hidden && fbOnScreen() && navigator.onLine && session && !document.querySelector('.fb-cam')) dgRefresh(false).catch(() => {});
    }, 20000);
  }

  // ── the page ──
  // ctx: { day, farmId, taskId, unitId } — a task card opens it on its zone
  async function dgPrune() {
    try {
      const keys = await tx('kv', 'readonly', s => s.getAllKeys());
      const from = addDays(todayISO(), -8);   // the farm's day (0.11.146)
      const old = keys.filter(k => /^dg_cache:/.test(String(k)) && String(k).slice(-10) < from);
      if (old.length) await tx('kv', 'readwrite', s => old.forEach(k => s.delete(k)));
    } catch (e) { /* kept */ }
  }
  async function openDigital(ctx = {}) {
    dgPrune();
    dgSetDay(ctx.day || todayISO());
    const tok = DG.token;
    DG.farms = await dgFarmList();
    if (!DG.farms.length) { showToast('No farm on this phone yet — sync when there is signal', 'error'); return; }
    DG.page = 'day';
    const box = dgBox();
    box.append(el('div', 'fb-meta', 'Reading the day…'));
    dgSwap(box);
    show('task', 'Digital scouting', () => dgClose());
    await dgRead(true);
    if (tok !== DG.token) return;
    dgTick();
    if (ctx.taskId || ctx.unitId) {
      for (const f of DG.farms) {
        const u = ((DG.data.get(f.id) || {}).dg?.units || []).find(x => (ctx.taskId && x.task_id === ctx.taskId) || (ctx.unitId && x.unit_id === ctx.unitId));
        if (u) { await dgPaintDay(); return dgZone(f.id, u.unit_id); }
      }
    }
    if (DG.view === 'feed') return dgShowFeed();      // the way it was left last time, while the app stays open
    await dgPaintDay();
  }
  function dgClose() {
    DG.page = null; DG.post = null; clearInterval(DG.timer); DG.timer = null;
    showWeek();
  }
  const dgFarmData = id => DG.data.get(id) || {};
  const dgUnit = (farmId, unitId) => ((dgFarmData(farmId).dg || {}).units || []).find(u => u.unit_id === unitId) || null;
  const dgRepUnit = (farmId, unitId) => ((dgFarmData(farmId).rep || {}).units || []).find(u => (u.unit_id || u.zone_id) === unitId) || null;
  const dgCanAdd = D => !!D && !!D.is_today;
  function dgCounterLine(u, extra) {
    const line = el('div', 'dg-count');
    dgCounters(u).forEach((c, i) => {
      if (i) line.append(document.createTextNode(' · '));
      line.append(el('span', c.target > 0 ? (c.ok ? 'dg-ok' : c.due === false ? 'dg-plain' : 'dg-miss') : 'dg-plain', c.target > 0 ? `${c.label} ${c.done}/${c.target}` : `${c.label} ${c.done}`));
    });
    if (!line.childNodes.length) line.append(el('span', 'dg-plain', 'Nothing due today'));
    if (extra) line.append(el('span', 'dg-sending', ' · ' + extra));
    return line;
  }
  // the day picker: today and the days before it, and a date field for any other
  function dgDayPicker() {
    const row = el('div', 'dg-days');
    const today = todayISO();
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, -i);            // the farm's days (0.11.146)
      const b = el('button', 'fb-btn dg-day' + (d === DG.day ? ' on' : ''), i === 0 ? 'Today' : i === 1 ? 'Yesterday'
        : new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }));
      b.type = 'button'; b.setAttribute('aria-pressed', String(d === DG.day));
      b.onclick = () => dgGoDay(d);
      row.append(b);
    }
    const pick = el('input', 'fb-num dg-date'); pick.type = 'date'; pick.max = today; pick.value = DG.day;
    pick.setAttribute('aria-label', 'Another day');
    pick.onchange = () => { if (pick.value && pick.value <= today) dgGoDay(pick.value); };
    row.append(pick);
    return row;
  }
  async function dgGoDay(d) {
    dgSetDay(d);
    const tok = DG.token;
    const box = dgBox(); box.append(el('div', 'fb-meta', 'Reading the day…')); dgSwap(box);
    await dgRead(true);
    if (tok !== DG.token || !dgOpen()) return;       // another day was chosen meanwhile: that one paints
    await dgPaintDay();
  }
  // the two ways of the page (0.11.134): the zones of a day, or the farm's photos as a feed
  function dgViewSwitch() {
    const row = el('div', 'dg-switch');
    [['zones', 'Zones'], ['feed', 'Feed']].forEach(([v, word]) => {
      const b = el('button', 'dg-switch-b' + (DG.view === v ? ' on' : ''), word); b.type = 'button';
      b.setAttribute('aria-pressed', String(DG.view === v));
      b.onclick = async () => {
        if (DG.view === v) return;
        if (v === 'feed') return dgShowFeed();
        await dgPaintDay(); window.scrollTo(0, 0);
      };
      row.append(b);
    });
    return row;
  }
  function dgReqsButton() {
    const rq = el('button', 'btn btn-block dg-reqs', `{i:message} ${DG.reqs.length} photo${DG.reqs.length === 1 ? '' : 's'} waiting for your opinion`);
    rq.onclick = () => dgRequests();
    return rq;
  }
  async function dgPaintDay() {
    DG.page = 'day'; DG.view = 'zones';
    const box = dgBox();
    const hero = el('div', 'hero');
    hero.append(el('h1', null, 'Digital scouting'), el('p', null, fmtDay(DG.day) + (DG.farms.length > 1 ? ' · ' + DG.farms.map(f => f.name).join(' + ') : '')));
    box.append(hero, dgViewSwitch(), dgDayPicker());
    if (DG.unsent.length) box.append(dgUnsentBox(DG.unsent));
    if (DG.reqs.length) box.append(dgReqsButton());
    const pend = await dgPending();
    let any = false;
    for (const f of DG.farms) {
      const fd = dgFarmData(f.id), D = fd.dg;
      if (DG.farms.length > 1) box.append(el('div', 'fb-unit', f.name));
      if (!D) { box.append(el('div', 'config-hint', navigator.onLine ? 'Could not read this day — try again in a moment.' : 'No signal, and nothing read on this phone for this day yet.')); continue; }
      if (fd.stale) box.append(el('div', 'config-hint', `No signal: as read at ${new Date(fd.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`));
      if (!D.is_today) box.append(el('div', 'config-hint', D.may_change_all ? 'A day gone by: you may still change or delete its items.' : 'A day gone by: to look at only.'));
      for (const u of D.units || []) {
        any = true;
        const mine = pend.filter(r => !r.dead && r.payload.view.farm_id === f.id && r.payload.view.unit_id === u.unit_id && ['photo', 'trap'].includes(r.payload.view.kind)).length;
        const b = el('button', 'fb-card dg-unit');
        const body = el('div', 'fb-body');
        body.append(el('div', 'fb-name', u.name || 'Zone'), dgCounterLine(u, mine ? `${mine} sending` : ''));
        const miss = dgMissing(u).text;
        if (miss && D.is_today) body.append(el('div', 'fb-meta dg-missline', miss));
        b.append(body);
        b.append(el('span', 'fb-chip ' + (u.complete ? 'ok' : 'todo'), u.complete ? 'Done' : 'Open'));
        b.onclick = () => dgZone(f.id, u.unit_id);
        box.append(b);
      }
    }
    if (!any && DG.farms.some(f => dgFarmData(f.id).dg)) box.append(el('div', 'config-hint', 'No zone to scout on this day.'));
    box.append(el('div', 'config-hint', 'Everybody sees the same page, live. You may change or delete your own photos and notes until the end of the day; a manager may change everything.'));
    dgSwap(box);
  }


//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- Digital scouting: the feed. Edit here, then run: python build.py
  // ── the feed (0.11.134): the farm's photos and trap readings of the last 7 or 30 days as posts, in the server's order
  // (dg_feed), 20 a page; a tap opens the post, Back comes here at the same place ──
  const dgFeedFarm = () => (DG.feed.farmId && DG.farms.some(f => f.id === DG.feed.farmId) ? DG.feed.farmId : (DG.farms[0] || {}).id || null);
  const dgFeedKey = () => `${dgFeedFarm()}:${DG.feed.sort}:${DG.feed.days}`;
  const dgFeedNow = () => DG.feed.answers.get(dgFeedKey()) || null;
  function dgFeedSig() { const A = dgFeedNow(); return [DG.view, dgFeedKey(), A ? A.sig : null, !!(A && A.stale), DG.feed.failed === dgFeedKey()]; }
  // the feed read again: as many pages as are on screen. Kept per farm, sort and period (KV dg_feed:<key>), so that
  // without signal the last answer shows, said as such
  async function dgReadFeed() {
    const F = DG.feed, farmId = dgFeedFarm(), key = dgFeedKey(), tok = F.tok;
    if (!farmId) return;
    const cur = F.answers.get(key) || null;
    const kept = async () => { const k = cur || await getKV('dg_feed:' + key).catch(() => null); if (k && tok === F.tok) F.answers.set(key, { ...k, stale: true }); return !!k; };
    if (!navigator.onLine || !session) { await kept(); return; }
    const pages = Math.max(1, Math.ceil(((cur && cur.items) || []).length / DG_FEED_PAGE));
    let items = [], res = null;
    try {
      for (let i = 0; i < pages; i++) {
        res = await dgRpc('dg_feed', { p: { farm_id: farmId, sort: F.sort, days: F.days, offset: i * DG_FEED_PAGE, limit: DG_FEED_PAGE } });
        if (tok !== F.tok) return;
        items = dgFeedMerge(items, (res && res.items) || []);
        if (!res || !res.more) break;
      }
    } catch (e) {
      if (tok !== F.tok) return;
      if (!(await kept())) F.failed = key;
      return;
    }
    const A = { farm_id: farmId, items, more: !!(res && res.more), total: Number(res && res.total) || items.length, may_verify: !!(res && res.may_verify),
                may_case: !!(res && res.may_case), at: Date.now(), stale: false, sig: JSON.stringify(items) };
    F.answers.set(key, A); F.failed = null; F.dirty = false;
    setKV('dg_feed:' + key, A).catch(() => {});
    dgFeedThumbs(items);                          // not awaited: the cards are painted first, the pictures fill in
  }
  // the pictures of the posts not on this phone (dg_thumbs, 40 at most a call); a failed ask is asked again next time
  function dgFeedThumbs(items) {
    const want = dgThumbAsk(items, DG.thumbs, DG.asked);
    if (!want.length || !navigator.onLine || !session) return;
    const tok = DG.token;
    want.forEach(x => DG.asked.add(x.id));
    for (let i = 0; i < want.length; i += 40) {
      const part = want.slice(i, i + 40);
      dgRpc('dg_thumbs', { p: { items: part } }).then(th => {
        if (tok !== DG.token) return;
        Object.entries(th || {}).forEach(([id, data]) => { if (data) DG.thumbs.set(id, data); });
        dgFillThumbs();
      }).catch(() => { if (tok === DG.token) part.forEach(x => DG.asked.delete(x.id)); });
    }
  }
  // the next 20 under the ones on screen
  async function dgMoreFeed() {
    if (!navigator.onLine || !session) { showToast('Needs signal', 'error'); return; }
    const F = DG.feed, key = dgFeedKey(), tok = F.tok, cur = F.answers.get(key);
    if (!cur || F.loading) return;
    F.loading = true;
    try {
      const res = await dgRpc('dg_feed', { p: { farm_id: dgFeedFarm(), sort: F.sort, days: F.days, offset: cur.items.length, limit: DG_FEED_PAGE } });
      if (tok !== F.tok) return;
      const items = dgFeedMerge(cur.items, (res && res.items) || []);
      const A = { ...cur, items, more: !!(res && res.more), total: Number(res && res.total) || items.length, at: Date.now(), stale: false, sig: JSON.stringify(items) };
      F.answers.set(key, A);
      setKV('dg_feed:' + key, A).catch(() => {});
      dgFeedThumbs((res && res.items) || []);
    } catch (e) { showToast('More could not be read — try again', 'error'); }
    finally { F.loading = false; }
    if (tok === F.tok && DG.page === 'feed' && dgOpen()) { await dgPaintFeed(); DG.lastSig = await dgPageSig(); }
  }
  // the feed on screen: what is kept at once, then read again
  async function dgShowFeed() {
    DG.view = 'feed'; DG.page = 'feed'; DG.post = null;
    await dgPaintFeed(); window.scrollTo(0, 0);
    await dgFeedAgain();
  }
  async function dgFeedAgain() {
    const tok = DG.feed.tok;
    await dgReadFeed();
    if (tok === DG.feed.tok && DG.page === 'feed' && dgOpen() && !document.querySelector('.fb-sheet, .fb-cam, .fb-viewer')) { await dgPaintFeed(); DG.lastSig = await dgPageSig(); }
  }
  // another sort, period or farm: the answer kept for it shows at once, from the top
  async function dgFeedGo(change) {
    Object.assign(DG.feed, change); DG.feed.tok++; DG.feed.loading = false; DG.feed.y = 0;
    await dgPaintFeed(); window.scrollTo(0, 0);
    await dgFeedAgain();
  }
  const dgFeedWhen = iso => !iso ? '' : (dgDayOf(iso) === todayISO() ? '' : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ') + dgHm(iso);
  function dgFeedTitle(kind, it) {
    if (kind === 'trap') return [it.zone, `Trap ${shortCode(it.code)}`, it.side].filter(Boolean).join(' · ');
    return [it.zone, dgPartWord(it.part)].filter(Boolean).join(' · ') || 'Plant photo';
  }
  // the verified diagnosis under a picture, in short: "Verified  Downy mildew, not powdery…"
  function dgVerifiedTag(v) {
    if (!v || typeof v !== 'object') return null;
    const b = el('div', 'dg-verified');
    b.append(el('span', 'dg-verified-k', 'Verified'));
    const t = el('span', 'dg-verified-text'); t.textContent = dgFirstWords(v.body); b.append(t);
    b.title = 'Verified diagnosis' + (v.by ? ' by ' + firstName(v.by) : '') + (v.verified_by ? ', verified by ' + firstName(v.verified_by) : '') + ': ' + String(v.body || '');
    return b;
  }
  // a post of the feed: the zone page's compact card, with the post's risk on its left edge
  function dgFeedCard(p, pend) {
    const kind = p.kind === 'trap' ? 'trap' : 'observation';
    const mine = pend.filter(r => r.payload.view.ref_id === p.id);
    const { it, removing } = dgEdited(p, mine);
    const c = el('div', 'fb-step dg-item dg-feed-item' + (['red', 'orange', 'green'].includes(p.risk) ? ' risk-' + p.risk : '') + (removing ? ' gone' : ''));
    c.dataset.ref = p.id;
    const img = el('img', 'dg-img'); img.alt = ''; img.dataset.thumb = p.id;
    { const t0 = dgThumb(p.id); if (t0) img.src = t0; }
    const txt = el('div', 'dg-text');
    const t = el('b'); t.textContent = dgFeedTitle(kind, it); txt.append(t);
    txt.append(el('div', 'fb-meta', [dgFeedWhen(p.taken_at), p.by ? firstName(p.by) : null, removing ? 'deleting — sending' : null].filter(Boolean).join(' · ')));
    const chips = dgChipRow(kind, p, it);
    if (chips) txt.append(chips);
    const s = dgSocialWith(p.social, dgPendReact(mine, 'ai', null), dgPendNotes(mine));
    const ver = dgVerifiedTag(s && s.verified);
    if (ver) txt.append(ver);
    const sl = dgSocialText(s);
    if (sl) txt.append(el('div', 'dg-social', sl));
    c.append(img, txt);
    if (!removing) {
      c.classList.add('tap'); c.setAttribute('role', 'button'); c.tabIndex = 0;
      c.onclick = () => dgOpenPost(p.id, 'feed');
      c.onkeydown = e => { if (e.key === 'Enter') dgOpenPost(p.id, 'feed'); };
    }
    return c;
  }
  async function dgPaintFeed() {
    DG.page = 'feed'; DG.view = 'feed';
    const F = DG.feed, key = dgFeedKey(), A = dgFeedNow();
    const box = dgBox();
    const hero = el('div', 'hero');
    hero.append(el('h1', null, 'Digital scouting'), el('p', null, `The farm's photos · the last ${F.days} days`));
    box.append(hero, dgViewSwitch());
    if (DG.reqs.length) box.append(dgReqsButton());
    const chipRow = (list, on, go, cls) => {
      const row = el('div', 'dg-days ' + cls);
      list.forEach(([v, word]) => {
        const b = el('button', 'fb-btn' + (v === on ? ' on' : ''), word); b.type = 'button'; b.setAttribute('aria-pressed', String(v === on));
        b.onclick = () => (v !== on ? go(v) : null);
        row.append(b);
      });
      return row;
    };
    if (DG.farms.length > 1) box.append(chipRow(DG.farms.map(f => [f.id, f.name]), dgFeedFarm(), v => dgFeedGo({ farmId: v }), 'dg-farms'));
    box.append(chipRow(DG_SORTS, F.sort, v => dgFeedGo({ sort: v }), 'dg-sorts'));
    const per = chipRow(DG_PERIODS, F.days, v => dgFeedGo({ days: v }), 'dg-period');
    if (A && A.items.length) per.append(el('span', 'fb-meta', `${A.total} post${A.total === 1 ? '' : 's'}`));
    box.append(per);
    if (!A) {
      box.append(el('div', 'config-hint', !navigator.onLine || !session ? 'The feed needs signal.'
                                          : F.failed === key ? 'Could not read the feed — try again in a moment.' : 'Reading the feed…'));
      dgSwap(box); return;
    }
    if (A.stale) box.append(el('div', 'config-hint', (navigator.onLine ? 'Could not be read again' : 'No signal') + `: the feed as read at ${dgHm(new Date(A.at).toISOString())}.`));
    const pend = (await dgPending()).filter(r => r.payload.view.farm_id === A.farm_id);
    A.items.forEach(p => box.append(dgFeedCard(p, pend)));
    if (!A.items.length) box.append(el('div', 'config-hint', dgFeedEmpty(F.sort)));
    if (A.more) {
      const more = el('button', 'btn btn-block dg-more', 'More'); more.type = 'button';
      more.disabled = F.loading;
      more.onclick = () => { more.disabled = true; dgMoreFeed(); };
      box.append(more);
    }
    dgSwap(box);
  }


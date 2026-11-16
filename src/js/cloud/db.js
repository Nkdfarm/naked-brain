//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- OPENS it. Constants, the IndexedDB wrapper, draft photos. Edit here, then run: python build.py
// ═══════════════════════════════════════════════════════════════════════════
// FARMBOX CLOUD — the Tasks tab served by Supabase (spec §6, phase 1)
//
// Sign in once, sync the farm's week into IndexedDB, work offline, post the
// outbox when there is signal. The Notion path is untouched and stays the
// default; Settings → Data source flips between them.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  const URL_BASE = 'https://azfiajzhzewjcblbltmp.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6ZmlhanpoemV3amNibGJsdG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMDg5NzQsImV4cCI6MjEwNDc4NDk3NH0.0wakTe-gKANg4w6sfxyNfn8nhfgDGW2O7O60WvMI1mY';
  const SESSION_KEY = 'fb_session', SOURCE_KEY = 'fb_source';

  const $ = id => document.getElementById('fb-' + id);
  const el = (tag, cls, text) => { const n = document.createElement(tag);
    if (cls) n.className = cls; if (text != null) nbLabel(n, text); return n; };

  // ── tiny IndexedDB wrapper (one store, keyed records) ───────────────────
  // v2 adds 'positions': the crop positions a grouped task covers (Phase A).
  // v3 adds 'traps': the farm's sticky traps, for the IPM trap round.
  const STORES = ['kv', 'tasks', 'sops', 'versions', 'steps', 'outbox', 'positions', 'traps', 'task_workers', 'workers'];
  let dbp;
  function db() {
    if (dbp) return dbp;
    const p = dbp = new Promise((res, rej) => {
      const r = indexedDB.open('farmbox', 4);
      r.onupgradeneeded = () => STORES.forEach(s => {
        if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
      });
      r.onsuccess = () => {
        const d = r.result;
        // another tab upgrading later: let go of this connection, reopen on demand
        d.onversionchange = () => { d.close(); if (dbp === p) dbp = null; };
        // 0.11.146: closed by the browser (an iPhone after the app was in the background): reopened at the next use
        d.onclose = () => { if (dbp === p) dbp = null; };
        res(d);
      };
      r.onerror = () => { if (dbp === p) dbp = null; rej(r.error); };
      r.onblocked = () => { if (dbp === p) dbp = null; rej(new Error('Close the other Naked Brain tab and reload')); };
    });
    return p;
  }
  // 0.11.146 (review of 16 Nov): WebKit drops the connection after the app was in the background ("Connection to
  // Indexed Database server lost"), and every save failed until a reload — Finish said "Could not save". Such a
  // failure opens the database again and tries once more; nothing was written by the failed try.
  const idbLost = e => !!e && (e.name === 'InvalidStateError' || e.name === 'UnknownError'
    || /connection.*(lost|clos)|database.*clos/i.test(String(e.message || '')));
  async function tx(store, mode, fn, again = true) {
    const p = db(), d = await p;
    try {
      return await new Promise((res, rej) => {
        const t = d.transaction(store, mode), s = t.objectStore(store);
        const out = fn(s);
        t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || Object.assign(new Error('the phone refused to save (storage full?)'), { noError: true }));
      });
    } catch (e) {
      // an abort with no reason, or a plain AbortError, after the browser closed the connection (onclose let it go) is
      // the same lost connection
      const closedUnder = dbp !== p && !!e && (e.noError || e.name === 'AbortError');
      if (!again || !(idbLost(e) || closedUnder)) throw e;
      if (dbp === p) { dbp = null; try { d.close(); } catch (x) { /* gone already */ } }
      return tx(store, mode, fn, false);
    }
  }
  // and when the app comes back on screen, a connection the browser closed meanwhile is let go before anything uses it
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !dbp) return;
    const p = dbp;
    p.then(d => { try { d.transaction('kv', 'readonly'); } catch (e) { if (idbLost(e) && dbp === p) dbp = null; } }, () => {});
  });
  const putAll = (store, rows) => rows && rows.length
    ? tx(store, 'readwrite', s => rows.forEach(r => s.put(r))) : Promise.resolve();
  const all = store => tx(store, 'readonly', s => s.getAll());
  const getKVraw = async k => (await tx('kv', 'readonly', s => s.get(k)))?.v;
  const setKVraw = (k, v) => tx('kv', 'readwrite', s => s.put({ id: k, v }));
  const delRaw = (store, id) => tx(store, 'readwrite', s => s.delete(id));

  // ── a draft's photos are stored once (0.11.92, review of 30 Sept): every save of a scouting draft used to write
  // every 4000 px photo again — a phone stores a Blob as a file of its own on each put, so a zone of 15 photos wrote
  // ~60 MB at every tap. Now a Blob in a draft goes once under 'blob:<id>' and the draft keeps { __blob: id };
  // getKV puts the photos back, so the drafts' callers did not change. Unreferenced photos are swept (gcBlobs).
  // an iPhone or iPad (0.11.99, owner 4 Oct 2026: "we had problems on iPhone"): less memory for a web app, no still
  // camera for it, no graphics acceleration for the outline model — so smaller photos, the phone's own camera, and
  // waiting photos stored as plain bytes (a Blob in the browser's database is the weak spot there after a kill)
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const unBlob = v => (v && typeof v === 'object' && v.__ab instanceof ArrayBuffer ? new Blob([v.__ab], { type: v.type || 'image/jpeg' }) : v);
  const packBlob = async b => (IS_IOS && b instanceof Blob ? { __ab: await b.arrayBuffer(), type: b.type || 'image/jpeg' } : b);
  const freeCanvas = c => { try { if (c && c.width) { c.width = 0; c.height = 0; } } catch (e) { /* gone already */ } };
  const FB_DRAFT_KEY = /^(rundraft|scout2|trapdraft|harvdraft|fbkdraft|ghdraft):/;
  const blobIds = new WeakMap();                         // a Blob → its 'blob:<id>' once stored
  const newBlobId = () => 'blob:' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  function swapOut(v, fresh, refs) {
    if (v instanceof Blob) {
      let id = blobIds.get(v) || fresh.get(v);
      if (!id) { id = newBlobId(); fresh.set(v, id); }
      refs.add(id);
      return { __blob: id };
    }
    if (Array.isArray(v)) return v.map(x => swapOut(x, fresh, refs));
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const o = {}; for (const k of Object.keys(v)) o[k] = swapOut(v[k], fresh, refs); return o;
    }
    return v;
  }
  function swapIn(v, got) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.__blob === 'string' && Object.keys(v).length === 1) {
      const b = got.get(v.__blob) || null;
      if (b) blobIds.set(b, v.__blob);
      return b;
    }
    if (Array.isArray(v)) return v.map(x => swapIn(x, got));
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const o = {}; for (const k of Object.keys(v)) if (k !== '__blobs') o[k] = swapIn(v[k], got); return o;
    }
    return v;
  }
  let gcTimer = null;
  const gcSoon = () => { clearTimeout(gcTimer); gcTimer = setTimeout(() => gcBlobs().catch(() => {}), 20000); };
  async function gcBlobs() {
    const keys = await tx('kv', 'readonly', s => s.getAllKeys());
    const blobs = keys.filter(k => String(k).startsWith('blob:'));
    if (!blobs.length) return;
    const used = new Set();
    for (const k of keys.filter(k => FB_DRAFT_KEY.test(String(k)))) ((await getKVraw(k))?.__blobs || []).forEach(id => used.add(id));
    const gone = blobs.filter(id => !used.has(id));
    if (gone.length) await tx('kv', 'readwrite', s => gone.forEach(id => s.delete(id)));
  }
  async function setKV(k, v) {
    if (!FB_DRAFT_KEY.test(String(k)) || v == null) { const r = await setKVraw(k, v); if (v == null && FB_DRAFT_KEY.test(String(k))) gcSoon(); return r; }
    const fresh = new Map(), refs = new Set();
    const out = swapOut(v, fresh, refs);
    const packed = new Map();
    if (IS_IOS) for (const [b, id] of fresh) packed.set(id, await packBlob(b));
    // the new photos and the draft in one transaction: a draft never points at a photo that was not stored
    const r = await tx('kv', 'readwrite', s => {
      fresh.forEach((id, b) => s.put({ id, v: packed.get(id) || b }));
      s.put({ id: k, v: { ...out, __blobs: [...refs] } });
    });
    fresh.forEach((id, b) => blobIds.set(b, id));
    if (fresh.size || refs.size) gcSoon();
    return r;
  }
  async function getKV(k) {
    const v = await getKVraw(k);
    if (!v || !FB_DRAFT_KEY.test(String(k)) || !(v.__blobs || []).length) return v && v.__blobs ? swapIn(v, new Map()) : v;
    const got = new Map();
    await tx('kv', 'readonly', s => v.__blobs.forEach(id => { const q = s.get(id); q.onsuccess = () => { if (q.result) got.set(id, unBlob(q.result.v)); }; }));
    return swapIn(v, got);
  }
  // every kv row, a draft with its photos back and the stored photos themselves left out (Send reads the drafts this way)
  async function allKV() {
    const rows = await all('kv');
    const got = new Map(rows.filter(r => String(r.id).startsWith('blob:')).map(r => [r.id, unBlob(r.v)]));
    return rows.filter(r => !String(r.id).startsWith('blob:'))
      .map(r => FB_DRAFT_KEY.test(String(r.id)) && r.v && r.v.__blobs ? { ...r, v: swapIn(r.v, got) } : r);
  }
  async function del(store, id) {
    const r = await delRaw(store, id);
    if (store === 'kv' && FB_DRAFT_KEY.test(String(id))) gcSoon();
    return r;
  }
  gcSoon();                                              // photos of drafts finished before this visit


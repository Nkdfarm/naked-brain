//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- OPENS it. What is left of the Notion SoP: the Worker call and its small database. Edit here, then run: python build.py
(() => {
'use strict';
// ─── WHAT IS LEFT OF THE NOTION SoP ──────────────────────────
// Until 0.11.117 (6 Oct 2026) the Tasks tab could read its procedures from Notion: a list, a dashboard, a checklist
// run, an editor and a Word / PDF import, all opened by sopOpen. Since then the source is always the platform
// (setSource('cloud') in js/cloud/lot-scan.js, the choice hidden in Settings) and none of it could be reached; it was
// removed on 17 Nov 2026. Kept: the runs of a Notion checklist finished on a phone before then and still waiting in
// this small database ('sopapp', key 'outbox') go up to Notion's SOP Runs when the signal comes back (js/sop/run.js).
// The cloud closure (js/cloud/*) still sits inside this one and has its own $(), el() and helpers.
// Same Cloudflare Worker as Brain+: it injects the Notion token and gates every call on X-App-Password (or the
// person's session, cfFetch decides). No secrets live in this file.
const PROXY = 'https://notion-proxy.francesco-955.workers.dev';
const NOTION_VERSION = '2022-06-28';                    // the Worker forces this anyway
const RUNS_DB = '2bb3587c362a490882496c3967dda7db';     // Naked Farm / Brain+ / SOP Runs
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = iso => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

// Failed response → a short, true reason. Notion/Groq send {message} or {error:{message}}.
async function apiErrorMessage(res) {
  let detail = '';
  try {
    const body = await res.text();
    try { const j = JSON.parse(body); detail = j?.message || j?.error?.message || ''; }
    catch (_) { detail = body.trim(); }
  } catch (_) {}
  if (res.status === 429) return 'rate limit reached — wait a minute and retry';
  if (res.status === 413) return 'document too large for the AI — use "Import as-is"';
  const base = detail || `HTTP ${res.status}`;
  return base.length > 140 ? base.slice(0, 137) + '…' : base;
}
function failureReason(e) {
  if (e?.name === 'AbortError') return 'timed out — connection too slow';
  if (e instanceof TypeError) return 'cannot reach the server — check your connection';
  const msg = e?.message || 'unknown error';
  return msg.length > 140 ? msg.slice(0, 137) + '…' : msg;
}
const isNetworkError = e => e instanceof TypeError || e?.name === 'AbortError';

// cfFetch is Naked Brain's (the password or the session, 2-minute cap, 401 → login).

// Notion REST call through the Worker. Throws Error(reason) on non-2xx.
async function notion(path, method = 'GET', body) {
  const opts = { method, headers: { 'Notion-Version': NOTION_VERSION } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await cfFetch(PROXY + '/v1/' + path, opts);
  if (!res.ok) {
    const e = new Error(await apiErrorMessage(res));
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

// ─── INDEXEDDB (the old outbox) ──────────────────────────────
let _db = null;
function idb() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open('sopapp', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}
async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  } catch (e) { console.warn('idbGet', key, e); return undefined; }
}
// strict: the failure is thrown, for writes nothing may be lost on (the outbox, 0.11.92)
async function idbSet(key, val, strict = false) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      val === undefined ? tx.objectStore('kv').delete(key) : tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('storage refused (full?)'));
    });
  } catch (e) { console.warn('idbSet', key, e); if (strict) throw e; }
}


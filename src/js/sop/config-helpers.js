//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- OPENS it. Config, helpers, login, IndexedDB. Edit here, then run: python build.py
(() => {
'use strict';
// ─── CONFIG ──────────────────────────────────────────────────
const APP_VERSION = CURRENT_VERSION;   // one version for the whole app
// Same Cloudflare Worker as Brain+: it injects the Notion token and Groq key
// and gates every call on X-App-Password. No secrets live in this file.
const PROXY = 'https://notion-proxy.francesco-955.workers.dev';
const NOTION_VERSION = '2022-06-28';                    // the Worker forces this anyway
const SOP_DB = '3581301d4ab8819693a1e1d1f958e6d6';      // Naked Farm / Brain+ / 📋 SoP
const RUNS_DB = '2bb3587c362a490882496c3967dda7db';     // Naked Farm / Brain+ / SOP Runs
const CATEGORIES = ['Field Ops', 'Safety', 'Hardware', 'Software'];
// Families = the SOP's "Family" field in Notion; the Tasks dashboard groups by them.
const FAMILIES = [['Agriculture', 'sprout'], ['Maintenance', 'wrench'], ['Office', 'briefcase']];   // family, its line icon
const FAMILY_ICON = Object.fromEntries(FAMILIES);
const famIc = f => FAMILY_ICON[f] ? `{i:${FAMILY_ICON[f]}} ` : '';
const DASH_KEY = 'sopapp_dash_period';
const STATUSES = ['Draft', 'In Review', 'Approved', 'Archived'];
// Groq retires models and the old id then hard-fails — check
// https://console.groq.com/docs/deprecations first if AI import breaks.
const AI_MODEL = 'openai/gpt-oss-20b';
const AI_MAX_INPUT_CHARS = 14000;   // free tier ≈ 8K tokens/min: bigger docs get a 413/429
const NOTION_SINGLE_PART_LIMIT = 20 * 1024 * 1024;
const OPERATOR_KEY = 'sopapp_operator', RUN_KEY = 'sopapp_run';
const authorName = () => getAuthor();   // Naked Brain's mandatory author name


// ─── SMALL HELPERS ───────────────────────────────────────────
const SOP_ROOT = document.getElementById('viewSop');
const $ = id => document.getElementById('sop-' + id);   // SoP element ids are prefixed
// Build DOM with createElement/textContent only — never innerHTML with
// Notion text (Brain+ v1.49: injected markup executed and "<B2>" vanished).
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') nbLabel(e, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : nbFrag(k));
  return e;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const plain = rt => (rt || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = iso => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);
function lsGet(k, fb = null) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (_) { return fb; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

const toast = (msg, type = 'info') => showToast(msg, type);   // Naked Brain's toast

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

// ─── LOGIN + WORKER FETCH: Naked Brain's (one password, one login screen) ───
const getPw = getAppPassword;
const showGate = showPasswordGate;
// cfFetch is Naked Brain's (injects the password, 2-minute cap, 401 → login).

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

// ─── INDEXEDDB (offline copies + outbox) ─────────────────────
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


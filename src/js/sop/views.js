//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- router, list, dashboard, SOP view, steps. Edit here, then run: python build.py
// ─── ROUTER + CHROME ─────────────────────────────────────────
// Hash routes so iOS swipe-back and the Android back button just work:
//   #/  #/sop/ID  #/run/ID  #/edit/ID  #/new  #/import  #/runs
let leaveGuard = null;   // editor sets this to warn about unsaved changes
function go(hash) { location.hash = hash; }
function setHeader(title, back) {
  const t = $('hdrTitle');
  t.textContent = '';
  if (title) t.textContent = title; else t.textContent = '';
  $('backBtn').classList.toggle('hidden', !back);
}
function view(...nodes) { const v = $('view'); v.replaceChildren(...nodes.flat().filter(n => n != null && n !== false)); window.scrollTo(0, 0); return v; }
function loadingView(msg = 'Loading…') { view(el('div', { class: 'loading' }, el('span', { class: 'spinner' }), msg)); }
function errorView(msg, retry) {
  view(el('div', { class: 'empty' }, el('p', { text: '{i:alert} ' + msg }),
    retry ? el('button', { class: 'btn', style: 'margin-top:1rem', onclick: retry }, 'Try again') : null));
}

let shownHash = null;
async function route() {
  if (location.hash && !location.hash.startsWith('#/')) return;   // e.g. #settings belongs to Naked Brain
  if (!getPw()) { showGate(); return; }
  if (leaveGuard && location.hash !== shownHash) {
    if (leaveGuard() && !confirm('Discard unsaved changes?')) { history.pushState(null, '', shownHash); return; }
    leaveGuard = null;
  }
  shownHash = location.hash;
  const [, r, id] = (location.hash.replace(/^#\/?/, '') || '').match(/^([^/]*)\/?(.*)$/) || [];
  SOP_ROOT.querySelector('.bottom-bar')?.remove();
  try {
    if (r === 'sop' && id) await showSop(id);
    else if (r === 'run' && id) await showRun(id);
    else if (r === 'edit' && id) await showEditor(id);
    else if (r === 'new') await showEditor(null);
    else if (r === 'import') showImport();
    else if (r === 'runs') await showRuns();
    else await showList();
  } catch (e) {
    console.warn(e);
    errorView(failureReason(e), route);
  }
}
window.addEventListener('hashchange', () => { if (sopStarted) route(); });
$('backBtn').addEventListener('click', () => (history.length > 1 ? history.back() : go('#/')));

function bottomBar(...kids) {
  SOP_ROOT.querySelector('.bottom-bar')?.remove();
  SOP_ROOT.append(el('div', { class: 'bottom-bar' }, el('div', { class: 'btn-row' }, kids)));
}

function sheet(title, text, ...content) {
  const ov = el('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } },
    el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('h2', null, title), text ? el('p', null, text) : null, ...content));
  SOP_ROOT.append(ov);
  return ov;
}
function confirmSheet(title, text, okLabel, danger = false) {
  return new Promise(resolve => {
    let ov;
    const done = v => { ov.remove(); resolve(v); };
    ov = sheet(title, text, el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
      el('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => done(true) }, okLabel)));
  });
}

// ─── LIST VIEW ───────────────────────────────────────────────
let listFilter = { q: '', cat: '', fam: '' };
async function showList({ force = false } = {}) {
  setHeader(null, false);
  const cached = await idbGet('sops');
  if (!cached) loadingView('Loading SOPs…');
  let data;
  try { data = await loadSops({ force }); }
  catch (e) { if (!cached) throw e; data = { list: cached.list, at: cached.at, offline: true }; }

  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search SOPs…', value: listFilter.q, 'aria-label': 'Search SOPs' });
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Category' });
  const results = el('div');
  const draw = () => {
    const q = listFilter.q.toLowerCase();
    const shown = data.list.filter(s => (!listFilter.cat || s.category === listFilter.cat) && (!listFilter.fam || s.family === listFilter.fam) &&
      (!q || (s.title + ' ' + s.note + ' ' + s.category).toLowerCase().includes(q)));
    results.replaceChildren(...(shown.length ? shown.map(sopCard) :
      [el('div', { class: 'empty', text: data.list.length ? 'No SOP matches.' : 'No SOPs yet — create or import one.' })]));
    chips.replaceChildren(
      ...(listFilter.fam ? [el('button', { class: 'chip active', 'aria-label': 'Clear family filter',
        onclick: () => { listFilter.fam = ''; draw(); } }, `${famIc(listFilter.fam)}${listFilter.fam} ✕`)] : []),
      ...['', ...CATEGORIES].map(c => el('button', {
      class: 'chip' + (listFilter.cat === c ? ' active' : ''), 'aria-pressed': String(listFilter.cat === c),
      onclick: () => { listFilter.cat = c; draw(); } }, c || 'All')));
  };
  search.addEventListener('input', () => { listFilter.q = search.value; draw(); });
  draw();

  const run = lsGet(RUN_KEY);
  const first = (authorName() || lsGet(OPERATOR_KEY, '') || '').trim().split(/\s+/)[0];
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  view(
    data.offline ? el('div', { class: 'banner warn' }, `Offline copy from ${fmtDate(data.at)} ${fmtTime(data.at)}`) : null,
    el('div', { class: 'hero' }, el('h1', null, `${greet}${first ? ', ' + first : ''}!`),
      el('p', null, run ? 'You have a checklist in progress.' : 'Your farm work for the day.')),
    run ? resumeCard(run) : null,
    dashboard(data.list, fam => { listFilter.fam = fam; draw(); results.scrollIntoView({ behavior: 'smooth', block: 'start' }); }),
    el('div', { class: 'sec-head' }, el('h2', null, 'Procedures'), el('span', { class: 'badge', text: String(data.list.length) })),
    el('div', { class: 'search-wrap' }, search, chips),
    results,
  );
  bottomBar(
    el('button', { class: 'btn btn-lg', onclick: () => go('#/import') }, '{i:download} Import'),
    el('button', { class: 'btn btn-primary btn-lg', onclick: () => go('#/new') }, '＋ New SOP'));
  refreshOutboxBadge();
}

function sopCard(s) {
  return el('button', { class: 'card sop-card', onclick: () => go('#/sop/' + s.id) },
    el('span', { class: 'sc-icon', 'aria-hidden': 'true' }, nbEmoji(s.icon || '📋')),
    el('div', { class: 'sc-body' },
      el('div', { class: 'card-title', text: s.title }),
      s.note ? el('div', { class: 'card-note', text: s.note }) : null,
      el('div', { class: 'meta' },
        s.status ? el('span', { class: 'badge ' + s.status.replace(/\s/g, ''), text: s.status }) : null,
        s.docType ? el('span', { class: 'badge', text: s.docType }) : null,
        s.family ? el('span', { text: `${famIc(s.family)}${s.family}` }) : null,
        s.category ? el('span', { text: s.category }) : null)),
    el('span', { class: 'round', 'aria-hidden': 'true' }, '↗'));
}

// ─── DASHBOARD: checklists per family, Complete | Incomplete ──
// Complete = runs saved as Completed. Incomplete = Partial or Aborted runs,
// plus a checklist started on this phone and not finished. A run belongs to the
// family of its SOP (SOP relation → the SOP's Family field).
function periodRange(p) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (p === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);   // weeks start on Monday
  if (p === 'month') start.setDate(1);
  const end = new Date(start);
  if (p === 'today') end.setDate(end.getDate() + 1);
  else if (p === 'week') end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);
  return { start, end };
}
function periodLabel(p, { start, end }) {
  const d = x => x.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  if (p === 'today') return 'Today: ' + d(start);
  if (p === 'week') { const last = new Date(end); last.setDate(last.getDate() - 1); return `This week: ${d(start)} – ${d(last)}`; }
  return 'This month: ' + start.toLocaleDateString([], { month: 'long', year: 'numeric' });
}
async function loadRunStats(p) {
  const range = periodRange(p);
  const key = 'dash:' + p + ':' + range.start.toISOString().slice(0, 10);
  let rows, offline = false;
  try {
    rows = [];
    let cursor;
    do {
      const r = await notion(`databases/${RUNS_DB}/query`, 'POST', { page_size: 100, start_cursor: cursor,
        filter: { and: [{ property: 'Started', date: { on_or_after: range.start.toISOString() } },
                        { property: 'Started', date: { before: range.end.toISOString() } }] } });
      rows.push(...r.results.map(pg => ({ sopId: (pg.properties.SOP?.relation?.[0]?.id || '').replace(/-/g, ''),
        status: pg.properties.Status?.select?.name || '' })));
      cursor = r.has_more ? r.next_cursor : undefined;
    } while (cursor);
    await idbSet(key, rows);
  } catch (e) {
    const cached = await idbGet(key);
    if (!cached || !isNetworkError(e)) throw e;
    rows = cached; offline = true;
  }
  // Runs saved on this phone but not uploaded yet, and one still in progress
  const inRange = iso => { const x = new Date(iso); return x >= range.start && x < range.end; };
  rows = rows.slice();
  for (const rec of (await idbGet('outbox')) || []) if (inRange(rec.startedAt)) rows.push({ sopId: rec.sopId, status: rec.status });
  const cur = lsGet(RUN_KEY);
  if (cur && inRange(cur.startedAt)) rows.push({ sopId: cur.sopId, status: 'In progress' });
  return { rows, offline };
}
function dashboard(list, onFamily) {
  const famOf = new Map(list.map(s => [s.id, s.family]));
  let period = lsGet(DASH_KEY, 'week');
  const pick = el('select', { class: 'dash-period', 'aria-label': 'Period' },
    [['today', 'Today'], ['week', 'This week'], ['month', 'This month']].map(([v, l]) =>
      el('option', { value: v, selected: v === period ? true : null }, l)));
  const range = el('div', { class: 'dash-range' });
  const intro = el('p', { class: 'dash-intro' });
  const cards = el('div', { class: 'dash-cards' });
  const note = el('div', { class: 'dash-note' });
  const card = (name, icon, ok, open) => {
    const total = (ok || 0) + (open || 0);
    return el('div', { class: 'dash-card' },
      el('button', { class: 'dash-go', 'aria-label': `Show ${name} procedures`, title: `Show ${name} procedures`, onclick: () => onFamily(name) }, '↗'),
      el('div', { class: 'dash-nums' },
        el('span', { class: 'n-ok', text: ok == null ? '–' : String(ok) }),
        el('span', { class: 'dash-sep', 'aria-hidden': 'true' }),
        el('span', { class: 'n-open', text: open == null ? '–' : String(open) })),
      el('div', { class: 'dash-bar' }, el('div', { class: 'dash-fill', style: `width:${total ? Math.round(100 * ok / total) : 0}%` })),
      el('div', { class: 'dash-title', text: `{i:${icon}} ${name}` }),
      el('div', { class: 'dash-sub' }, el('span', null, 'Complete'), el('span', { 'aria-hidden': 'true' }, '|'), el('span', null, 'Incomplete')));
  };
  const fill = async () => {
    const r = periodRange(period);
    range.textContent = periodLabel(period, r);
    const word = period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month';
    intro.textContent = `Here's a quick peek at your checklists ${word}! Below is your overview.`;
    cards.replaceChildren(...FAMILIES.map(([n, i]) => card(n, i, null, null)));
    const noFam = list.filter(s => !s.family).length;
    const hint = noFam ? `${noFam} procedure${noFam === 1 ? ' has' : 's have'} no family yet — set it with Edit.` : '';
    note.textContent = hint;
    try {
      const { rows, offline } = await loadRunStats(period);
      const tally = Object.fromEntries(FAMILIES.map(([n]) => [n, { ok: 0, open: 0 }]));
      for (const row of rows) {
        const c = tally[famOf.get(row.sopId)];
        if (!c) continue;
        if (row.status === 'Completed') c.ok++; else c.open++;
      }
      cards.replaceChildren(...FAMILIES.map(([n, i]) => card(n, i, tally[n].ok, tally[n].open)));
      note.textContent = (offline ? 'Offline — showing the last saved numbers. ' : '') + hint;
    } catch (e) {
      console.warn('dashboard', e);
      note.textContent = 'Could not load the numbers: ' + failureReason(e);
    }
  };
  pick.addEventListener('change', () => { period = pick.value; lsSet(DASH_KEY, period); fill(); });
  fill();
  return el('section', { class: 'dash', 'aria-label': 'Overview' },
    el('div', { class: 'dash-top' }, pick, range),
    el('div', { class: 'dash-panel' }, intro, cards,
      el('div', { class: 'dash-legend', 'aria-hidden': 'true' }, el('span', null, 'Complete'), el('span', null, '|'), el('span', null, 'Incomplete')),
      note));
}

// The one thing to pick back up: an unfinished checklist on this phone.
function resumeCard(run) {
  const steps = run.items.filter(i => i.kind === 'step');
  const done = steps.filter(s => run.state[s.key]?.done).length;
  return el('div', { class: 'ink-card' },
    el('div', { class: 'ink-top' },
      el('div', { style: 'flex:1;min-width:0' },
        el('div', { class: 'ink-title', text: run.sopTitle }),
        el('div', { class: 'ink-sub', text: `${done} of ${steps.length} steps · ${run.operator} · started ${fmtTime(run.startedAt)}` })),
      el('button', { class: 'round light', 'aria-label': 'Resume checklist', onclick: () => go('#/run/' + run.sopId) }, '{i:play}')),
    el('div', { class: 'ink-track' }, el('div', { class: 'ink-fill', style: `width:${steps.length ? 100 * done / steps.length : 0}%` })));
}

// ─── SOP VIEW ────────────────────────────────────────────────
async function showSop(id, { force = false } = {}) {
  setHeader(' ', true);
  const cached = await idbGet('sop:' + id);
  if (!cached || force) loadingView();
  const data = await loadSop(id, { force });
  const s = sopProps(data.page);
  setHeader(s.title, true);
  const steps = extractSteps(data.blocks).filter(x => x.kind === 'step').length;
  view(
    data.offline ? el('div', { class: 'banner warn' }, `Offline copy from ${fmtDate(data.at)} ${fmtTime(data.at)}`) : null,
    el('div', { class: 'sop-head' },
      el('h1', null, s.icon ? nbEmoji(s.icon) : null, (s.icon ? ' ' : '') + s.title),
      el('div', { class: 'meta' },
        s.status ? el('span', { class: 'badge ' + s.status.replace(/\s/g, ''), text: s.status }) : null,
        s.category ? el('span', { text: s.category }) : null,
        el('span', { text: `· ${steps} checklist step${steps === 1 ? '' : 's'}` }),
        el('a', { href: s.url, target: '_blank', rel: 'noopener', style: 'color:var(--primary)' }, 'Open in Notion ↗')),
      s.note ? el('p', { class: 'note', text: s.note }) : null),
    el('div', { class: 'doc' }, renderBlocks(data.blocks)),
    el('div', { style: 'margin-top:2rem', class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => go('#/edit/' + id) }, '{i:pencil} Edit'),
      el('button', { class: 'btn', onclick: () => showSop(id, { force: true }).catch(e => toast(failureReason(e), 'error')) }, '{i:refresh} Refresh')),
  );
  bottomBar(el('button', { class: 'btn btn-primary btn-lg', disabled: steps ? null : true, onclick: () => go('#/run/' + id) },
    steps ? '{i:play} Start checklist' : 'No numbered steps or to-dos to check'));
  // Background refresh when showing a cached copy so the next visit is current.
  if (cached && !force && !data.offline && Date.now() - cached.at > 60_000) loadSop(id, { force: true }).catch(() => {});
}

// ─── CHECKLIST STEPS ─────────────────────────────────────────
// Numbered items and to-dos become checkable steps, grouped under the nearest
// heading; callouts become info cards (safety notes etc.). Pages with neither
// numbered items nor to-dos fall back to bullets. Works on existing SOP pages
// as-is — no special format required.
const STEP_CONTAINERS = new Set(['toggle', 'column_list', 'column', 'synced_block']);
function extractSteps(blocks) {
  const collect = stepTypes => {
    const out = [];
    const walk = list => {
      for (const b of list || []) {
        const d = b[b.type] || {};
        if (/^heading_/.test(b.type)) out.push({ kind: 'section', text: plain(d.rich_text) });
        else if (stepTypes.has(b.type)) out.push({ kind: 'step', key: b.id, text: plain(d.rich_text) });
        else if (b.type === 'callout') { out.push({ kind: 'info', icon: d.icon?.emoji || '💡', text: plain(d.rich_text) }); walk(b.children); }
        else if (STEP_CONTAINERS.has(b.type)) walk(b.children);
      }
    };
    walk(blocks);
    return out;
  };
  let items = collect(new Set(['numbered_list_item', 'to_do']));
  if (!items.some(i => i.kind === 'step')) items = collect(new Set(['bulleted_list_item']));
  // Keep a section (and its info cards) only if a step follows before the next
  // section — drops "References", "Scope" etc. from the checklist.
  const out = [];
  let pending = [];
  for (const it of items) {
    if (it.kind === 'section') pending = [it];
    else if (it.kind === 'info') pending.push(it);
    else { out.push(...pending, it); pending = []; }
  }
  return out;
}


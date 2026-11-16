//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- the old Notion run mode, its outbox and history (unreachable since 0.11.117: source is always cloud). Edit here, then run: python build.py
// ─── RUN MODE ────────────────────────────────────────────────
// Run state lives in localStorage and is written on every tap: iOS kills
// backgrounded PWAs without warning and a half-done checklist must survive it.
const saveRun = st => lsSet(RUN_KEY, st);

async function showRun(id) {
  setHeader('Checklist', true);
  let st = lsGet(RUN_KEY);
  if (st && st.sopId !== id) {
    const discard = await confirmSheet('Unfinished checklist',
      `"${st.sopTitle}" is still in progress. Discard it and start this one?`, 'Discard it', true);
    if (!discard) { go('#/run/' + st.sopId); return; }
    st = null; saveRun(null);
  }
  loadingView();
  const data = await loadSop(id);
  const sop = sopProps(data.page);
  const byId = new Map();
  walkBlocks(data.blocks, b => byId.set(b.id, b));

  if (!st) {
    const items = extractSteps(data.blocks);
    const name = authorName() || await requestAuthor();
    if (!name) { history.back(); return; }
    st = { runId: uid(), sopId: id, sopTitle: sop.title, operator: name, startedAt: new Date().toISOString(),
      items, state: {}, notes: '' };
    saveRun(st);
  }
  setHeader(st.sopTitle, true);
  drawRun(st, byId);
}

// No name yet (should not happen — Naked Brain requires it): open Naked Brain's
// name dialog and start the checklist once the name is saved. Never asks here.
function requestAuthor() {
  openAuthorGate(false);
  return new Promise(resolve => {
    const poll = setInterval(() => { const n = getAuthor(); if (n) { clearInterval(poll); resolve(n); } }, 300);
  });
}

function drawRun(st, byId) {
  const steps = st.items.filter(i => i.kind === 'step');
  const fill = el('div', { class: 'progress-fill' });
  const label = el('div', { class: 'progress-label' });
  const updateProgress = () => {
    const done = steps.filter(s => st.state[s.key]?.done).length;
    fill.style.width = (steps.length ? (100 * done / steps.length) : 0) + '%';
    label.replaceChildren(el('span', null, `${done} / ${steps.length} steps`), el('span', null, `${st.operator} · started ${fmtTime(st.startedAt)}`));
  };

  let n = 0;
  const nodes = st.items.map(it => {
    if (it.kind === 'section') return el('div', { class: 'run-section', text: it.text });
    if (it.kind === 'info') return el('div', { class: 'info-card' + (WARN_ICONS.has(it.icon) ? '' : ' soft') }, el('span', { 'aria-hidden': 'true' }, nbEmoji(it.icon)), el('span', { text: it.text }));
    const num = ++n;
    const s = () => (st.state[it.key] ||= { done: false, note: '' });
    const card = el('div', { class: 'step' });
    const time = el('div', { class: 'step-time' });
    const noteBox = el('textarea', { class: 'input step-note hidden', rows: 2, placeholder: 'Note for this step (optional)', 'aria-label': `Note for step ${num}` });
    const block = byId.get(it.key);
    const refresh = () => {
      const cur = st.state[it.key];
      card.classList.toggle('done', !!cur?.done);
      mainBtn.setAttribute('aria-pressed', String(!!cur?.done));
      time.textContent = cur?.done ? '✓ ' + fmtTime(cur.doneAt) : '';
      nbLabel(noteBtn, cur?.note ? '{i:pencil} Edit note' : '{i:pencil} Add note');
    };
    const mainBtn = el('button', { class: 'step-main', onclick: () => {
      const cur = s();
      cur.done = !cur.done; cur.doneAt = cur.done ? new Date().toISOString() : null;
      saveRun(st); refresh(); updateProgress();
      if (cur.done && navigator.vibrate) navigator.vibrate(15);
    } },
      el('span', { class: 'step-check', 'aria-hidden': 'true' }, '✓'),
      el('span', null, el('span', { class: 'step-text' }, el('span', { class: 'step-num' }, num + '.'), ' ',
        block ? renderRich(block[block.type].rich_text) : it.text), time));
    const noteBtn = el('button', { class: 'btn btn-sm', onclick: () => { noteBox.classList.toggle('hidden'); if (!noteBox.classList.contains('hidden')) noteBox.focus(); } });
    noteBox.value = st.state[it.key]?.note || '';
    if (noteBox.value) noteBox.classList.remove('hidden');
    noteBox.addEventListener('input', () => { s().note = noteBox.value; saveRun(st); refresh(); });
    card.append(mainBtn, el('div', { class: 'step-extra' },
      block?.children?.length ? el('div', { class: 'doc' }, renderBlocks(block.children)) : null,
      el('div', { class: 'step-tools' }, noteBtn), noteBox));
    refresh();
    return card;
  });

  updateProgress();
  view(el('div', { class: 'progress' }, el('div', { class: 'progress-track' }, fill), label), ...nodes);
  bottomBar(
    el('button', { class: 'btn btn-lg', onclick: () => abortRun(st) }, 'Stop'),
    el('button', { class: 'btn btn-primary btn-lg', onclick: () => finishRun(st) }, 'Finish ✓'));
}

function finishRun(st) {
  const steps = st.items.filter(i => i.kind === 'step');
  const done = steps.filter(s => st.state[s.key]?.done).length;
  const notes = el('textarea', { class: 'input', rows: 3, placeholder: 'Anything to report? (optional)', 'aria-label': 'Run notes' });
  notes.value = st.notes || '';
  const status = done === steps.length ? 'Completed' : 'Partial';
  let ov;
  ov = sheet(done === steps.length ? 'All steps done' : `${done} of ${steps.length} steps done`,
    done === steps.length ? 'This run will be logged as Completed.' : 'Unticked steps will be logged as not done (status: Partial).',
    el('div', { class: 'field' }, el('label', null, 'Notes'), notes),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => ov.remove() }, 'Back'),
      el('button', { class: 'btn btn-primary', onclick: () => { st.notes = notes.value.trim(); ov.remove(); logRun(st, status); } }, 'Save run')));
}

function abortRun(st) {
  let ov;
  ov = sheet('Stop this checklist?', 'You can log what was done so far as an aborted run, or throw it away.',
    el('div', { class: 'btn-row', style: 'flex-direction:column' },
      el('button', { class: 'btn btn-block', onclick: () => { ov.remove(); logRun(st, 'Aborted'); } }, 'Log as aborted'),
      el('button', { class: 'btn btn-danger btn-block', onclick: () => { ov.remove(); saveRun(null); toast('Checklist discarded'); go('#/sop/' + st.sopId); } }, 'Discard, don\'t log'),
      el('button', { class: 'btn btn-block', onclick: () => ov.remove() }, 'Keep going')));
}

async function logRun(st, status) {
  const rec = { ...st, status, finishedAt: new Date().toISOString() };
  const box = (await idbGet('outbox')) || [];
  box.push(rec);
  // the run in progress is only cleared once the outbox really holds it (a full or blocked storage used to lose it)
  try { await idbSet('outbox', box, true); }
  catch (e) { toast('Could not save this run on the phone (storage full?) — it is still open: free some space and finish again', 'error', 8000); return; }
  saveRun(null);
  go('#/sop/' + st.sopId);
  const n = await syncOutbox();
  if (n > 0) toast('Run saved to Notion ✓', 'success');
  else toast('Saved on this phone — will upload when back online', 'info', 5000);
}

// ─── OUTBOX → NOTION "SOP Runs" ──────────────────────────────
let syncing = false;
async function refreshOutboxBadge() {
  const box = (await idbGet('outbox')) || [];
  const b = $('syncBtn');
  b.classList.toggle('hidden', !box.length);
  nbLabel(b, box.length ? `{i:upload}${box.length}` : '{i:upload}');
  b.title = `${box.length} run(s) waiting to upload`;
}

const rt = (s, max = 2000) => [{ type: 'text', text: { content: String(s || '').slice(0, max) } }];

function runPageBody(rec) {
  const blocks = [];
  let n = 0;
  for (const it of rec.items) {
    if (it.kind === 'section') blocks.push({ type: 'heading_3', heading_3: { rich_text: rt(it.text) } });
    if (it.kind !== 'step') continue;
    const s = rec.state[it.key] || {};
    const b = { type: 'to_do', to_do: { checked: !!s.done, rich_text: [
      ...rt(`${++n}. ${it.text}`, 1900),
      ...(s.done ? [{ type: 'text', text: { content: `  ✓ ${fmtTime(s.doneAt)}` }, annotations: { color: 'green' } }] : []),
    ] } };
    if (s.note) b.to_do.children = [{ type: 'paragraph', paragraph: { rich_text: rt('📝 ' + s.note) } }];
    blocks.push(b);
  }
  if (rec.notes) blocks.push({ type: 'heading_3', heading_3: { rich_text: rt('Notes') } },
    { type: 'paragraph', paragraph: { rich_text: rt(rec.notes) } });
  return blocks;
}

async function uploadRun(rec) {
  // A timed-out create may still have succeeded server-side — check first so a
  // retry never produces a duplicate record.
  const q = await notion(`databases/${RUNS_DB}/query`, 'POST',
    { page_size: 1, filter: { property: 'Run ID', rich_text: { equals: rec.runId } } });
  if (q.results.length) return;
  const steps = rec.items.filter(i => i.kind === 'step');
  const done = steps.filter(s => rec.state[s.key]?.done).length;
  const body = runPageBody(rec);
  const page = await notion('pages', 'POST', {
    parent: { database_id: RUNS_DB },
    properties: {
      Run: { title: rt(`${rec.sopTitle} — ${rec.operator} — ${fmtDate(rec.startedAt)}`) },
      SOP: { relation: [{ id: rec.sopId }] },
      Operator: { rich_text: rt(rec.operator) },
      Status: { select: { name: rec.status } },
      Started: { date: { start: rec.startedAt } },
      Finished: { date: { start: rec.finishedAt } },
      'Steps done': { number: done },
      'Steps total': { number: steps.length },
      Notes: { rich_text: rt(rec.notes) },
      'Run ID': { rich_text: rt(rec.runId) },
    },
    children: body.slice(0, 100),
  });
  for (let i = 100; i < body.length; i += 100) {
    await notion(`blocks/${page.id}/children`, 'PATCH', { children: body.slice(i, i + 100) });
  }
}

// Returns how many runs were uploaded.
let syncAgain = false;
async function syncOutbox(verbose = false) {
  if (syncing) { syncAgain = true; return 0; }   // a run finished during a sync goes in the next pass
  syncing = true;
  let sent = 0, box = [];
  // each write reads the outbox again (0.11.92): writing back the copy read at the start dropped a run finished
  // while a slow upload was going on
  const update = async fn => { const now = (await idbGet('outbox')) || []; box = fn(now); await idbSet('outbox', box, true); };
  try {
    box = (await idbGet('outbox')) || [];
    for (const rec of [...box]) {
      try {
        await uploadRun(rec);
        await update(now => now.filter(r => r.runId !== rec.runId));
        sent++;
      } catch (e) {
        console.warn('run upload failed', e);
        const why = failureReason(e);
        await update(now => now.map(r => r.runId === rec.runId ? { ...r, error: why } : r)).catch(() => {});
        if (isNetworkError(e)) break;   // offline: stop, try again later
      }
    }
    if (verbose) toast(box.length ? `${sent} uploaded, ${box.length} still waiting: ${box[0].error || ''}` : 'All runs uploaded ✓',
      box.length ? 'error' : 'success', 5000);
  } finally {
    syncing = false;
    refreshOutboxBadge();
    if (syncAgain) { syncAgain = false; setTimeout(() => syncOutbox(), 0); }
  }
  return sent;
}
$('syncBtn').addEventListener('click', () => syncOutbox(true));
function updateNet() { $('netPill').classList.toggle('hidden', navigator.onLine); if (navigator.onLine) syncOutbox(); }
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

// ─── RUN HISTORY ─────────────────────────────────────────────
async function showRuns() {
  setHeader('Run history', true);
  loadingView();
  const box = (await idbGet('outbox')) || [];
  let runs = [], err = null;
  try {
    const r = await notion(`databases/${RUNS_DB}/query`, 'POST', { page_size: 50, sorts: [{ property: 'Started', direction: 'descending' }] });
    runs = r.results;
  } catch (e) { err = failureReason(e); }
  const card = (title, status, when, sub, href) => el(href ? 'a' : 'div', { class: 'card', href, target: href ? '_blank' : null, rel: href ? 'noopener' : null, style: 'color:inherit;text-decoration:none' },
    el('div', { class: 'card-title', text: title }),
    el('div', { class: 'meta' }, el('span', { class: 'badge ' + status, text: status }), el('span', { text: when }), sub ? el('span', { text: sub }) : null));
  view(
    box.length ? el('div', null, el('div', { class: 'lbl', text: 'Waiting to upload' }),
      ...box.map(r => card(r.sopTitle, r.status, `${r.operator} · ${fmtDate(r.startedAt)} ${fmtTime(r.startedAt)}`, r.error ? '{i:alert} ' + r.error : 'pending')),
      el('button', { class: 'btn btn-block', style: 'margin:0.5rem 0 1.5rem', onclick: () => syncOutbox(true).then(showRuns) }, 'Upload now')) : null,
    err ? el('div', { class: 'banner warn', text: 'Could not load history: ' + err }) : null,
    el('div', { class: 'lbl', text: 'Recent runs' }),
    ...(runs.length ? runs.map(p => {
      const pr = p.properties;
      const started = pr.Started?.date?.start;
      return card(plain(pr.Run?.title), pr.Status?.select?.name || '—', started ? `${fmtDate(started)} ${fmtTime(started)}` : '',
        `${pr['Steps done']?.number ?? '?'}/${pr['Steps total']?.number ?? '?'} steps`, p.url);
    }) : [el('div', { class: 'empty', text: err ? '' : 'No runs logged yet.' })]));
}


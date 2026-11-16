//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- the old Notion checklist runs still on a phone, sent to SOP Runs. Edit here, then run: python build.py
// ─── OUTBOX → NOTION "SOP Runs" ──────────────────────────────
// Nothing adds to this outbox any more (the Notion checklist was removed on 17 Nov 2026); a run finished in it before
// 0.11.117 and never sent still goes up, as before, when the phone comes back online.
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
let syncing = false, syncAgain = false;
async function syncOutbox() {
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
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; setTimeout(() => syncOutbox(), 0); }
  }
  return sent;
}
window.addEventListener('online', () => syncOutbox());


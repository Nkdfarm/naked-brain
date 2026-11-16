//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- entries log, create database, test connection, init. Edit here, then run: python build.py
// ─── ENTRIES LOG ─────────────────────────────────────────────
const ENTRIES_KEY = 'ugly200_entries';

function saveEntry(entry) {
  const entries = getEntries();
  // the list shows 200 characters: a whole transcript per entry filled the phone's storage (0.11.92)
  entries.unshift({ ...entry, transcript: String(entry.transcript || '').slice(0, 200), date: new Date().toISOString(), id: Date.now() });
  try { localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries.slice(0, 50))); }
  catch (e) { console.warn('entries log not saved', e); }
  renderEntries();
}

function getEntries() {
  try { return JSON.parse(localStorage.getItem(ENTRIES_KEY) || '[]'); } catch { return []; }
}

function renderEntries() {
  const list    = document.getElementById('entriesList');
  const empty   = document.getElementById('emptyLog');
  const entries = getEntries();
  // Remove old cards
  list.querySelectorAll('.entry-card').forEach(el => el.remove());

  if (!entries.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  // Built with textContent, not innerHTML: note and transcript text is arbitrary
  // (typed, or whatever Whisper returned), and interpolating it as markup both
  // executed it and silently ate ordinary text — a Location of "Tunnel <B2>"
  // rendered as "Tunnel", and anything after an unclosed tag disappeared.
  const div = (cls, text) => {
    const el = document.createElement('div');
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  entries.forEach(entry => {
    const card = div('entry-card');
    const date = new Date(entry.date).toLocaleString();
    const tabLabel = entry.tab ? (TAB_LABELS[entry.tab] || entry.tab) : '';
    const fieldChips = [];
    Object.entries(entry.fields || {}).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(x => fieldChips.push(`${k}: ${x}`));
      else if (v) fieldChips.push(`${k}: ${v}`);
    });
    // Backward compat for old entries with `tags`
    if (entry.tags) entry.tags.forEach(t => fieldChips.push(t));

    card.appendChild(div('entry-meta', date + (tabLabel ? ` · ${tabLabel}` : '')));
    card.appendChild(div('entry-text', (entry.transcript || entry.note || '').slice(0, 200) || '(no text)'));

    if (fieldChips.length) {
      const tags = div('entry-tags');
      fieldChips.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'entry-tag';
        chip.textContent = t;
        tags.appendChild(chip);
      });
      card.appendChild(tags);
    }

    const statusText = entry.status === 'sent' ? '✓ Sent to Notion'
                     : entry.status === 'failed' ? '✗ Failed'
                     : 'Pending';
    card.appendChild(div(`entry-status ${entry.status}`, statusText));
    list.appendChild(card);
  });
}

// ─── CREATE DATABASE ──────────────────────────────────────────
const PRESET_TAGS = [
  'FarmBox','Field Visit','Urgent','South Africa','Italy','France',
  'Idea','Meeting','Follow-up','Greenhouse','Energy','Robotics'
];
const NOTION_COLORS = ['blue','brown','default','gray','green','orange','pink','purple','red','yellow'];
function tagColor(name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return NOTION_COLORS[Math.abs(h) % NOTION_COLORS.length];
}

// The Notion token lives in the Cloudflare Worker (env.NOTION_TOKEN), not in the
// page — cfFetch adds the app password and the Worker injects the token. The old
// #notionToken input was removed with that move; reading it here threw a
// TypeError on the handler's first line and killed this button silently.
document.getElementById('createDbBtn').addEventListener('click', async () => {
  const parentId = document.getElementById('notionParentId').value.trim().replace(/-/g, '');
  const btn      = document.getElementById('createDbBtn');
  const result   = document.getElementById('createDbResult');

  if (!parentId) { showToast('Enter a Parent Page ID', 'error'); return; }
  if (parentId.length !== 32) { showToast(`Page ID should be 32 chars — got ${parentId.length}`, 'error'); return; }

  btn.disabled = true;
  result.style.display = 'none';

  const tabs = Object.keys(TAB_LABELS); // ['ugly200','sop','daily','sulive']
  const created = [];
  const failed  = [];

  for (const tab of tabs) {
    btn.innerHTML = `<div class="dot-spin"></div> Creating ${TAB_LABELS[tab]}…`;
    try {
      const dbProps = {
        'Title':  { title: {} },
        'Date':   { date: {} },
        'Note':   { rich_text: {} },
      };
      (TAB_SCHEMAS[tab] || []).forEach(field => {
        if (field.type === 'multi_select') {
          dbProps[field.key] = { multi_select: { options: field.options.map(n => ({ name: n, color: tagColor(n) })) } };
        } else if (field.type === 'select') {
          dbProps[field.key] = { select: { options: field.options.map(n => ({ name: n, color: tagColor(n) })) } };
        } else if (field.type === 'text') {
          dbProps[field.key] = { rich_text: {} };
        } else if (field.type === 'priorities') {
          (field.props || ['P1','P2','P3']).forEach(p => { dbProps[p] = { rich_text: {} }; });
        }
      });

      const res = await cfFetch(PROXY + '/v1/databases', {
        method: 'POST',
        headers: {
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { type: 'page_id', page_id: parentId },
          icon: { type: 'emoji', emoji: { ugly200: '💩', sop: '📋', daily: '📅', sulive: '🎓' }[tab] || '🧠' },
          title: [{ type: 'text', text: { content: TAB_LABELS[tab] } }],
          properties: dbProps,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Error ${res.status}`);

      const dbId = data.id.replace(/-/g, '');
      document.getElementById(TAB_DB[tab]).value = dbId;
      created.push(TAB_LABELS[tab]);
    } catch(e) {
      failed.push(`${TAB_LABELS[tab]}: ${e.message}`);
    }
  }

  saveConfig();
  document.getElementById('notionParentId').value = '';

  result.style.display = 'flex';
  if (failed.length === 0) {
    result.className = 'test-ok';
    result.textContent = `✓ All 4 databases created — IDs saved!`;
    showToast('All 4 databases created ✓', 'success');
  } else {
    result.className = 'test-err';
    result.textContent = `✗ ${failed.join(' | ')}`;
    if (created.length) showToast(`Created: ${created.join(', ')}`, 'success');
    showToast(`Failed: ${failed.join(', ')}`, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Create All 4 Databases`;
});

// ─── TEST CONNECTION ──────────────────────────────────────────
// Uses cfFetch (not bare fetch) so the request carries X-App-Password — without
// it the Worker answers 401 and this always reported a failed connection.
document.getElementById('testNotionBtn').addEventListener('click', async () => {
  const dbId   = document.getElementById(TAB_DB[activeTab]).value.trim();
  const result = document.getElementById('notionTestResult');
  result.style.display = 'flex';
  if (!dbId) {
    result.textContent = `✗ No database ID set for ${TAB_LABELS[activeTab]}`;
    result.className = 'test-err';
    return;
  }
  result.textContent = '…';
  result.className = '';
  try {
    const res = await cfFetch(`${PROXY}/v1/databases/${dbId}`, {
      headers: { 'Notion-Version': '2022-06-28' }
    });
    if (res.ok) {
      result.textContent = '✓ Connected';
      result.className = 'test-ok';
    } else {
      const err = await res.json().catch(() => ({}));
      result.textContent = `✗ ${err.message || res.status}`;
      result.className = 'test-err';
    }
  } catch(e) {
    result.textContent = `✗ ${e.message || 'Network error'}`;
    result.className = 'test-err';
  }
});

// ─── INIT ─────────────────────────────────────────────────────
// Before the renders below — restoreDraft sets activeTab and noteStartTime,
// which renderNoteStamp/updateSubmitBtn/setActiveTab all read.
restoreDraft();
loadConfig();
syncAuthorBtn();
renderNoteStamp();
renderEntries();
updateSubmitBtn();
setActiveTab(activeTab);
ensureAuthor();

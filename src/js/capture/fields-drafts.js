//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- per-tab fields, drafts, submit button state. Edit here, then run: python build.py
// ─── TAB-SPECIFIC FIELDS RENDERER ────────────────────────────
function makeAddTagBtn(field, tab, onAdded) {
  const wrapper = document.createElement('span');
  wrapper.style.cssText = 'display:inline-flex;align-items:center;gap:4px';

  const btn = document.createElement('button');
  btn.className = 'tag-chip';
  btn.style.cssText = 'border-style:dashed;color:var(--primary);border-color:var(--primary)';
  btn.textContent = '+ Add';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'New tag…';
  input.style.cssText = 'display:none;width:90px;font-size:var(--text-xs);padding:2px 6px;border-radius:var(--radius-full);border:1px solid var(--primary);background:var(--surface-2);color:var(--text-primary);outline:none';

  const confirm = () => {
    const val = input.value.trim();
    if (val && !field.options.includes(val)) {
      field.options.push(val);
      onAdded();
    } else {
      input.style.display = 'none';
      btn.style.display = 'inline-flex';
    }
  };

  btn.addEventListener('click', () => {
    btn.style.display = 'none';
    input.style.display = 'inline-block';
    input.focus();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirm();
    if (e.key === 'Escape') { input.style.display = 'none'; btn.style.display = 'inline-flex'; }
  });
  input.addEventListener('blur', () => setTimeout(confirm, 150));

  wrapper.appendChild(btn);
  wrapper.appendChild(input);
  return wrapper;
}

function renderTabFields(tab) {
  const top  = document.getElementById('tabFieldsTop');
  const pre  = document.getElementById('tabFieldsPre');
  const post = document.getElementById('tabFields');
  if (!post) return;
  if (top) top.innerHTML = '';
  if (pre) pre.innerHTML = '';
  post.innerHTML = '';
  const schema = TAB_SCHEMAS[tab] || [];

  schema.forEach(field => {
    const wrap = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = field.label || field.key;
    wrap.appendChild(label);

    if (field.type === 'multi_select') {
      const chips = document.createElement('div');
      chips.className = 'tags-preset';
      const current = new Set(getTabValue(tab, field.key) || []);
      field.options.forEach(opt => {
        const chip = document.createElement('button');
        chip.className = 'tag-chip' + (current.has(opt) ? ' selected' : '');
        chip.textContent = opt;
        chip.setAttribute('aria-pressed', current.has(opt));
        chip.addEventListener('click', () => {
          if (current.has(opt)) current.delete(opt); else current.add(opt);
          setTabValue(tab, field.key, [...current]);
          renderTabFields(tab);
          updateSubmitBtn();
        });
        chips.appendChild(chip);
      });
      chips.appendChild(makeAddTagBtn(field, tab, () => { current.add(field.options[field.options.length-1]); setTabValue(tab, field.key, [...current]); renderTabFields(tab); updateSubmitBtn(); }));
      wrap.appendChild(chips);
    } else if (field.type === 'select' && field.menu) {
      // A rolling menu (0.11.120): one of a fixed list, nothing to add
      const sel = document.createElement('select');
      sel.className = 'tab-field-text';
      sel.setAttribute('aria-label', field.label || field.key);
      const current = getTabValue(tab, field.key) || '';
      [['', 'Choose…'], ...field.options.map(o => [o, o])].forEach(([value, text]) => {
        const o = document.createElement('option');
        o.value = value; o.textContent = text; o.selected = value === current;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        setTabValue(tab, field.key, sel.value || null);
        updateSubmitBtn();
      });
      wrap.appendChild(sel);
    } else if (field.type === 'select') {
      const chips = document.createElement('div');
      chips.className = 'tags-preset';
      const current = getTabValue(tab, field.key);
      field.options.forEach(opt => {
        const chip = document.createElement('button');
        chip.className = 'tag-chip' + (current === opt ? ' selected' : '');
        chip.textContent = opt;
        chip.setAttribute('aria-pressed', current === opt);
        chip.addEventListener('click', () => {
          setTabValue(tab, field.key, current === opt ? null : opt);
          renderTabFields(tab);
          updateSubmitBtn();
        });
        chips.appendChild(chip);
      });
      chips.appendChild(makeAddTagBtn(field, tab, () => { setTabValue(tab, field.key, field.options[field.options.length-1]); renderTabFields(tab); updateSubmitBtn(); }));
      wrap.appendChild(chips);
    } else if (field.type === 'text') {
      const input = document.createElement(field.multiline ? 'textarea' : 'input');
      if (!field.multiline) input.type = 'text';
      input.className = 'tab-field-text';
      input.value = getTabValue(tab, field.key) || '';
      input.placeholder = `${field.label || field.key}…`;
      if (field.multiline) input.rows = 3;
      input.addEventListener('input', () => {
        setTabValue(tab, field.key, input.value);
        updateSubmitBtn();
      });
      wrap.appendChild(input);
    } else if (field.type === 'date') {
      // Date only (no time). Shows today until changed; today is not stored,
      // so an untouched date never counts as content on its own.
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'tab-field-text';
      input.value = getTabValue(tab, field.key) || localDateISO();
      input.setAttribute('aria-label', field.label || field.key);
      input.addEventListener('change', () => {
        setTabValue(tab, field.key, input.value && input.value !== localDateISO() ? input.value : null);
        updateSubmitBtn();
      });
      wrap.appendChild(input);
    } else if (field.type === 'priorities') {
      const stored = getTabValue(tab, field.key) || {};
      (field.props || ['P1','P2','P3']).forEach(p => {
        const row = document.createElement('div');
        row.className = 'priority-row';
        const tag = document.createElement('span');
        tag.className = 'priority-tag';
        tag.textContent = p;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-field-text';
        input.value = stored[p] || '';
        input.placeholder = `${p}…`;
        input.addEventListener('input', () => {
          const cur = getTabValue(tab, field.key) || {};
          cur[p] = input.value;
          setTabValue(tab, field.key, cur);
          updateSubmitBtn();
        });
        row.appendChild(tag);
        row.appendChild(input);
        wrap.appendChild(row);
      });
    }

    const target = (field.top && top) ? top : (field.beforeMedia && pre) ? pre : post;
    target.appendChild(wrap);
  });
}

// ─── DRAFT PERSISTENCE ───────────────────────────────────────
// The text of an in-progress note lived only in the DOM, so an iOS PWA eviction
// (or any reload) lost the transcript and everything typed with it — the worst
// case being a note taken in the field with no signal to send it. Text fields,
// the note's start time and the active tab are now mirrored to localStorage on
// every change and restored on load. Attachments are NOT saved: they are File
// handles, often hundreds of MB, and this app already fights iOS memory limits
// — the restore toast says so when the lost draft had any.
const DRAFT_KEY = 'ugly200_draft';
const DRAFT_FIELDS = ['noteTitle','transcriptText','summaryText','noteText','videoTranscriptText','videoSummaryText'];
let _draftTimer = null;
let _restoringDraft = false;

function writeDraft() {
  _draftTimer = null;
  if (_restoringDraft) return;
  try {
    const fields = {};
    let hasText = false;
    DRAFT_FIELDS.forEach(id => {
      const v = document.getElementById(id)?.value || '';
      fields[id] = v;
      // the author's name put in the Title box by the app (Daily) is not text of a note (0.11.120)
      if (v.trim() && !(id === 'noteTitle' && document.getElementById(id).dataset.auto === '1')) hasText = true;
    });
    // Nothing worth keeping — drop the draft rather than leaving a stale one.
    if (!hasText) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      fields,
      tab: activeTab,
      startedAt: noteStartTime.toISOString(),
      location: captureLocation,
      mediaCount: mediaFiles.length,
      savedAt: new Date().toISOString(),
    }));
  } catch(e) {
    // Quota exceeded / private mode — a failed draft save must never block the note.
    console.warn('Draft save failed:', e.message);
  }
}

// Debounced on keystrokes; flushed synchronously when the app is backgrounded.
function saveDraft() {
  if (_draftTimer) clearTimeout(_draftTimer);
  _draftTimer = setTimeout(writeDraft, 400);
}
function flushDraft() {
  if (_draftTimer) { clearTimeout(_draftTimer); writeDraft(); }
}

function clearDraft() {
  if (_draftTimer) { clearTimeout(_draftTimer); _draftTimer = null; }
  try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}
}

function restoreDraft() {
  let d = null, nameOnly = false;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch(e) {}
  if (!d || !d.fields) return;

  _restoringDraft = true;
  try {
    DRAFT_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof d.fields[id] === 'string') el.value = d.fields[id];
    });
    // Restore the tab too — a Daily draft restored under Ugly200 would submit to
    // the wrong database.
    if (d.tab && TAB_DB[d.tab]) {
      activeTab = d.tab;
      localStorage.setItem('brain_activeTab', d.tab);
    }
    // Keep the original start time: it is what gets sent to Notion as the date.
    // Not from a draft that holds nothing but the Title on Daily (0.11.120): that was the author's
    // name the app writes there, kept as a "draft" for ever — and its start time with it, so every Daily sent
    // from that phone carried the day the tab was first opened (five reports of 5-9 Oct 2026 dated 30 Sept).
    const started = d.startedAt ? new Date(d.startedAt) : null;
    nameOnly = titledByAuthor(d.tab) && DRAFT_FIELDS.every(id => id === 'noteTitle' || !(d.fields[id] || '').trim());
    if (started && !isNaN(started) && !nameOnly) { noteStartTime = started; noteStarted = true; }
    if (d.location && typeof d.location.lat === 'number') { captureLocation = d.location; renderGpsStamp(); }
  } finally {
    _restoringDraft = false;
  }
  if (nameOnly) return;   // nothing came back that the person wrote

  // Tell the user what came back — and what didn't. Drafts are never expired
  // automatically (that would re-introduce the data loss this fixes), so an old
  // one is flagged by age instead.
  const ageMs = d.savedAt ? Date.now() - new Date(d.savedAt).getTime() : 0;
  const days = Math.floor(ageMs / 86400000);
  const bits = ['Draft restored'];
  if (days >= 1) bits.push(`from ${days} day${days === 1 ? '' : 's'} ago`);
  if (d.mediaCount) bits.push(`— re-attach ${d.mediaCount} file${d.mediaCount === 1 ? '' : 's'}`);
  setTimeout(() => showToast(bits.join(' '), 'info'), 600);
}

// Any programmatic write (transcription, AI summary) lands here too, since every
// one of those paths already calls updateSubmitBtn.
DRAFT_FIELDS.forEach(id =>
  document.getElementById(id)?.addEventListener('input', saveDraft)
);
// iOS kills backgrounded PWAs without warning — a pending debounce would be lost,
// so commit synchronously the moment the app goes away.
window.addEventListener('pagehide', flushDraft);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushDraft();
});

// ─── SUBMIT BUTTON STATE ─────────────────────────────────────
function updateSubmitBtn() {
  saveDraft();
  // Weekly priorities (persistent) and the date don't count as content on their own
  const persistKeys = (TAB_SCHEMAS[activeTab] || []).filter(f => f.persist || f.type === 'date').map(f => f.key);
  const tabHasValues = Object.entries(tabValues[activeTab] || {}).some(([k, v]) =>
    !persistKeys.includes(k) && (Array.isArray(v) ? v.length > 0 : (typeof v === 'object' ? Object.values(v).some(x => x) : !!v))
  );
  // A title the person typed, a video transcription pasted in or a video summary are content too: Send used to stay
  // grey on them alone, with no word why. Not the name the app itself writes in the Title box on Daily.
  const titleBox = document.getElementById('noteTitle');
  const typedTitle = !!titleBox && !!titleBox.value.trim() && titleBox.dataset.auto !== '1';
  const hasContent = document.getElementById('transcriptText').value.trim() ||
                     document.getElementById('summaryText').value.trim() ||
                     document.getElementById('noteText').value.trim() ||
                     document.getElementById('videoTranscriptText').value.trim() ||
                     document.getElementById('videoSummaryText').value.trim() ||
                     typedTitle ||
                     mediaFiles.length > 0 ||
                     tabHasValues;
  // the note starts here, when the empty form first gets something (see noteStarted)
  if (hasContent && !noteStarted) { noteStartTime = new Date(); noteStarted = true; }
  else if (!hasContent && !submitting) noteStarted = false;
  document.getElementById('submitBtn').disabled = submitting || !hasContent;   // never back on during a send
}

['transcriptText','summaryText','noteText','noteTitle','videoTranscriptText','videoSummaryText'].forEach(id =>
  document.getElementById(id).addEventListener('input', updateSubmitBtn)
);


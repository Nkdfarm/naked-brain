//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- the Notion submit and file upload. Edit here, then run: python build.py
// ─── NOTION SUBMIT ───────────────────────────────────────────
document.getElementById('submitBtn').addEventListener('click', submitToNotion);

// ─── NOTION FILE UPLOAD ───────────────────────────────────────
// Always uploads the original file (never a compressed copy) — full-quality
// video, up to 5 GB, requires a paid Notion workspace for multi-part.
const NOTION_SINGLE_PART_LIMIT = 20 * 1024 * 1024; // Notion's single-request cap
const NOTION_MULTIPART_CHUNK   = 10 * 1024 * 1024; // Notion recommends 5–20 MB per part

function guessContentType(file) {
  return file.type ||
    (file.name.match(/\.(mp4|m4v)$/i) ? 'video/mp4' :
     file.name.match(/\.(mov|qt)$/i)   ? 'video/quicktime' :
     file.name.match(/\.(webm)$/i)      ? 'video/webm' :
     file.name.match(/\.(jpg|jpeg)$/i)  ? 'image/jpeg' :
     file.name.match(/\.(png)$/i)       ? 'image/png' :
     'application/octet-stream');
}

async function uploadFileToNotion(file, onStatus) {
  const contentType = guessContentType(file);

  if (file.size > NOTION_SINGLE_PART_LIMIT) {
    return uploadFileMultiPart(file, contentType, onStatus);
  }

  const sizeMBStr = (file.size / 1024 / 1024).toFixed(1);
  onStatus?.(`Uploading ${file.name} (${sizeMBStr} MB)…`);

  // Create upload slot
  const cr = await cfFetch(PROXY + '/v1/file_uploads', {
    method: 'POST',
    headers: { 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, content_type: contentType }),
  });
  if (!cr.ok) {
    const e = await cr.json().catch(() => ({}));
    throw new Error(e?.message || `Create upload slot failed (${cr.status})`);
  }
  const { id } = await cr.json();
  if (!id) throw new Error('Notion did not return an upload ID');

  // Send file with an abort timeout. Set to 120 s deliberately: cfFetch used to
  // discard this signal, so every upload has really been running against its
  // 2-min cap. Now that the signal is honoured, keeping 120 s preserves the
  // behaviour that works on farm connections instead of silently tightening it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const sr = await cfFetch(`${PROXY}/v1/file_uploads/${id}/send`, {
      method: 'POST',
      headers: { 'Notion-Version': '2022-06-28' },
      body: fd,
      signal: controller.signal,
    });
    if (!sr.ok) {
      const e = await sr.json().catch(() => ({}));
      throw new Error(e?.message || `Upload send failed (${sr.status})`);
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Upload timed out — file may be too large or connection too slow');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  return id;
}

// ── Multi-part upload (paid Notion workspaces, up to 5 GB) ────
// Chunks are sent sequentially, not in parallel — a dropped chunk on a flaky
// mobile connection is cheaper to retry alone than to re-race a whole batch.
async function uploadFileMultiPart(file, contentType, onStatus) {
  const numParts = Math.ceil(file.size / NOTION_MULTIPART_CHUNK);
  const sizeMBStr = (file.size / 1024 / 1024).toFixed(1);

  const cr = await cfFetch(PROXY + '/v1/file_uploads', {
    method: 'POST',
    headers: { 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name, content_type: contentType,
      mode: 'multi_part', number_of_parts: numParts,
    }),
  });
  if (!cr.ok) {
    const e = await cr.json().catch(() => ({}));
    throw new Error(e?.message || `Create multi-part upload failed (${cr.status})`);
  }
  const { id } = await cr.json();
  if (!id) throw new Error('Notion did not return an upload ID');

  for (let part = 1; part <= numParts; part++) {
    const start = (part - 1) * NOTION_MULTIPART_CHUNK;
    const chunk = file.slice(start, start + NOTION_MULTIPART_CHUNK);
    onStatus?.(`Uploading ${file.name} (${sizeMBStr} MB) — part ${part}/${numParts}…`);

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      // 120 s per 10 MB chunk — see uploadFileToNotion: this signal was ignored
      // until now, so 120 s is the interval these uploads have actually been
      // succeeding under. 60 s would demand ~1.4 Mbps sustained, which a
      // greenhouse mobile connection does not reliably give.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const fd = new FormData();
        fd.append('file', chunk, file.name);
        fd.append('part_number', String(part));
        const sr = await cfFetch(`${PROXY}/v1/file_uploads/${id}/send`, {
          method: 'POST',
          headers: { 'Notion-Version': '2022-06-28' },
          body: fd,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!sr.ok) {
          const e = await sr.json().catch(() => ({}));
          throw new Error(e?.message || `Part ${part} failed (${sr.status})`);
        }
        lastErr = null;
        break;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e.name === 'AbortError' ? new Error(`Part ${part} timed out`) : e;
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
    if (lastErr) throw new Error(`Upload failed on part ${part}/${numParts}: ${lastErr.message}`);
  }

  onStatus?.(`Finalizing upload…`);
  const fr = await cfFetch(`${PROXY}/v1/file_uploads/${id}/complete`, {
    method: 'POST',
    headers: { 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!fr.ok) {
    const e = await fr.json().catch(() => ({}));
    throw new Error(e?.message || `Finalizing upload failed (${fr.status})`);
  }

  return id;
}

// Cache title property names per DB to avoid repeated lookups
const _dbPropsCache = {};
let dbPropsWhy = '';   // why the last read gave nothing: Send says it, instead of one sentence for every cause
// Fetch (and cache) a database's property schema: { name: {type, ...} }.
async function getDbProps(dbId) {
  if (_dbPropsCache[dbId]) return _dbPropsCache[dbId];
  try {
    const res = await cfFetch(PROXY + '/v1/databases/' + dbId, {
      headers: { 'Notion-Version': '2022-06-28' }
    });
    if (!res.ok) { dbPropsWhy = 'Notion answered ' + res.status; return {}; }
    const data = await res.json();
    dbPropsWhy = '';
    return (_dbPropsCache[dbId] = data.properties || {});
  } catch(e) {
    try { dbPropsWhy = failureReason(e); } catch (_) { dbPropsWhy = ''; }
    return {};
  }
}

async function getTitlePropName(dbId) {
  const props = await getDbProps(dbId);
  const entry = Object.entries(props).find(([, v]) => v.type === 'title');
  return entry ? entry[0] : 'Title';
}

// Cache the workspace member list (rarely changes) to resolve author names to Notion user IDs.
let _workspaceUsersCache = null;
async function getWorkspaceUsers() {
  if (_workspaceUsersCache) return _workspaceUsersCache;
  try {
    const res = await cfFetch(PROXY + '/v1/users', { headers: { 'Notion-Version': '2022-06-28' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (_workspaceUsersCache = (data.results || []).filter(u => u.type === 'person'));
  } catch(e) {
    return [];
  }
}

// Match a typed author name against workspace members (exact, then partial).
async function findNotionUserByName(name) {
  const users = await getWorkspaceUsers();
  const lower = name.trim().toLowerCase();
  return users.find(u => (u.name || '').toLowerCase() === lower)
      || users.find(u => (u.name || '').toLowerCase().includes(lower));
}

// Format a string value to match a Notion property's type (for the Author prop).
// 'people' properties need a real Notion user id, not free text — resolved via findNotionUserByName.
async function buildPropValue(type, value) {
  const s = String(value);
  switch (type) {
    case 'select':       return { select: { name: s } };
    case 'multi_select': return { multi_select: [{ name: s }] };
    case 'title':        return { title: [{ text: { content: s } }] };
    case 'people': {
      const user = await findNotionUserByName(s);
      return user ? { people: [{ object: 'user', id: user.id }] } : null;
    }
    case 'rich_text':
    default:             return { rich_text: [{ text: { content: s.slice(0, 2000) } }] };
  }
}

// one send at a time (0.11.92): a second tap while the columns were read, or the button turned back on by typing
// during the upload, created a second Notion page
var submitting = false;   // var: updateSubmitBtn can run during start-up, before this line
// the spinner and words on a button, as text: a file's name is part of the words (it was put in as HTML)
function busyLabel(btn, text) {
  btn.textContent = '';
  const d = document.createElement('div'); d.className = 'dot-spin'; d.style.borderTopColor = 'var(--text-inverse)';
  btn.append(d, document.createTextNode(' ' + text));
}
async function submitToNotion() {
  if (submitting) return;
  // what is sent is what was on the form when Send was pressed: the tab and the attachments are fixed here, so a
  // switch of tab or a photo added during a long upload neither goes to the wrong database nor is wiped after
  const tab = activeTab;
  const sentMedia = mediaFiles.slice();
  const dbId       = document.getElementById(TAB_DB[tab]).value.trim();
  const tagsProp   = 'Tags';
  const noteProp   = 'Note';
  const authorName = document.getElementById('authorName').value.trim();

  if (!dbId) {
    showToast('Configuration needed — open Settings (ask the admin for the settings PIN)', 'error');   // the PIN is not shown in the app any more
    return;
  }
  const unchosen = (TAB_SCHEMAS[tab] || []).find(f => f.required && !getTabValue(tab, f.key));
  if (unchosen) {
    showToast(`Choose the ${(unchosen.label || unchosen.key).toLowerCase()} first: ${unchosen.options.join(', ')}`, 'error');
    return;
  }
  if (TITLE_REQUIRED[tab] && !document.getElementById('noteTitle').value.trim()) {
    showToast('Give the report a title first', 'error');
    document.getElementById('noteTitle').focus();
    return;
  }

  submitting = true;
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  busyLabel(btn, 'Sending…');
  const failedMedia = [];
  try {
  delete _dbPropsCache[dbId];   // re-read the columns on every send: they can be renamed in Notion
  const dbProps     = await getDbProps(dbId);
  // No columns read = Notion did not answer (no signal, a time-out, a busy server): a list always has at least its
  // title column. Sending on blind made a Daily or SU report with no date, no author and no status under "Sent" —
  // the date, the author and the status are only written to columns that were found. Nothing is sent; the note stays.
  if (!Object.keys(dbProps).length) {
    showToast(navigator.onLine === false
      ? 'No signal — nothing was sent and your note is still here. Press Send again when you have signal.'
      : `Not sent — ${dbPropsWhy || 'could not reach Notion'}. Your note is still here: press Send again.`, 'error');
    return;
  }
  const titleProp   =Object.entries(dbProps).find(([, v]) => v.type === 'title')?.[0] || 'Title';
  const voiceTranscript = document.getElementById('transcriptText').value.trim();
  const videoTranscriptVal = document.getElementById('videoTranscriptText').value.trim();
  const transcript  = [videoTranscriptVal, voiceTranscript].filter(Boolean).join('\n\n');
  const summary     = document.getElementById('summaryText').value.trim();
  const note        = document.getElementById('noteText').value.trim();
  const titleInput  = document.getElementById('noteTitle').value.trim();
  const title       = titledByAuthor(tab)
    ? (titleInput || authorName || TAB_LABELS[tab])
    : titleInput || summary || transcript.slice(0, 80) || note.slice(0, 80) || 'Voice Note';
  const videoSummary = document.getElementById('videoSummaryText').value.trim();
  const sentText = { titleInput, voiceTranscript, videoTranscriptVal, summary, note, videoSummary };
  const sentFields = JSON.stringify(tabValues[tab] || {});

  // Upload files directly to Notion
  const children = [];
  // Notion caps rich_text content at 2000 chars per object; split long text into multiple paragraph blocks.
  const pushTextBlocks = (text) => {
    const LIMIT = 2000;
    for (let i = 0; i < text.length; i += LIMIT) {
      children.push({ object:'block', type:'paragraph', paragraph:{ rich_text:[{ type:'text', text:{ content: text.slice(i, i + LIMIT) } }] } });
    }
  };

  // ── Media blocks: videos first, images second (no heading) ──
  const uploadMedia = async (m) => {
    if (m.type === 'link') {
      children.push({ object:'block', type:'embed', embed:{ url: m.url } });
      return;
    }
    try {
      // Prefer the compressed video (~85 MB budget for 8 min, average quality)
      // over the raw original (can be 400+ MB) — falls back to the original
      // if compression failed or hasn't finished.
      let fileForUpload = m.file;
      if (m.type === 'video' && m.compressPromise) {
        // a stalled compression does not hold Send for ever (0.11.92): after two minutes the original goes
        busyLabel(btn, 'Finishing the video…');
        const compressed = await Promise.race([m.compressPromise.catch(() => null), new Promise(r => setTimeout(() => r(null), 120000))]);
        if (compressed) fileForUpload = compressed;
      }
      const uploadId = await uploadFileToNotion(fileForUpload, (msg) => busyLabel(btn, msg));
      const isImage = m.file.type.startsWith('image/');
      const isVideo = m.file.type.startsWith('video/');
      if (isImage)       children.push({ object:'block', type:'image', image:{ type:'file_upload', file_upload:{ id: uploadId } } });
      else if (isVideo)  children.push({ object:'block', type:'video', video:{ type:'file_upload', file_upload:{ id: uploadId } } });
      else               children.push({ object:'block', type:'file',  file:{  type:'file_upload', file_upload:{ id: uploadId }, caption:[{ type:'text', text:{ content: m.file.name } }] } });
    } catch(e) {
      failedMedia.push(m);                    // kept on the phone after the send, to be sent again
      showToast(`A file was not uploaded — ${failureReason(e)}`, 'error');   // it said "note will still be sent", also when nothing could be
      children.push({ object:'block', type:'paragraph', paragraph:{ rich_text:[{ type:'text', text:{ content:`[File not uploaded: ${m.file.name} — ${e.message}]` } }] } });
    }
  };

  for (const m of sentMedia.filter(m => m.type === 'video' || m.type === 'link')) await uploadMedia(m);
  for (const m of sentMedia.filter(m => m.type === 'image' || m.type === 'audio')) await uploadMedia(m);

  // ── Text blocks at the bottom ─────────────────────────────────
  // The Voice summary was only ever the page's title, when the Title box was empty: with a title typed — always on
  // Daily (the name) and on SU reports (the title is required) — it reached Notion nowhere and was cleared as sent.
  if (summary && summary !== title) {
    children.push({ object:'block', type:'heading_3', heading_3:{ rich_text:[{ type:'text', text:{ content:'Summary' } }] } });
    pushTextBlocks(summary);
  }
  if (videoSummary) {
    children.push({ object:'block', type:'heading_3', heading_3:{ rich_text:[{ type:'text', text:{ content:'Video Summary' } }] } });
    pushTextBlocks(videoSummary);
  }
  if (transcript) {
    children.push({ object:'block', type:'heading_3', heading_3:{ rich_text:[{ type:'text', text:{ content:'Transcript' } }] } });
    pushTextBlocks(transcript);
  }
  if (note) {
    children.push({ object:'block', type:'heading_3', heading_3:{ rich_text:[{ type:'text', text:{ content:'Note' } }] } });
    pushTextBlocks(note);
  }

  // Only a location the user saved is sent.
  const loc = captureLocation;
  if (loc) {
    children.push({ object:'block', type:'paragraph', paragraph:{ rich_text:[
      { type:'text', text:{ content:'📍 ' } },
      { type:'text', text:{ content: locationText(loc), link:{ url: mapsUrl(loc) } } },
    ] } });
  }

  const properties = {
    [titleProp]: { title: [{ text: { content: title } }] },
  };

  // Location column, if the DB has one (Location / GPS, url or text).
  const locEntry = loc && Object.entries(dbProps).find(([k, v]) =>
    /^(location|gps|position)$/i.test(k) && (v.type === 'url' || v.type === 'rich_text'));
  if (locEntry) {
    properties[locEntry[0]] = locEntry[1].type === 'url'
      ? { url: mapsUrl(loc) }
      : { rich_text: [{ text: { content: locationText(loc), link: { url: mapsUrl(loc) } } }] };
  }
  // Precision column in metres (number, or text "±12 m"), if the DB has one.
  const accEntry = loc && Object.entries(dbProps).find(([k, v]) =>
    /^(gps )?(precision|accuracy)( \(m\))?$/i.test(k) && (v.type === 'number' || v.type === 'rich_text'));
  if (accEntry) {
    properties[accEntry[0]] = accEntry[1].type === 'number'
      ? { number: Math.round(loc.acc) }
      : { rich_text: [{ text: { content: `±${Math.round(loc.acc)} m` } }] };
  }

  // Author: send to any tab whose DB has an Author property.
  const authorEntry = Object.entries(dbProps).find(([k]) => /^author$/i.test(k));
  if (authorEntry && authorName) {
    const authorValue = await buildPropValue(authorEntry[1].type, authorName);
    if (authorValue) {
      properties[authorEntry[0]] = authorValue;
    } else if (authorEntry[1].type === 'people') {
      showToast(`No Notion member matches "${authorName}" — Author left blank`, 'error');
    }
  }

  if (datedOnForm(tab)) {
    // Daily, SU reports: the date chosen in the form, date only (no time); today if unchanged — what the form shows.
    // Until 0.11.120 an unchanged date was the note's start time, which on these tabs could be weeks old.
    const dateEntry = Object.entries(dbProps).find(([, v]) => v.type === 'date');
    if (dateEntry) {
      properties[dateEntry[0]] = { date: { start: getTabValue(tab, 'Date') || localDateISO() } };
    }
  }
  if (tab !== 'daily') {
    // Date and note go to whichever column the live DB has (SoP renamed
    // Date → Effective Date and Note → Summary); left out if none exists,
    // since Notion rejects the whole page for an unknown column.
    const knownProps = Object.keys(dbProps).length > 0;
    const pickCol = (names, type) => !knownProps ? names[0]
      : names.find(n => dbProps[n]?.type === type)
        || Object.keys(dbProps).find(n => dbProps[n].type === type && names.some(x => n.toLowerCase().includes(x.toLowerCase())));
    const dateCol = datedOnForm(tab) ? null : pickCol(['Date', 'Effective Date'], 'date');
    if (dateCol) properties[dateCol] = { date: { start: dateCol === 'Date' ? noteStartTime.toISOString() : localDateISO(noteStartTime) } };
    const noteCol = pickCol([noteProp, 'Summary'], 'rich_text');
    if (note && noteCol) {
      properties[noteCol] = { rich_text: [{ text: { content: note.slice(0, 2000) } }] };
    }
  }

  // Schema-based fields (all tabs, including Daily). Each field goes to the
  // column that exists in the live Notion database — its key, or an older name
  // listed in `aliases` — so a column renamed in Notion never makes Notion reject
  // the whole note. A field with no matching column is left out and reported.
  const schema = TAB_SCHEMAS[tab] || [];
  const knownCols = Object.keys(dbProps).length > 0;
  const missingCols = [];
  schema.forEach(field => {
    const val = getTabValue(tab, field.key);
    if (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length)) return;
    const col = knownCols ? [field.key, ...(field.aliases || [])].find(n => n in dbProps) : field.key;
    if (field.type !== 'priorities' && !col) { missingCols.push(field.label || field.key); return; }
    if (field.type === 'multi_select') {
      properties[col] = { multi_select: val.map(name => ({ name })) };
    } else if (field.type === 'select') {
      properties[col] = { select: { name: val } };
    } else if (field.type === 'priorities') {
      (field.props || ['P1','P2','P3']).forEach(p => {
        if (val[p]?.trim()) properties[p] = { rich_text: [{ text: { content: val[p].trim().slice(0, 2000) } }] };
      });
    } else if (field.type === 'text') {
      properties[col] = { rich_text: [{ text: { content: String(val).slice(0, 2000) } }] };
    }
  });

  // SU reports: a report arrives as New; the farm team moves it to Seen and Done in Notion
  if (tab === 'sulive' && dbProps.Status?.type === 'select') properties.Status = { select: { name: 'New' } };

  busyLabel(btn, 'Creating page…');

  let created = false;
  try {
    const res = await cfFetch(PROXY + '/v1/pages', {
      method: 'POST',
      headers: {
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: dbId }, properties, children }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Notion error');
    }
    created = true;
    const fields = JSON.parse(sentFields);
    // the form first: the note is in Notion, and a full phone storage writing the log below must not undo that
    resetForm({ tab, sentText, sentFields, sentMedia, keepMedia: failedMedia });
    if (failedMedia.length) {
      showToast(`Sent to ${TAB_LABELS[tab]}, but ${failedMedia.length} file${failedMedia.length === 1 ? ' was' : 's were'} not uploaded — still here: press Send again for ${failedMedia.length === 1 ? 'it' : 'them'}`, 'error');
    } else {
      showToast(`Sent to ${TAB_LABELS[tab]} ✓` +
        (missingCols.length ? ` — not in Notion, left out: ${missingCols.join(', ')}` : ''),
        missingCols.length ? 'info' : 'success');
    }
    saveEntry({ title, transcript, note, tab, fields, status: 'sent' });
  } catch(e) {
    if (!created) {
      // plain words: it read "Failed: Failed to fetch" ("Load failed" on an iPhone) and did not say the note was kept
      showToast(`Not sent — ${failureReason(e)}. Your note is still here: press Send again.`, 'error');
      saveEntry({ title, transcript, note, tab, fields: JSON.parse(sentFields), status: 'failed' });
    }
  }
  } finally {
    submitting = false;
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send to <span id="submitTabLabel">${TAB_LABELS[activeTab]}</span>`;
    updateSubmitBtn();
  }
}

// After a send: only what was sent is cleared (0.11.92). A field changed during the upload, a photo added, a file
// that failed to upload, and another tab's values stay — called with nothing, it clears the whole form as before.
function resetForm(sent = null) {
  const tab = sent?.tab || activeTab;
  const clearIf = (id, was) => { const f = document.getElementById(id); if (!sent || f.value.trim() === (was || '')) f.value = ''; };
  clearIf('noteTitle', sent?.sentText.titleInput);
  syncDailyTitle(activeTab);   // Daily: the author name comes back for the next note
  clearIf('transcriptText', sent?.sentText.voiceTranscript);
  clearIf('summaryText', sent?.sentText.summary);
  clearIf('noteText', sent?.sentText.note);
  clearIf('videoTranscriptText', sent?.sentText.videoTranscriptVal);
  clearIf('videoSummaryText', sent?.sentText.videoSummary);
  mediaFiles = sent ? mediaFiles.filter(m => !sent.sentMedia.includes(m) || sent.keepMedia.includes(m)) : [];
  renderMediaPreviews();
  // Clear the sent tab's field values, but keep persistent fields (e.g. weekly priorities) — and values changed meanwhile
  if (!sent || JSON.stringify(tabValues[tab] || {}) === sent.sentFields) {
    const persistKeys = (TAB_SCHEMAS[tab] || []).filter(f => f.persist).map(f => f.key);
    const kept = {};
    persistKeys.forEach(k => { if (tabValues[tab]?.[k] !== undefined) kept[k] = tabValues[tab][k]; });
    if (Object.keys(kept).length) tabValues[tab] = kept; else delete tabValues[tab];
    try { localStorage.setItem('brain_tabValues', JSON.stringify(tabValues)); } catch (e) { /* storage full: the form still clears */ }
    if (tab === activeTab) renderTabFields(activeTab);
  }
  // the author's name back in the Title box (Daily) is not something left to send: until 0.11.120 it
  // kept the old start time and the draft alive after every send on that tab
  const left = ['noteTitle', 'transcriptText', 'summaryText', 'noteText', 'videoTranscriptText', 'videoSummaryText']
    .some(id => { const f = document.getElementById(id); return f.value.trim() && !(id === 'noteTitle' && f.dataset.auto === '1'); }) || mediaFiles.length > 0;
  if (!left) {
    recordedBlob = null;
    noteStartTime = new Date(); // fresh timestamp for the next note
    noteStarted = false;        // and taken again when the next note gets its first word (updateSubmitBtn skips this during a send)
    stopGpsWatch();
    captureLocation = null;     // and a fresh position
    renderGpsStamp();
    clearDraft();               // note is safely in Notion — drop the local copy
  }
  renderNoteStamp();
  updateSubmitBtn();            // saves the draft of whatever is left
}


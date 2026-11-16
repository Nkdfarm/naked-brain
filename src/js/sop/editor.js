//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- SOP editor. Edit here, then run: python build.py
// ─── EDITOR ──────────────────────────────────────────────────
// Edits the page block-by-block instead of rewriting it, so anything the editor
// can't represent (tables, sub-pages, nested content, existing photos) is kept
// untouched in place. Unchanged blocks are never re-sent, so their colours,
// mentions etc. survive too.
const ED_TYPES = [
  ['numbered_list_item', 'Numbered step'], ['to_do', 'Checkbox'], ['bulleted_list_item', 'Bullet'],
  ['paragraph', 'Text'], ['heading_1', 'Heading'], ['heading_2', 'Subheading'], ['heading_3', 'Small heading'],
  ['callout', 'Callout'], ['quote', 'Quote'], ['toggle', 'Toggle'], ['divider', 'Divider'],
];
const ED_TEXT_TYPES = new Set(ED_TYPES.map(t => t[0]).filter(t => t !== 'divider'));
const CALLOUT_ICONS = ['⚠️', '💡', 'ℹ️', '🎯', '📌', '🧤', '💧'];
let importDraft = null;   // set by the importer, consumed by showEditor(null)

// Rich text ⇄ light markdown: **bold**, *italic*, `code`, [text](https://…)
function richToMd(rtArr) {
  let lossy = false;
  const s = (rtArr || []).map(t => {
    if (t.type !== 'text') { lossy = true; return t.plain_text || ''; }
    let x = t.text.content;
    const a = t.annotations || {};
    if (a.strikethrough || a.underline || (a.color && a.color !== 'default')) lossy = true;
    if (a.code) x = '`' + x + '`';
    if (a.italic) x = '*' + x + '*';
    if (a.bold) x = '**' + x + '**';
    if (t.text.link?.url) x = `[${x}](${t.text.link.url})`;
    return x;
  }).join('');
  return { md: s, lossy };
}
function mdToRich(s) {
  const out = [];
  const push = (content, ann = {}, url) => {
    for (let i = 0; i < content.length; i += 2000) {
      const t = { type: 'text', text: { content: content.slice(i, i + 2000) } };
      if (url) t.text.link = { url };
      if (Object.keys(ann).length) t.annotations = ann;
      out.push(t);
    }
  };
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) push(s.slice(last, m.index));
    if (m[1] != null) {
      const inner = m[1].match(/^\*\*(.+)\*\*$/);
      push(inner ? inner[1] : m[1], inner ? { bold: true } : {}, m[2]);
    }
    else if (m[3] != null) push(m[3], { bold: true });
    else if (m[4] != null) push(m[4], { italic: true });
    else push(m[5], { code: true });
    last = re.lastIndex;
  }
  if (last < s.length) push(s.slice(last));
  return out;
}

function blockToItem(b, idx) {
  const d = b[b.type] || {};
  const editable = ED_TEXT_TYPES.has(b.type) || b.type === 'divider';
  const { md, lossy } = editable && b.type !== 'divider' ? richToMd(d.rich_text) : { md: '', lossy: false };
  const kids = b.children?.length || (b.has_children ? 1 : 0);
  return {
    key: uid(), id: b.id, origIndex: idx, type: b.type, origType: b.type,
    text: md, origText: md, lossy, checked: !!d.checked, origChecked: !!d.checked,
    icon: d.icon?.emoji || '', origIcon: d.icon?.emoji || '',
    kids, locked: !editable, // locked = not editable here, kept as-is (can still be deleted)
    lockedLabel: editable ? '' : lockedLabel(b),
    imgUrl: b.type === 'image' ? imageUrl(b) : null,
  };
}
function lockedLabel(b) {
  const d = b[b.type] || {};
  if (b.type === 'image') return '{i:camera} Photo' + (plain(d.caption) ? ' — ' + plain(d.caption) : '');
  if (b.type === 'table') return `{i:table} Table (${b.children?.length || '?'} rows)`;
  if (b.type === 'child_page') return '{i:file} Sub-page: ' + (d.title || '');
  return b.type.replace(/_/g, ' ');
}
const newItem = (type, text = '', extra = {}) => ({ key: uid(), id: null, type, text, checked: false,
  icon: type === 'callout' ? '⚠️' : '', kids: 0, locked: false, ...extra });
// Anchors keep their Notion block: nested content can't be moved or retyped
// through the API without being lost, and locked blocks can't be recreated.
const isAnchor = it => it.id && (it.kids || it.locked);
const itemChanged = it => it.text !== it.origText || it.checked !== it.origChecked || it.icon !== it.origIcon;

async function showEditor(id) {
  setHeader(id ? 'Edit SOP' : 'New SOP', true);
  let props = { title: '', category: 'Field Ops', status: 'Draft', note: '', icon: '', family: '' };
  let items = [];
  let origProps = null;
  if (id) {
    loadingView();
    const data = await loadSop(id, { force: true });   // edit the live version, never a stale copy
    if (data.offline) throw new Error('Editing needs a connection — you are offline.');
    const s = sopProps(data.page);
    props = { title: s.title, category: s.category, status: s.status, note: s.note, icon: s.icon, family: s.family };
    items = data.blocks.map(blockToItem);
  } else if (importDraft) {
    props = { ...props, ...importDraft.props };
    items = importDraft.items.map(i => newItem(i.type, i.text, i));
    importDraft = null;
  } else {
    items = [newItem('callout', '**Purpose:** ', { icon: '🎯' }), newItem('heading_2', 'Procedure'), newItem('numbered_list_item')];
  }
  origProps = JSON.stringify(props);
  const origKeys = items.map(i => i.key).join();
  const dirty = () => JSON.stringify(props) !== origProps || items.some(i => !i.id || itemChanged(i) || i.type !== i.origType) ||
    items.map(i => i.key).join() !== origKeys;
  leaveGuard = dirty;

  // Properties
  const f = (label, input) => el('div', { class: 'field' }, el('label', null, label), input);
  const inTitle = el('input', { class: 'input', value: props.title, placeholder: 'e.g. SOP: Cleaning the dosing tank' });
  const inIcon = el('input', { class: 'input', value: props.icon, placeholder: 'emoji', maxlength: 4, style: 'width:4.5rem;text-align:center' });
  const sel = (opts, val) => el('select', { class: 'input' }, opts.map(o => el('option', { value: o, selected: o === val ? true : null }, o)));
  const inCat = sel(CATEGORIES, props.category), inStatus = sel(STATUSES, props.status);
  const inNote = el('textarea', { class: 'input', rows: 2, placeholder: 'One-line summary shown in the list' });
  inNote.value = props.note;
  inTitle.oninput = () => props.title = inTitle.value;
  inIcon.oninput = () => props.icon = inIcon.value.trim();
  inCat.onchange = () => props.category = inCat.value;
  inStatus.onchange = () => props.status = inStatus.value;
  const inFam = el('select', { class: 'input' }, el('option', { value: '' }, '— none —'),
    FAMILIES.map(([n, i]) => el('option', { value: n, selected: n === props.family ? true : null }, n)));
  inFam.onchange = () => props.family = inFam.value;
  inNote.oninput = () => props.note = inNote.value;

  const list = el('div');
  const grow = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  const draw = () => {
    list.replaceChildren(...items.map((it, i) => itemCard(it, i)));
    list.querySelectorAll('textarea').forEach(grow);
  };
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; draw(); };
  const insert = (i, it) => { items.splice(i, 0, it); draw(); setTimeout(() => list.querySelector(`[data-key="${it.key}"] textarea`)?.focus(), 30); };

  function itemCard(it, i) {
    const fixed = isAnchor(it);
    const card = el('div', { class: 'ed-item' + (it.locked ? ' locked' : '') + (it.id && (itemChanged(it) || it.type !== it.origType) || !it.id ? ' changed' : ''), 'data-key': it.key });
    const typeSel = el('select', { 'aria-label': 'Block type', disabled: fixed || it.type === 'image' ? true : null },
      it.locked || it.type === 'image' ? el('option', null, it.type === 'image' ? 'Photo' : 'Kept as is') :
        ED_TYPES.map(([v, l]) => el('option', { value: v, selected: v === it.type ? true : null }, l)));
    typeSel.onchange = () => { it.type = typeSel.value; if (it.type === 'callout' && !it.icon) it.icon = '⚠️'; draw(); };
    const bar = el('div', { class: 'ed-bar' }, typeSel,
      it.type === 'to_do' ? el('input', { type: 'checkbox', checked: it.checked ? true : null, 'aria-label': 'Checked', onchange: e => { it.checked = e.target.checked; } }) : null,
      it.type === 'callout' ? el('select', { 'aria-label': 'Callout icon', onchange: e => { it.icon = e.target.value; } },
        [...new Set([it.icon, ...CALLOUT_ICONS])].filter(Boolean).map(ic => el('option', { value: ic, selected: ic === it.icon ? true : null }, NB_EMOJI_WORD[nbEmojiName(ic)] || ic))) : null,
      el('span', { class: 'sp' }),
      el('button', { class: 'btn-icon', 'aria-label': 'Move up', disabled: fixed || i === 0 ? true : null, onclick: () => move(i, -1) }, '↑'),
      el('button', { class: 'btn-icon', 'aria-label': 'Move down', disabled: fixed || i === items.length - 1 ? true : null, onclick: () => move(i, 1) }, '↓'),
      el('button', { class: 'btn-icon', 'aria-label': 'Add step below', onclick: () => insert(i + 1, newItem(it.type === 'to_do' ? 'to_do' : 'numbered_list_item')) }, '＋'),
      el('button', { class: 'btn-icon', 'aria-label': 'Delete block', onclick: async () => {
        if (it.kids && !(await confirmSheet('Delete block?', 'This block has nested content in Notion, which will be deleted with it.', 'Delete', true))) return;
        items.splice(i, 1); draw(); } }, '✕'));
    card.append(bar);
    if (it.type === 'image') card.append(el('img', { class: 'ed-img', src: it.previewUrl || it.imgUrl, alt: 'Photo' }));
    else if (it.locked) card.append(el('div', { class: 'ed-locked-label', text: it.lockedLabel + ' — kept as is (edit in Notion)' }));
    else if (it.type !== 'divider') {
      const ta = el('textarea', { class: 'ed-text' + (/^heading_/.test(it.type) ? ' h' : ''), rows: 1, 'aria-label': 'Block text',
        placeholder: it.type === 'numbered_list_item' ? 'Describe the step…' : 'Text…' });
      ta.value = it.text;
      ta.oninput = () => { it.text = ta.value; grow(ta); card.classList.toggle('changed', !it.id || itemChanged(it) || it.type !== it.origType); };
      card.append(ta);
    } else card.append(el('hr', { style: 'border:none;border-top:1px solid var(--border);margin:0.5rem 0' }));
    if (it.kids) card.append(el('div', { class: 'ed-kids', text: '↳ has nested content in Notion (kept)' }));
    if (it.lossy) card.append(el('div', { class: 'ed-kids', text: 'Has colours/mentions — editing this text will simplify its formatting' }));
    return card;
  }

  const photoInput = el('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async () => {
    const file = photoInput.files[0]; photoInput.value = '';
    if (!file) return;
    try {
      const small = await compressImage(file);
      items.push(newItem('image', '', { file: small, previewUrl: URL.createObjectURL(small) }));
      draw();
    } catch (e) { toast('Could not read that photo: ' + failureReason(e), 'error'); }
  } });
  const addBtn = (label, type, extra) => el('button', { class: 'btn btn-sm', onclick: () => insert(items.length, newItem(type, '', extra)) }, label);

  draw();
  view(
    el('div', { style: 'display:flex;gap:0.75rem' }, f('Icon', inIcon), el('div', { style: 'flex:1' }, f('Title', inTitle))),
    el('div', { style: 'display:flex;gap:0.75rem' }, el('div', { style: 'flex:1' }, f('Category', inCat)), el('div', { style: 'flex:1' }, f('Status', inStatus))),
    f('Family', inFam),
    f('Summary', inNote),
    el('div', { class: 'lbl', style: 'margin-top:1rem' }, 'Content'),
    el('p', { class: 'hint', style: 'margin-bottom:0.5rem' }, 'Numbered steps and checkboxes become the checklist. Formatting: **bold**, *italic*, [link](https://…)'),
    list,
    el('div', { class: 'ed-add' }, addBtn('＋ Step', 'numbered_list_item'), addBtn('＋ Checkbox', 'to_do'), addBtn('＋ Subheading', 'heading_2'),
      addBtn('＋ Text', 'paragraph'), addBtn('＋ Safety note', 'callout', { icon: '⚠️' }),
      el('button', { class: 'btn btn-sm', onclick: () => photoInput.click() }, '{i:camera} Photo'), photoInput),
  );
  const saveBtn = el('button', { class: 'btn btn-primary btn-lg', onclick: async () => {
    if (!props.title.trim()) { toast('Give the SOP a title', 'error'); inTitle.focus(); return; }
    saveBtn.disabled = true;
    const setStatus = m => { saveBtn.replaceChildren(el('span', { class: 'spinner' }), ' ' + m); };
    try {
      const pageId = id ? await saveExisting(id, props, JSON.parse(origProps), items, setStatus) : await saveNew(props, items, setStatus);
      leaveGuard = null;
      // Mark the list stale (refetched on next visit) without dropping the offline copy.
      const cachedList = await idbGet('sops');
      if (cachedList) await idbSet('sops', { ...cachedList, at: 0 });
      toast('Saved to Notion ✓', 'success');
      if (id) history.back(); else location.replace('#/sop/' + pageId.replace(/-/g, ''));
      await loadSop(pageId.replace(/-/g, ''), { force: true }).then(() => route()).catch(() => {});
    } catch (e) {
      console.warn(e);
      toast('Save failed: ' + failureReason(e), 'error', 6000);
      saveBtn.disabled = false; saveBtn.textContent = 'Save to Notion';
    }
  } }, 'Save to Notion');
  bottomBar(el('button', { class: 'btn btn-lg', onclick: () => history.back() }, 'Cancel'), saveBtn);
}

function propsPayload(p) {
  const o = {
    Title: { title: rt(p.title.trim()) },
    Category: p.category ? { select: { name: p.category } } : { select: null },
    Status: p.status ? { select: { name: p.status } } : { select: null },
    Summary: { rich_text: p.note.trim() ? rt(p.note.trim()) : [] },
    Family: p.family ? { select: { name: p.family } } : { select: null },
  };
  return o;
}

async function itemToBlock(it) {
  if (it.type === 'divider') return { type: 'divider', divider: {} };
  if (it.type === 'image') return { type: 'image', image: { type: 'file_upload', file_upload: { id: await uploadFile(it.file) } } };
  const d = { rich_text: mdToRich(it.text) };
  if (it.type === 'to_do') d.checked = !!it.checked;
  if (it.type === 'callout') d.icon = { type: 'emoji', emoji: it.icon || '💡' };
  return { type: it.type, [it.type]: d };
}

async function appendBlocks(parentId, blocks, after) {
  let lastId = after;
  for (let i = 0; i < blocks.length; i += 100) {
    const body = { children: blocks.slice(i, i + 100) };
    if (lastId) body.after = lastId;
    const r = await notion(`blocks/${parentId}/children`, 'PATCH', body);
    // With `after`, Notion returns the newly created blocks; without it, the
    // whole child list — the last entry is the last appended in both cases.
    lastId = r.results[r.results.length - 1]?.id || lastId;
  }
  return lastId;
}

async function saveNew(props, items, setStatus) {
  const blocks = [];
  let n = 0;
  for (const it of items) {
    if (it.type === 'image') setStatus(`Uploading photo ${++n}…`); else setStatus('Preparing…');
    if (it.type !== 'divider' && it.type !== 'image' && !it.text.trim()) continue;
    blocks.push(await itemToBlock(it));
  }
  setStatus('Creating page…');
  const page = await notion('pages', 'POST', {
    parent: { database_id: SOP_DB },
    icon: props.icon ? { type: 'emoji', emoji: props.icon } : undefined,
    properties: { ...propsPayload(props), 'Effective Date': { date: { start: new Date().toISOString().slice(0, 10) } } },
    children: blocks.slice(0, 100),
  });
  if (blocks.length > 100) await appendBlocks(page.id, blocks.slice(100));
  return page.id;
}

async function saveExisting(pageId, props, orig, items, setStatus) {
  // 1. Properties
  if (JSON.stringify(props) !== JSON.stringify(orig)) {
    setStatus('Saving details…');
    const body = { properties: propsPayload(props) };
    if (props.icon !== orig.icon) body.icon = props.icon ? { type: 'emoji', emoji: props.icon } : null;
    await notion(`pages/${pageId}`, 'PATCH', body);
  }
  // Blank new text blocks are dropped rather than saved as empty lines.
  items = items.filter(it => it.id || it.type === 'divider' || it.type === 'image' || it.text.trim());

  // 2. Which existing blocks stay where they are? Anchors always do; others only
  // while they remain in their original order (the API can't move blocks, so a
  // moved or retyped block is deleted and recreated).
  const anchors = items.filter(isAnchor);
  let lastIdx = -1;
  for (const it of items) {
    it.inPlace = false;
    if (!it.id) continue;
    if (isAnchor(it)) { it.inPlace = true; lastIdx = it.origIndex; continue; }
    const nextAnchor = anchors.find(a => items.indexOf(a) > items.indexOf(it));
    if (it.type === it.origType && it.origIndex > lastIdx && (!nextAnchor || it.origIndex < nextAnchor.origIndex)) {
      it.inPlace = true; lastIdx = it.origIndex;
    }
  }
  // 3. What will go: removed blocks and the originals of recreated ones — deleted LAST (0.11.92). Deleting first
  // meant a dropped connection between the deletes and the inserts lost the moved or retyped blocks from Notion.
  const keep = new Set(items.filter(i => i.inPlace).map(i => i.id));
  const data = await idbGet('sop:' + pageId);
  const origIds = (data?.blocks || []).map(b => b.id);
  const toDelete = origIds.filter(bid => !keep.has(bid));

  // 4. Walk the final order: patch changed in-place blocks, insert runs of new ones.
  let prev = null, pendingTop = null;
  for (let i = 0; i < items.length;) {
    const it = items[i];
    if (it.inPlace) {
      if (!it.locked && it.type !== 'divider' && itemChanged(it)) {
        setStatus('Saving changes…');
        const d = { rich_text: mdToRich(it.text) };
        if (it.type === 'to_do') d.checked = !!it.checked;
        if (it.type === 'callout' && it.icon) d.icon = { type: 'emoji', emoji: it.icon };
        await notion(`blocks/${it.id}`, 'PATCH', { [it.type]: d });
      }
      if (pendingTop) {
        // New blocks went in before the first kept block. The API can only
        // insert *after* a block, so insert after it, then move it below them.
        const lastNew = await appendBlocks(pageId, pendingTop, it.id);
        if (!isAnchor(it)) {
          await notion(`blocks/${it.id}`, 'DELETE');
          prev = await appendBlocks(pageId, [await itemToBlock(it)], lastNew);
        } else {
          toast('New blocks were placed after the first block (it has nested content and cannot move)', 'info', 6000);
          prev = lastNew;
        }
        pendingTop = null;
      } else prev = it.id;
      i++;
      continue;
    }
    const run = [];
    while (i < items.length && !items[i].inPlace) {
      if (items[i].type === 'image') setStatus('Uploading photo…');
      run.push(await itemToBlock(items[i]));
      i++;
    }
    setStatus('Adding blocks…');
    if (prev) prev = await appendBlocks(pageId, run, prev);
    else if (items.slice(i).some(x => x.inPlace)) pendingTop = run;
    else prev = await appendBlocks(pageId, run);   // nothing kept: plain append
  }
  // 5. Now the old blocks go. One already gone (a retry after a dropped connection) is not an error.
  let k = 0;
  for (const bid of toDelete) {
    setStatus(`Removing blocks ${++k}/${toDelete.length}…`);
    try { await notion(`blocks/${bid}`, 'DELETE'); }
    catch (e) { if (e?.status !== 404 && !/not.?found|archived|object_not_found/i.test(String(e?.message || e))) throw e; }
  }
  return pageId;
}

// Photos: shrink before upload (field connections are slow; Notion shows them small anyway).
function compressImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(new File([b], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })) : reject(new Error('encode failed')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported image')); };
    img.src = url;
  });
}

async function uploadFile(file) {
  if (file.size > NOTION_SINGLE_PART_LIMIT) throw new Error(`${file.name} is over 20 MB`);
  const cr = await notion('file_uploads', 'POST', { filename: file.name, content_type: file.type || 'application/octet-stream' });
  const fd = new FormData();
  fd.append('file', file, file.name);
  const sr = await cfFetch(`${PROXY}/v1/file_uploads/${cr.id}/send`, { method: 'POST', headers: { 'Notion-Version': NOTION_VERSION }, body: fd });
  if (!sr.ok) throw new Error('Photo upload failed: ' + await apiErrorMessage(sr));
  return cr.id;
}


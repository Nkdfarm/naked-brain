//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- Notion data and block rendering. Edit here, then run: python build.py
// ─── NOTION DATA ─────────────────────────────────────────────
function sopProps(page) {
  const p = page.properties || {};
  return {
    id: page.id.replace(/-/g, ''),
    title: plain(p.Title?.title) || 'Untitled',
    category: p.Category?.select?.name || '',
    status: p.Status?.select?.name || '',
    note: plain(p.Summary?.rich_text) || plain(p.Note?.rich_text),
    date: p['Effective Date']?.date?.start || p.Date?.date?.start || '',
    docType: p['Document Type']?.select?.name || '',
    family: p.Family?.select?.name || '',
    icon: page.icon?.type === 'emoji' ? page.icon.emoji : '',
    url: page.url,
    edited: page.last_edited_time,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// All SOPs except archived ones. Falls back to the offline copy on network failure.
async function loadSops({ force = false } = {}) {
  const cached = await idbGet('sops');
  if (cached && !force && Date.now() - cached.at < 60_000) return { list: cached.list, at: cached.at, offline: false };
  try {
    const list = [];
    let cursor;
    do {
      const r = await notion(`databases/${SOP_DB}/query`, 'POST', {
        page_size: 100, start_cursor: cursor,
        filter: { property: 'Status', select: { does_not_equal: 'Archived' } },
        sorts: [{ property: 'Title', direction: 'ascending' }],
      });
      list.push(...r.results.map(sopProps));
      cursor = r.has_more ? r.next_cursor : undefined;
    } while (cursor);
    const at = Date.now();
    await idbSet('sops', { list, at });
    return { list, at, offline: false };
  } catch (e) {
    if (cached && isNetworkError(e)) return { list: cached.list, at: cached.at, offline: true };
    throw e;
  }
}

const NO_DESCEND = new Set(['child_page', 'child_database', 'unsupported']);
async function fetchChildren(blockId, depth = 0) {
  const blocks = [];
  let cursor;
  do {
    const q = cursor ? `?page_size=100&start_cursor=${cursor}` : '?page_size=100';
    const r = await notion(`blocks/${blockId}/children${q}`);
    blocks.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  if (depth < 4) {
    await mapLimit(blocks.filter(b => b.has_children && !NO_DESCEND.has(b.type)), 3, async b => {
      b.children = await fetchChildren(b.id, depth + 1);
    });
  }
  return blocks;
}

// One SOP = its page (properties) + its block tree. Cached for offline reading.
async function loadSop(id, { force = false } = {}) {
  const key = 'sop:' + id;
  const cached = await idbGet(key);
  if (cached && !force && Date.now() - cached.at < 60_000) return { ...cached, offline: false };
  try {
    const [page, blocks] = await Promise.all([notion(`pages/${id}`), fetchChildren(id)]);
    const data = { page, blocks, at: Date.now() };
    await idbSet(key, data);
    cacheImages(blocks);
    return { ...data, offline: false };
  } catch (e) {
    if (cached && isNetworkError(e)) return { ...cached, offline: true };
    throw e;
  }
}

// Notion image URLs are signed and expire after ~1 h, so keep a blob copy for
// offline use. Works only if the file host allows CORS; otherwise silently skipped.
function walkBlocks(blocks, fn) { for (const b of blocks || []) { fn(b); walkBlocks(b.children, fn); } }
function imageUrl(b) { const im = b.image; return im?.type === 'external' ? im.external.url : im?.file?.url; }
async function cacheImages(blocks) {
  const imgs = [];
  walkBlocks(blocks, b => { if (b.type === 'image') imgs.push(b); });
  await mapLimit(imgs, 2, async b => {
    if (await idbGet('img:' + b.id)) return;
    try {
      const r = await fetch(imageUrl(b), { mode: 'cors' });
      if (r.ok) await idbSet('img:' + b.id, await r.blob());
    } catch (_) {}
  });
}

// ─── RENDERING NOTION BLOCKS ─────────────────────────────────
function renderRich(rt) {
  const frag = document.createDocumentFragment();
  for (const t of rt || []) {
    const a = t.annotations || {};
    let node = document.createTextNode(t.plain_text ?? t.text?.content ?? '');
    const href = safeUrl(t.href || t.text?.link?.url);
    if (a.code) node = el('code', null, node);
    if (a.bold) node = el('strong', null, node);
    if (a.italic) node = el('em', null, node);
    if (a.strikethrough) node = el('s', null, node);
    if (a.underline) node = el('u', null, node);
    if (a.color && a.color !== 'default' && !a.color.endsWith('_background')) node = el('span', { class: 'c-' + a.color }, node);
    if (href) node = el('a', { href, target: '_blank', rel: 'noopener' }, node);
    frag.append(node);
  }
  return frag;
}

const LIST_TYPES = { bulleted_list_item: 'ul', numbered_list_item: 'ol' };
function renderBlocks(blocks) {
  const frag = document.createDocumentFragment();
  let list = null, listType = null;
  for (const b of blocks || []) {
    const lt = LIST_TYPES[b.type];
    if (lt) {
      if (listType !== lt) { list = el(lt); frag.append(list); listType = lt; }
      const li = el('li', null, renderRich(b[b.type].rich_text));
      if (b.children?.length) li.append(el('div', { class: 'kids' }, renderBlocks(b.children)));
      list.append(li);
      continue;
    }
    list = null; listType = null;
    const node = renderBlock(b);
    if (node) frag.append(node);
  }
  return frag;
}

const WARN_ICONS = new Set(['⚠️', '⚠', '🚫', '⛔', '❗', '‼️', '🔥', '☠️', '🧤', '🥽', '🔪']);
function renderBlock(b) {
  const d = b[b.type] || {};
  const kids = () => (b.children?.length ? el('div', { class: 'kids' }, renderBlocks(b.children)) : null);
  switch (b.type) {
    case 'paragraph': return plain(d.rich_text) ? el('div', null, el('p', null, renderRich(d.rich_text)), kids()) : null;
    case 'heading_1': return el('h2', null, renderRich(d.rich_text));
    case 'heading_2': return el('h3', null, renderRich(d.rich_text));
    case 'heading_3': return el('h4', null, renderRich(d.rich_text));
    case 'to_do': return el('div', null,
      el('div', { class: 'todo' }, el('span', { class: 'box' + (d.checked ? ' on' : '') }), el('span', null, renderRich(d.rich_text))), kids());
    case 'callout': return el('div', { class: 'callout' + (WARN_ICONS.has(d.icon?.emoji) ? ' warn' : '') },
      el('span', { class: 'ic', 'aria-hidden': 'true' }, nbEmoji(d.icon?.emoji || '💡')),
      el('div', null, el('div', null, renderRich(d.rich_text)), b.children?.length ? renderBlocks(b.children) : null));
    case 'quote': return el('blockquote', null, renderRich(d.rich_text), kids());
    case 'divider': return el('hr');
    case 'code': return el('pre', null, el('code', null, plain(d.rich_text)));
    case 'toggle': return el('details', null, el('summary', null, renderRich(d.rich_text)), kids());
    case 'image': {
      const img = el('img', { src: imageUrl(b), alt: plain(d.caption) || 'SOP photo', loading: 'lazy' });
      img.addEventListener('error', async () => {
        const blob = await idbGet('img:' + b.id);
        if (blob && !img.dataset.fb) { img.dataset.fb = '1'; img.src = URL.createObjectURL(blob); }
      }, { once: true });
      return el('figure', null, img, d.caption?.length ? el('figcaption', null, renderRich(d.caption)) : null);
    }
    case 'table': {
      const rows = (b.children || []).filter(r => r.type === 'table_row');
      const tbl = el('table');
      rows.forEach((r, i) => tbl.append(el('tr', { class: i === 0 && d.has_column_header ? 'th' : null },
        r.table_row.cells.map(c => el('td', null, renderRich(c))))));
      return el('div', { class: 'tbl-wrap' }, tbl);
    }
    case 'column_list': case 'column': case 'synced_block': return el('div', null, renderBlocks(b.children));
    case 'bookmark': case 'embed': case 'link_preview': {
      const u = safeUrl(d.url);
      return u ? el('p', null, el('a', { href: u, target: '_blank', rel: 'noopener' }, plain(d.caption) || u)) : null;
    }
    case 'video': case 'file': case 'pdf': case 'audio': {
      const u = safeUrl(d.type === 'external' ? d.external?.url : d.file?.url);
      const name = d.name || plain(d.caption) || b.type;
      return u ? el('p', null, el('a', { href: u, target: '_blank', rel: 'noopener' }, '{i:clip} ' + name)) : null;
    }
    case 'child_page': return el('p', { class: 'unsupported' }, '{i:file} Sub-page: ' + (d.title || ''));
    case 'child_database': return el('p', { class: 'unsupported' }, '{i:database} Database: ' + (d.title || ''));
    default: return el('p', { class: 'unsupported' }, `[${b.type.replace(/_/g, ' ')} — open in Notion to see it]`);
  }
}


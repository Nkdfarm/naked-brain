//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- import Word / PDF / text as a draft SOP. Edit here, then run: python build.py
// ─── IMPORT (Word / PDF / text → draft SOP) ──────────────────
// Libraries load on demand from jsDelivr, pinned — import is a desk task that
// needs a connection anyway, so they're not precached for offline use.
const LIBS = {
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
};
const _scripts = {};
function loadScript(src) {
  return _scripts[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => { delete _scripts[src]; reject(new Error('could not load the file reader — check your connection')); };
    document.head.append(s);
  });
}

// Inline HTML (from mammoth) → light markdown.
function nodeToMd(node) {
  let s = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { s += n.textContent; continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol' || tag === 'img') continue;
    const inner = nodeToMd(n);
    if (!inner.trim()) { s += inner; continue; }
    if (tag === 'strong' || tag === 'b') s += `**${inner.trim()}** `;
    else if (tag === 'em' || tag === 'i') s += `*${inner.trim()}* `;
    else if (tag === 'a' && safeUrl(n.getAttribute('href'))) s += `[${inner.trim()}](${n.getAttribute('href')})`;
    else if (tag === 'br') s += '\n';
    else s += inner;
  }
  return s.replace(/[ \t]+/g, ' ').replace(/ ([.,;:!?])/g, '$1');
}
function dataUrlToFile(src, i) {
  const [head, b64] = src.split(',');
  const type = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64), buf = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
  return new File([buf], `image-${i}.${type.split('/')[1] || 'png'}`, { type });
}

async function readDocx(file) {
  await loadScript(LIBS.mammoth);
  const { value: html } = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = [], images = [];
  const addImgs = n => n.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:')) { const f = dataUrlToFile(src, images.length + 1); images.push(f); items.push({ type: 'image', file: f }); }
  });
  const walkList = (list, ordered) => {
    for (const li of list.children) {
      const t = nodeToMd(li).trim();
      if (t) items.push({ type: ordered ? 'numbered_list_item' : 'bulleted_list_item', text: t });
      addImgs(li);
      li.querySelectorAll(':scope > ul, :scope > ol').forEach(sub => walkList(sub, sub.tagName === 'OL'));
    }
  };
  for (const n of doc.body.children) {
    const tag = n.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) { const t = nodeToMd(n).trim(); if (t) items.push({ type: tag === 'h1' ? 'heading_1' : tag === 'h2' ? 'heading_2' : 'heading_3', text: t }); }
    else if (tag === 'ul' || tag === 'ol') walkList(n, tag === 'ol');
    else if (tag === 'table') {
      for (const tr of n.querySelectorAll('tr')) {
        const cells = [...tr.children].map(td => nodeToMd(td).trim()).filter(Boolean);
        if (cells.length) items.push({ type: 'bulleted_list_item', text: cells.join(' | ') });
      }
    } else { const t = nodeToMd(n).trim(); if (t) items.push({ type: 'paragraph', text: t }); addImgs(n); }
  }
  const text = items.map(i => i.type === 'image' ? '[photo]' : (i.type === 'numbered_list_item' ? '1. ' : i.type === 'bulleted_list_item' ? '- ' : /^heading/.test(i.type) ? '## ' : '') + i.text).join('\n');
  return { items, text, images };
}

async function readPdf(file) {
  await loadScript(LIBS.pdfjs);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    let line = '', lastY = null;
    for (const it of tc.items) {
      const y = Math.round(it.transform?.[5] ?? 0);
      if (lastY !== null && Math.abs(y - lastY) > 2 && line.trim()) { lines.push(line.trim()); line = ''; }
      line += it.str + (it.hasEOL ? '' : '');
      if (it.hasEOL) { if (line.trim()) lines.push(line.trim()); line = ''; }
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    lines.push('');
  }
  const text = lines.join('\n');
  if (text.replace(/\s/g, '').length < 20) throw new Error('no text found — this PDF is probably a scan (images only)');
  return { items: textToItems(text), text, images: [] };
}

// Plain text / markdown / PDF lines → blocks. Wrapped lines are merged back
// into their paragraph or list item.
function textToItems(text) {
  const items = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { cur = null; continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { items.push({ type: ['heading_1', 'heading_2', 'heading_3'][m[1].length - 1], text: m[2] }); cur = null; }
    else if ((m = line.match(/^[-*•●▪–]\s*\[( |x|X)\]\s*(.*)/))) items.push(cur = { type: 'to_do', text: m[2], checked: m[1] !== ' ' });
    else if ((m = line.match(/^(?:\d{1,3}|[a-z])[.)]\s+(.*)/))) items.push(cur = { type: 'numbered_list_item', text: m[1] });
    else if ((m = line.match(/^[-*•●▪–]\s+(.*)/))) items.push(cur = { type: 'bulleted_list_item', text: m[1] });
    else if ((m = line.match(/^>\s?(.*)/))) { items.push({ type: 'quote', text: m[1] }); cur = null; }
    else if (line.length < 70 && /[A-Z]{3}/.test(line) && line === line.toUpperCase() && !/[.:;,]$/.test(line)) {
      items.push({ type: 'heading_2', text: line.charAt(0) + line.slice(1).toLowerCase() }); cur = null;
    }
    else if (cur) cur.text += (cur.text.endsWith('-') ? '' : ' ') + line;
    else items.push(cur = { type: 'paragraph', text: line });
  }
  return items;
}

async function aiStructure(text, fileName) {
  const system = `You turn source documents into Standard Operating Procedures for FarmBox, a hydroponic greenhouse farm. Field staff read them on phones and tick steps off as a checklist.
Rules:
- Keep ALL information from the source. Never invent facts, quantities, timings or steps. Translate nothing; keep the source language.
- Every action is its own "numbered_list_item": imperative voice, one action per step, short sentences.
- Group into "heading_2" sections such as Purpose, Scope, Materials & tools, Safety, Procedure, Checks, Records (only those the source supports). Use "heading_3" for phases inside the procedure.
- Safety warnings → "callout" with icon "⚠️". Key tips → "callout" with icon "💡". The purpose → a first "callout" with icon "🎯".
- Lists of materials → "bulleted_list_item". Recurring checks → "to_do".
- Use **bold** for key numbers and limits (pH, EC, temperatures, durations, doses).
Reply with JSON only:
{"title": "SOP: …", "icon": "one emoji", "category": one of ${JSON.stringify(CATEGORIES)}, "summary": "one sentence", "blocks": [{"type": "heading_2|heading_3|paragraph|numbered_list_item|bulleted_list_item|to_do|callout", "text": "…", "icon": "emoji, callouts only"}]}`;
  const res = await cfFetch(PROXY + '/groq/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      reasoning_effort: 'low',
      max_completion_tokens: 6000,   // gpt-oss is a reasoning model: reasoning tokens count against this
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: `File: ${fileName}\n\n${text}` }],
    }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res));
  const j = await res.json();
  const choice = j.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('the AI ran out of space — try "Import as-is" or a shorter document');
  let out;
  try { out = JSON.parse(choice?.message?.content || ''); } catch (_) { throw new Error('the AI returned an unreadable answer — try again'); }
  const allowed = new Set(['heading_2', 'heading_3', 'paragraph', 'numbered_list_item', 'bulleted_list_item', 'to_do', 'callout']);
  const blocks = (out.blocks || []).filter(b => allowed.has(b.type) && String(b.text || '').trim())
    .map(b => ({ type: b.type, text: String(b.text).trim(), icon: b.type === 'callout' ? (b.icon || '💡') : '' }));
  if (!blocks.length) throw new Error('the AI returned no content — try again or use "Import as-is"');
  return { title: String(out.title || '').trim(), icon: String(out.icon || '').trim().slice(0, 4),
    category: CATEGORIES.includes(out.category) ? out.category : 'Field Ops', summary: String(out.summary || '').trim(), blocks };
}

function showImport() {
  setHeader('Import SOP', true);
  let src = null;   // { name, items, text, images }
  const fileIn = el('input', { type: 'file', accept: '.docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain', class: 'hidden' });
  const paste = el('textarea', { class: 'input', rows: 6, placeholder: '…or paste the SOP text here' });
  const out = el('div');
  const busy = msg => out.replaceChildren(el('div', { class: 'loading' }, el('span', { class: 'spinner' }), msg));

  const finish = draft => { importDraft = draft; go('#/new'); };
  const asIs = () => finish({
    props: { title: src.title, status: 'Draft', note: '', icon: '' },
    items: src.items,
  });
  const withAi = async () => {
    busy('Structuring with AI… (20–60 s)');
    try {
      const r = await aiStructure(src.text.slice(0, AI_MAX_INPUT_CHARS), src.name);
      const items = r.blocks;
      if (src.images.length) items.push({ type: 'heading_2', text: 'Photos from the original document' },
        ...src.images.map(f => ({ type: 'image', file: f })));
      finish({ props: { title: r.title || src.title, icon: r.icon, category: r.category, note: r.summary, status: 'Draft' }, items });
    } catch (e) {
      console.warn(e);
      drawChoice();
      toast('AI structuring failed: ' + failureReason(e), 'error', 6000);
    }
  };
  const drawChoice = () => {
    const tooLong = src.text.length > AI_MAX_INPUT_CHARS;
    out.replaceChildren(
      el('div', { class: 'lbl', style: 'margin-top:1.25rem' }, `Extracted from ${src.name}`),
      el('div', { class: 'preview-box', text: src.text.slice(0, 4000) + (src.text.length > 4000 ? '\n…' : '') }),
      el('p', { class: 'hint' }, `${src.items.length} blocks · ${src.text.length.toLocaleString()} characters` + (src.images.length ? ` · ${src.images.length} photo(s)` : '')),
      tooLong ? el('div', { class: 'banner warn', style: 'margin-top:0.75rem' },
        `Too long for the free AI tier (${AI_MAX_INPUT_CHARS.toLocaleString()} characters max). Import as-is, or split the document.`) : null,
      el('div', { class: 'btn-row', style: 'margin-top:1rem;flex-direction:column' },
        el('button', { class: 'btn btn-primary btn-lg', disabled: tooLong ? true : null, onclick: withAi }, '✦ Structure with AI'),
        el('button', { class: 'btn btn-lg', onclick: asIs }, 'Import as-is')),
      el('p', { class: 'hint' }, 'Either way you get an editable draft to review before anything is saved to Notion.'));
  };
  const load = async (name, reader) => {
    busy('Reading ' + name + '…');
    try {
      const r = await reader();
      if (!r.items.length) throw new Error('no text found in this file');
      const firstHeading = r.items.find(i => /^heading/.test(i.type))?.text;
      src = { name, title: firstHeading || name.replace(/\.\w+$/, '').replace(/[_-]+/g, ' '), ...r };
      drawChoice();
    } catch (e) {
      console.warn(e);
      out.replaceChildren(el('div', { class: 'banner warn', style: 'margin-top:1rem' }, 'Could not read it: ' + failureReason(e)));
    }
  };
  fileIn.onchange = () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (ext === 'docx') load(f.name, () => readDocx(f));
    else if (ext === 'pdf') load(f.name, () => readPdf(f));
    else if (ext === 'txt' || ext === 'md') load(f.name, async () => { const text = await f.text(); return { items: textToItems(text), text, images: [] }; });
    else toast('Use a .docx, .pdf, .txt or .md file (old .doc files: save as .docx first)', 'error', 5000);
  };

  view(
    el('p', { class: 'hint', style: 'font-size:var(--text-sm);margin-bottom:1rem' },
      'Turn an existing procedure into a draft SOP. Word (.docx) keeps headings, lists and photos; PDFs give text only.'),
    el('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => fileIn.click() }, '{i:file} Choose a file'), fileIn,
    el('div', { style: 'margin-top:1rem' }, paste),
    el('button', { class: 'btn btn-block', style: 'margin-top:0.5rem', onclick: () => {
      const text = paste.value.trim();
      if (!text) { paste.focus(); return; }
      load('pasted text', async () => ({ items: textToItems(text), text, images: [] }));
    } }, 'Use pasted text'),
    out);
}


//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the harvest weight per batch. Edit here, then run: python build.py
  // ── the harvest weight, per batch ─────────────────────────────────────
  // A harvest procedure (sop.attributes.module = 'harvest') on a grouped task:
  // one line per batch (position) with the kg cut and "Last cut" when the
  // batch is cleared. The weights go up with the run as `harvests` and land
  // on the batch through record_harvest — the dashboard calendar shows them.
  // Kept in the phone's database as they are typed, like the trap cards.
  const isHarvestTask = sop => sop && sop.attributes?.module === 'harvest';
  const harvDraftKey = task => 'harvdraft:' + (task.key || task.id);
  async function saveHarvDraft() {
    if (!run?.harvests) return;
    try { await setKV(harvDraftKey(run.task), { saved: Date.now(), rows: [...run.harvests.values()] }); }
    catch (e) { console.warn('harvest draft not saved', e); }
  }
  // The items of a task that is not about crop batches (FarmBox 0075: the assets
  // of a maintenance task): one row each, ticked as it is done; the ticks travel
  // with the run and the server sets last_done on every rule under the task.
  // the places a task covers (maintenance assets…), 0.11.59: one is named in the facts line and done with Finish;
  // several are the same red/green buttons as the zones — Finish asks about any still red
  function itemButtons(task) {
    const items = task.positions.filter(isItem);
    run.items = new Map(items.map(p => [p.id, { id: p.id, done: !!p.done_at, note: p.result?.note || '' }]));
    if (items.length === 1) { run.itemsAuto = true; return null; }
    run.itemsAuto = false;
    const card = el('div', 'fb-step fb-zstep');
    card.append(el('div', 'fb-step-head'));
    card.firstChild.append(el('h4', null, 'Done on'));
    const row = el('div', 'fb-zchips');
    items.forEach(p => {
      const st = run.items.get(p.id);
      const b = el('button', 'fb-zchip', p.label || 'Item');
      const paint = () => { b.classList.toggle('on', st.done); b.setAttribute('aria-pressed', String(st.done)); };
      b.onclick = () => { st.done = !st.done; paint(); };
      paint();
      row.append(b);
    });
    const all = el('button', 'fb-link', 'All done');
    all.onclick = () => { run.items.forEach(st => { st.done = true; }); row.querySelectorAll('.fb-zchip').forEach(b => { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }); };
    card.append(row, all);
    return card;
  }
  function itemBlock(task) {
    run.items = new Map();
    const box = el('div', 'fb-harv');
    box.append(el('div', 'fb-sec', `Items · ${task.positions.filter(isItem).length}`));
    task.positions.filter(isItem).forEach(p => {
      const st = { id: p.id, done: !!p.done_at, note: p.result?.note || '' };
      run.items.set(p.id, st);
      const row = el('div', 'fb-harv-row');
      row.append(el('span', 'fb-pos-name', p.label || 'Item'));
      const b = el('button', 'fb-btn', 'Done');
      b.setAttribute('aria-pressed', String(st.done));
      b.onclick = () => { st.done = !st.done; b.setAttribute('aria-pressed', String(st.done)); };
      row.append(b);
      box.append(row);
    });
    return box;
  }

  // the batches added by their code (0.11.128): their names kept on this phone, for a task opened again — what the
  // server sends back of a run is only { plan_id, kg }
  const HARV_LOTS = 'harv_lots';
  const lotLine = f => [f.lot_code, f.crop, [f.zone, f.position].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  async function harvestBlock(task, detail) {
    let draft = null;
    try { draft = await getKV(harvDraftKey(task)); } catch (e) { /* none */ }
    const prior = new Map((draft?.rows || []).map(x => [x.plan_id, x]));
    (detail?.harvests || []).forEach(h => { if (!prior.has(h.plan_id)) prior.set(h.plan_id, { plan_id: h.plan_id, kg: Number(h.kg) }); });
    run.harvests = new Map();
    const box = el('div', 'fb-traps');
    box.append(el('div', 'fb-sec', 'Harvest weight'));
    // owner 15 Oct 2026: "you enter the batch code (manually or qrcode) and the harvest total kg". One total per task and
    // batch: the server keeps the first one it gets (record_task_harvests), so two people adding up one batch lose one
    box.append(el('div', 'config-hint', 'One person weighs each batch for the whole task: type its total kg. Tick "Last cut" when the batch is cleared — its place is freed for the next one. A batch that is not listed: add it by the code on its label.'));
    const total = el('div', 'fb-harv-total');
    const totalVal = el('span', null, '0 kg');
    total.append(el('span', null, 'All batches'), totalVal);
    const paintTotal = () => {
      const kg = [...run.harvests.values()].reduce((a, x) => a + (num(x.kg) || 0), 0);
      totalVal.textContent = (Math.round(kg * 100) / 100) + ' kg';
    };
    // one line: the batch's name, its total kg, Last cut — the same for a batch of the task and one added by its code
    const lines = el('div');
    box.append(lines);
    const line = (st, name) => {
      run.harvests.set(st.plan_id, st);
      const row = el('div', 'fb-harv-row'); row.dataset.plan = st.plan_id;
      const nameEl = el('span', 'fb-pos-name', name);
      row.append(nameEl);
      const kg = el('input', 'fb-num'); kg.type = 'number'; kg.min = '0'; kg.step = '0.1'; kg.placeholder = 'Total kg';
      kg.setAttribute('aria-label', 'Total kilograms from ' + (st.position_code || name));
      if (st.kg != null) kg.value = String(st.kg);
      kg.oninput = () => { const v = parseFloat(kg.value); st.kg = isNaN(v) ? null : v; paintTotal(); saveHarvDraft(); };
      const last = el('button', 'fb-btn', 'Last cut');
      last.setAttribute('aria-pressed', String(!!st.final));
      last.onclick = () => { st.final = !st.final; last.setAttribute('aria-pressed', String(st.final)); saveHarvDraft(); };
      row.append(kg, el('span', 'fb-chip', 'kg'), last);
      lines.append(row);
      return { kg, nameEl };
    };
    task.positions.filter(p => p.plan_id && (!p.done || detail)).forEach(p => {
      const st = { plan_id: p.plan_id, position_code: p.label || p.position_code || '', kg: null, final: false,
                   ...(prior.get(p.plan_id) || {}) };
      line(st, [st.position_code, p.crop_name || task.crop_name].filter(Boolean).join(' · '));
    });
    // the batches added by their code before: in the draft (the task closed and opened again), or in what was sent (a
    // done task opened to change it or to add to it). Only a batch the task does not list — a listed one keeps its own
    // line, or none once it is done, exactly as before.
    const listed = new Set(task.positions.map(p => p.plan_id).filter(Boolean));
    let names = {};
    try { names = (await getKV(HARV_LOTS)) || {}; } catch (e) { names = {}; }
    for (const [id, x] of prior) {
      if (!id || run.harvests.has(id) || listed.has(id)) continue;
      const known = names[id] || {};
      const lab = x.label || known.label || '';
      const made = line({ plan_id: id, position_code: x.position_code || known.position_code || '', kg: null, final: false,
                          ...x, added: true, label: lab }, lab || 'A batch added by its code');
      // added on another phone: its name is asked of the farm when there is signal; without, the line works all the same
      if (!lab && navigator.onLine && session) {
        rpcLot('lot_card', { p_plan: id }).then(c => {
          const f = { lot_code: c?.lot_code, crop: c?.crop?.name, zone: c?.place?.zone, position: c?.place?.position };
          const st = run?.harvests?.get(id);
          if (st && lotLine(f)) { st.label = lotLine(f); if (!st.position_code) st.position_code = f.position || f.lot_code || ''; made.nameEl.textContent = st.label; }
        }).catch(() => { /* the line keeps its plain name */ });
      }
    }

    // ── add a batch by its code (0.11.128): typed, or read off its label with the Tasks scanner's reader ──
    // The code is looked up on the server (lot_find, or lot_card for a label's link), so it needs signal; the lines
    // above work offline as always. Only a batch of this task's own unit is added: the server takes the weight of a
    // batch of its farm only, and another unit's would be dropped without a word.
    const NO_SIGNAL = 'No signal: the code cannot be looked up — use a line above, or add it once you have signal';
    const add = el('form', 'fb-harv-row fb-harv-add');
    const code = el('input', 'fb-num'); code.type = 'text'; code.placeholder = '26-0002';
    code.autocomplete = 'off'; code.setAttribute('autocapitalize', 'characters'); code.spellcheck = false;
    code.setAttribute('aria-label', 'The lot code on the batch label');
    const addBtn = el('button', 'fb-btn', 'Add'); addBtn.type = 'submit';
    const scanBtn = el('button', 'fb-btn', '{i:qr} Scan'); scanBtn.type = 'button';
    add.append(el('span', 'fb-pos-name', 'Add a batch by its code'), code, addBtn, scanBtn);
    const unitName = async id => {
      try { const u = ((await getKV('sisters')) || []).find(x => x.id === id); if (u) return u.name || null; } catch (e) { /* below */ }
      try { const f = farm || await getKV('farm'); return f && f.id === id ? f.name || null : null; } catch (e) { return null; }
    };
    const LOT_WORD = { proposed: 'proposed', validated: 'planned', active: 'growing', harvested: 'harvested', cancelled: 'cancelled' };
    const pickLot = list => new Promise(res => {
      const sheet = el('div', 'fb-sheet'), card = el('div', 'fb-sheet-card');
      let over = false;
      const done = v => { if (over) return; over = true; sheet.remove(); res(v); };
      card.append(el('h3', null, 'Which batch?'), el('div', 'fb-meta', `${list.length} batches answer to this code`));
      list.forEach(f => {
        const b = el('button', 'fb-btn', lotLine(f) + (LOT_WORD[f.status] ? ' · ' + LOT_WORD[f.status] : ''));
        b.type = 'button'; b.style.cssText = 'display:block;width:100%;text-align:left;margin:6px 0';
        b.onclick = () => done(f);
        card.append(b);
      });
      const no = el('button', 'fb-btn', 'Cancel'); no.type = 'button'; no.onclick = () => done(null);
      const acts = el('div', 'fb-actions'); acts.append(no); card.append(acts);
      sheet.append(card);
      sheet._close = () => done(null);              // the phone's Back closes it (the popstate handler)
      sheet.onclick = e => { if (e.target === sheet) done(null); };
      document.body.append(sheet);
    });
    const take = f => {
      if (run.harvests.has(f.id)) {
        // already here, listed or added before: its kg field, not a second line
        const inp = lines.querySelector(`[data-plan="${f.id}"] input`);
        if (inp) { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); inp.focus(); }
        showToast(`${f.lot_code || 'This batch'} is already in this task — type its total kg there`, 'info');
        return;
      }
      // a batch this task lists whose line is not shown (a done part of an older grouped task): it was weighed there, and
      // a second line would record it once more on another part of the task
      if (listed.has(f.id)) { showToast('This batch is already weighed in this task', 'info'); return; }
      const lab = lotLine(f);
      const made = line({ plan_id: f.id, position_code: f.position || f.lot_code || '', kg: null, final: false, added: true, label: lab }, lab);
      code.value = '';
      paintTotal(); saveHarvDraft();
      // its name kept on this phone for a later opening of the task (a month, then it goes)
      getKV(HARV_LOTS).then(m => { m = m || {}; m[f.id] = { label: lab, position_code: f.position || f.lot_code || '', at: Date.now() };
        for (const k of Object.keys(m)) if (!(m[k] && m[k].at > Date.now() - 31 * 864e5)) delete m[k];
        return setKV(HARV_LOTS, m); }).catch(() => { /* the draft has the name anyway */ });
      made.kg.scrollIntoView({ behavior: 'smooth', block: 'center' }); made.kg.focus();
    };
    let busy = false;
    const addByCode = async raw => {
      const s = String(raw || '').trim();
      if (!s || busy) return;
      if (!navigator.onLine) { showToast(NO_SIGNAL, 'error'); return; }
      const R = run;                                 // the checklist this box belongs to: nothing is added to another one
      busy = true; addBtn.disabled = scanBtn.disabled = true;
      try {
        let found = [];
        const m = LOT_RE.exec(s);
        if (m) {
          // a label's link names the batch itself
          const c = await rpcLot('lot_card', { p_plan: m[1] });
          found = [{ id: m[1], lot_code: c?.lot_code, farm_id: c?.farm_id, farm: c?.farm, crop: c?.crop?.name, zone: c?.place?.zone, position: c?.place?.position, status: c?.status }];
        } else if (/^https?:\/\//i.test(s)) { showToast('Not a FarmBox batch label — nothing added', 'error'); return; }
        else found = (await rpcLot('lot_find', { p_code: s })) || [];
        if (!found.length) { showToast(`No batch of your farm has the lot code ${s} — nothing added`, 'error'); return; }
        // this task's unit: by the farm's id (lot_find carries it since FarmBox 0237, lot_card always did); a row without
        // it (an older server) by the unit's name, as before
        const unit = await unitName(task.farm_id);
        if (found.some(f => !f.farm_id) && !unit) { showToast('This phone does not know the task\'s unit yet — sync, then add the batch', 'error'); return; }
        const here = found.filter(f => f.farm_id ? f.farm_id === task.farm_id : f.farm === unit);
        if (!here.length) {
          const where = [...new Set(found.map(f => f.farm).filter(n => n && n !== unit))].join(' and ');
          showToast(`${s} is a batch of ${where || 'another unit'}, not of ${unit || 'this task\'s unit'} — nothing added. Weigh it in a harvest task of its own unit.`, 'error');
          return;
        }
        // only a batch that is planned or growing: a cleared or cancelled one would take the weight without a word
        const open = here.filter(f => f.status === 'validated' || f.status === 'active');
        if (!open.length) {
          const x = here[0];
          const word = { harvested: 'is a batch already cleared (harvested)', cancelled: 'is a cancelled batch', proposed: 'is a batch not planted yet' }[x.status]
            || `is not a growing batch (${x.status || 'no state'})`;
          showToast(`${x.lot_code || s} ${word} — nothing added`, 'error');
          return;
        }
        const f = open.length === 1 ? open[0] : await pickLot(open);
        if (f && run === R && R && R.harvests) take(f);
      } catch (e) {
        const why = String(e.message || e);
        showToast(errKind(e) === 'net' ? NO_SIGNAL
          : /42501|not a member/.test(why) ? 'This batch belongs to a farm you are not part of — nothing added'
          : /P0002|no such batch/.test(why) ? 'No such batch: it may have been removed — nothing added'
          : 'Could not look it up — ' + why.replace(/^\d+ /, '').slice(0, 80), 'error');
      } finally { busy = false; addBtn.disabled = scanBtn.disabled = false; }
    };
    add.onsubmit = e => { e.preventDefault(); addByCode(code.value); };
    scanBtn.onclick = async () => {
      if (busy) return;
      if (!navigator.onLine) { showToast(NO_SIGNAL, 'error'); return; }
      const v = await readLotLabel({ go: 'Add', prompt: 'Lot code of the batch (for example 26-0002)' });
      if (v) addByCode(v);
    };
    box.append(add, total);
    paintTotal();
    return box;
  }


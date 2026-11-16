//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- one step of a checklist. Edit here, then run: python build.py
  // once per item (FarmBox 0078: a sump check answered for each sump).
  const stepKey = (s, item) => item ? `${item.id}|${s.seq}` : s.seq;
  function stepCard(s, item) {
    const key = stepKey(s, item);
    const card = el('div', 'fb-step'); card.dataset.seq = s.seq; card.dataset.key = String(key);
    if (s.section) card.append(el('div', 'fb-sec', s.section));
    const head = el('div', 'fb-step-head');
    head.append(el('h4', null, s.title));
    const hasDetail = s.instruction || s.expected_result || s.action_plan;
    if (hasDetail) {
      const more = el('button', 'fb-link', 'Details');
      more.setAttribute('aria-expanded', 'false');
      more.onclick = () => {
        const open = card.classList.toggle('open');
        more.setAttribute('aria-expanded', String(open));
      };
      head.append(more);
    }
    card.append(head);

    // the exhaustive version, folded under Details
    if (hasDetail) {
      const det = el('div', 'fb-detail');
      if (s.instruction) det.append(el('div', 'fb-inst', s.instruction));
      if (s.expected_result) { const x = el('div', 'fb-expect'); x.append(el('b', null, 'Expected: ')); x.append(document.createTextNode(s.expected_result)); det.append(x); }
      if (s.action_plan) { const x = el('div', 'fb-expect'); x.append(el('b', null, 'If not OK: ')); x.append(document.createTextNode(s.action_plan)); det.append(x); }
      card.append(det);
    }

    const set = (result, extra) => {
      run.answers.set(key, { seq: s.seq, step_id: s.id, result, ...(item ? { item_id: item.id } : {}),
        min_value: s.min_value, max_value: s.max_value, ...extra });
      card.classList.toggle('answered', result === 'ok');
      card.classList.toggle('bad', result === 'nok');
      plan.classList.toggle('hidden', result !== 'nok' || !s.action_plan);
      saveRunDraft();
    };

    const acts = el('div', 'fb-actions');
    if (s.step_type === 'measure') {
      const input = el('input', 'fb-num'); input.type = 'text'; input.inputMode = 'decimal';
      input.placeholder = s.value_unit || 'value';
      input.setAttribute('aria-label', s.title);
      const range = (s.min_value != null || s.max_value != null)
        ? `${s.min_value ?? ''}–${s.max_value ?? ''} ${s.value_unit || ''}`.trim()
        : (s.target_source !== 'fixed' ? 'target comes from the crop' : '');
      input.oninput = () => {
        const v = parseFloat(String(input.value).replace(',', '.'));
        if (isNaN(v)) { run.answers.delete(key); card.classList.remove('answered', 'bad'); saveRunDraft(); return; }
        const bad = (s.min_value != null && v < s.min_value) || (s.max_value != null && v > s.max_value);
        set(bad ? 'nok' : 'ok', { value_num: v });
      };
      acts.append(input);
      if (range) acts.append(el('span', 'fb-chip', range));
    } else if (s.step_type === 'record') {
      const input = el('input', 'fb-num'); input.style.width = '100%'; input.type = 'text';
      input.placeholder = s.expected_result || 'what you saw';
      input.setAttribute('aria-label', s.title);
      input.oninput = () => { if (input.value.trim()) set('ok', { value_text: input.value.trim() });
                              else { run.answers.delete(key); card.classList.remove('answered'); saveRunDraft(); } };
      acts.append(input);
    } else {
      // a tick (0.11.57): red until tapped green; still red at Finish = sent as not OK, with the note saying why
      card.classList.add('todo');
      const tog = el('button', 'fb-tick', s.step_type === 'check' ? 'Tap when OK' : 'Tap when done');
      const paintTog = on => {
        tog.classList.toggle('on', on); card.classList.toggle('todo', !on);
        tog.textContent = on ? (s.step_type === 'check' ? '✓ OK' : '✓ Done') : (s.step_type === 'check' ? 'Tap when OK' : 'Tap when done');
      };
      tog.onclick = () => {
        const on = !tog.classList.contains('on');
        if (on) set('ok', {}); else { run.answers.delete(key); card.classList.remove('answered', 'bad'); saveRunDraft(); }
        paintTog(on);
      };
      card._setOk = on => { if (on) set('ok', {}); paintTog(on); };   // the draft and an edit come back through here
      acts.append(tog);
    }
    card.append(acts);

    // evidence
    if (/photo|video/.test(s.evidence || '')) {
      const shot = el('div', 'fb-shot');
      const pick = el('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.style.display = 'none';   // the gallery, when the camera is not there
      const btn = el('button', 'fb-btn', '{i:camera} Photo');
      const addStepPhoto = async f => {
        try {
          const big = await shrinkPhoto(f, FULL_PX, null);
          const b = await new Promise(res => big.canvas.toBlob(res, 'image/jpeg', FULL_Q));
          big.canvas.width = big.canvas.height = 0;
          card._addPhoto(b || f);
        } catch (e) { card._addPhoto(f); }
        saveRunDraft();
      };
      btn.onclick = async () => {
        let r = null;
        try { r = await takeTrapPhoto('', s.title, 'step'); } catch (e) { r = null; }
        if (r === 'cancel') return;
        if (r) addStepPhoto(r); else pick.click();
      };
      // one way in for a new photo and a restored one (the draft)
      card._addPhoto = f => {
        const list = run.media.get(key) || [];
        list.push(f); run.media.set(key, list);
        const img = el('img'); img.src = URL.createObjectURL(f); img.alt = 'evidence';
        img.onload = () => URL.revokeObjectURL(img.src);
        // a wrong photo can go: the ✕ in its corner (0.11.86; it was a tap on the photo)
        shot.insertBefore(picX(img, pic => {
          const l = run.media.get(key) || [], i = l.indexOf(f);
          if (i >= 0) l.splice(i, 1);
          pic.remove();
          if (!l.length && !shot.querySelector('.fb-chip')) shot.append(el('span', 'fb-chip', 'required'));
          saveRunDraft();
        }), btn);
        shot.querySelector('.fb-chip')?.remove();
      };
      pick.onchange = () => { const f = pick.files[0]; pick.value = ''; if (f) addStepPhoto(f); };
      shot.append(btn, pick);
      shot.append(el('span', 'fb-chip', 'required'));
      card.append(shot);
    }

    const plan = el('div', 'fb-plan hidden');
    if (s.action_plan) plan.textContent = s.action_plan;
    card.append(plan);
    return card;
  }

  // a tick step: check or action, nothing to type or photograph by rule
  const isTick = s => (s.step_type === 'check' || s.step_type === 'action') && !/photo|video/.test(s.evidence || '');
  // a zone's short name on its button: Zone 4-1 → 4.1, Bay 2A → 2A
  const zoneShort = l => String(l || '?').replace(/^(zone|bay)\s+/i, '').replace(/^(\d+)-(\d+)$/, '$1.$2');
  // one tick step over the zones: the title and its details once, then a button per zone
  function zoneStepCard(s, items) {
    const card = el('div', 'fb-step fb-zstep');
    card.dataset.seq = s.seq;
    const head = el('div', 'fb-step-head');
    head.append(el('h4', null, s.title));
    const hasDetail = s.instruction || s.expected_result || s.action_plan;
    if (hasDetail) {
      const more = el('button', 'fb-link', 'Details'); more.setAttribute('aria-expanded', 'false');
      more.onclick = () => { const open = card.classList.toggle('open'); more.setAttribute('aria-expanded', String(open)); };
      head.append(more);
    }
    card.append(head);
    if (hasDetail) {
      const det = el('div', 'fb-detail');
      if (s.instruction) det.append(el('div', 'fb-inst', s.instruction));
      if (s.expected_result) { const x = el('div', 'fb-expect'); x.append(el('b', null, 'Expected: ')); x.append(document.createTextNode(s.expected_result)); det.append(x); }
      if (s.action_plan) { const x = el('div', 'fb-expect'); x.append(el('b', null, 'If not OK: ')); x.append(document.createTextNode(s.action_plan)); det.append(x); }
      card.append(det);
    }
    const row = el('div', 'fb-zchips');
    items.forEach(it => {
      const key = stepKey(s, it);
      const b = el('button', 'fb-zchip', zoneShort(it.label));
      b.dataset.key = String(key); b.title = it.label || '';
      const paint = on => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
      b._setOk = on => {
        if (on) run.answers.set(key, { seq: s.seq, step_id: s.id, result: 'ok', item_id: it.id });
        else run.answers.delete(key);
        paint(on); saveRunDraft();
      };
      b.onclick = () => b._setOk(!b.classList.contains('on'));
      paint(false);
      row.append(b);
    });
    const all = el('button', 'fb-link', 'All OK');
    all.onclick = () => row.querySelectorAll('.fb-zchip').forEach(b => b._setOk(true));
    card.append(row, all);
    return card;
  }


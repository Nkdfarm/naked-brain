//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- scouting and trap procedures, the old rounds' stand-ins, a photo's parts and risk. Edit here, then run: python build.py
  // the procedure tests: the old sticky trap round (ipm-trap-round, module 'ipm_traps') and the daily scouting (FarmBox 0096)
  const isTrapRound = sop => sop && (sop.attributes?.module === 'ipm_traps' || sop.slug === 'ipm-trap-round');
  const isScouting = sop => sop && sop.attributes?.module === 'scouting';
  // the kind of insect is named in the console, by the AI on request or by a person (0.11.25)

  // ── the rounds of before, removed (17 Nov 2026) ───────────────────────────
  // The sticky trap round (procedure ipm-trap-round, archived; its last task was on 28 Sep 2026) and the scouting round
  // in sections (scoutSections, its Finish, the automatic sizing, the trap-code reader) are gone: since Digital scouting
  // (0.11.132, 21 Oct 2026) a zone's scouting opens Digital scouting, no extra scouting is made any more, and a phone
  // keeps a week of tasks — none of the old kind is planned or open. What still uses their parts stays: the risk menu,
  // the parts lists, the scale card, measuring by hand, the camera, counting insects. A round's photos still on a phone
  // (scout2: and trapdraft: drafts) are sent or removed by "Send everything now", which reads the drafts on its own.
  // Should an old-style scouting still be opened (a task of that kind arriving after all), it does not open the round:
  // it says so and goes to Digital scouting, and the checklist's own Finish is never reached.
  async function scoutSections(task, sop, detail) {
    const R = run;
    let held = 0;
    try { held = ((await getKV(scDraftKey(task)))?.photos || []).length; } catch (e) { held = 0; }
    setTimeout(async () => {
      if (run !== R) return;
      try { await setKV('run_open', null); } catch (e) { /* not remembered anyway */ }
      try { await leaveRun(); } catch (e) { /* the timer stays as it was */ }
      if (run === R) run = null;
      try { await backFromRun(); } catch (e) { /* the list is drawn at the next screen */ }   // under Digital scouting, should it not open
      showToast('That scouting is from before Digital scouting (21 Oct 2026) and does not open any more — scouting is done here now.'
        + (held ? ` Its ${held} photo${held === 1 ? '' : 's'} still on this phone: Send everything now sends ${held === 1 ? 'it' : 'them'}.` : ''), 'info');
      openDigital({ day: todayISO() });
    }, 0);
    return el('div', 'config-hint', 'Opening Digital scouting…');
  }
  async function finishScouting() { /* run.sc is no longer set by anything: nothing to finish */ }
  const howItWorks = () => document.createDocumentFragment();
  async function trapRound(task, sop, item = null) {
    const box = el('div', 'fb-traps');
    box.append(el('div', 'config-hint', 'The sticky traps are read in Digital scouting now (the scouting task of the day) — this checklist no longer takes trap photos.'));
    return box;
  }
  // a photo's parts (Digital scouting's Add photo, its notes): what it shows, and what a growth photo measures
  const PARTS = [['leaf', 'Leaf'], ['fruit', 'Fruit'], ['root', 'Root'], ['stem', 'Stem'], ['whole', 'Whole plant'], ['other', 'Other']];
  const GROWTH_PARTS = [['fruit', 'Fruit'], ['head', 'Head'], ['leaf', 'Leaf'], ['whole', 'Whole plant']];
  // crops measured as a head seen from above (0.11.79): salads, leafy greens, herbs
  const HEAD_RE = /lettuce|butterhead|romaine|iceberg|\bcos\b|salad|spinach|rocket|arugula|kale|chard|basil|parsley|coriander|cilantro|mint|herb|pak ?choi|bok ?choy|mizuna|endive|radicchio|watercress|m[aâ]che|chive|dill|oregano|thyme/i;
  const MEASURE_WHAT = [['diameter', 'Diameter'], ['length', 'Length'], ['width', 'Width'], ['height', 'Height']];
  // the risk of a plant photo's comment (0.11.130, owner 15 Oct 2026: a colour code by gravity and urgency, on the AI's
  // scale — green no risk, yellow low risk, red high risk; no blue, no grey). Only with a comment; a comment whose risk
  // was never chosen is yellow. FarmBox 0239 keeps it on the observation (note_level) and gives it back in run_detail.
  const NOTE_LEVELS = [['green', 'Green · no risk'], ['yellow', 'Yellow · low risk'], ['red', 'Red · high risk']];
  const noteLevelOf = o => String(o?.note || '').trim()
    ? (NOTE_LEVELS.some(([v]) => v === o.note_level) ? o.note_level : 'yellow') : null;
  // the Risk menu beside a comment — a plant photo's (0.11.130) and a trap's (0.11.131, owner: "add the risk color in the
  // traps as well"), one menu so both look and behave the same: dimmed while the comment is empty, yellow once typing
  // starts (the person changes it if needed), cleared with the comment so the next one starts on yellow again, the
  // "Risk" placeholder never picked. Writes o.note and o.note_level, then save().
  function riskMenu(o, note, save) {
    const risk = el('select', 'fb-note-risk'); risk.setAttribute('aria-label', 'Risk of what the comment says');
    const r0 = el('option', null, 'Risk'); r0.value = ''; r0.disabled = true; r0.hidden = true; risk.append(r0);
    NOTE_LEVELS.forEach(([v, l]) => { const x = el('option', null, l); x.value = v; risk.append(x); });
    const paint = () => { const lv = noteLevelOf(o); risk.disabled = !lv; risk.value = lv || ''; risk.dataset.level = lv || ''; };
    risk.onchange = () => { o.note_level = risk.value || null; paint(); save(); };
    note.oninput = () => { o.note = note.value; if (!String(o.note).trim()) o.note_level = null; else if (!o.note_level) o.note_level = 'yellow'; paint(); save(); };
    paint();
    return risk;
  }
  const scDraftKey = task => 'scout2:' + (task.key || task.id);
  let scDraftTimer = null;
  function saveScDraft() {
    if (!run?.sc) return;
    run.touched = true;
    clearTimeout(scDraftTimer);
    const r = run;
    scDraftTimer = setTimeout(async () => {
      try {
        await setKV(scDraftKey(r.task), { saved: Date.now(), cid: r.sc.cid || null, tab: r.sc.tab, outcome: r.sc.outcome, outcomeNote: r.sc.outcomeNote, verdict: r.sc.verdict,
          lastPos: r.sc.lastPos, extra: [...r.sc.extra], status: [...r.sc.status], noTraps: !!r.sc.noTraps, photos: [...r.sc.photos.values()] });
      } catch (e) { console.warn('scouting draft not saved', e); }
    }, 250);
  }
  const parsePos = code => {
    const m = /^([0-9]+)([A-Z]+)([0-9]+(?:[.,][0-9]+)?)?$/.exec(String(code || '').toUpperCase().replace(/[\s\-_.·/]/g, ''));
    return m ? { n: m[1], row: m[2], m: m[3] ? m[3].replace(',', '.') : null } : null;
  };

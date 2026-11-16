//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- old scouting: the sticky trap round, four sections. Edit here, then run: python build.py
  // ── IPM: the sticky trap round ──────────────────────────────────────────
  // The procedure ipm-trap-round (sop.attributes.module = 'ipm_traps') asks
  // for every trap of the zone: a photo with the code in the frame, a count
  // (the phone counts the dark specks on the yellow card; the person corrects),
  // what the insects mostly are, whether the trap was replaced. The cards are
  // the evidence for the checklist's photo step; the readings go up with the
  // run as `traps`.
  const isTrapRound = sop => sop && (sop.attributes?.module === 'ipm_traps' || sop.slug === 'ipm-trap-round');
  // the daily scouting (FarmBox 0096): the traps folded, count or skip, and plant photos
  const isScouting = sop => sop && sop.attributes?.module === 'scouting';
  // the kind of insect is named in the console, by the AI on request or by a person (0.11.25)

  async function trapRound(task, sop, item = null) {
    // one zone: the task's own, or (a grouped round, FarmBox 0095) the item's
    const zoneId = item ? item.area_zone_id : task.zone_id;
    const systemId = item ? item.area_system_id : task.system_id;
    const traps = (await all('traps')).filter(t => t.active !== false
      && ((zoneId && t.zone_id === zoneId) || (t.system_id && t.system_id === systemId)))
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    const th = (await getKV('ipm_threshold')) || { watch: 25, over: 50 };
    if (!run.traps) { run.traps = new Map(); run.trapList = []; run.trapsByItem = new Map(); }
    const seen = new Set(run.trapList.map(x => x.id));
    run.trapList.push(...traps.filter(t => !seen.has(t.id)));
    if (item) run.trapsByItem.set(item.id, traps);
    let draft = null;
    try { draft = await getKV(trapDraftKey(task)); } catch (e) { /* no draft */ }
    const prior = new Map((draft?.traps || []).map(x => [x.trap_id, x]));
    const box = el('div', 'fb-traps');
    box.append(el('div', 'fb-sec', 'Sticky traps in this zone'));
    if (!traps.length) {
      box.append(el('div', 'config-hint', 'No sticky trap is registered for this zone. Add them on the console (IPM page) and sync; the round can still be finished without readings.'));
      return box;
    }
    box.append(el('div', 'config-hint', `${traps.length} trap${traps.length > 1 ? 's' : ''} — photograph each one square-on with its code in the picture, then type the number of insects you count on it.`));
    const kept = traps.filter(t => prior.get(t.id)?.photo_data).length;
    if (kept) box.append(el('div', 'config-hint', `${kept} photo${kept > 1 ? 's' : ''} from before the app was closed ${kept > 1 ? 'are' : 'is'} back — carry on from there.`));
    traps.forEach(t => box.append(trapCard(t, th, prior.get(t.id))));
    return box;
  }

  // ── the daily scouting in four sections (FarmBox 0141, 0.11.40) ─────────
  // Traps · Plant health · Growth · Finish, filled in any order. A trap photo:
  // the code read off the card (matched to this unit's traps), the phone's count
  // and its colour — new insects a week against the farm's watch / over — a note
  // and Replaced. A plant-health or growth photo: the position as written (3B8 =
  // zone or bay 3, row B, 8 m from the corridor) or the GPS; a growth photo finds
  // the printed scale card (a magenta 5 cm square) and sizes are measured on it.
  // Any photo may ask the AI for a note — only when its button is pressed.
  // Finish: OK, or not OK with a note. Everything is kept in the phone's
  // database as it happens (KV scout2:<task>) and the full photos upload after
  // the run, over the connection chosen in Settings.
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
  const SC_TABS = [['trap', 'Traps'], ['health', 'Health'], ['growth', 'Growth']];
  const SIDES = [['yellow', 'Yellow side'], ['blue', 'Blue side']];              // the two faces of every trap card (0149)   // OK / Not OK sit above Finish (0.11.43)
  // a picture with its ✕ in the top right corner (0.11.86, owner 2 Oct 2026: "the possibility to remove the taken picture
  // by clicking the top right corner of all pictures with a small x"): asks once, then remove(pic)
  function picX(img, remove, ask = 'Remove this photo?') {
    const pic = el('div', 'fb-pic');
    const x = el('button', 'fb-pic-x', '✕'); x.type = 'button';
    x.setAttribute('aria-label', 'Remove this photo'); x.title = 'Remove this photo';
    x.onclick = e => { e.preventDefault(); e.stopPropagation(); if (!confirm(ask)) return; remove(pic); };
    pic.append(img, x);
    return pic;
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
  const posWords = code => { const p = parsePos(code); return p ? `${p.n} · row ${p.row}${p.m != null ? ` · ${p.m} m` : ''}` : ''; };
  const placed = p => !!parsePos(p.pos_code) || !!p.gps;

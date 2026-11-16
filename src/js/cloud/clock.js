//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- clock in / out. Edit here, then run: python build.py
  // ── the clock (FarmBox 0134): clock in when you arrive, out when you leave ──
  // The state shows at once; the outbox sends it when there is signal, with its
  // own id, so sending it twice never counts twice.
  const hm = m => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;
  async function paintClock(me) {
    const box = $('clock'); if (!box) return;
    box.textContent = ''; box.className = 'fb-clock';
    if (!me) return;                           // not one of the farm's people: no clock
    const c = (await getKV('clock')) || {};
    const open = c.open;
    const since = open ? new Date(open.clock_in) : null;
    const today = Number(c.today_minutes || 0) + (open && c.at ? (Date.now() - c.at) / 60000 : 0);
    if (open) box.classList.add('on');
    const text = el('div', 'fb-clock-text');
    text.append(el('b', null, open ? `Clocked in since ${since.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not clocked in'),
                el('span', null, today >= 1 ? `${hm(today)} today` : open ? 'Just started' : 'Clock in when you start work'));
    const btn = el('button', 'btn btn-sm ' + (open ? '' : 'btn-primary'), open ? 'Clock out' : 'Clock in');
    btn.onclick = async () => {
      const action = open ? 'out' : 'in';
      const at = new Date().toISOString();
      await setKV('clock', { open: action === 'in' ? { clock_in: at } : null, today_minutes: today, at: Date.now() });
      await queue([{ __clock: true, client_run_id: `clk-${action}-${Date.now()}`, action, at }]);
      showToast(action === 'in' ? 'Clocked in' : `Clocked out · ${hm(today)} today`, 'success');
      paintClock(me);
    };
    box.append(el('span', 'fb-clock-dot'), text, btn);
  }

  // The family is the card's colour, not a word: Agriculture green, Maintenance
  // amber, Office grey. The line under the title says where instead.
  const famClass = f => ' fam-' + String(f || 'agriculture').toLowerCase();

  function taskCard(g, late) {
    const b = el('button', 'fb-card' + famClass(g.family) + (isClosed(g.status) ? ' done' : ''));
    const body = el('div', 'fb-body');
    body.append(el('div', 'fb-name', g.title));
    const meta = el('div', 'fb-meta');
    const zn = zonesOf(g).size;
    const zl = zonesLine(g);
    const where = zl || g.zone_name || g.area || (zn > 1 ? `${zn} zones` : null);
    if (where) meta.append(el('span', 'fb-where', where));
    // what the task asks for, just before its time: none said = it can be swiped done (0.11.29)
    const bits = zl ? (g.extra ? [] : [fmtMin(g.minutes)]) : qtyBits(g);        // the zones already say the places (0.11.60)
    const k = isClosed(g.status) ? 0 : inputsOf(g);
    if (k) bits.splice(bits.length && !(g.extra || g.extraZone) ? bits.length - 1 : bits.length, 0, typeof k === 'string' ? k : `${k} input${k > 1 ? 's' : ''}`);
    if (bits.length) meta.append(document.createTextNode((where ? ' · ' : '') + bits.join(' · ')));
    // the responsible (0.11.96): the people the task is given to, or "nobody yet" while it is open
    const resp = whoOf(g);
    if (resp.length || !isClosed(g.status)) {
      if (meta.textContent) meta.append(document.createTextNode(' · '));
      // their faces first (0.11.114): the picture, or the figure in the person's own colour
      const faces = [...new Set(whoIds(g))].filter(id => WORKERS.has(id)).slice(0, 3);
      const w = el('span', 'fb-resp' + (resp.length ? '' : ' none'), resp.length ? (faces.length ? '' : '{i:user} ') + names(resp) : 'nobody yet');
      if (resp.length && faces.length) w.prepend(...faces.map(faceOf));
      w.title = resp.length ? 'Responsible: ' + resp.join(', ') : 'Nobody is responsible for this task yet';
      meta.append(w);
    }
    body.append(meta);
    // a zone's daily scouting (0.11.132): a reminder of what is missing, from Digital scouting
    if (DG_UNSENT.has(g.key)) {
      // a round started on this phone before Digital scouting, with photos never sent (0.11.132)
      const un = el('div', 'fb-meta dg-missline', 'An earlier round on this phone was not sent ');
      const go = el('span', 'fb-link', 'Send it'); go.setAttribute('role', 'button');
      go.addEventListener('pointerdown', e => e.stopPropagation());
      go.onclick = e => { e.stopPropagation(); sendAllNow(); };
      un.append(go);
      body.append(un);
    }
    const dgc = !isClosed(g.status) && (g.members || []).length === 1 ? dgCountsFor(g.members[0].id) : null;
    if (dgc) {
      body.append(dgCounterLine(dgc));
      const miss = dgMissing(dgc).text;
      if (miss) body.append(el('div', 'fb-meta dg-missline', miss));
    }
    b.append(body);
    // only the states worth a word get one; "Open" is what a card already is — and the time worked (0.11.56)
    const chip = timeChip(g, late);
    if (chip) b.append(chip);
    // feedback on this task (0.11.85): its own tap — not the card's, and not the start of a swipe
    if (FEEDBACK_ON && !g.hub) {
      const f = el('span', 'fb-fbk', '{i:message}');
      f.setAttribute('role', 'button'); f.setAttribute('aria-label', 'Feedback on this task'); f.title = 'Feedback on this task';
      f.addEventListener('pointerdown', e => e.stopPropagation());
      f.onclick = e => { e.stopPropagation(); openFeedback(g); };
      b.append(f);
    }
    b.onclick = () => { if (b.dataset.swiped) { delete b.dataset.swiped; return; } openTask(g.key); };
    return swipeable(b, g);
  }


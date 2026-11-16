//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- + Extra scouting and the day's scouting hub. Edit here, then run: python build.py
  // ── + Extra scouting (0.11.94, FarmBox 0204; owner 4 Oct 2026: "everyone could start an additional scouting … a task
  // with all zones, the user selects the zone … without minimum pictures … open for all the day") ──
  // The task is made here, with ids of its own, so it works without signal: the server makes the same task when it is
  // asked (start_extra_scouting) or when the first photos arrive. One a person a day and unit.
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  // what an extra needs: the scouting procedure and the zones of each unit, from the zone lines of its planned scoutings
  async function extraUnits() {
    const today = todayISO(), me = await getKV('me');
    const tasks = await all('tasks'), sops = await all('sops'), pos = await all('positions');
    const sop = sops.find(isScouting);
    if (!sop) { showToast('No scouting on this phone yet — sync when there is signal', 'error'); return null; }
    const byFarm = new Map();
    tasks.filter(t => t.sop_id === sop.id && String(t.generation_key || '').startsWith('routine:scouting:'))
      .sort((a, b) => (a.planned_date < b.planned_date ? 1 : -1))
      .forEach(t => pos.filter(p => p.task_id === t.id && p.kind === 'area' && p.ref_id).forEach(p => {
        if (!byFarm.has(t.farm_id)) byFarm.set(t.farm_id, { zones: new Map(), sample: t });
        const u = byFarm.get(t.farm_id); if (!u.zones.has(p.ref_id)) u.zones.set(p.ref_id, p);
      }));
    if (!byFarm.size) { showToast('No zones known on this phone yet — sync when there is signal', 'error'); return null; }
    return { today, me, tasks, pos, sop, byFarm, mineKey: `extra:scouting:${me || 'me'}:${today}` };
  }
  // this person's extra of today at a unit: found, or made here (the server makes the same one when asked, or from its first photos)
  async function ensureExtra(farmId, X) {
    let t = X.tasks.find(x => x.farm_id === farmId && x.planned_date === X.today && x.generation_key === X.mineKey && x.status !== 'cancelled');
    if (t) return { t, items: X.pos.filter(p => p.task_id === t.id && p.kind === 'area') };
    const u = X.byFarm.get(farmId), id = uuid();
    if (!u) return null;
    t = { id, farm_id: farmId, title: 'Extra scouting', family: u.sample.family, sop_id: X.sop.id, sop_version_id: u.sample.sop_version_id,
          source: 'manual', generation_key: X.mineKey, planned_date: X.today, status: 'in_progress', estimated_minutes: 0, area: 'All zones',
          slot: 'any', plan_slot: 'am', priority: 'normal', sections: ['trap', 'health', 'growth'], local: true, updated_at: new Date().toISOString() };
    const items = [...u.zones.values()].map(p => ({ id: uuid(), task_id: id, kind: 'area', ref_id: p.ref_id, label: p.label, quantity: 1, unit: 'system', minutes: 0,
      area_zone_id: p.area_zone_id || null, area_system_id: p.area_system_id || null, crops: p.crops || null, zone_name: p.zone_name || null }));
    await putAll('tasks', [t]); await putAll('positions', items);
    if (X.me) await putAll('task_workers', [{ id: id + '|' + X.me, task_id: id, worker_id: X.me }]);
    X.tasks.push(t); X.pos.push(...items);
    if (navigator.onLine) {
      // the server makes it now when it can; if it cannot, the first photos sent make it
      Promise.race([api('/rest/v1/rpc/start_extra_scouting', { method: 'POST', body: JSON.stringify({ p_farm: farmId, p_task: id,
        p_items: items.map(x => ({ id: x.id, ref_id: x.ref_id })) }) }), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))])
        .then(() => liveSay()).catch(() => {});
    }
    return { t, items };
  }
  let extraPick = false;      // a zone was opened from the both-units list: Finish and Back come back to it
  async function startExtra() {
    const X = await extraUnits();
    if (!X) return;
    // two units (0.11.97): one Extra scouting over both — the zones of each under its unit, a unit's task made at its first zone
    if (X.byFarm.size > 1) return openExtraPick(X);
    const made = await ensureExtra([...X.byFarm.keys()][0], X);
    return made ? openTask('srv:' + made.t.id) : null;
  }
  async function openExtraPick(X0 = null) {
    const X = X0 || await extraUnits();
    if (!X) { extraPick = false; return showWeek(); }
    const sis = (await getKV('sisters')) || [];
    const order = [...X.byFarm.keys()].sort((a, b) => { const ia = sis.findIndex(x => x.id === a), ib = sis.findIndex(x => x.id === b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    const box = $('task'); box.textContent = '';
    const sec = el('section', 'fb-day');
    sec.append(el('h2', null, 'Extra scouting · pick a zone'));
    sec.append(el('p', 'fb-runfacts', 'Photos and counts you add here go into today\'s report, marked as extra. No minimum: send a zone as often as you like. The planned scouting of each zone stays its own task.'));
    for (const farmId of order) {
      const u = sis.find(x => x.id === farmId) || {}, unit = X.byFarm.get(farmId);
      const mine = X.tasks.find(x => x.farm_id === farmId && x.planned_date === X.today && x.generation_key === X.mineKey && x.status !== 'cancelled');
      const items = mine ? X.pos.filter(p => p.task_id === mine.id && p.kind === 'area') : [];
      const h = el('div', 'fb-unit');
      h.style.setProperty('--u', u.colour || 'var(--text-muted)');
      h.append(el('span', 'fb-ubadge', u.badge || u.code || '·'), el('span', null, u.name || 'This unit'));
      sec.append(h);
      sec.append(greenhouseCard({ farm_id: farmId, day: X.today, extra: true, task_id: mine?.id || null }, () => openExtraPick()));
      [...unit.zones.values()].sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true })).forEach(z => {
        const it = items.find(x => x.ref_id === z.ref_id);
        const at = it ? EXTRA_SENT['xz:' + mine.id + ':' + it.id] : null;
        const b = el('button', 'fb-card' + famClass(unit.sample.family));
        const body = el('div', 'fb-body');
        body.append(el('div', 'fb-name', z.label || 'Zone'));
        const meta = el('div', 'fb-meta'); meta.append(el('span', 'fb-where', 'photos'));
        body.append(meta); b.append(body);
        b.append(at ? el('span', 'fb-chip ok', 'Sent ' + new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · add more')
                    : el('span', 'fb-chip todo', 'Add photos'));
        b.onclick = async () => {
          const made = await ensureExtra(farmId, X);
          const line = made && made.items.find(x => x.ref_id === z.ref_id);
          if (!line) { showToast('This zone is not in today\'s extra scouting of the unit', 'error'); return; }
          extraPick = true;
          return openTask('xz:' + made.t.id + ':' + line.id);
        };
        sec.append(b);
      });
    }
    box.append(sec);
    show('task', 'Extra scouting', () => { extraPick = false; hubReturn = null; showWeek(); });
  }
  // a zone scouting somebody else finished today (0.11.97): what this person adds goes in as an extra of that zone —
  // the finished report stays its people's to correct
  async function extraZoneFor(t) {
    const line = (t.positions || []).find(p => p.kind === 'area' && p.ref_id);
    if (!line) return null;
    const X = await extraUnits();
    if (!X || !X.byFarm.has(t.farm_id)) return null;
    const made = await ensureExtra(t.farm_id, X);
    const it = made && made.items.find(x => x.ref_id === line.ref_id);
    return it ? 'xz:' + made.t.id + ':' + it.id : null;
  }

  // ── the day's scouting: its zones, each a task of its own (0.11.67) ──
  // the day's scouting: its zone tasks, drawn exactly as on the day list (0.11.68, owner: "exactly the same task design,
  // just a collection of the five tasks with all the standard information")
  function openHub(h) {
    const box = $('task'); box.textContent = '';
    const sec = el('section', 'fb-day');
    const done = h.zones.filter(z => z.status === 'done').length, open = h.zones.filter(z => !isClosed(z.status));
    if (h.extra) {
      sec.append(el('h2', null, 'Extra scouting · pick a zone'));
      sec.append(el('p', 'fb-runfacts', 'Photos and counts you add here go into today\'s report, marked as extra. No minimum: send a zone as often as you like. The planned scouting of each zone stays its own task.'));
    } else
    sec.append(el('h2', null, [fmtDay(h.planned_date), `${done} of ${h.zones.length} done`,
      open.length ? `${open.length} to do, ${fmtMin(open.reduce((a, z) => a + z.openMinutes, 0))} planned` : null].filter(Boolean).join(' · ')));
    // the whole greenhouse first (0.11.122): a note for the day's report, never required
    sec.append(greenhouseCard({ farm_id: h.farm_id || farm?.id, day: h.extra || h.planned_date > todayISO() ? todayISO() : h.planned_date,
                                extra: !!h.extra, task_id: h.extra ? h.id : null },
      async () => { const again = (await loadGroups()).find(x => x.key === h.key); return again && again.hub ? openHub(again) : showWeek(); }));
    const late = h.planned_date < todayISO();
    h.zones.forEach(z => sec.append(taskCard(z, late && !isClosed(z.status))));
    box.append(sec);
    show('task', h.title, () => { hubReturn = null; showWeek(); });
  }
  // back to the hub after a zone, else to the day
  async function backFromRun() {
    if (extraPick) return openExtraPick();        // the both-units list of an extra scouting
    const hk = hubReturn;
    if (hk) {
      const groups = await loadGroups();
      const h = groups.find(x => x.key === hk);
      if (h && h.hub) return openHub(h);
    }
    hubReturn = null;
    return showWeek();
  }


//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the day's scouting hub, back from a run. Edit here, then run: python build.py
  // ids made on the phone (Digital scouting's items)
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  // + Extra scouting (0.11.94, FarmBox 0204) is Digital scouting since 0.11.132 (21 Oct 2026): its own picker, the task it
  // made on the phone and "a zone somebody else finished today goes in as an extra" were removed on 17 Nov 2026 — a zone
  // task opens Digital scouting first, done or not, so the last one was no longer reached. Kept for openTask's old branch:
  let extraPick = false;
  async function extraZoneFor(t) { return null; }

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
    const hk = hubReturn;
    if (hk) {
      const groups = await loadGroups();
      const h = groups.find(x => x.key === hk);
      if (h && h.hub) return openHub(h);
    }
    hubReturn = null;
    return showWeek();
  }


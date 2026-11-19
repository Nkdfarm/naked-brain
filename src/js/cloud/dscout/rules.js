//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- Digital scouting: pure rules, a photo as a post, the verified diagnosis. Edit here, then run: python build.py
  // ══ Digital scouting (0.11.132, FarmBox 0246–0247; owner 21 Oct 2026) ═══════════════════════════════════════
  // "the extra scouting will be the Digital scouting; after clicking you open a live simplified mobile-friendly page of
  // the Naked Heart scouting page, where everybody can see the current scouting page and pics, notes and add pics, notes
  // and traps in each section (no risk of unfiled pics). All modifications are live, admin can modify all elements,
  // otherwise you can modify and delete only your elements. The daily scouting task will be only a reminder of missing
  // inputs for the responsible."
  // Each item is saved on its own the moment it is made (dg_add_photo, dg_read_trap, dg_add_note …), through the outbox:
  // its file first, then the call, with the phone's own id so a resend is harmless. No round and no Finish: the day's
  // report is the page. The zone task of the daily scouting is a reminder of what is missing, ticked done on its
  // responsible's own phone once the zone has every minimum.

  // ── the pure rules (stub-tested in the Deno image) ──
  const DG_SINCE = '2026-10-21';           // the first day of Digital scouting: a zone task from then on opens it, done or not
  const DG_PARTS = [['health', 'Health'], ['growth', 'Growth'], ['traps', 'Traps']];
  // a unit's counters: each part with a target, or with photos on a day it is not due
  // the traps, whenever the zone has some (owner 22 Oct 2026: "the information will be on top as usual logic with eg.
  // 4/6 traps and color according the reached target"): the traps done (every side in, or not read today with why) of
  // the zone's traps; due = a trap day, when a trap still missing is said in red
  function dgCounters(u) {
    return DG_PARTS.map(([k, label]) => {
      const c = (u && u[k]) || {};
      if (k === 'traps' && Array.isArray(c.list) && c.list.length) {
        const n = dgTrapCount(c.list);
        return { key: k, label, done: n.done, target: n.total, ok: n.done >= n.total, due: Number(c.target) > 0 };
      }
      const done = Number(c.done) || 0, target = Number(c.target) || 0;
      return { key: k, label, done, target, ok: done >= target };
    }).filter(c => c.target > 0 || c.done > 0);
  }
  // a trap's sides, each red until photographed today, green after, grey when the trap is not read today with why: a
  // two-sided card ('both') by its yellow and its blue side, any other card by one photo (as dg_day counts them)
  function dgTrapDots(t) {
    if (t.skipped) return t.colour === 'both' ? [{ side: 'yellow', state: 'skip' }, { side: 'blue', state: 'skip' }] : [{ side: null, state: 'skip' }];
    if (t.colour === 'both') return [{ side: 'yellow', state: t.yellow ? 'ok' : 'todo' }, { side: 'blue', state: t.blue ? 'ok' : 'todo' }];
    return [{ side: null, state: t.done ? 'ok' : 'todo' }];
  }
  const dgTrapName = t => t.spot || shortCode(t.code) || 'trap';
  // what a unit still misses: "Missing: 2 traps (1C08, 1E26) · 2 growth photos"
  function dgMissing(u) {
    const tr = (u && u.traps) || {};
    const traps = (tr.target || 0) > 0 ? (tr.list || []).filter(t => !t.done).map(dgTrapName) : [];
    const lack = k => Math.max(0, ((u && u[k] && u[k].target) || 0) - ((u && u[k] && u[k].done) || 0));
    const health = lack('health'), growth = lack('growth');
    const bits = [traps.length ? `${traps.length} trap${traps.length === 1 ? '' : 's'} (${traps.join(', ')})` : null,
                  health ? `${health} health photo${health === 1 ? '' : 's'}` : null,
                  growth ? `${growth} growth photo${growth === 1 ? '' : 's'}` : null].filter(Boolean);
    return { traps, health, growth, text: bits.length ? 'Missing: ' + bits.join(' · ') : '' };
  }
  // a call on an item that is gone meanwhile (deleted, already removed): the server answers "no such …" or "… not found"
  // — finished, not retried for ever. Never for a new photo or trap reading, which is set aside instead of lost.
  const DG_ON_ITEM = ['remove_photo', 'dg_edit_item', 'dg_add_note', 'dg_edit_note', 'dg_delete_note', 'dg_ask_opinion',
                      'dg_dismiss_request', 'dg_skip_trap', 'dg_unskip_trap', 'dg_vote', 'dg_react'];
  const dgGoneAlready = (u, e) => !!u && DG_ON_ITEM.includes(u.rpc) && /no such|not found/i.test(String((e && e.message) || e || ''));
  // a unit as it will be once this phone has sent what it holds: its photos and trap sides waiting in the outbox count
  // as made (Leave would otherwise list a trap photographed without signal as missing)
  function dgWithPending(u, views) {
    if (!u) return u;
    const x = JSON.parse(JSON.stringify(u));
    for (const v of views || []) {
      if (v.kind === 'photo') { const k = v.section === 'growth' ? 'growth' : 'health'; x[k] = { ...(x[k] || {}), done: ((x[k] && x[k].done) || 0) + 1 }; }
      const t = v.trap_id && ((x.traps && x.traps.list) || []).find(y => y.trap_id === v.trap_id);
      if (!t) continue;
      if (v.kind === 'trap') { if (v.side) t[v.side] = true; t.done = t.colour === 'both' ? !!(t.yellow && t.blue) || !!t.skipped : true; }
      if (v.kind === 'skip') { t.skipped = t.skipped || 'sending'; t.done = true; }
      if (v.kind === 'unskip') { t.skipped = null; t.done = t.colour === 'both' ? !!(t.yellow && t.blue) : !!(t.yellow || t.blue); }
    }
    if (x.traps && x.traps.list) x.traps.done = x.traps.list.filter(y => y.done).length;
    return x;
  }
  // who may change or delete an item: its writer on its own day while that day is today, or on the day they added it (a
  // gallery photo of a day gone by: dg_day's added_today, 0.11.150), a manager always (the server checks the same:
  // app.may_remove_photo, given greatest(the item's time, its created_at) since FarmBox 0282)
  const dgMayChange = (item, D) => !!D && (!!D.may_change_all || (!!item && !!D.me && item.by_user === D.me
    && (!!D.is_today || (Array.isArray(D.added_today) && D.added_today.includes(item.id)))));
  // a note: its writer until the end of the note's own day (the farm's day since 0.11.146, was the phone's), a manager always
  const dgDayOf = iso => { const d = new Date(iso); return isNaN(d) ? '' : farmDay(d); };
  const dgNoteMayChange = (n, D, today) => !!D && (!!D.may_change_all || (!!n && !!D.me && n.by_user === D.me && dgDayOf(n.at) === today));
  // where a photo lands in the evidence bucket: by day, so a save that fails still shows in Unfiled photos
  const dgPath = (farmId, day, kind, id) => `${farmId}/dg-${String(day).replace(/-/g, '')}/${kind}-${id}.jpg`;

  // ── a photo as a post (0.11.133, FarmBox 0249; owner 22 Oct 2026: "remove the full AI note from each picture, just
  // the small coloured blocks (from the AI and from people) as in Naked Heart … the full comments only after clicking
  // on the picture. The number of comments and agree/disagree visible under each picture, as in a social app. You write
  // a comment, and afterwards you decide to ask the AI or someone of the team — no automatic AI chat") ──
  // the risk of a finding, on Naked Heart's one scale (viewer.js riskOf): nothing or a beneficial green, slight yellow,
  // clear or severe red; a finding without a severity is slight
  const DG_SEV = ['none', 'slight', 'clear', 'severe'];
  const dgRisk = (severity, kind) => kind === 'beneficial' || Number(severity) === 0 ? 'green' : Number(severity ?? 1) >= 2 ? 'red' : 'yellow';
  // a finding's first words, as on Naked Heart's cards: "Powdery mildew" of "Powdery mildew (Podosphaera)"
  const dgShortName = s => { const t = String(s || '').split(/\s*[(,;:]|\s+[—–-]\s+/)[0].trim(); return t.length > 26 ? t.slice(0, 25).trimEnd() + '…' : t; };
  const dgAiDone = (kind, p) => !!p && (p.ai_status === 'done' || (p.ai_status == null && (kind === 'trap' ? Array.isArray(p.species) && p.species.length > 0 : !!p.ai)));
  // by gravity, as Naked Heart (viewer.js byGravity, 0.7.275): red before yellow before green, then the higher severity,
  // then the AI's own order; a trap's insects the pests first, the most counted first
  const DG_RANK = { red: 3, yellow: 2, green: 1 };
  const dgByGravity = all => all.map((x, i) => ({ x, i, lvl: dgRisk(x.severity, x.kind) }))
    .sort((a, b) => (DG_RANK[b.lvl] - DG_RANK[a.lvl]) || (Number(b.x.severity ?? 1) - Number(a.x.severity ?? 1)) || a.i - b.i);
  const dgInsectsByGravity = sp => sp.map((x, i) => ({ x, i }))
    .sort((a, b) => (!!a.x.beneficial - !!b.x.beneficial) || (Number(b.x.count ?? 0) - Number(a.x.count ?? 0)) || a.i - b.i).map(o => o.x);
  // the AI's block under a picture (0.11.137, owner 22 Oct 2026: "the AI notes in only one to be more visual, with
  // first information according with gravity"): ONE block, every finding by gravity, in the colour of the worst
  // ("AI: Healthy" when it found nothing); a trap reading's insects the same way, yellow when a pest is among them
  function dgAiChips(kind, p) {
    if (!dgAiDone(kind, p)) return [];
    if (kind === 'trap') {
      const sp = dgInsectsByGravity(Array.isArray(p.species) ? p.species : []);
      if (!sp.length) return [];
      const word = x => `${x.common || x.name || 'insect'}${x.count != null ? ' ' + x.count : ''}`;
      return [{ text: 'AI: ' + sp.map(word).join(', '), level: sp.some(x => !x.beneficial) ? 'yellow' : 'green', title: sp.map(x => 'AI: ' + word(x)).join('\n') }];
    }
    const all = dgByGravity((p.ai && Array.isArray(p.ai.findings)) ? p.ai.findings : []);
    if (!all.length) return p.ai && p.ai.healthy === false ? [] : [{ text: 'AI: Healthy', level: 'green' }];
    const sevWord = x => x.severity != null && DG_SEV[x.severity] ? ' · ' + DG_SEV[x.severity] : '';
    return [{ text: 'AI: ' + all.map(({ x }) => dgShortName(x.name || x.code) + sevWord(x)).join(', '), level: all[0].lvl,
              title: all.map(({ x }) => `AI: ${x.name || x.code}${sevWord(x)}`).join('\n') }];
  }
  // the counts under a picture as this phone will have them: a vote still in the outbox replaces mine, a comment still
  // in the outbox counts
  // (0.11.142, FarmBox 0261) the reactions replace Agree / Disagree: like, dislike, pensive ("not sure") on every
  // comment, the AI's reading included. The counts read from a server before 0261 (agree / disagree / mine) read as the
  // AI's likes and dislikes. `react`: my reaction on the AI's reading still in the outbox (null takes it back)
  function dgSocialWith(s, react, notes = 0) {
    if (!s && react === undefined && !notes) return s || null;
    const n = v => Number(v) || 0;
    const ai = s && s.ai ? s.ai : { like: n(s?.agree), dislike: n(s?.disagree), pensive: 0, mine: s?.mine === 1 ? 'like' : s?.mine === -1 ? 'dislike' : null };
    const x = { comments: n(s?.comments) + notes, like: s && 'like' in s ? n(s.like) : n(s?.agree), dislike: s && 'dislike' in s ? n(s.dislike) : n(s?.disagree),
                pensive: n(s?.pensive), ai: { like: n(ai.like), dislike: n(ai.dislike), pensive: n(ai.pensive), mine: ai.mine || null } };
    if (s && s.verified) x.verified = s.verified;           // the verified diagnosis rides along (0.11.134)
    if (react !== undefined && (react || null) !== x.ai.mine) {
      if (x.ai.mine) { x.ai[x.ai.mine] = Math.max(0, x.ai[x.ai.mine] - 1); x[x.ai.mine] = Math.max(0, x[x.ai.mine] - 1); }
      if (react) { x.ai[react]++; x[react]++; }
      x.ai.mine = react || null;
    }
    x.agree = x.ai.like; x.disagree = x.ai.dislike; x.mine = x.ai.mine === 'like' ? 1 : x.ai.mine === 'dislike' ? -1 : null;
    return x;
  }
  // the reactions, the one place with emoji (owner 23 Oct 2026: "for general design and gui I prefer the minimalist
  // icon, for the reactions the classic small emoji are better"); the line icons stay everywhere else
  const DG_REACTS = [['like', '👍', 'Like'], ['dislike', '👎', 'Dislike'], ['pensive', '🤔', 'Not sure']];
  // "3 comments · 👍 2 · 👎 1 · 🤔 1"; the zero parts left out; "No comment yet" when all are zero
  function dgSocialText(s) {
    if (!s) return '';
    const n = v => Number(v) || 0, c = n(s.comments);
    const r = { like: 'like' in s ? n(s.like) : n(s.agree), dislike: 'dislike' in s ? n(s.dislike) : n(s.disagree), pensive: n(s.pensive) };
    const parts = [c ? `${c} comment${c === 1 ? '' : 's'}` : null, ...DG_REACTS.map(([k, e]) => (r[k] ? `${e} ${r[k]}` : null))].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'No comment yet';
  }
  // one comment's reactions as this phone will have them: the server's, with my own still in the outbox
  function dgReactWith(s, pending) {
    const x = { like: Number(s?.like) || 0, dislike: Number(s?.dislike) || 0, pensive: Number(s?.pensive) || 0, mine: s?.mine || null,
                who: Array.isArray(s?.who) ? s.who : [] };
    if (pending !== undefined && (pending || null) !== x.mine) {
      if (x.mine) x[x.mine] = Math.max(0, x[x.mine] - 1);
      if (pending) x[pending]++;
      x.mine = pending || null;
    }
    return x;
  }
  // my reaction on one comment still in the outbox: the last one queued (null takes it back); undefined when none
  function dgPendReact(rows, target, tid) {
    const r = (rows || []).filter(x => x.payload.view.kind === 'react' && !x.dead && x.payload.view.target === target
                                       && (x.payload.view.target_id || null) === (tid || null))
      .sort((a, b) => (a.at || 0) - (b.at || 0)).pop();
    return r ? r.payload.view.reaction : undefined;
  }
  // my reaction pressed again takes it back
  const dgNextReaction = (mine, pressed) => (mine === pressed ? null : pressed);
  // the first sentence of the AI's reading, for its one line
  function dgFirstSentence(s) {
    const t = String(s || '').replace(/\s+/g, ' ').trim(), m = t.match(/^.+?[.!?](?=\s|$)/);
    const x = (m ? m[0] : t).trim();
    return x.length > 160 ? x.slice(0, 157).trimEnd() + '…' : x;
  }
  // the conversation in time order; an AI answer under the comment it answers (when that comment is in the thread)
  function dgThreadOrder(thread) {
    const items = (Array.isArray(thread) ? thread : []).map((x, i) => [x, i])
      .sort((a, b) => (new Date(a[0].at).getTime() || 0) - (new Date(b[0].at).getTime() || 0) || a[1] - b[1]).map(([x]) => x);
    const notes = new Set(items.filter(x => x.type === 'note' && x.id).map(x => x.id));
    const under = new Map();
    items.forEach(x => { if (x.type === 'ai' && x.note_id && notes.has(x.note_id)) under.set(x.note_id, [...(under.get(x.note_id) || []), x]); });
    const out = [];
    items.forEach(x => {
      if (x.type === 'ai' && x.note_id && notes.has(x.note_id)) return;
      out.push({ item: x, depth: 0 });
      if (x.type === 'note') (under.get(x.id) || []).forEach(a => out.push({ item: a, depth: 1 }));
    });
    return out;
  }

  // ── the feed and the verified diagnosis (0.11.134, FarmBox 0250; owner 22 Oct 2026: "Feed and ranking: Needs
  // attention / Newest / Disagreements / Mine; the verified diagnosis; Open a case") ──
  const DG_SORTS = [['attention', 'Needs attention'], ['newest', 'Newest'], ['disagree', 'Disagreements'], ['mine', 'Mine']];
  const DG_PERIODS = [[7, '7 days'], [30, '30 days']];
  const DG_FEED_PAGE = 20;
  // a comment's first words, for a card: "Downy mildew, not powdery; the underside…"
  const dgFirstWords = (s, max = 70) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; };
  // a page added under the ones read: the server's order kept, a post already there (the order moved meanwhile) once
  function dgFeedMerge(old, add) {
    const seen = new Set((old || []).map(x => x.kind + ':' + x.id));
    return [...(old || []), ...(add || []).filter(x => x && x.id && !seen.has(x.kind + ':' + x.id) && seen.add(x.kind + ':' + x.id))];
  }
  // the pictures of a page to ask for (dg_thumbs): the posts with a phone copy, not on this phone, not asked already
  const dgThumbAsk = (items, have, asked) => (items || []).filter(x => x && x.id && x.has_thumb && !have.has(x.id) && !(asked && asked.has(x.id)))
    .map(x => ({ kind: x.kind === 'trap' ? 'trap' : 'observation', id: x.id }));
  // what a sort says when it has nothing
  const dgFeedEmpty = sort => ({ disagree: 'No disagreement in these days.', mine: 'Nothing of yours in these days: no photo, comment or vote.' }[sort] || 'No photo in these days.');
  // what a case opened from a post starts from: the AI's most severe finding (a trap reading: the pest it named), its
  // severity, else slight
  function dgCaseGuess(kind, p) {
    const sev = v => Math.max(0, Math.min(3, Math.round(Number(v ?? 1)) || 0));
    if (kind === 'trap') return { code: (p && p.ai_pest) || null, severity: 1 };
    const fs = (p && p.ai && Array.isArray(p.ai.findings) ? p.ai.findings : []).filter(x => x && x.kind !== 'beneficial');
    if (!fs.length) return { code: null, severity: 1 };
    const top = fs.map((x, i) => [x, i]).sort((a, b) => (Number(b[0].severity ?? 1) - Number(a[0].severity ?? 1)) || a[1] - b[1])[0][0];
    return { code: top.code || null, severity: sev(top.severity) };
  }
  // a trap's chip: green once every side is photographed, grey when not read today with why, red until then
  const dgTrapState = t => t.skipped ? 'skip' : dgTrapDots(t).every(d => d.state === 'ok') ? 'ok' : 'todo';
  // the zone's traps done: every side photographed, or not read today with why (as dg_day counts a skip)
  function dgTrapCount(list) {
    const l = Array.isArray(list) ? list : [];
    return { done: l.filter(t => dgTrapState(t) !== 'todo').length, total: l.length };
  }


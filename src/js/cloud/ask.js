//! Naked Brain - the cloud closure (FarmBox Tasks on Supabase): opened in js/cloud/db.js, closed in js/cloud/lot-scan.js; shares session, farm, run, DG, TIMERS, show(), $() and el() with every js/cloud/* file -- the app's own question sheet. Edit here, then run: python build.py
  // ── askSheet (0.11.147): the app's own question, in place of the browser's confirm() ──
  // confirm() is a grey system box that names no action ("OK / Cancel"), cannot be tapped with gloves with any confidence
  // and blocks the page. This is Send everything now's sheet, made one helper: askSheet({ title, text, yes, no, danger, list })
  // answers true (the yes button) or false (the no button, or a tap beside the sheet). Buttons are 48 px and named after
  // the action. The sheet covers the whole screen, so no second tap reaches the page while the question is open.
  function askSheet({ title, text, yes = 'Yes', no = 'Cancel', danger = false, list = null }) {
    return new Promise(resolve => {
      const sheet = el('div', 'fb-sheet fb-ask');
      sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
      const box = el('div', 'fb-sheet-card');
      if (title) box.append(el('h3', null, title));
      String(text || '').split('\n\n').filter(Boolean).forEach(t => box.append(el('p', null, t)));
      if (list && list.length) { const ul = el('ul', 'fb-sendlist'); list.forEach(t => ul.append(el('li', null, t))); box.append(ul); }
      const done = v => { sheet.remove(); resolve(v); };
      const n = el('button', 'fb-btn', no); n.type = 'button'; n.onclick = () => done(false);
      const y = el('button', 'fb-btn ' + (danger ? 'fb-btn-primary' : 'fb-ask-yes'), yes); y.type = 'button'; y.onclick = () => done(true);
      const acts = el('div', 'fb-actions'); acts.append(n, y);
      box.append(acts);
      sheet.append(box);
      sheet.onclick = e => { if (e.target === sheet) done(false); };
      document.body.append(sheet);
      y.focus();
    });
  }
  // ── a photo's ✕ with five seconds of Undo (0.11.147) ──
  // The old ✕ (picX, js/cloud/scouting/trap-round.js) asked first; a glove on a small corner meant either a wrong photo
  // kept or a right one lost behind a question. Now the photo goes at once from the data (so a Finish in those five
  // seconds does not send it) and from the screen, and the bar at the top offers Undo through holdForUndo (js/cloud/swipe-open.js):
  // Undo puts it back where it was. remove(pic) takes it out of the data and the page; restore(pic) puts both back.
  function picUndoX(img, remove, restore) {
    const pic = el('div', 'fb-pic');
    const x = el('button', 'fb-pic-x', '✕'); x.type = 'button';
    x.setAttribute('aria-label', 'Remove this photo'); x.title = 'Remove this photo';
    x.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      const parent = pic.parentNode, next = pic.nextSibling;
      const R = run;   // the checklist the photo came from: Undo puts it back only there (review of 17 Nov)
      remove(pic);
      holdForUndo('Photo removed', async () => { /* already out of the data; nothing more to keep */ }, () => {
        // finished, handed over or another task opened within the five seconds: the photo stays out of every run
        if (!R || run !== R) { showToast('That checklist is closed: the photo was not put back', 'error'); return; }
        if (parent && parent.isConnected) parent.insertBefore(pic, next && next.parentNode === parent ? next : null);
        restore(pic);
      });
    };
    pic.append(img, x);
    return pic;
  }
  // the Capture tab's scripts sit outside this closure: they ask through window.askSheet, and fall back to confirm()
  // if this closure never started (no cloud script, an old cached page)
  window.askSheet = askSheet;

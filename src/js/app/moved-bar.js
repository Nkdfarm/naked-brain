//! Naked Brain - the bar shown on the old github.io address. Edit here, then run: python build.py
// 0.11.116 — Naked Brain moved to https://brain.nkd.farm/ (5 Oct 2026). A new address is a new app to the phone: what
// still waits here (reports, photos, drafts) cannot be reached from there. So the copy still served at the old
// github.io address says it on every screen: empty this phone with Force send, then open the new address.
(function () {
  if (!/(^|\.)github\.io$/i.test(location.hostname)) return;
  var bar = document.createElement('div');
  bar.id = 'nb-moved';
  bar.setAttribute('role', 'alert');
  bar.style.cssText = 'background:#b45309;color:#fff;padding:10px 14px;font:600 14px/1.4 Inter,system-ui,sans-serif;text-align:center;position:relative;z-index:50';
  bar.innerHTML = 'Naked Brain has moved. 1 · Press <b>Force send</b> here, and send any note still open in Capture, so nothing stays on this phone. '
    + '2 · Open <a href="https://brain.nkd.farm/" style="color:#fff;text-decoration:underline;font-weight:800">brain.nkd.farm</a>, sign in and install it.';
  document.body.insertBefore(bar, document.body.firstChild);
})();

//! Naked Brain - the SoP closure: opened in js/sop/config-helpers.js, closed in js/sop/tail.js; shares its locals with every js/sop/* and js/cloud/* file -- CLOSES it. Edit here, then run: python build.py

window.sopOpen = sopOpen;
if (document.body.classList.contains('mode-sop') && !document.body.classList.contains('src-cloud')) sopOpen();
})();

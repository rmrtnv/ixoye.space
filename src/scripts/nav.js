/**
 * Mobile navigation helpers.
 *
 * The compact top bar is mostly native: <details> dropdowns, history back /
 * forward buttons, and a form that submits to the search page. This script
 * adds the small behaviours that markup alone cannot:
 *   - close an open dropdown when the user taps outside it or presses Escape;
 *   - focus the search field when its dropdown opens;
 *   - navigate to the selected text from the middle picker.
 */
(function () {
  "use strict";

  var OPEN = "details.nav-drop[open]";

  function closeAll() {
    var open = document.querySelectorAll(OPEN);
    for (var i = 0; i < open.length; i++) open[i].removeAttribute("open");
  }

  document.addEventListener("click", function (e) {
    var open = document.querySelectorAll(OPEN);
    for (var i = 0; i < open.length; i++) {
      if (!open[i].contains(e.target)) open[i].removeAttribute("open");
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Esc") closeAll();
  });

  // Autofocus the search field when its dropdown opens.
  document.addEventListener("toggle", function (e) {
    var d = e.target;
    if (!d.matches || !d.matches("details.nav-search")) return;
    if (!d.open) return;
    var input = d.querySelector("input[type='search']");
    if (input) setTimeout(function () { input.focus(); }, 0);
  }, true);

  // Keep Escape / outside-click from leaving a stale box open on back-forward.
  window.addEventListener("pageshow", closeAll);

  // The middle picker: navigate to the selected text.
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains("nav-text") && t.value) {
      window.location.assign(t.value);
    }
  });
})();

/**
 * Mobile navigation + reading-state helpers.
 *
 * The compact top bar is mostly native: <details> dropdowns and a form that
 * submits to the search page. This script adds the behaviours that markup
 * alone cannot:
 *   - close an open dropdown when the user taps outside it or presses Escape;
 *   - focus the search field when its dropdown opens;
 *   - navigate to the selected text from the middle picker;
 *   - back / forward arrows. The back arrow walks the browser history; the
 *     forward arrow advances through the middle picker (the section's table
 *     of contents) when there is nothing left to pop from the navigation
 *     trail, so readers can page through a section in order;
 *   - remember the last-read position (localStorage) and restore it when the
 *     installed app is opened again.
 */
(function () {
  "use strict";

  var OPEN = "details.nav-drop[open]";
  var FWD_KEY = "ixoye-nav-fwd";
  var READ_KEY = "ixoye-read-state";

  var navType = "";
  try {
    var perf = window.performance && performance.getEntriesByType
      ? performance.getEntriesByType("navigation")
      : null;
    navType = perf && perf[0] ? perf[0].type : "";
  } catch (e) { /* navigation timing unavailable */ }

  // ---------------------------------------------------------------------------
  // dropdown closing / search autofocus / middle picker
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // back / forward arrows
  // ---------------------------------------------------------------------------

  // Our own forward trail, kept in sessionStorage so it survives page loads.
  // The back arrow records the page it leaves; the forward arrow pops the
  // trail back into the browser, or — when the trail is empty — advances to
  // the next option of the middle picker (the section's table of contents).
  var fwd = [];
  try { fwd = JSON.parse(sessionStorage.getItem(FWD_KEY) || "[]"); } catch (e) { fwd = []; }

  function saveFwd() {
    try {
      sessionStorage.setItem(FWD_KEY, JSON.stringify(fwd.slice(-50)));
    } catch (e) { /* storage unavailable */ }
  }

  // A fresh navigation (new link, reload, or app restart) dismisses the trail;
  // a back/forward navigation keeps it.
  if (navType !== "back_forward") {
    fwd = [];
    saveFwd();
  }

  function navigator(url) {
    if (url) window.location.assign(url);
  }

  function pickerAdvance() {
    var sel = document.querySelector("select.nav-text");
    if (!sel || sel.selectedIndex < 0 || sel.selectedIndex >= sel.options.length - 1) {
      return false;
    }
    navigator(sel.options[sel.selectedIndex + 1].value);
    return true;
  }

  var backBtn = document.querySelector(".nav-back");
  var fwdBtn = document.querySelector(".nav-forward");

  if (backBtn) {
    backBtn.addEventListener("click", function () {
      fwd.push(location.href);
      saveFwd();
      history.back();
    });
  }

  if (fwdBtn) {
    fwdBtn.addEventListener("click", function () {
      var url;
      // skip stale entries that point at the page we are already on
      while ((url = fwd.pop()) && url === location.href) { /* noop */ }
      if (url) {
        saveFwd();
        navigator(url);
        return;
      }
      pickerAdvance(); // continue reading the section in order
    });
  }

  // ---------------------------------------------------------------------------
  // reading state
  // ---------------------------------------------------------------------------

  function readState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(READ_KEY) || "null"); } catch (e) { s = null; }
    return s && typeof s === "object" ? s : null;
  }

  function saveRead() {
    try {
      localStorage.setItem(READ_KEY, JSON.stringify({
        url: location.href,
        y: Math.round(window.pageYOffset || document.documentElement.scrollTop || 0),
      }));
    } catch (e) { /* storage unavailable */ }
  }

  var saveTimer = null;
  window.addEventListener("scroll", function () {
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; saveRead(); }, 400);
  }, { passive: true });

  // Save the position when the app is backgrounded or closed.
  window.addEventListener("pagehide", saveRead);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") saveRead();
  });

  function restoreIfCurrent() {
    var s = readState();
    if (!s || !s.url || s.url !== location.href || !(s.y > 0)) return;
    window.scrollTo(0, s.y);
  }

  // Installed PWA (display-mode: standalone covers Android/Chrome; the iOS
  // legacy API is navigator.standalone). Reopening the app from the home page
  // returns the reader to the text they were reading.
  var standalone = false;
  try {
    standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) ||
      navigator.standalone === true;
  } catch (e) { /* matchMedia unavailable */ }

  var isHome = location.pathname === "/" || location.pathname === "/index.html";

  if (navType !== "back_forward") {
    // Fresh open (app restart / new tab): resume where the reader stopped.
    if (standalone && isHome) {
      var s = readState();
      if (s && s.url && s.url !== location.href) {
        location.replace(s.url);
      } else {
        restoreIfCurrent();
      }
    } else {
      restoreIfCurrent();
    }
  }

  // Re-apply once layout is settled (images etc.) — same position, no jump.
  window.addEventListener("load", restoreIfCurrent);
})();
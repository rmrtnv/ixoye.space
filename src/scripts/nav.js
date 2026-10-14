/**
 * Mobile navigation + reading-state helpers.
 *
 * The compact top bar is mostly native: <details> dropdowns and a form that
 * submits to the search page. This script adds the behaviours that markup
 * alone cannot:
 *   - close an open dropdown when the user taps outside it or presses Escape;
 *   - focus the search field when its dropdown opens;
 *   - back / forward arrows. The back arrow goes up one level (data-up);
 *     the forward arrow follows the page's next-text link (data-next).
 *     Both arrows render grey (disabled) when they have nowhere to go;
 *   - a text-size control in the menu dropdown: two buttons (smaller / larger)
 *     that scale the root --text-scale custom property. The dropdown stays
 *     open across presses so the size can be dialled in;
 *   - remember the last-read position (localStorage) and restore it when the
 *     installed app is opened again, including reopening the app at the site
 *     root and resuming the text that was being read;
 *   - offline reading: register the service worker so the site keeps working
 *     without a connection, and offer an "add to favorites" control on each
 *     text (the favorites list lives at /fav.html).
 */
(function () {
  "use strict";

  var OPEN = "details.nav-drop[open]";
  var READ_KEY = "ixoye-read-state";
  // Marks an in-progress browsing session. Empty on a cold launch / bookmark
  // open, present across in-session navigations (links, Back/Forward), which is
  // how the reading-state code tells "the app was opened" from "the reader went
  // back to the root".
  var SESSION_KEY = "ixoye-session";

  var navType = "";
  try {
    var perf = window.performance && performance.getEntriesByType
      ? performance.getEntriesByType("navigation")
      : null;
    navType = perf && perf[0] ? perf[0].type : "";
  } catch (e) { /* navigation timing unavailable */ }

  // ---------------------------------------------------------------------------
  // text size
  // ---------------------------------------------------------------------------

  // The reader's text size is a multiplier on the root --text-scale variable
  // (main.css derives the body font-size from it). Steps of 0.1 within a
  // readable 0.8–1.6 band. The matching inline bootstrap in <head> re-applies a
  // stored value before first paint, so this code only has to handle changes
  // made during the session.
  var SIZE_KEY = "ixoye-text-size";
  var SIZE_MIN = 0.8;
  var SIZE_MAX = 1.6;
  var SIZE_STEP = 0.1;

  function readSize() {
    var v = parseFloat(localStorage.getItem(SIZE_KEY));
    if (!isFinite(v)) return 1;
    return Math.min(SIZE_MAX, Math.max(SIZE_MIN, v));
  }

  function writeSize(v) {
    try {
      localStorage.setItem(SIZE_KEY, String(v));
    } catch (e) { /* storage unavailable */ }
    document.documentElement.style.setProperty("--text-scale", String(v));
    syncSizeButtons(v);
  }

  function stepSize(v, dir) {
    // round to the step grid so repeated + / − taps don't accumulate float drift
    return Math.round((v + dir * SIZE_STEP) * 100) / 100;
  }

  function syncSizeButtons(v) {
    var btns = document.querySelectorAll(".nav-text-size-btn[data-text-size]");
    for (var i = 0; i < btns.length; i++) {
      var dir = parseInt(btns[i].getAttribute("data-text-size"), 10) || 1;
      btns[i].disabled = stepSize(v, dir) < SIZE_MIN || stepSize(v, dir) > SIZE_MAX;
    }
  }

  // ---------------------------------------------------------------------------
  // font family (sans default, serif opt-in)
  // ---------------------------------------------------------------------------

  // Default is the sans stack (main.css --font-main); `font-serif` on <html>
  // switches to the serif stack. Persisted per reader like the text size.
  var FONT_KEY = "ixoye-font-serif";

  function readSerif() {
    try { return localStorage.getItem(FONT_KEY) === "1"; } catch (e) { return false; }
  }

  function applySerif(on) {
    var root = document.documentElement;
    if (on) root.classList.add("font-serif");
    else root.classList.remove("font-serif");
    var toggles = document.querySelectorAll(".nav-font-toggle");
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function writeSerif(on) {
    try { localStorage.setItem(FONT_KEY, on ? "1" : "0"); } catch (e) { /* unavailable */ }
    applySerif(on);
  }

  // Pressing a text control must not dismiss the dropdown: the user usually
  // taps +/− several times in a row to land on a comfortable size.
  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest
      ? e.target.closest(".nav-text-size-btn")
      : null;
    if (btn) {
      e.preventDefault();
      if (btn.hasAttribute("data-font-toggle")) {
        writeSerif(!readSerif());
        return; // keep the menu open; stop the outside-click handler
      }
      var dir = parseInt(btn.getAttribute("data-text-size"), 10) || 1;
      var next = stepSize(readSize(), dir);
      if (next >= SIZE_MIN && next <= SIZE_MAX) writeSize(next);
      return; // keep the menu open; stop the outside-click handler
    }

    var open = document.querySelectorAll(OPEN);
    for (var i = 0; i < open.length; i++) {
      if (!open[i].contains(e.target)) open[i].removeAttribute("open");
    }
  });

  // Restore the persisted size into the CSS variable. The <head> bootstrap
  // usually did this already; running it here keeps state consistent when the
  // bootstrap was skipped (older cached page, storage written by another tab).
  var currentSize = readSize();
  document.documentElement.style.setProperty("--text-scale", String(currentSize));
  syncSizeButtons(currentSize);
  applySerif(readSerif());

  // Another tab changed a setting — stay in sync.
  window.addEventListener("storage", function (e) {
    if (e.key === SIZE_KEY) {
      var v = readSize();
      document.documentElement.style.setProperty("--text-scale", String(v));
      syncSizeButtons(v);
    } else if (e.key === FONT_KEY) {
      applySerif(readSerif());
    }
  });

  // ---------------------------------------------------------------------------
  // dropdown closing / search autofocus / middle picker
  // ---------------------------------------------------------------------------

  function closeAll() {
    var open = document.querySelectorAll(OPEN);
    for (var i = 0; i < open.length; i++) open[i].removeAttribute("open");
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Esc") closeAll();
  });

  // Autofocus the search field when its dropdown opens.
  document.addEventListener("toggle", function (e) {
    var d = e.target;
    if (!d.matches) return;
    if (d.matches("details.nav-search")) {
      if (!d.open) return;
      var input = d.querySelector("input[type='search']");
      if (input) setTimeout(function () { input.focus(); }, 0);
      return;
    }
    // Menu dropdown: when its content does not fit the viewport height,
    // flow it into two columns instead of clipping (see .cols-2).
    if (d.matches("details.nav-menu") && d.open) {
      setTimeout(function () { fitMenuColumns(d); }, 0);
    }
  }, true);

  // Re-evaluate columns when the viewport changes while the menu is open.
  window.addEventListener("resize", function () {
    var menus = document.querySelectorAll("details.nav-menu[open]");
    for (var i = 0; i < menus.length; i++) fitMenuColumns(menus[i]);
  });

  function fitMenuColumns(menu) {
    var list = menu.querySelector(".nav-drop-list");
    if (!list) return;
    list.classList.remove("cols-2");
    try {
      var limit = window.innerHeight * 0.9;
      if (list.scrollHeight > limit && window.innerHeight > 0) {
        list.classList.add("cols-2");
      }
    } catch (e) { /* measuring unavailable */ }
  }

  // Keep Escape / outside-click from leaving a stale box open on back-forward.
  window.addEventListener("pageshow", closeAll);

  // ---------------------------------------------------------------------------
  // back / forward arrows
  // ---------------------------------------------------------------------------

  // The back arrow goes up one level (data-up on the arrow); the forward
  // arrow follows the page's next-text link (data-next on the arrow).
  function navigator(url) {
    if (url) window.location.assign(url);
  }

  var backBtn = document.querySelector(".nav-back");
  var fwdBtn = document.querySelector(".nav-forward");

  // Grey out an arrow when it has nowhere to go: back needs a parent level
  // (data-up), forward needs a next-text link (data-next). Recomputed on
  // every show — back-forward cache restores the DOM as it was.
  function updateArrows() {
    if (backBtn) {
      var up = backBtn.getAttribute("data-up");
      backBtn.disabled = !(up && up.length > 0);
    }
    if (fwdBtn) {
      var next = fwdBtn.getAttribute("data-next");
      fwdBtn.disabled = !(next && next.length > 0);
    }
  }

  if (backBtn) {
    backBtn.addEventListener("click", function () {
      navigator(backBtn.getAttribute("data-up")); // up one level
    });
  }

  if (fwdBtn) {
    fwdBtn.addEventListener("click", function () {
      navigator(fwdBtn.getAttribute("data-next")); // next text in the section
    });
  }

  updateArrows();
  window.addEventListener("pageshow", updateArrows);

  // ---------------------------------------------------------------------------
  // reading state
  // ---------------------------------------------------------------------------

  // The reader's place in the site is remembered so that reopening the
  // installed app resumes the text they were in the middle of reading, at the
  // same scroll offset.
  //
  // Two things make this unreliable on iOS home-screen apps, and both are
  // handled below:
  //
  //  1. iOS does not always restore the last page — the webview frequently
  //     reopens at the site root. When that happens we have to navigate to the
  //     remembered page ourselves (see the launch block at the end of the
  //     reading-state section).
  //  2. iOS matches the saved state by exact `location.href`, which breaks on
  //     URL normalisation differences (percent-encoding, a trailing "#", a
  //     query the webview re-adds). State is therefore keyed on the
  //     *pathname* and the comparison ignores everything else.
  //
  // In addition, the scroll offset is only meaningful once the document has
  // grown to its real height — on iOS that happens after fonts and images
  // land, well after `load` in some cases — so the restore retries across
  // frames until the offset can actually be applied.

  // Flag state, in the outer closure because several handlers share it:
  //   restoring        — a saved offset is currently being applied; the scroll
  //                      events our own scrollTo() produces, and lifecycle
  //                      saves, must not clobber the target;
  //   restoreDone      — a saved offset was successfully applied;
  //   restoreCancelled — the reader has scrolled/touched, so stop intervening.
  var restoring = false;
  var restoreDone = false;
  var restoreCancelled = false;
  // Set once we decide to navigate to the remembered page on launch. From then
  // on the reader is already on their way, so late lifecycle events must not
  // overwrite the saved place with the launch page.
  var redirecting = false;

  function scrollTop() {
    return Math.round(
      window.pageYOffset ||
      (document.documentElement && document.documentElement.scrollTop) ||
      (document.body && document.body.scrollTop) ||
      0
    );
  }

  function samePath(a, b) {
    try {
      return new URL(a, location.href).pathname === new URL(b, location.href).pathname;
    } catch (e) {
      return a === b;
    }
  }

  function readState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(READ_KEY) || "null"); } catch (e) { s = null; }
    return s && typeof s === "object" ? s : null;
  }

  function saveRead() {
    // Never record while a restore is mid-flight: at that moment the viewport
    // is still at the top, so it would overwrite the very offset we are about
    // to restore. Likewise while we are navigating to the remembered page.
    if (restoring || redirecting) return;
    try {
      localStorage.setItem(READ_KEY, JSON.stringify({
        url: location.href,
        path: location.pathname,
        y: scrollTop(),
        title: (document.querySelector("h1") || {}).textContent || document.title,
        at: Date.now(),
      }));
    } catch (e) { /* storage unavailable */ }
  }

  var saveTimer = null;
  window.addEventListener("scroll", function () {
    // Our own restore scrolls too; those must not be treated as a takeover.
    if (restoring) return;
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; saveRead(); }, 200);
  }, { passive: true });

  // Save the position when the app is backgrounded or closed. On iOS,
  // `visibilitychange` is the reliable one: `pagehide`/`beforeunload` are not
  // always delivered when a home-screen app is swiped away from the switcher.
  window.addEventListener("pagehide", saveRead);
  window.addEventListener("beforeunload", saveRead);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") saveRead();
  });

  // An explicit interaction (tap, wheel, key) means the reader is in control.
  // Cancel the restore so a late attempt cannot yank them away from where they
  // have deliberately scrolled to.
  ["pointerdown", "touchstart", "wheel", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, function () {
      if (!restoreDone) restoreCancelled = true;
    }, { passive: true });
  });

  function restoreIfCurrent() {
    if (restoreDone || restoreCancelled) return;
    var s = readState();
    if (!s || !s.url || !samePath(s.url, location.href) || !(s.y > 0)) return;

    var target = s.y;

    // `scroll-behavior: smooth` in the stylesheet would animate the restore
    // from the top — slow, and frequently paused while the app is still
    // settling. Force instant scrolling for the restore, then put the original
    // back so in-page anchor links keep their smooth behaviour.
    var root = document.documentElement;
    var prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";

    function finish() {
      restoring = false;
      root.style.scrollBehavior = prevBehavior;
    }

    // A single synchronous pass handles the common case (the document is
    // already laid out when the deferred script runs). Further passes are
    // scheduled with BOTH rAF and setTimeout: rAF is the accurate one, but it
    // is paused in background tabs and can be throttled on iOS during load,
    // and setTimeout still fires under those conditions.
    function apply() {
      if (restoreCancelled) { finish(); return true; }
      var max = Math.max(
        0,
        (document.documentElement.scrollHeight || 0) - window.innerHeight
      );
      var want = Math.min(target, max);
      window.scrollTo(0, want);
      if (max > 0 && Math.abs(scrollTop() - want) <= 2) {
        restoreDone = true;
        finish();
        return true;
      }
      return false;
    }

    restoring = true;
    apply();
    if (restoreDone || restoreCancelled) { finish(); return; }

    var deadline = Date.now() + 1500;
    function retry() {
      if (restoreDone || restoreCancelled || Date.now() > deadline) { finish(); return; }
      apply();
      if (restoreDone || restoreCancelled) { finish(); return; }
      window.requestAnimationFrame(retry);
    }
    window.requestAnimationFrame(retry);
    // Belt and braces for contexts where rAF is paused or heavily throttled
    // (background tab, iOS during load): give the offset one last try.
    setTimeout(function () {
      if (restoreDone || restoreCancelled) { finish(); return; }
      apply();
      finish();
    }, 1500);
  }

  // Installed PWA detection. `display-mode` covers Android/Chrome and modern
  // iOS; `navigator.standalone` is the long-standing iOS home-screen API.
  var standalone = false;
  try {
    standalone =
      (window.matchMedia && matchMedia("(display-mode: standalone)").matches) ||
      (window.matchMedia && matchMedia("(display-mode: fullscreen)").matches) ||
      (window.matchMedia && matchMedia("(display-mode: minimal-ui)").matches) ||
      navigator.standalone === true;
  } catch (e) { /* matchMedia unavailable */ }

  var isHome = location.pathname === "/" || location.pathname === "/index.html";

  // A home-screen launch does not always run as a standalone web app: without
  // the `apple-mobile-web-app-capable` meta the icon opens a normal Safari view
  // where `navigator.standalone` is false and the launch lands on the root.
  // `sessionStorage` distinguishes a fresh launch from an in-session
  // navigation — it is empty on a cold launch / bookmark open and survives
  // link clicks and Back/Forward, so a reader who deliberately navigates back
  // to the root is never hijacked to an article.
  var freshLaunch = false;
  try {
    freshLaunch = !sessionStorage.getItem(SESSION_KEY);
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch (e) { /* sessionStorage unavailable */ }

  // The fresh-launch fallback exists for the home-screen app that is not a true
  // standalone app. Keep it to touch devices so a desktop visitor who opens the
  // site in a new tab is never bounced to an old article.
  var touch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;

  var saved = readState();
  // Only resume a recent session, so a reader coming back after a long absence
  // still lands on the home page instead of being thrown into an old article.
  var RESUME_WINDOW = 30 * 24 * 60 * 60 * 1000; // 30 days
  var recentEnough = !!(saved && saved.at && Date.now() - saved.at < RESUME_WINDOW);

  if (
    isHome && saved && saved.url &&
    !samePath(saved.url, location.href) &&
    recentEnough && (standalone || (freshLaunch && touch))
  ) {
    // The app reopened at the site root: jump straight back to the page the
    // reader was on. `location.replace` keeps it out of the history stack, so
    // Back still leads to the root the app was launched at.
    redirecting = true;
    location.replace(saved.url);
  } else if (freshLaunch || navType !== "back_forward") {
    // Fresh open (app restart / new tab) or a cold launch: restore the offset.
    restoreIfCurrent();
  }

  // Record the page as soon as it is opened, not only once it is scrolled:
  // otherwise a page that is read without scrolling leaves the previous page
  // as the remembered location. Skipped when we are navigating away, and
  // skipped while a restore is mid-flight (saveRead guards on `restoring`).
  if (!redirecting) saveRead();

  // Re-apply once layout is settled (images etc.) — same position, no jump.
  window.addEventListener("load", restoreIfCurrent);

  // ---------------------------------------------------------------------------
  // hide the bar on scroll down, show on scroll up
  // ---------------------------------------------------------------------------
  // The sticky header slides out of view while reading down and returns on
  // the first upward motion. Skipped while a dropdown is open (it would hide
  // the open menu) and while a scroll restore is mid-flight.
  (function hideOnScroll() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var lastY = scrollTop();
    var HIDE_AFTER = 140;
    var DELTA = 5;
    var ticking = false;
    function update() {
      ticking = false;
      if (restoring) { lastY = scrollTop(); return; }
      var y = scrollTop();
      var dy = y - lastY;
      lastY = y;
      if (document.querySelector(OPEN)) { header.classList.remove("nav-hidden"); return; }
      if (dy > DELTA && y > HIDE_AFTER) header.classList.add("nav-hidden");
      else if (dy < -DELTA || y <= HIDE_AFTER) header.classList.remove("nav-hidden");
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
  })();

  // ---------------------------------------------------------------------------
  // favorites
  // ---------------------------------------------------------------------------
  // The worker is registered on every page so the site keeps working
  // without a connection. Each text (not indexes / utility pages) also gets
  // an "add to favorites" control: the favorites list itself lives in
  // localStorage (shown at /fav.html), and a favorited page is automatically
  // downloaded for offline reading through window.IxoyeOffline
  // (see offline-core.js). Favorites and saved offline bundles are separate
  // things: deleting saved bundles never deletes the favorites list.
  if (window.IxoyeOffline) {
    var OFF = window.IxoyeOffline;
    OFF.register();

    var SKIP_FAV = { "/": 1, "/index.html": 1, "/offline.html": 1, "/poisk.html": 1, "/about.html": 1, "/animation.html": 1, "/pleroma.html": 1, "/fav.html": 1 };

    var FAV_KEY = "ixoye-fav-list";

    function readFav() {
      try {
        var list = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
        return Array.isArray(list) ? list : [];
      } catch (e) { return []; }
    }

    function writeFav(list) {
      try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); }
      catch (e) { /* storage unavailable */ }
    }

    (function addFavControl() {
      var rawPath = location.pathname;
      // Normalise "/x/index.html" -> "/x/" so doc ids match the manifest
      // canonical form and duplicate links don't create duplicate bundles.
      var p = rawPath.replace(/\/index\.html$/i, "/");
      // Section landing pages ("/", "/<dir>/") and utility pages get no
      // per-text favorites button.
      if (SKIP_FAV[p] || SKIP_FAV[rawPath] || /\/$/.test(p)) return;
      var article = document.querySelector("article.content-block");
      if (!article || !article.querySelector("h1")) return;

      var group = "fav:" + p;
      var busy = false;

      var box = document.createElement("div");
      box.className = "fav-save";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fav-save-btn";
      var status = document.createElement("span");
      status.className = "fav-save-status";
      box.appendChild(btn);
      box.appendChild(status);
      article.appendChild(box);

      function pageUrls() {
        var urls = [p];
        function addUrl(raw) {
          if (!raw) return;
          var first = String(raw).split(",")[0].trim().split(" ")[0].trim();
          if (!first || /^(?:data:|https?:|\/\/|#)/i.test(first)) return;
          try {
            var abs = new URL(first, location.href).pathname;
            if (abs.charAt(0) === "/" && urls.indexOf(abs) < 0) urls.push(abs);
          } catch (e) { /* ignore bad src */ }
        }
        var imgs = article.querySelectorAll("img[src]");
        for (var i = 0; i < imgs.length; i++) {
          addUrl(imgs[i].getAttribute("src"));
          addUrl(imgs[i].getAttribute("srcset"));
        }
        var sources = article.querySelectorAll("source[src], source[srcset]");
        for (var s = 0; s < sources.length; s++) {
          addUrl(sources[s].getAttribute("src"));
          addUrl(sources[s].getAttribute("srcset"));
        }
        var posters = article.querySelectorAll("[poster]");
        for (var q = 0; q < posters.length; q++) {
          addUrl(posters[q].getAttribute("poster"));
        }
        return urls;
      }

      function isFav() {
        var list = readFav();
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].u === p) return true;
        }
        return false;
      }

      function pageTitle() {
        var h1 = article.querySelector("h1");
        return ((h1 && h1.textContent) || document.title || p).replace(/\s+/g, " ").trim();
      }

      function sync() {
        if (isFav()) {
          btn.textContent = "★ В избранном";
          btn.classList.add("fav-on");
          if (!status.textContent) status.textContent = "✓ В избранном";
        } else {
          btn.textContent = "☆ В избранное";
          btn.classList.remove("fav-on");
          status.textContent = "";
        }
      }

      btn.addEventListener("click", function () {
        if (busy) return;
        busy = true;
        btn.disabled = true;
        if (isFav()) {
          // Explicit unfavorite: drop the list entry and its auto-saved
          // offline copy. (The favorites list itself is never touched by the
          // /offline.html "delete all" control — see sw.js clearAll.)
          status.textContent = "Убираем…";
          writeFav(readFav().filter(function (it) { return !it || it.u !== p; }));
          busy = false; btn.disabled = false; sync();
          if (OFF.supported && OFF.cachesAvailable) {
            OFF.remove(group).catch(function () {});
          }
          return;
        }
        var list = readFav();
        var title = pageTitle();
        list.push({ u: p, t: title, at: Date.now() });
        writeFav(list);
        busy = false; btn.disabled = false; sync();
        // Favorite pages are saved for offline reading automatically.
        if (OFF.supported && OFF.cachesAvailable) {
          status.textContent = "Сохраняем для офлайн-чтения…";
          OFF.download(group, title, pageUrls()).then(function (res) {
            res = res || {};
            if (res.error && !res.total) status.textContent = "В избранном · не удалось сохранить офлайн-копию: " + res.error;
            else if (res.timeout) status.textContent = "В избранном · сохранение копии продолжается в фоне…";
            else if (res.failed) status.textContent = "В избранном · копия сохранена частично (ошибок: " + res.failed + ")";
            else status.textContent = "✓ В избранном";
            sync();
          }).catch(function () {
            status.textContent = "В избранном · не удалось сохранить офлайн-копию.";
            sync();
          });
        } else {
          status.textContent = "✓ В избранном";
        }
      });

      sync();
    })();
  }
})();
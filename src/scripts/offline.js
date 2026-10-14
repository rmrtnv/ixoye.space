/**
 * offline.js — management UI for /offline.html.
 *
 * Reads offline-manifest.json (generated at maintenance time) for the size of
 * the whole site, checks navigator.storage.estimate() to decide whether the
 * whole thing fits, and drives the service worker through
 * window.IxoyeOffline.
 *
 * There is no separate "saved list": the whole-site button doubles as the
 * status + delete control. A saved site shows an "Удалить весь сайт" button;
 * pressing it removes that bundle. "Удалить всё сохранённое" clears every
 * explicit bundle (the whole site) but preserves the opportunistic cache of
 * visited pages and all favorites bundles (see sw.js clearAll): the favorites
 * list is never deleted from here. Per-text offline copies are made
 * automatically by favoriting (the "☆ В избранное" control on each text).
 */
(function () {
  "use strict";

  var OFF = window.IxoyeOffline;
  var $ = function (id) { return document.getElementById(id); };

  if (!OFF || !OFF.supported || !OFF.cachesAvailable) {
    var note = $("offline-unsupported");
    if (note) note.hidden = false;
    ["offline-storage-section", "offline-whole-section", "offline-doc-section", "offline-clear-section"].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
    return;
  }

  var manifest = null;
  var registry = { groups: [] };
  var busy = false;
  var lastEstimate = null;
  var progressEl, progressBar, progressText, statusEl;

  function setText(el, text) { if (el) el.textContent = text; }

  function setButtonsDisabled(disabled) {
    var nodes = document.querySelectorAll("#offline-whole-btn, #offline-clear-btn");
    for (var i = 0; i < nodes.length; i++) nodes[i].disabled = disabled;
  }

  /** Favorites auto-save bundles never count as deletable "saved" content. */
  function isFavGroup(id) {
    return String(id || "").indexOf("fav:") === 0;
  }

  function findGroup(id) {
    var groups = registry.groups || [];
    for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i];
    return null;
  }

  function plural(n, one, few, many) {
    n = Math.abs(Number(n) || 0);
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function filesText(n) {
    return n + " " + plural(n, "файл", "файла", "файлов");
  }

  function showProgress(p) {
    if (progressEl) progressEl.hidden = false;
    var total = (p && p.total) || 0;
    var done = (p && p.done) || 0;
    var failed = (p && p.failed) || 0;
    if (progressBar) {
      progressBar.style.width = (total ? Math.min(100, Math.round((100 * (done + failed)) / total)) : 0) + "%";
    }
    var text = "Сохранение… " + done + " из " + total;
    if (p && p.bytes) text += " · " + OFF.fmtSize(p.bytes);
    if (failed) text += " · ошибок: " + failed;
    setText(progressText, text);
  }

  function hideProgress() {
    if (progressEl) progressEl.hidden = true;
    if (progressBar) progressBar.style.width = "0";
  }

  function refresh() {
    return Promise.all([OFF.estimate(), OFF.list()]).then(function (res) {
      lastEstimate = res[0] || null;
      registry = res[1] || { groups: [] };
      renderStorage(lastEstimate);
      renderWhole(lastEstimate);
      renderClear();
    }).catch(function () {
      renderStorage(lastEstimate);
      renderWhole(lastEstimate);
      renderClear();
    });
  }

  function renderStorage(est) {
    var out = $("offline-storage");
    if (!out) return;
    if (!est || !est.quota) {
      setText(out, "Размер доступной памяти браузер не сообщает.");
      return;
    }
    var usage = est.usage || 0;
    var free = Math.max(0, est.quota - usage);
    setText(out, "Использовано " + OFF.fmtSize(usage) + " из " + OFF.fmtSize(est.quota) + " · свободно " + OFF.fmtSize(free) + ".");
  }

  function renderWhole(est) {
    var info = $("offline-whole-info");
    var btn = $("offline-whole-btn");
    if (!info || !btn) return;

    var saved = findGroup("site");
    if (saved) {
      var text = "Сохранено на устройстве: " + OFF.fmtSize(saved.bytes || 0) +
        " · " + filesText(saved.urls ? saved.urls.length : 0);
      if (saved.failed) text += " · не удалось: " + saved.failed + ". Нажмите «Удалить» и скачайте заново для повтора.";
      else if (manifest && saved.at) {
        // Manifest has no version stamp; sizes are the staleness signal.
        text += " · сохранено " + new Date(saved.at).toLocaleDateString("ru-RU") + ".";
      }
      setText(info, text);
      btn.textContent = "Удалить весь сайт";
      btn.title = "Удалить сохранённое собрание с устройства";
      btn.disabled = false;
      return;
    }

    if (!manifest) {
      setText(info, "Не удалось прочитать список страниц. Обновите страницу при подключении к сети.");
      btn.textContent = "Сохранить весь сайт";
      btn.disabled = true;
      return;
    }
    var total = manifest.totalBytes || 0;
    var fits = true;
    if (est && est.quota) {
      fits = total + (est.usage || 0) <= est.quota * 0.95;
    }
    var label = "Размер всего собрания: " + OFF.fmtSize(total) + " · " + (manifest.allUrls ? manifest.allUrls.length : (manifest.count || 0)) + " " + plural(manifest.allUrls ? manifest.allUrls.length : 0, "файл", "файла", "файлов") + " (" + (manifest.count || 0) + " стр.).";
    if (!fits) label += " Свободной памяти меньше — добавьте нужные тексты в избранное: они сохраняются для офлайн-чтения автоматически.";
    setText(info, label);
    btn.textContent = "Сохранить весь сайт";
    btn.title = fits ? "" : "Не хватает памяти устройства";
    btn.disabled = !fits;
  }


  function renderClear() {
    var block = $("offline-clear-block");
    if (!block) return;
    var saved = (registry.groups || []).filter(function (g) { return g && !isFavGroup(g.id); });
    block.hidden = saved.length === 0;
  }

  function downloadGroup(group, label, urls) {
    if (busy || !urls || !urls.length) return;
    busy = true;
    setButtonsDisabled(true);
    setText(statusEl, "");
    showProgress({ done: 0, failed: 0, total: urls.length, bytes: 0 });
    OFF.download(group, label, urls).then(function (res) {
      busy = false;
      setButtonsDisabled(false);
      res = res || {};
      if (res.error && !res.total) {
        setText(statusEl, "Не удалось сохранить: " + res.error);
      } else if (res.timeout) {
        setText(statusEl, "Сохранение продолжается в фоне — можно закрыть страницу. Прогресс сохранится при повторном открытии.");
      } else if (res.failed) {
        if (res.total && res.failed === res.total) {
          setText(statusEl, "Ничего не сохранено: сайт недоступен. Проверьте подключение и повторите — частичных данных не осталось.");
          hideProgress();
        } else {
          setText(statusEl, "Готово частично: " + res.failed + " " + plural(res.failed, "файл", "файла", "файлов") + " не удалось сохранить. Удалите пакет и скачайте заново для повтора.");
        }
      } else {
        setText(statusEl, "Сохранено: " + label + " · " + OFF.fmtSize(res.bytes) + ".");
        hideProgress();
      }
      return refresh();
    }).catch(function () {
      busy = false;
      setButtonsDisabled(false);
      setText(statusEl, "Не удалось сохранить. Попробуйте ещё раз.");
    });
  }

  function removeGroup(id, label) {
    if (busy) return;
    busy = true;
    setButtonsDisabled(true);
    OFF.remove(id).then(function (res) {
      busy = false;
      setButtonsDisabled(false);
      if (res && (res.error || res.timeout)) {
        setText(statusEl, "Не удалось удалить. Попробуйте ещё раз.");
      } else {
        setText(statusEl, "Удалено: " + label + ".");
      }
      return refresh();
    }).catch(function () {
      busy = false;
      setButtonsDisabled(false);
      setText(statusEl, "Не удалось удалить. Попробуйте ещё раз.");
    });
  }

  function init() {
    progressEl = $("offline-progress");
    progressBar = $("offline-progress-bar");
    progressText = $("offline-progress-text");
    statusEl = $("offline-status");

    OFF.onProgress = showProgress;

    var wholeBtn = $("offline-whole-btn");
    if (wholeBtn) {
      wholeBtn.addEventListener("click", function () {
        if (busy) return;
        if (findGroup("site")) {
          removeGroup("site", "Весь сайт");
          return;
        }
        if (!manifest) return;
        downloadGroup("site", "Весь сайт", manifest.allUrls || []);
      });
    }
    var clearBtn = $("offline-clear-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (busy) return;
        busy = true;
        setButtonsDisabled(true);
        OFF.removeAll().then(function (res) {
          busy = false;
          setButtonsDisabled(false);
          if (res && (res.error || res.timeout)) {
            setText(statusEl, "Не удалось удалить. Попробуйте ещё раз.");
          } else {
            setText(statusEl, "Сохранённое удалено.");
          }
          return refresh();
        }).catch(function () {
          busy = false;
          setButtonsDisabled(false);
          setText(statusEl, "Не удалось удалить. Попробуйте ещё раз.");
        });
      });
    }

    OFF.register();
    if (OFF.persist) OFF.persist();

    var manifestPromise = fetch("/offline-manifest.json", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });

    Promise.all([OFF.estimate(), OFF.list(), manifestPromise]).then(function (res) {
      lastEstimate = res[0] || null;
      registry = res[1] || { groups: [] };
      manifest = res[2];
      renderStorage(lastEstimate);
      renderWhole(lastEstimate);
      renderClear();
      // Self-heal the app shell in the background: if this install landed
      // with an incomplete shell (failed precache / eviction — the iOS PWA
      // case where even /offline.html falls back to the 503 notice), top up
      // the missing shell files and re-render once repaired.
      try {
        if (OFF.warm && (!("onLine" in navigator) || navigator.onLine !== false)) {
          OFF.warm().then(function (r) {
            if (r && r.repaired) return refresh();
          }).catch(function () {});
        }
      } catch (e) {}
    }).catch(function () {
      renderStorage(lastEstimate);
      renderWhole(lastEstimate);
      renderClear();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

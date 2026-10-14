/**
 * fav.js — the /fav.html favorites list.
 *
 * Favorites live in localStorage ("ixoye-fav-list", shared with the per-text
 * control in nav.js) as [{u, t, at}]. Each row links to the text and offers
 * removal; removing also drops that page's auto-saved offline copy.
 * The list itself is never touched by the /offline.html "delete all" control.
 */
(function () {
  "use strict";

  var FAV_KEY = "ixoye-fav-list";
  var OFF = window.IxoyeOffline;

  function $(id) { return document.getElementById(id); }

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

  function fmtDate(at) {
    try {
      return new Date(at).toLocaleDateString("ru-RU");
    } catch (e) { return ""; }
  }

  function render() {
    var listEl = $("fav-list");
    var emptyEl = $("fav-empty");
    if (!listEl) return;
    var list = readFav().filter(function (it) { return it && it.u; });
    listEl.textContent = "";
    if (emptyEl) emptyEl.hidden = list.length !== 0;
    list.forEach(function (it) {
      var li = document.createElement("li");
      li.className = "offline-row";
      var info = document.createElement("span");
      info.className = "offline-row-info";
      var a = document.createElement("a");
      a.href = it.u;
      a.textContent = it.t || it.u;
      info.appendChild(a);
      if (it.at) {
        var when = document.createElement("span");
        when.className = "offline-muted";
        when.textContent = " — " + fmtDate(it.at);
        info.appendChild(when);
      }
      li.appendChild(info);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "offline-btn";
      del.textContent = "Убрать";
      del.title = "Убрать из избранного";
      (function (u) {
        del.addEventListener("click", function () {
          writeFav(readFav().filter(function (x) { return !x || x.u !== u; }));
          if (OFF && OFF.supported && OFF.cachesAvailable && OFF.remove) {
            try { OFF.remove("fav:" + u).catch(function () {}); } catch (e) {}
          }
          render();
        });
      })(it.u);
      li.appendChild(del);
      listEl.appendChild(li);
    });
  }

  if (OFF) OFF.register();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
  window.addEventListener("pageshow", render);
})();

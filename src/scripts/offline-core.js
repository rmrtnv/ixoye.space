/**
 * offline-core.js — shared API for ixoye.space offline reading.
 *
 * Loaded on every page (before nav.js) so both /offline.html and the
 * per-article "download for offline" control can talk to the service worker
 * through the same tiny interface. No dependencies, no build step.
 */
(function () {
  "use strict";

  var SW_URL = "/sw.js";
  var _regPromise = null;
  var READY_TIMEOUT = 15000;
  var READY_POLL = 300;

  /** Whatever can receive postMessage right now, or null. */
  function currentTarget() {
    var sw = null;
    try {
      if (navigator.serviceWorker.controller) sw = navigator.serviceWorker.controller;
    } catch (e) {}
    return sw;
  }

  function registrationTarget() {
    var p = null;
    try { p = navigator.serviceWorker.getRegistration(); }
    catch (e) { return Promise.resolve(null); }
    return Promise.resolve(p).then(function (reg) {
      if (!reg) return null;
      return reg.active || reg.waiting || reg.installing || null;
    }).catch(function () { return null; });
  }

  /**
   * Resolve with a postable worker. Deliberately does NOT rely on
   * `navigator.serviceWorker.ready`: on iOS home-screen apps that promise
   * is known to stay unsettled (e.g. a new worker stuck in `installing`
   * after a failed precache) while a controller is already serving the page.
   * Polls registration + controller and also listens for controllerchange.
   */
  function waitForWorker(ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = null;
      var poll = null;
      function cleanup() {
        clearTimeout(timer);
        if (poll) clearInterval(poll);
        try { navigator.serviceWorker.removeEventListener("controllerchange", onChange); } catch (e) {}
      }
      function done(sw) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(sw);
      }
      function fail(e) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      }
      function onChange() {
        var sw = currentTarget();
        if (sw) done(sw);
        else kick();
      }
      function kick() {
        registrationTarget().then(function (sw) {
          if (settled) return;
          if (sw) done(sw);
          else {
            var c = currentTarget();
            if (c) done(c);
          }
        });
      }
      timer = setTimeout(function () {
        // Last chance: whatever exists wins over an error.
        registrationTarget().then(function (sw) {
          var c = sw || currentTarget();
          if (c) done(c);
          else fail(new Error("service worker ready timeout"));
        });
      }, ms);
      try { navigator.serviceWorker.addEventListener("controllerchange", onChange); } catch (e) {}
      kick();
      poll = setInterval(kick, READY_POLL);
    });
  }

  function ready() {
    if (!("serviceWorker" in navigator)) {
      return Promise.reject(new Error("service worker unsupported"));
    }
    // register() is called from nav.js on every page; make sure a registration
    // exists before looking for a worker to talk to.
    if (!_regPromise) CORE.register();
    return _regPromise.then(function (ok) {
      if (!ok) throw new Error("service worker registration failed");
      return waitForWorker(READY_TIMEOUT);
    }).then(function (sw) {
      if (!sw) throw new Error("service worker not active yet");
      return sw;
    });
  }

  function uid() {
    return "o" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  /**
   * Send `type` to the worker and resolve with the matching
   * `type + ":done"` reply (or `{ timeout:true }` / `{ error }`).
   */
  function request(type, payload) {
    return ready().then(function (sw) {
      var id = uid();
      if (!sw) return { error: "no-worker", type: type };
      return new Promise(function (resolve) {
        var timer = null;
        function cleanup() {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener("message", onMessage);
        }
        function onMessage(e) {
          var d = e.data || {};
          if (d._id === id && (d.type === type + ":done" || d.type === type + ":error")) {
            cleanup();
            resolve(d);
          }
        }
        timer = setTimeout(function () {
          cleanup();
          resolve({ timeout: true, type: type });
        }, 30000);
        navigator.serviceWorker.addEventListener("message", onMessage);
        var msg = { type: type, _id: id };
        for (var k in payload) msg[k] = payload[k];
        try {
          sw.postMessage(msg);
        } catch (e) {
          cleanup();
          resolve({ error: String((e && e.message) || e), type: type });
        }
      });
    }).catch(function (e) {
      return { error: String((e && e.message) || e), type: type };
    });
  }

  var CORE = {
    supported: "serviceWorker" in navigator,
    cachesAvailable: "caches" in window,

    /** Register the worker once; resolves true/false. */
    register: function () {
      if (!CORE.supported) return Promise.resolve(false);
      if (_regPromise) return _regPromise;
      _regPromise = navigator.serviceWorker.register(SW_URL)
        .then(function () { return true; })
        .catch(function () { return false; });
      return _regPromise;
    },

    ready: ready,

    /** navigator.storage.estimate(), or null when unavailable. */
    estimate: function () {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().catch(function () { return null; });
      }
      return Promise.resolve(null);
    },

    /** Ask the browser to keep origin storage (best-effort, never rejects). */
    persist: function () {
      try {
        if (navigator.storage && navigator.storage.persist) {
          return navigator.storage.persist().catch(function () { return false; });
        }
      } catch (e) { /* storage unavailable */ }
      return Promise.resolve(false);
    },

    /** Download a bundle `{group,label,urls}`; resolve with the done reply. */
    download: function (group, label, urls) {
      if (!Array.isArray(urls) || !urls.length) {
        return Promise.resolve({ ok: false, failed: 1, bytes: 0, total: 0 });
      }
      return ready().then(function (sw) {
        var id = uid();
        if (!sw) return { error: "no-worker", group: group };
        return new Promise(function (resolve) {
          var timer = null;
          function cleanup() {
            clearTimeout(timer);
            navigator.serviceWorker.removeEventListener("message", onMessage);
          }
          function onMessage(e) {
            var d = e.data || {};
            if (d._id !== id) return;
            if (d.type === "offline:progress") {
              if (CORE.onProgress) CORE.onProgress(d);
            } else if (d.type === "offline:done" || d.type === "offline:error") {
              cleanup();
              if (d.type === "offline:done" && CORE.onProgress) {
                CORE.onProgress({ type: "offline:progress", _id: id, done: d.total, failed: d.failed, total: d.total, bytes: d.bytes });
              }
              resolve(d);
            }
          }
          // Long downloads (the whole site) are driven by the worker; give it
          // plenty of time, and resolve soft so the UI can say "still running".
          timer = setTimeout(function () {
            cleanup();
            resolve({ timeout: true, group: group });
          }, 30 * 60 * 1000);
          navigator.serviceWorker.addEventListener("message", onMessage);
          try {
            sw.postMessage({ type: "offline:download", _id: id, group: group, label: label, urls: urls });
          } catch (e) {
            cleanup();
            resolve({ error: String((e && e.message) || e), group: group });
          }
        });
      }).catch(function (e) {
        return { error: String((e && e.message) || e), group: group };
      });
    },

    /** Remove one bundle. Resolves with `{group}` (or `{timeout:true}` / `{error}`). */
    remove: function (group) {
      return request("offline:remove", { group: group });
    },

    /** Remove every explicit bundle. */
    removeAll: function () {
      return request("offline:clear", {});
    },

    /** Resolve with the group registry `{ groups: [...] }` (never rejects). */
    list: function () {
      return request("offline:list", {}).then(function (d) { return (d && d.meta) || { groups: [] }; });
    },

    /**
     * Top up the app shell in the worker (repairs a failed precache or an
     * evicted shell). Resolves `{ repaired }` / `{ timeout }` / `{ error }`.
     */
    warm: function () {
      return request("offline:warm", {});
    },

    /** Human-readable byte size (RU). */
    fmtSize: function (n) {
      n = Number(n) || 0;
      if (n < 1024) return n + " Б";
      var kb = n / 1024;
      if (kb < 1024) return kb.toFixed(1).replace(/\.0$/, "") + " КБ";
      var mb = kb / 1024;
      if (mb < 1024) return mb.toFixed(1).replace(/\.0$/, "") + " МБ";
      return (mb / 1024).toFixed(1).replace(/\.0$/, "") + " ГБ";
    },
  };

  window.IxoyeOffline = CORE;
})();

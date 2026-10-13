/**
 * sw.js — ixoye.space service worker (offline reading).
 *
 * Cache layers:
 *
 *   ixoye-shell-v<ver>      core app files, installed with the worker
 *   ixoye-offline-data-v<ver>  opportunistic cache: anything fetched while
 *                           online (visited pages, css, images) so recently
 *                           looked-at content is available offline by itself
 *   ixoye-offline-<group>   explicit offline bundles requested from
 *                           /offline.html ("site", "section:<dir>") or from a
 *                           text's own "download for offline" button
 *                           ("doc:<path>")
 *
 * Serving is cache-first for every same-origin GET. Navigations that are
 * neither cached nor reachable offline fall back to /offline.html.
 *
 * Downloads run inside `event.waitUntil` of an ExtendableMessageEvent.
 * Progress is broadcast to all windows; completion is both sent back to the
 * sender and broadcast, because `event.source` can be null for uncontrolled
 * clients. The group registry lives in the stable META_CACHE as JSON.
 *
 * Protocol (page -> worker):
 *   { type:"offline:download", _id, group, label, urls[] }
 *   { type:"offline:remove",   _id, group }
 *   { type:"offline:clear",    _id }
 *   { type:"offline:list",     _id }
 * Worker -> page:
 *   { type:"offline:progress", _id, done, total, bytes, failed }   (all windows)
 *   { type:"offline:done",     _id, group, ok, failed, bytes, total }
 *   { type:"offline:list:done",_id, meta }
 *   { type:"offline:remove:done", _id, group }
 *   { type:"offline:clear:done",  _id }
 *   { type:"offline:warm:done",  _id, repaired }
 *   { type:"<any>:error", _id, error }  on failure (also broadcast)
 */
"use strict";

var VERSION = "6";
var SHELL_CACHE = "ixoye-shell-v" + VERSION;
var DATA_CACHE = "ixoye-offline-data-v" + VERSION;
// The group registry lives in its own stable cache (not the versioned shell
// cache) so an app update never orphans the record of what's already saved.
var META_CACHE = "ixoye-meta";
var META_KEY = "__ixoye-offline-meta__";

// Core files every offline session needs. Kept tiny; pages/sections are added
// by explicit downloads or by the opportunistic cache.
var SHELL_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/src/styles/main.css",
  "/src/scripts/nav.js",
  "/src/scripts/offline-core.js",
  "/src/scripts/offline.js",
  "/offline-manifest.json",
];

// Without these two the app has no offline landing page at all, so install
// must not activate without them (iOS PWA test caught a worker that had
// activated with a broken shell after a failed precache evicted the old one).
var SHELL_CRITICAL = ["/", "/offline.html"];

// Pathnames served from SHELL_URLS: online responses for these heal the shell
// cache instead of landing in the opportunistic data cache (see fetch below).
var SHELL_PATHS = {};
SHELL_URLS.forEach(function (u) {
  try { SHELL_PATHS[new URL(u, self.location.origin).pathname] = 1; } catch (e) {}
});

function postAll(msg) {
  self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    clients.forEach(function (client) {
      try { client.postMessage(msg); } catch (e) { /* client gone */ }
    });
  });
}

function reply(event, msg) {
  if (event && event.source && event.source.postMessage) {
    try { event.source.postMessage(msg); } catch (e) { /* client gone */ }
  }
}

/** Deliver to the sender (when known) and to every window (for null sources). */
function replyAll(event, msg) {
  reply(event, msg);
  postAll(msg);
}

function cacheNameFor(id) {
  return "ixoye-offline-" + String(id);
}

function isDataCache(name) {
  return name === DATA_CACHE || name.indexOf("ixoye-offline-data-") === 0;
}

/** Explicit per-group bundle caches only (never shell / data / meta). */
function isGroupCache(name) {
  return name.indexOf("ixoye-offline-") === 0 && !isDataCache(name);
}

function isOurs(name) {
  return name === SHELL_CACHE || isDataCache(name) || isGroupCache(name) ||
    name.indexOf("ixoye-shell-") === 0;
}

/** Lower number = searched first. */
function cachePriority(name) {
  if (name === SHELL_CACHE) return 0;
  if (name === DATA_CACHE || name.indexOf("ixoye-offline-data-") === 0) return 1;
  return 2;
}

function readMeta() {
  return caches.open(META_CACHE).then(function (c) {
    return c.match(META_KEY).then(function (res) {
      if (!res) return { groups: [] };
      return res.json().then(function (meta) {
        if (!meta || !Array.isArray(meta.groups)) return { groups: [] };
        return meta;
      });
    }).catch(function () {
      return { groups: [] };
    });
  });
}

function writeMeta(meta) {
  return caches.open(META_CACHE).then(function (c) {
    return c.put(META_KEY, new Response(JSON.stringify(meta), {
      headers: { "Content-Type": "application/json" },
    }));
  });
}

/**
 * Re-fetch any SHELL_URLS missing from the shell cache (failed precache,
 * eviction under storage pressure, interrupted update). Misses are tolerated
 * here — this is best-effort healing, not install. Resolves { repaired }.
 */
function topUpShell() {
  return caches.open(SHELL_CACHE).then(function (c) {
    return Promise.all(SHELL_URLS.map(function (u) {
      return c.match(u).then(function (hit) {
        if (hit) return null;
        return fetch(u).then(function (res) {
          if (res && res.ok) {
            return c.put(u, res.clone()).then(
              function () { return u; },
              function () { return null; });
          }
          return null;
        }).catch(function () { return null; });
      }).catch(function () { return null; });
    }));
  }).then(function (fixed) {
    var n = 0;
    fixed.forEach(function (u) { if (typeof u === "string") n++; });
    return { repaired: n };
  }).catch(function () { return { repaired: 0 }; });
}

/**
 * Equivalent URLs for cache lookup: "/x/" === "/x/index.html",
 * "/" === "/index.html". Query strings are preserved; hashes never reach us.
 */
function aliasUrls(href) {
  var out = [href];
  try {
    var u = new URL(href);
    var p = u.pathname;
    var cand = null;
    if (p === "/") {
      cand = "/index.html";
    } else if (/\/index\.html$/i.test(p)) {
      cand = p.replace(/\/index\.html$/i, "/");
    } else if (p.charAt(p.length - 1) === "/") {
      cand = p + "index.html";
    }
    if (cand) {
      var alt = new URL(u.href);
      alt.pathname = cand;
      if (alt.href !== href) out.push(alt.href);
    }
  } catch (e) { /* keep original only */ }
  return out;
}

/* Look a request up in every ixoye cache: shell first, then data, then groups. */
function matchAny(req) {
  var href;
  try {
    href = req instanceof Request ? req.url : String(req.url || req);
  } catch (e) {
    return Promise.resolve(null);
  }
  var candidates = aliasUrls(href);
  // Versioned asset URLs (main.css?v=<hash>) share one canonical entry so
  // cache-busting queries neither fragment the cache nor miss the precache.
  try {
    var u = new URL(href);
    if (u.search && SHELL_PATHS[u.pathname]) {
      var canon = new URL(u.href);
      canon.search = "";
      if (canon.href !== href) candidates.push(canon.href);
    }
  } catch (e) { /* keep aliases only */ }
  return caches.keys().then(function (keys) {
    var names = keys.filter(isOurs).sort(function (a, b) {
      return cachePriority(a) - cachePriority(b);
    });
    var chain = Promise.resolve(null);
    names.forEach(function (name) {
      chain = chain.then(function (hit) {
        if (hit) return hit;
        return caches.open(name).then(function (c) {
          var inner = Promise.resolve(null);
          candidates.forEach(function (cand) {
            inner = inner.then(function (m) {
              if (m) return m;
              return c.match(cand).catch(function () { return null; });
            });
          });
          return inner;
        }).then(function (m) {
          return m || null;
        }).catch(function () { return null; });
      });
    });
    return chain;
  });
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

self.addEventListener("install", function (event) {
  // Precache the core files, tolerating individual failures: downloads and
  // messaging must work even with shell gaps (a worker stuck in `installing`
  // strands every client — on iOS that surfaces as "ready timeout" on all
  // buttons). Gaps are healed by topUpShell() on activate and by shell-path
  // routing in fetch; activate keeps old shells when critical files missed.
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) {
      return Promise.all(SHELL_URLS.map(function (u) {
        return fetch(u).then(function (res) {
          if (res && res.ok) return c.put(u, res.clone()).catch(function () { return null; });
          return null;
        }).catch(function () { return null; });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/** True when the new shell holds its critical files (offline landing page). */
function shellComplete() {
  return caches.open(SHELL_CACHE).then(function (c) {
    return Promise.all(SHELL_CRITICAL.map(function (u) {
      return c.match(u).then(function (hit) { return !!hit; })
        .catch(function () { return false; });
    }));
  }).then(function (flags) {
    for (var i = 0; i < flags.length; i++) if (!flags[i]) return false;
    return true;
  }).catch(function () { return false; });
}

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      var oldShells = keys.filter(function (k) {
        return k.indexOf("ixoye-shell-") === 0 && k !== SHELL_CACHE;
      });
      // The saved-bundle registry used to live *inside* the shell cache (v≤3);
      // move it into the version-stable META_CACHE before the old shell cache
      // is deleted, or a version bump would orphan all saved sections/texts.
      // Group caches "ixoye-offline-<id>" are never deleted by version bumps.
      var migrate = caches.open(META_CACHE).then(function (metaCache) {
        return metaCache.match(META_KEY).then(function (existing) {
          if (existing) return null;
          var chain = Promise.resolve(null);
          oldShells.forEach(function (name) {
            chain = chain.then(function (found) {
              if (found) return found;
              return caches.open(name).then(function (c) { return c.match(META_KEY); })
                .catch(function () { return null; });
            });
          });
          return chain.then(function (res) { if (res) return metaCache.put(META_KEY, res.clone()).catch(function () {}); });
        });
      });
      return migrate.then(function () {
        // Delete old shells only when the new shell can serve the offline
        // landing page; otherwise keep them (matchAny still finds the old
        // copy) and let topUpShell() heal the new one. Deleting a good old
        // shell for a broken new one was the iOS PWA 503.
        return shellComplete().then(function (ok) {
          if (!ok) return null;
          return Promise.all(
            keys.filter(function (k) {
              return (k.indexOf("ixoye-shell-") === 0 || k.indexOf("ixoye-offline-data-") === 0) && k !== SHELL_CACHE && k !== DATA_CACHE;
            }).map(function (k) { return caches.delete(k); })
          );
        });
      }).then(function () {
        // Heal any shell gaps left by a failed precache or an eviction before
        // this worker takes over serving.
        return topUpShell();
      });
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ---------------------------------------------------------------------------
// serving
// ---------------------------------------------------------------------------

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  // Registry key, not a page: never intercept even if pathed as "/__ixoye-…".
  if (url.pathname.indexOf(META_KEY) !== -1) return;

  event.respondWith(
    matchAny(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          var keep = req.mode === "navigate" ||
            url.pathname.indexOf("/src/") === 0 ||
            /\.(css|mjs|js|json|webmanifest|xml|svg|ttf|otf|woff2?|jpg|jpeg|gif|png|webp|avif|ico|bmp|pdf)$/i.test(url.pathname);
          if (keep) {
            // Shell files heal the shell cache (repairs failed precaches and
            // evictions); everything else goes to the opportunistic cache.
            // Versioned shell URLs are stored under the canonical (queryless)
            // key so ?v= hashes never fragment the cache.
            var target = SHELL_PATHS[url.pathname] ? SHELL_CACHE : DATA_CACHE;
            var putKey = (url.search && SHELL_PATHS[url.pathname]) ? (url.origin + url.pathname) : req;
            caches.open(target).then(function (c) { return c.put(putKey, copy).catch(function () {}); }).catch(function () {});
          }
          return res;
        }
        // Client errors (404, …) are real answers — show them as-is.
        // Only a network failure (below) means "offline".
        return res;
      }).catch(function () {
        if (req.mode === "navigate") return offlineFallback();
        return new Response("", { status: 504, statusText: "Offline" });
      });
    })
  );
});

/** The offline landing page, or a plain notice if it was never cached. */
function offlineFallback() {
  // Alias-aware lookup across every ixoye cache (shell, data, groups):
  // matches "/offline.html" however it was stored and finds it inside an
  // explicit "site" bundle too, not just the shell cache.
  var base = self.location.origin;
  var urls = [base + "/offline.html", base + "/", base + "/index.html"];
  var chain = Promise.resolve(null);
  urls.forEach(function (u) {
    chain = chain.then(function (hit) {
      if (hit) return hit;
      return matchAny(u);
    });
  });
  return chain.then(function (hit) {
    if (hit) return hit;
    return new Response(
      "<!doctype html><meta charset=\"utf-8\"><title>Нет подключения</title>" +
      "<h1>Нет подключения</h1><p>Эта страница не сохранена для офлайн-чтения.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  });
}

// ---------------------------------------------------------------------------
// download / manage bundles
// ---------------------------------------------------------------------------

/**
 * Fetch every URL in `data.urls`, store it in the group cache, and record the
 * group in the registry. Runs with limited concurrency (6 in flight).
 * Never rejects: quota/network failures are counted in `failed`.
 */
function download(data) {
  var seen = {};
  var urls = [];
  (data.urls || []).forEach(function (u) {
    var key = String(u);
    if (!seen[key]) { seen[key] = 1; urls.push(u); }
  });
  var group = String(data.group || "site");
  var label = String(data.label || "Офлайн-пакет");
  var total = urls.length;
  var cacheName = cacheNameFor(group);
  var done = 0;
  var failed = 0;
  var bytes = 0;

  function finishTimer(timer) { try { clearInterval(timer); } catch (e) {} }

  return caches.open(cacheName).then(function (cache) {
    var idx = 0;
    var progress = function () {
      postAll({ type: "offline:progress", _id: data._id, done: done, failed: failed, total: total, bytes: bytes });
    };
    var timer = setInterval(progress, 250);

    function workOne() {
      if (idx >= total) return Promise.resolve();
      var u = urls[idx++];
      var href;
      try { href = new URL(u, self.location.origin).href; } catch (e) {
        failed++; return workOne();
      }
      return fetch(href, { credentials: "same-origin" }).then(function (res) {
        if (!res || !res.ok) { failed++; return workOne(); }
        // Clone before put so bytes are measured from the network body, not
        // the Content-Length header (which may be the compressed size).
        var meas = null;
        try { meas = res.clone(); } catch (e) { meas = null; }
        return cache.put(href, res).then(function () {
          if (!meas) return null;
          return meas.blob().catch(function () { return null; });
        }).then(function (blob) {
          if (blob && blob.size) bytes += blob.size;
          done++;
          return workOne();
        }).catch(function () { failed++; return workOne(); });
      }).catch(function () { failed++; return workOne(); });
    }

    var CONCURRENCY = 6;
    var workers = [];
    var i;
    for (i = 0; i < CONCURRENCY; i++) workers.push(workOne());
    return Promise.all(workers).then(function () {
      finishTimer(timer);
      // Final progress so bars stuck on an interval boundary still complete.
      progress();
      return readMeta().then(function (meta) {
        // A fully-failed run is not "saved": drop any stale record so the UI
        // offers a retry instead of blocking sections as part of "site".
        if (total > 0 && failed >= total) {
          meta.groups = meta.groups.filter(function (g) { return g.id !== group; });
          return writeMeta(meta).catch(function () {}).then(function () {
            return { group: group, ok: false, failed: failed, bytes: bytes, total: total };
          });
        }
        var rec = { id: group, label: label, urls: urls, bytes: bytes, failed: failed, at: Date.now() };
        var k = -1;
        var j;
        for (j = 0; j < meta.groups.length; j++) if (meta.groups[j].id === group) { k = j; break; }
        if (k >= 0) meta.groups[k] = rec; else meta.groups.push(rec);
        return writeMeta(meta).catch(function () {}).then(function () {
          return { group: group, ok: failed === 0, failed: failed, bytes: bytes, total: total };
        });
      });
    }).catch(function (e) {
      finishTimer(timer);
      return { group: group, ok: false, failed: total, bytes: bytes, total: total, error: String((e && e.message) || e) };
    });
  }).catch(function (e) {
    return { group: group, ok: false, failed: total, bytes: 0, total: total, error: String((e && e.message) || e) };
  });
}

function remove(group) {
  return caches.delete(cacheNameFor(group)).then(function () {
    return readMeta().then(function (meta) {
      meta.groups = meta.groups.filter(function (g) { return g.id !== group; });
      return writeMeta(meta).then(function () { return { group: group }; });
    });
  });
}

/** Delete explicit bundles only; the opportunistic data cache is preserved. */
function clearAll() {
  return caches.keys().then(function (keys) {
    return Promise.all(
      keys.filter(isGroupCache)
        .map(function (k) { return caches.delete(k); })
    );
  }).then(function () {
    return readMeta().then(function (meta) {
      meta.groups = [];
      return writeMeta(meta).then(function () { return {}; });
    });
  });
}

self.addEventListener("message", function (event) {
  var data = event.data || {};

  if (data.type === "offline:download") {
    event.waitUntil(
      download(data).then(function (res) {
        if (res && res.error && res.total === 0) {
          replyAll(event, { type: "offline:error", _id: data._id, group: res.group, error: res.error });
        } else {
          replyAll(event, {
            type: "offline:done", _id: data._id,
            group: res.group, ok: res.ok, failed: res.failed, bytes: res.bytes, total: res.total,
          });
        }
      }).catch(function (e) {
        replyAll(event, { type: "offline:error", _id: data._id, group: data.group, error: String((e && e.message) || e) });
      })
    );
    return;
  }

  if (data.type === "offline:remove") {
    event.waitUntil(remove(data.group).then(function () {
      replyAll(event, { type: "offline:remove:done", _id: data._id, group: data.group });
    }).catch(function (e) {
      replyAll(event, { type: "offline:remove:error", _id: data._id, group: data.group, error: String((e && e.message) || e) });
    }));
    return;
  }

  if (data.type === "offline:clear") {
    event.waitUntil(clearAll().then(function () {
      replyAll(event, { type: "offline:clear:done", _id: data._id });
    }).catch(function (e) {
      replyAll(event, { type: "offline:clear:error", _id: data._id, error: String((e && e.message) || e) });
    }));
    return;
  }

  if (data.type === "offline:list") {
    event.waitUntil(readMeta().then(function (meta) {
      replyAll(event, { type: "offline:list:done", _id: data._id, meta: meta });
    }).catch(function (e) {
      replyAll(event, { type: "offline:list:error", _id: data._id, error: String((e && e.message) || e) });
    }));
    return;
  }

  if (data.type === "offline:warm") {
    event.waitUntil(topUpShell().then(function (r) {
      replyAll(event, { type: "offline:warm:done", _id: data._id, repaired: r.repaired });
    }).catch(function (e) {
      replyAll(event, { type: "offline:warm:error", _id: data._id, error: String((e && e.message) || e) });
    }));
    return;
  }
});

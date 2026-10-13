#!/usr/bin/env node
/**
 * version-assets.mjs — cache-bust CSS/JS with content hashes.
 *
 * Device and SW caches keep serving an old `main.css` long after a styling
 * change ships (seen on iPhones where neither reload nor PWA reinstall
 * refreshed the look). A content hash in the query (`main.css?v=1a2b3c4d`)
 * forces every cache layer to fetch the new file, while the service worker
 * maps `?v=` URLs back to canonical cache keys (see sw.js SHELL_PATHS) so
 * the cache does not fragment per version.
 *
 * Usage:
 *   node scripts/version-assets.mjs            # dry-run report
 *   node scripts/version-assets.mjs --write    # rewrite URLs in place
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectPages, ROOT } from "./site-utils.mjs";

const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
const WRITE = process.argv.includes("--write");

// Public URL -> repo-relative file. Hashed independently so editing one
// asset invalidates only that asset.
const ASSETS = {
  "/src/styles/main.css": "src/styles/main.css",
  "/src/scripts/nav.js": "src/scripts/nav.js",
  "/src/scripts/offline-core.js": "src/scripts/offline-core.js",
  "/src/scripts/offline.js": "src/scripts/offline.js",
};

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function build() {
  const hashes = {};
  for (const [url, file] of Object.entries(ASSETS)) {
    const data = fs.readFileSync(path.join(ROOT, file));
    hashes[url] = crypto.createHash("md5").update(data).digest("hex").slice(0, 8);
  }

  const patterns = Object.entries(hashes).map(([url, hash]) => ({
    url,
    hash,
    re: new RegExp(`((?:href|src)\\s*=\\s*["'])${escRe(url)}(\\?v=[^"']*)?(["'])`, "gi"),
    replacement: `$1${url}?v=${hash}$3`,
  }));

  let filesChanged = 0;
  let urlsChanged = 0;
  for (const file of collectPages()) {
    const html = fs.readFileSync(file, "utf8");
    let out = html;
    let n = 0;
    for (const p of patterns) {
      out = out.replace(p.re, (m, pre, _old, post, offset, str) => {
        // Skip if the exact versioned URL is already in place.
        const want = `${pre}${p.url}?v=${p.hash}${post}`;
        if (str.startsWith(want, offset)) return m;
        n++;
        return want;
      });
    }
    if (out !== html) {
      filesChanged++;
      urlsChanged += n;
      if (WRITE) fs.writeFileSync(file, out, "utf8");
    }
  }
  return { filesChanged, urlsChanged, hashes };
}

if (IS_MAIN) {
  const r = build();
  console.log(
    `version-assets: ${r.urlsChanged} URLs in ${r.filesChanged} files` +
    (WRITE ? " (WRITTEN)" : " (dry-run)")
  );
  for (const [url, hash] of Object.entries(r.hashes)) console.log(`  ${url}?v=${hash}`);
}

export { build };

#!/usr/bin/env node
/**
 * generate-offline-manifest.mjs — build offline-manifest.json.
 *
 * The /offline.html page needs to know two things the service worker cannot
 * discover on its own before downloading: how big the whole site is, and how
 * big each section is. This script reads sitemap.xml (the canonical URL list,
 * already checked by CI) and the local files to produce that data:
 *
 *   {
 *     count, totalBytes,
 *     shell:   { label, items:[{u,b}], bytes },
 *     search:  { id, label, items:[{u,b}], bytes },
 *     sections:[ { id, label, count, bytes, items:[{u,t,b}], images:[{u,b}] } ],
 *     root:    { id, label, count, bytes, items:[{u,t,b}], images:[{u,b}] },
 *     allUrls: [ "/", "/about.html", … ]      // download order for "whole site"
 *   }
 *
 * Usage:
 *   node scripts/generate-offline-manifest.mjs            # dry-run report
 *   node scripts/generate-offline-manifest.mjs --write    # write offline-manifest.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./site-utils.mjs";
import { SECTIONS } from "./structurize-pages.mjs";

const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
const WRITE = process.argv.includes("--write");
const OUT = path.join(ROOT, "offline-manifest.json");

// Core files an offline session always needs (installed with the worker).
const SHELL_FILES = [
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
const SEARCH_FILES = ["/poisk.html", "/search-index.json"];
const SECTION_DIRS = new Set(SECTIONS.map((s) => s.dir));
const SECTION_LABEL = new Map(SECTIONS.map((s) => [s.dir, s.label]));

const IMG_RE = /<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi;
const SRCSET_RE = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
const SOURCE_RE = /<source\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi;
const POSTER_RE = /\bposter\s*=\s*["']?([^"'\s>]+)/gi;
const LINK_ASSET_RE = /<a\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)/gi;
const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function fileForPath(pathname) {
  let p = pathname;
  try { p = decodeURIComponent(pathname); } catch { /* keep raw */ }
  if (p === "/" || p.endsWith("/")) p += "index.html";
  return path.join(ROOT, p.replace(/^\/+/, ""));
}

function statBytes(file) {
  try { return fs.statSync(file).size; } catch { return null; }
}

function pageTitle(html, fallback) {
  const h1 = html.match(H1_RE);
  if (h1) {
    const t = stripTags(h1[1]);
    if (t) return t;
  }
  const title = html.match(TITLE_RE);
  if (title) {
    return stripTags(title[1]).replace(/\s*[—–-]\s*Русская Апокрифическая Студия\s*$/i, "").trim() || fallback;
  }
  return fallback;
}

/** Local asset targets referenced by a page, resolved against the page URL. */
function pageImages(html, pageUrl) {
  const out = [];
  const seen = new Set();
  function addRaw(raw) {
    if (!raw) return;
    // srcset lists ("a.jpg 480w, b.jpg 2x"): each comma-entry's first token.
    const parts = String(raw).split(",");
    for (const part of parts) {
      const token = part.trim().split(/\s+/)[0];
      if (!token || /^(?:data:|https?:|#|\/\/)/i.test(token)) continue;
      let url;
      try { url = new URL(token, "https://ixoye.space" + pageUrl); } catch { continue; }
      if (url.origin !== "https://ixoye.space") continue;
      const u = url.pathname;
      // Requires a local asset extension (skips broken legacy refs like
      // <img src="../#"> that resolve to "/").
      if (!/\.(?:jpe?g|gif|png|svg|webp|avif|ico|bmp|pdf|ttf|otf|woff2?|mp4|webm|mp3)$/i.test(u)) continue;
      if (seen.has(u)) continue;
      const bytes = statBytes(fileForPath(u));
      if (bytes == null) continue;
      seen.add(u);
      out.push({ u, b: bytes });
    }
  }
  let m;
  IMG_RE.lastIndex = 0;
  while ((m = IMG_RE.exec(html))) addRaw(m[1]);
  SRCSET_RE.lastIndex = 0;
  while ((m = SRCSET_RE.exec(html))) addRaw(m[1]);
  SOURCE_RE.lastIndex = 0;
  while ((m = SOURCE_RE.exec(html))) addRaw(m[1]);
  POSTER_RE.lastIndex = 0;
  while ((m = POSTER_RE.exec(html))) addRaw(m[1]);
  LINK_ASSET_RE.lastIndex = 0;
  while ((m = LINK_ASSET_RE.exec(html))) {
    // Only linked downloadable assets, not page navigation.
    if (/\.(?:pdf|mp4|webm|mp3)$/i.test(m[1])) addRaw(m[1]);
  }
  return out;
}

function groupForPath(pathname) {
  const seg = pathname.replace(/^\/+/, "").split("/")[0];
  return SECTION_DIRS.has(seg) ? seg : "root";
}

function build() {
  const sitemapFile = path.join(ROOT, "sitemap.xml");
  const sitemap = fs.readFileSync(sitemapFile, "utf8");
  const locs = [...sitemap.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/g)].map((m) => m[1].trim());

  const shellItems = [];
  for (const u of SHELL_FILES) {
    const bytes = statBytes(fileForPath(u));
    if (bytes == null) throw new Error(`shell file missing: ${u}`);
    shellItems.push({ u, b: bytes });
  }

  const searchItems = SEARCH_FILES.map((u) => ({ u, b: statBytes(fileForPath(u)) || 0 }));

  const sections = new Map(); // dir -> { items, images:Map }
  const root = { items: [], images: new Map() };
  let pageCount = 0;

  for (const loc of locs) {
    let url;
    try { url = new URL(loc); } catch { continue; }
    if (url.origin !== "https://ixoye.space") continue;
    const pathname = url.pathname;
    if (pathname === "/" || SEARCH_FILES.includes(pathname)) continue;

    const file = fileForPath(pathname);
    const bytes = statBytes(file);
    if (bytes == null) continue; // sitemap entry without a local file

    const html = fs.readFileSync(file, "utf8");
    const item = { u: pathname, t: pageTitle(html, pathname), b: bytes };
    const key = groupForPath(pathname);
    const bucket = key === "root" ? root : (sections.get(key) || (sections.set(key, { items: [], images: new Map() }), sections.get(key)));
    bucket.items.push(item);
    for (const img of pageImages(html, pathname)) {
      if (!bucket.images.has(img.u)) bucket.images.set(img.u, img);
    }
    pageCount++;
  }

  const sectionList = [];
  for (const { dir, label } of SECTIONS) {
    const bucket = sections.get(dir);
    if (!bucket || !bucket.items.length) continue;
    const items = bucket.items.sort((a, b) => a.u.localeCompare(b.u));
    const images = [...bucket.images.values()].sort((a, b) => a.u.localeCompare(b.u));
    sectionList.push({
      id: dir,
      label,
      count: items.length,
      bytes: items.reduce((n, i) => n + i.b, 0) + images.reduce((n, i) => n + i.b, 0),
      items,
      images,
    });
  }

  const rootItems = root.items.sort((a, b) => a.u.localeCompare(b.u));
  const rootImages = [...root.images.values()].sort((a, b) => a.u.localeCompare(b.u));
  const rootGroup = {
    id: "root",
    label: "Служебные страницы",
    count: rootItems.length,
    bytes: rootItems.reduce((n, i) => n + i.b, 0) + rootImages.reduce((n, i) => n + i.b, 0),
    items: rootItems,
    images: rootImages,
  };

  const searchGroup = {
    id: "search",
    label: "Поиск по сайту",
    count: searchItems.length,
    bytes: searchItems.reduce((n, i) => n + i.b, 0),
    items: searchItems,
    images: [],
  };

  const allUrls = [];
  for (const it of shellItems) allUrls.push(it.u);
  for (const s of sectionList) {
    for (const it of s.items) allUrls.push(it.u);
    for (const it of s.images) allUrls.push(it.u);
  }
  for (const it of rootItems) allUrls.push(it.u);
  for (const it of rootImages) allUrls.push(it.u);
  for (const it of searchItems) allUrls.push(it.u);

  const totalBytes = shellItems.reduce((n, i) => n + i.b, 0) +
    sectionList.reduce((n, s) => n + s.bytes, 0) +
    rootGroup.bytes + searchGroup.bytes;

  return {
    count: pageCount,
    totalBytes,
    shell: { label: "Оболочка сайта", items: shellItems, bytes: shellItems.reduce((n, i) => n + i.b, 0) },
    search: searchGroup,
    sections: sectionList,
    root: rootGroup,
    allUrls,
  };
}

if (IS_MAIN) {
  const manifest = build();
  const json = JSON.stringify(manifest, null, 2) + "\n";
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  const changed = existing !== json;
  console.log(
    `offline manifest: ${manifest.count} pages, ${manifest.sections.length} sections, ` +
    `${(manifest.totalBytes / 1048576).toFixed(1)} MB, ${manifest.allUrls.length} URLs`
  );
  if (WRITE) {
    if (changed) fs.writeFileSync(OUT, json);
    console.log(changed ? "offline-manifest.json updated" : "offline-manifest.json already up to date");
  } else {
    console.log(changed ? "would update offline-manifest.json" : "offline-manifest.json up to date");
  }
}

export { build };
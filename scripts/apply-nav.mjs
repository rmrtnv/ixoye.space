#!/usr/bin/env node
/**
 * apply-nav.mjs — (re)generate the shared header on every page.
 *
 * The legacy→semantic migration already wrote a <header class="site-header">
 * into each page. This script rebuilds that header from the single source of
 * truth (renderHeader in structurize-pages.mjs) so every page gains the compact
 * mobile bar (back · menu · current-text picker · search · forward) and the
 * desktop section list stays consistent.
 *
 * The middle picker mirrors the section's table of contents: same-directory
 * links on the section's index page, in document order; the current page is
 * preselected. Root-level pages fall back to the section links.
 *
 * Pages that only carry a `<main class="container content-block">` (the
 * restoration stubs) are refitted into the shell so they get the nav too.
 *
 * Usage:
 *   node scripts/apply-nav.mjs            # dry-run report
 *   node scripts/apply-nav.mjs --write    # rewrite pages in place
 */
import fs from "node:fs";
import path from "node:path";
import { renderHeader, buildShell, SECTIONS } from "./structurize-pages.mjs";
import { collectPages, rel } from "./site-utils.mjs";

const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");

const HEADER_RE = /<header class="site-header">[\s\S]*?<\/header>/;
const STUB_RE = /<main class="container content-block">([\s\S]*?)<\/main>/i;
const NOINDEX_RE = /<meta\s+name="robots"\s+content="noindex"/i;
const NAV_SCRIPT = "/src/scripts/nav.js";
const DEFAULT_MAILTO = "idixx@yandex.ru";

function stripTags(s) {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) {
    return stripTags(t[1]).replace(/\s*[—–-]\s*Русская Апокрифическая Студия\s*$/i, "").trim();
  }
  return "";
}

function injectScript(html) {
  if (html.includes(NAV_SCRIPT)) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `<script src="${NAV_SCRIPT}" defer></script>\n</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `<script src="${NAV_SCRIPT}"></script>\n</body>`);
  return null;
}

function dirKey(rel) {
  const d = path.dirname(rel);
  return d === "." ? "" : d;
}

const files = collectPages().map((p) => rel(p)).sort();

// The middle text picker mirrors the section's "table of contents": the order
// of the links on the section's index page, not alphabetical order.
// noindex restoration stubs are skipped.
const docsByDir = new Map(); // key -> [{ rel, href, label }]
const titles = new Map();
const pagesByDir = new Map();
for (const relPath of files) {
  const html = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const href = "/" + relPath.replace(/\\/g, "/");
  const label = pageTitle(html) || href;
  titles.set(relPath, label);
  if (NOINDEX_RE.test(html)) continue;
  const key = dirKey(relPath);
  if (!pagesByDir.has(key)) pagesByDir.set(key, []);
  pagesByDir.get(key).push({ rel: relPath, href, label });
}

// Walk each index page and collect same-directory links in document order;
// pages not linked there are appended in filename order. A section's own
// index page is kept as the first option (the "up" / contents entry).
for (const [key, pages] of pagesByDir) {
  const ordered = [];
  const seen = new Set();
  const base = `http://nav.local/${key === "" ? "" : key + "/"}index.html`;
  const indexPath = path.join(ROOT, key === "" ? "index.html" : key, "index.html");
  if (fs.existsSync(indexPath)) {
    const indexHtml = fs.readFileSync(indexPath, "utf8");
    const main = indexHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    const body = main ? main[1] : indexHtml;
    const hrefRe = /href="([^"]+)"/gi;
    let m;
    while ((m = hrefRe.exec(body))) {
      let u;
      try {
        u = new URL(m[1], base);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(u.protocol)) continue;
      let target;
      try {
        target = decodeURIComponent(u.pathname).replace(/^\/+/, "");
      } catch {
        continue;
      }
      if (dirKey(target) !== key || seen.has(target)) continue;
      seen.add(target);
      const page = pages.find((p) => p.rel === target);
      if (page) ordered.push(page);
    }
  }

  const all = [
    ...ordered,
    ...pages.filter((p) => !seen.has(p.rel)).sort((a, b) => a.rel.localeCompare(b.rel)),
  ];
  const idx = all.find((p) => path.basename(p.rel).toLowerCase() === "index.html");
  docsByDir.set(key, idx ? [idx, ...all.filter((p) => p !== idx)] : all);
}

let updated = 0;
const missing = [];
const noScript = [];
for (const rel of files) {
  const file = path.join(ROOT, rel);
  const html = fs.readFileSync(file, "utf8");
  const key = dirKey(rel);
  const docs = docsByDir.get(key) || [];
  const currentHref = "/" + rel.replace(/\\/g, "/");
  const activeDir = path.basename(rel) === "poisk.html" ? "poisk" : SECTIONS.some((s) => s.dir === key) ? key : "";

  let out = null;
  if (HEADER_RE.test(html)) {
    out = html.replace(
      HEADER_RE,
      renderHeader({ activeDir, currentHref, currentTitle: titles.get(rel), docs })
    );
  } else if (STUB_RE.test(html)) {
    // restoration stub → full shell
    const inner = html
      .match(STUB_RE)[1]
      .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, "")
      .replace(/^\s*<p>\s*<a href="\/"[^>]*>[\s\S]*?<\/p>\s*/i, "")
      .trim();
    const head = html.slice(0, html.search(/<body\b/i));
    const mail = (html.match(/mailto:([^"'<>\s]+)/i) || [])[1] || DEFAULT_MAILTO;
    out = buildShell({ relPath: rel, h1: titles.get(rel), content: inner, mailto: mail, head, docs });
  } else {
    missing.push(rel);
    continue;
  }

  const withScript = injectScript(out);
  if (withScript === null) noScript.push(rel);
  else out = withScript;

  if (out !== html) {
    updated++;
    if (WRITE) fs.writeFileSync(file, out);
  }
}

console.log(`${updated} page(s) ${WRITE ? "updated" : "would update"}; ${missing.length} not handled`);
if (missing.length) console.log("not handled: " + missing.join(", "));
if (noScript.length) console.log(`nav.js not injected (${noScript.length}): ` + noScript.join(", "));

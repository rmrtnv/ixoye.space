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
 * The middle picker lists the texts of the page's own section; the current page
 * is preselected. Root-level pages fall back to the section links.
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

// per-directory text lists for the middle picker (skip noindex stubs)
const docsByDir = new Map();
const titles = new Map();
for (const rel of files) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const href = "/" + rel.replace(/\\/g, "/");
  const label = pageTitle(html) || href;
  titles.set(rel, label);
  if (NOINDEX_RE.test(html)) continue;
  const key = dirKey(rel);
  if (!docsByDir.has(key)) docsByDir.set(key, []);
  docsByDir.get(key).push({ href, label });
}
for (const list of docsByDir.values()) list.sort((a, b) => a.label.localeCompare(b.label, "ru"));

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

#!/usr/bin/env node
/**
 * structurize-pages.mjs — migrate legacy 2001-era pages (CENTER/FONT/TABLE shell,
 * BLOCKQUOTE-wrapped content) to the canonical semantic shell used site-wide:
 *
 *   <header class="site-header">  site title + nav
 *   <main><article class="content-block">  <h1> + structured content
 *   <footer>  copyright / contacts
 *
 * Content is rewritten tag-by-tag only (no text changes):
 *   - <B><FONT SIZE=+2>…</FONT></B> / <FONT SIZE=+2>…</FONT>  → <h2>
 *   - <FONT SIZE=+1> with <a>          → <span class="doc-link">
 *   - <FONT SIZE=+1> short, no period  → <h3>
 *   - <FONT SIZE=-N>                   → <span class="small">
 *   - <font size="N"> (absolute)       → unwrap / .small / .text-lg
 *   - tables with BGCOLOR="#FFFFCC"    → <aside class="notice">
 *   - <CENTER>                         → <div class="text-center">
 *   - <HR …>                           → <hr>
 *   - inline style=/align=             → dropped (or mapped to utility classes)
 *
 * Usage:
 *   node scripts/structurize-pages.mjs            # dry-run + verification report
 *   node scripts/structurize-pages.mjs --write    # rewrite files in place
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
const WRITE = process.argv.includes("--write");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit=") ? a.slice(8) : "") || 0);

const SITE_NAME = "Русская Апокрифическая Студия";
const DEFAULT_MAILTO = "idixx@yandex.ru";

const SECTIONS = [
  { dir: "nag-hammadi", label: "Библиотека Наг-Хаммади" },
  { dir: "apocrypha-new", label: "Новозаветные апокрифы" },
  { dir: "apocrypha-old", label: "Ветхозаветные апокрифы" },
  { dir: "hermetic", label: "Герметизм" },
  { dir: "gnostic", label: "Гностицизм" },
  { dir: "kumran", label: "Свитки Иудейской пустыни" },
  { dir: "study", label: "Исследования" },
  { dir: "links", label: "Ссылки" },
  { dir: "contacts", label: "Контакты" },
];
const SECTION_TITLE_LABELS = new Set([
  "Библиотека Наг-Хаммади на русском языке",
  "Новозаветные апокрифы",
  "Ветхозаветные апокрифы",
  "Герметизм",
  "Гностицизм",
  "Исследования",
  "Кумранские рукописи",
]);

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

function discover() {
  const files = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (/\.(html|shtml)$/i.test(e.name)) {
        files.push(path.join(dir, e.name));
      }
    }
  })(ROOT);
  return files;
}

function SKIP(name) {
  return new Set([".git", "content", "scripts", "node_modules", ".github", ".githooks"]).has(name);
}

function isLegacy(html) {
  return /<TD\s+VALIGN\s*=\s*TOP/i.test(html) && /WIDTH\s*=\s*"750"/.test(html);
}

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

function normText(s) {
  return s
    // line-break and block-level boundaries separate text on both sides of the
    // conversion, so that a stripped &nbsp; run between two block elements is
    // not mistaken for a word join
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<hr\b[^>]*>/gi, " ")
    .replace(/<(p|h[1-6]|div|td|tr|li|blockquote|aside|center|ul|ol|dl|dd|dt|table|tbody|thead)\b[^>]*>/gi, " ")
    .replace(/<\/(p|h1|h2|h3|h4|h5|h6|div|td|tr|li|blockquote|aside|center)\s*>/gi, " ")
    .replace(/<[^>]+>/g, "") // delete remaining tags (rendered text comparison)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function deriveH1(title) {
  let parts = (title || "").split(" - ").map((s) => s.trim());
  if (parts[parts.length - 1] === SITE_NAME) parts.pop();
  if (parts.length > 1 && SECTION_TITLE_LABELS.has(parts[parts.length - 1])) parts.pop();
  return (parts.join(" - ") || title || "").trim();
}

// return the inner content of a <div> whose open tag starts at `openIdx`
function divInner(str, openIdx) {
  let depth = 1;
  const re = /<\s*\/?\s*div\b[^>]*>/gi;
  re.lastIndex = openIdx;
  let m;
  while ((m = re.exec(str))) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return str.slice(openIdx, m.index);
  }
  return str.slice(openIdx);
}

// ---------------------------------------------------------------------------
// content region extraction
// ---------------------------------------------------------------------------

function extractContent(html) {
  // content begins at the first justify-div or blockquote marker
  const divRe = /<DIV\b[^>]*align\s*=\s*["']?justify["']?/i;
  const bqRe = /<BLOCKQUOTE\b/i;
  const divM = divRe.exec(html);
  const bqM = bqRe.exec(html);
  let start = -1;
  if (divM && (!bqM || divM.index < bqM.index)) {
    start = html.indexOf(">", divM.index) + 1;
  } else if (bqM) {
    start = bqM.index + bqM[0].length;
  }
  if (start === -1) return null;

  // content ends at the last </BLOCKQUOTE> before the footer, else at footer.
  // The wrapper cell closes LAST (inner tables close earlier), so the tdEnd
  // candidate is the last </TD> (any case), not the first.
  let end = html.length;
  const lastBq = html.lastIndexOf("</BLOCKQUOTE>");
  const foot = html.search(/<CENTER>\s*<BR>\s*<b>2001/i);
  const tds = [...html.matchAll(/<\/TD\s*>/gi)];
  const tdEnd = tds.length ? tds[tds.length - 1].index : -1;
  const candidates = [];
  if (lastBq !== -1 && lastBq > start) candidates.push(lastBq + "</BLOCKQUOTE>".length);
  if (foot !== -1 && foot > start) candidates.push(foot);
  if (tdEnd !== -1 && tdEnd > start) candidates.push(tdEnd);
  if (candidates.length) end = Math.min(...candidates);
  return html.slice(start, end);
}

// unwrap an outermost justify-div / blockquote pair that wraps the content
function unwrapOuter(c) {
  let s = c.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const d = /^<DIV\b[^>]*align\s*=\s*["']?justify["']?/i.exec(s);
    if (d) {
      const openIdx = s.indexOf(">", d.index) + 1;
      const inner = divInner(s, openIdx);
      // only unwrap if the div wraps essentially everything (close near end)
      if (s.lastIndexOf("</div>") <= s.length - 8 && s.lastIndexOf("</div>") >= s.length - 30) {
        s = inner.trim();
        changed = true;
        continue;
      }
    }
    const b = /^<BLOCKQUOTE\b[^>]*>/i.exec(s);
    if (b) {
      const close = s.lastIndexOf("</BLOCKQUOTE>");
      if (close !== -1) {
        s = s.slice(b[0].length, close).trim();
        changed = true;
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// content transformation
// ---------------------------------------------------------------------------

function cleanTagAttrs(tagName, attrs) {
  let cls = (attrs.match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
  let id = (attrs.match(/id\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
  const align = (attrs.match(/align\s*=\s*["']?([a-z]+)/i) || [])[1];
  const al = align ? align.toLowerCase() : "";
  if (al && al !== "justify") cls = (cls + " text-" + al).trim();
  let out = "<" + tagName;
  if (id) out += ` id="${id}"`;
  if (cls) out += ` class="${cls}"`;
  return out + ">";
}

function transform(content, h1) {
  let c = content;
  c = c.replace(/\r\n?/g, "\n");
  // legacy typo: <pstyle="..."> (missing space) -> a real <p> tag
  c = c.replace(/<pstyle=/gi, "<p style=");
  c = unwrapOuter(c);

  // ---- structural tags
  c = c.replace(/<CENTER\b[^>]*>/gi, '<div class="text-center">').replace(/<\/CENTER\s*>/gi, "</div>");
  c = c.replace(/<HR\b[^>]*>/gi, "<hr>");

  // ---- notice boxes (#FFFFCC tables) -> <aside class="notice">
  c = c.replace(/<TABLE\b[^>]*BGCOLOR\s*=\s*["']#FFFFCC["'][^>]*>[\s\S]*?<\/TABLE\s*>/gi, (tbl) => {
    let inner = tbl
      .replace(/<TABLE\b[^>]*>/i, "")
      .replace(/<\/TABLE\s*>/i, "")
      .replace(/<TR\b[^>]*>/gi, "")
      .replace(/<\/TR\s*>/gi, "")
      .replace(/<TD\b[^>]*>/gi, "")
      .replace(/<\/TD\s*>/gi, "")
      .replace(/<BR\b[^>]*>/gi, "\n")
      .replace(/&nbsp;|&#160;/gi, " ")
      .trim();
    return `<aside class="notice">\n${inner}\n</aside>`;
  });

  // ---- heading conversions (relative FONT sizes, uppercase pattern)
  // +2 / +3 -> h2 (drop empty or punctuation-only runs, e.g. decorative
  // <FONT SIZE=+2>. </FONT> or <FONT SIZE=+2></FONT>)
  c = c.replace(/<FONT\b[^>]*SIZE\s*=\s*["']?\+[23]["']?[^>]*>([\s\S]*?)<\/FONT\s*>/gi, (m, inner) => {
    const txt = inner.replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/gi, "").replace(/\s+/g, "");
    if (!txt || /^[\p{P}\p{S}·…]+$/u.test(txt)) return "";
    return `<h2>${inner.trim()}</h2>`;
  });
  // +1 -> h3 (long prose/headings) or span.doc-link (link entries)
  c = c.replace(/<FONT\b[^>]*SIZE\s*=\s*["']?\+1["']?[^>]*>([\s\S]*?)<\/FONT\s*>/gi, (m, inner) => {
    const txt = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (/<a\b/i.test(inner)) return `<span class="doc-link">${inner.trim()}</span>`;
    if (txt && txt.length <= 200 && !/[.!?]\s*$/.test(txt) && !/[.!?]\s/.test(txt)) {
      return `<h3>${inner.trim()}</h3>`;
    }
    return inner.trim();
  });
  // -N -> small
  c = c.replace(/<FONT\b[^>]*SIZE\s*=\s*["']?-\d+["']?[^>]*>([\s\S]*?)<\/FONT\s*>/gi, (m, inner) => `<span class="small">${inner.trim()}</span>`);
  // collapse <b> wrapping a heading
  c = c.replace(/<B\s*>\s*(<H[23]\b[^>]*>[\s\S]*?<\/H[23]\s*>)\s*<\/B\s*>/gi, "$1");

  // merge heading fragments split across FONT/SUP runs (e.g. superscripted titles
  // like "Левит<sup>а</sup> 11Q1 …"). If a <b> block consists only of heading
  // fragments, collapse it into a single <h2>. Applied once — no chaining, so
  // chapter headings separated by footnote markup are never merged.
  const stripTags = (t) =>
    t
      .replace(/^<[A-Za-z][^>]*>/, "")
      .replace(/<\/[A-Za-z]+\s*>$/, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  c = c.replace(/<B\b[^>]*>([\s\S]*?)<\/B\s*>/gi, (m, inner) => {
    const headingOnly =
      /^(?:\s*<[Hh][23]\b[^>]*>[\s\S]*?<\/[Hh][23]\s*>|\s*<[Ss][Uu][Pp]\b[^>]*>[\s\S]*?<\/[Ss][Uu][Pp]\s*>|\s*)+$/.test(inner) &&
      (inner.match(/<[Hh][23]\b/gi) || []).length >= 2;
    if (!headingOnly) return m;
    return `<h2>${inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}</h2>`;
  });
  // fallback: heading + short superscript (no <b> wrapper) merges once. Never
  // merges footnote links (<sup><a href="#n">n</a></sup>).
  const supOk = (sup) => !/<a\b/i.test(sup) && /^[0-9a-zа-яё().,··•]{1,4}$/i.test(stripTags(sup));
  c = c.replace(
    /(<[Hh][23]\b[^>]*>[\s\S]*?<\/[Hh][23]\s*>)\s*(<[Ss][Uu][Pp]\b[^>]*>[\s\S]*?<\/[Ss][Uu][Pp]\s*>)\s*(<[Hh][23]\b[^>]*>[\s\S]*?<\/[Hh][23]\s*>)/g,
    (m, a, sup, b) => (supOk(sup) ? `<h2>${stripTags(a)}${stripTags(sup)}${stripTags(b)}</h2>` : m)
  );
  c = c.replace(
    /(<[Hh]2\b[^>]*>[\s\S]*?<\/[Hh]2\s*>)\s*(<[Ss][Uu][Pp]\b[^>]*>[\s\S]*?\S[\s\S]*?<\/[Ss][Uu][Pp]\s*>)(?!\s*<[Hh][23]\b)/g,
    (m, a, sup) => (supOk(sup) ? `<h2>${stripTags(a)}${stripTags(sup)}</h2>` : m)
  );
  // re-collapse <b> wrapping a (now merged) heading
  c = c.replace(/<B\s*>\s*(<H[23]\b[^>]*>[\s\S]*?<\/H[23]\s*>)\s*<\/B\s*>/gi, "$1");

  // ---- absolute <font size="N"> and generic fonts -> span classes / unwrap
  c = c.replace(/<font\b([^>]*)>([\s\S]*?)<\/font\s*>/gi, (m, attrs, inner) => {
    const sz = (attrs.match(/size\s*=\s*["']?([+-]?\d+)/i) || [])[1];
    if (!sz) return inner; // no size -> unwrap, keep content
    const n = +sz;
    if (n <= 2) return `<span class="small">${inner}</span>`;
    if (n === 3) return inner;
    return `<span class="text-lg">${inner}</span>`;
  });
  // remove any orphaned font tags left behind
  c = c.replace(/<font\b[^>]*>/gi, "").replace(/<\/font\s*>/gi, "");

  // ---- drop presentation attrs; map align on p/div to utility classes
  c = c.replace(/<([Pp])\b([^>]*)>/g, (m, tag, attrs) => cleanTagAttrs("p", attrs));
  c = c.replace(/<([Dd][Ii][Vv])\b([^>]*)>/g, (m, tag, attrs) => cleanTagAttrs("div", attrs));
  c = c.replace(/\s+(style|bgcolor|bordercolor|color|face|align|valign)\s*=\s*"[^"]*"/gi, "");
  c = c.replace(/\s+(style|bgcolor|bordercolor|color|face|align|valign)\s*=\s*'[^']*'/gi, "");
  // turn a remaining bare align=center on images into centered wrapper class rounding
  c = c.replace(/<IMG\b([^>]*)\balign\s*=\s*["']?center["']?\b/gi, '<img class="text-center"$1');

  // ---- remove the duplicate page title from the content top. Only the FIRST
  // h1/h2 that matches the derived title is dropped; identical mid-content
  // headings (which legacy pages use to mark where the translated text starts
  // after an intro) are legitimate and stay.
  if (h1) {
    const HOMO = { а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", к: "k", м: "m", т: "t", в: "b", н: "h" };
    const visual = (s) =>
      normText(s)
        .replace(/[^a-zа-яё0-9]/g, "")
        .replace(/[а-яё]/g, (ch) => HOMO[ch] || ch);
    const t1 = normText(h1);
    const v1 = visual(h1);
    let dropped = false;
    c = c.replace(/<H[12]\b[^>]*>([\s\S]*?)<\/H[12]\s*>/gi, (m, inner) => {
      if (!dropped && t1 && (normText(inner) === t1 || (v1 && visual(inner) === v1))) {
        dropped = true;
        return "";
      }
      return m;
    });
  }

  // ---- whitespace / nbsp tidy-up
  c = c.replace(/(<P\b[^>]*>|<BR\b[^>]*>)(?:\s*(?:&nbsp;|&#160;)+)+/gi, "$1");
  c = c.replace(/<P\b[^>]*>\s*(?:&nbsp;|&#160;)?\s*<\/P\s*>/gi, "");
  c = c.replace(/(?:<br\s*\/?>\s*)+$/i, "").replace(/^(?:<br\s*\/?>)+/i, "");
  c = c.replace(/^[ \t]+\n/gm, "").replace(/\n{4,}/g, "\n\n\n").trim();

  return c + "\n";
}

// ---------------------------------------------------------------------------
// shell building
// ---------------------------------------------------------------------------

function buildShell({ relPath, h1, content, mailto, head }) {
  const dir = path.dirname(relPath);
  const base = path.basename(relPath, path.extname(relPath));
  const isIndex = base === "index";

  const navItems = SECTIONS.map((s) => {
    const active = dir === s.dir || (isIndex && dir === s.dir);
    return `<li><a href="/${s.dir}/index.html"${active ? ' aria-current="page"' : ""}>${s.label}</a></li>`;
  }).join("\n      ");
  const navItemsFull =
    navItems + `\n      <li><a href="/poisk.html">Поиск</a></li>`;

  const active = SECTIONS.find((s) => s.dir === dir);
  void active;

  const doctype = "<!DOCTYPE html>\n<html lang=\"ru\">\n";
  const headOut = /^\s*<!DOCTYPE/i.test(head) ? head : doctype + head;
  return `${headOut}

<BODY>

<div class="site-shell">

<header class="site-header">
  <p class="site-title"><a href="/">Русская апокрифическая студия</a></p>
  <nav class="site-nav" aria-label="Разделы сайта">
    <ul>
      ${navItemsFull}
    </ul>
  </nav>
</header>

<main>
  <article class="content-block">
    <h1>${h1}</h1>

${content}
  </article>
</main>

<footer>
  <p>© 2001-2026 · <a href="mailto:${mailto}">Русская апокрифическая студия</a> · <a href="/about.html">О студии</a></p>
</footer>

</div>

</BODY>

</HTML>
`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const files = discover();
let converted = 0,
  skipped = [],
  failed = [];
const mismatches = [];

if (IS_MAIN) {

for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (LIMIT && converted >= LIMIT) break;
  const html = fs.readFileSync(file, "utf8");
  if (/<!--#/.test(html)) {
    skipped.push(rel + " (SSI)");
    continue;
  }
  if (!isLegacy(html)) {
    skipped.push(rel);
    continue;
  }

  const headMatch = html.search(/<BODY\b/i);
  if (headMatch === -1) {
    failed.push(rel + " (no <BODY>)");
    continue;
  }
  const head = html.slice(0, headMatch).trimEnd() + "\n";
  const body = html.slice(headMatch);

  const title = (html.match(/<TITLE>([\s\S]*?)<\/TITLE>/i) || [])[1] || "";
  const h1 = deriveH1(title);

  const content = extractContent(body);
  if (!content) {
    failed.push(rel + " (no content region)");
    continue;
  }
  const oldText = normText(content);
  const newContent = transform(content, h1);
  const newText = normText(newContent);

  // verification: transform must preserve rendered text. The only allowed
  // deletions are the removed duplicate <h1>/<h2> title (up to 3 copies of the
  // h1 phrase, homoglyph-normalized).
  const HOMO = { а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", к: "k", м: "m", т: "t", в: "b", н: "h" };
  const toks = (s) => (s.match(/[a-zа-яё0-9]+/g) || []).map((w) => w.replace(/[а-яё]/g, (ch) => HOMO[ch] || ch));
  const tOld = toks(oldText);
  const tNew = toks(newText);
  const tPh = toks(normText(h1));
  const cnt = (a) => {
    const m = new Map();
    for (const w of a) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const MO = cnt(tOld),
    MN = cnt(tNew),
    MP = cnt(tPh);
  let ok = true;
  // missing tokens (old minus new) are fine when within 3x the h1 phrase copies,
  // or when they are a join artifact: a h1-phrase word concatenated with the next
  // token at a tag boundary (e.g. "Левит<sup>а</sup>" -> token "левита" vs title
  // "Левит а"; "Мелхиседек</FONT><HR>Иисус…" -> "мелхиседекиисус"). The tail of
  // such a join is allowed to appear as a new token (soshestv: old "ад1", new "1").
  const phTokens = [...MP.keys()];
  const newSet = new Set(tNew);
  const explainMissing = (w) => {
    const tails = new Set();
    const rec = (t) => {
      if (t === "") {
        tails.add("");
        return;
      }
      for (const p of phTokens) if (t.startsWith(p)) rec(t.slice(p.length));
    };
    rec(w); // whole w is a join of h1-phrase tokens
    for (const p of phTokens) {
      if (w.startsWith(p) && w.length > p.length) {
        const rest = w.slice(p.length);
        if (newSet.has(rest)) tails.add(rest); // h1-word + neighbouring token
      }
    }
    return tails;
  };
  const newExtrasOk = new Set();
  for (const [w, c] of MO) {
    const gone = c - (MN.get(w) || 0);
    if (gone <= 0) continue;
    const allowed = (MP.get(w) || 0) * 3;
    if (gone > allowed) {
      const tails = explainMissing(w);
      if (tails.size === 0) ok = false;
      for (const t of tails) if (t) newExtrasOk.add(t);
    }
  }
  // no new words may appear (text was only removed, never added/rephrased)
  for (const [w, c] of MN) if ((MO.get(w) || 0) < c && !newExtrasOk.has(w)) ok = false;
  if (!ok) mismatches.push({ rel, oldText, newText });

  const mail = body.match(/mailto:([^"'<>\s]+)/i);
  const mailto = mail ? mail[1] : DEFAULT_MAILTO;

  const out = buildShell({ relPath: rel, h1, content: newContent, mailto, head });

  if (WRITE) {
    fs.writeFileSync(file, out);
  }
  converted++;
}

console.log(`\nstructurize-pages: ${converted} legacy pages processed${WRITE ? " (WRITTEN)" : " (dry-run)"}`);
console.log(`skipped (${skipped.length}): ${skipped.slice(0, 40).join(", ")}${skipped.length > 40 ? `… +${skipped.length - 40}` : ""}`);
if (failed.length) console.log(`FAILED (${failed.length}):\n  ${failed.join("\n  ")}`);
if (mismatches.length) {
  console.log(`TEXT MISMATCHES (${mismatches.length}):`);
  for (const m of mismatches.slice(0, 20)) {
    console.log(`  ${m.rel}`);
    if (WRITE === false) {
      const a = m.oldText.replace(/ /g, "·");
      const b = m.newText.replace(/ /g, "·");
      // find first divergence
      let i = 0;
      while (a[i] === b[i] && i < Math.min(a.length, b.length)) i++;
      console.log(`    old[${i}]: …${a.slice(Math.max(0, i - 40), i + 80)}`);
      console.log(`    new[${i}]: …${b.slice(Math.max(0, i - 40), i + 80)}`);
    }
  }
} else {
  console.log("text preservation: OK (all pages)");
}
} // IS_MAIN

export { extractContent, normText, deriveH1, transform, isLegacy, discover, buildShell };
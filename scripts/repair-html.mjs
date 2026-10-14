/**
 * Phase 1 repair pass — normalizes the legacy hand-made HTML.
 *
 * Run without arguments for a dry run, with --write to apply changes.
 *
 * What it does (idempotent):
 *  - collapses the duplicated `<meta charset="UTF-8">` runs to one
 *  - adds `<!DOCTYPE html>`, `<html lang="ru">` and a viewport meta
 *  - points every page at the single modern stylesheet `/src/styles/main.css`
 *  - removes dead Top100 / TopList counters and the dead "Гостевая книга" link
 *  - removes the dead sbible.boom.ru banner image
 *  - rewrites obsolete directory links (nag_hammadi, apocryph1/2, hermes, gnost)
 *  - makes absolute ixoye.space links root-relative
 *  - updates the footer year to 2026
 *  - replaces raw server 404 dumps with a styled restoration notice
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectPages, rel, read, write, ROOT } from './site-utils.mjs';

const APPLY = process.argv.includes('--write');

const LOST_PAGES = {
  'nag-hammadi/35.html': { section: 'Библиотека Наг-Хаммади', href: '/nag-hammadi/index.html' },
  'nag-hammadi/ap-adam-2.html': { section: 'Библиотека Наг-Хаммади', href: '/nag-hammadi/index.html' },
  'nag-hammadi/archonts-2.html': { section: 'Библиотека Наг-Хаммади', href: '/nag-hammadi/index.html' },
  '2_sif.html': null, // stray duplicate of nag-hammadi/2_sif.html — delete
};

function placeholder({ section, href }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Страница в восстановлении — Русская Апокрифическая Студия</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/src/styles/main.css">
</head>
<body>
<main class="container content-block">
<p><a href="/">← На главную</a> · <a href="${href}">${section}</a></p>
<h1>Страница в восстановлении</h1>
<p>К сожалению, файл этой страницы был утерян при архивации сайта. Мы работаем над восстановлением полного текста. Приносим извинения за неудобства.</p>
</main>
</body>
</html>
`;
}

const FIX_DIRS = [
  [/(^|\/)nag_hammadi\//gi, '$1nag-hammadi/'],
  [/(^|\/)apocryph1\//gi, '$1apocrypha-new/'],
  [/(^|\/)apocryph2\//gi, '$1apocrypha-old/'],
  [/(^|\/)hermes\//gi, '$1hermetic/'],
  [/(^|\/)gnost\//gi, '$1gnostic/'],
];

function fixUrl(url) {
  let u = url;
  for (const [re, to] of FIX_DIRS) u = u.replace(re, to);
  u = u.replace(/^https?:\/\/(?:www\.)?ixoye\.space\//i, '/');
  return u;
}

function repair(html) {
  // 1. Collapse duplicated charset metas.
  html = html.replace(
    /([ \t]*<meta\s+charset=["']?utf-8["']?\s*\/?>[ \t]*\r?\n?)+/gi,
    (m) => {
      const indent = (m.match(/^[ \t]*/) || [''])[0];
      return `${indent}<meta charset="UTF-8">\n`;
    },
  );

  // 2. Doctype + lang.
  if (/^\s*<!DOCTYPE/i.test(html)) {
    html = html.replace(/<html(\s[^>]*)?>/i, (m, attrs = '') =>
      /lang=/i.test(attrs) ? m : `<html lang="ru"${attrs}>`,
    );
  } else {
    html = html.replace(/^\s*<HTML(\s[^>]*)?>/i, (m, attrs = '') => {
      const clean = attrs.replace(/\s*lang=["'][^"']*["']/i, '');
      return `<!DOCTYPE html>\n<html lang="ru"${clean}>`;
    });
  }

  // 3. Viewport.
  if (!/name=["']viewport["']/i.test(html)) {
    if (/<meta charset="UTF-8">/i.test(html)) {
      html = html.replace(
        /(<meta charset="UTF-8">\r?\n)/i,
        '$1<meta name="viewport" content="width=device-width, initial-scale=1">\n',
      );
    } else {
      html = html.replace(
        /<\/head>/i,
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>',
      );
    }
  }

  // 4. Single stylesheet.
  html = html.replace(
    /(HREF|href)=(["']?)(?:\.\.\/)*\/?(?:src\/styles\/main\.css|ras\.css)\2/gi,
    '$1="/src/styles/main.css"',
  );

  // 5. Dead counters.
  html = html.replace(
    /<!--\s*begin of Top100\s*-->[\s\S]*?<!--\s*end of Top100 code\s*-->/gi,
    '',
  );
  html = html.replace(
    /<!--\s*(?:begin of Top100|end of Top100 code|TopList COUNTER)\s*-->\s*/gi,
    '',
  );

  // 6. Dead guestbook link.
  html = html.replace(
    /\s*\|?\s*<A\s+HREF="#"\s+title="Гостевая книга"\s*>Гостевая книга<\/A>/gi,
    '',
  );

  // 7. Dead external banner.
  html = html.replace(
    /<a\b[^>]*sbible\.boom\.ru[^>]*>\s*<img\b[^>]*ban\.gif[^>]*>\s*<\/a>/gi,
    '',
  );
  html = html.replace(/<img\b[^>]*ban\.gif[^>]*>/gi, '');

  // 8. URL fixes inside href/src.
  html = html.replace(
    /(HREF|href|SRC|src)=(["'])([^"']*)\2/gi,
    (m, attr, q, url) => `${attr}=${q}${fixUrl(url)}${q}`,
  );

  // 9. Footer year.
  html = html.replace(/2001\s*[-–—]\s*2025/g, '2001-2026');

  return html;
}

let changed = 0;
let placeholders = 0;
let deleted = 0;
const changedFiles = [];

for (const file of collectPages()) {
  const r = rel(file);
  if (r in LOST_PAGES) {
    const spec = LOST_PAGES[r];
    if (spec === null) {
      if (APPLY) fs.unlinkSync(file);
      deleted++;
      changedFiles.push(`${r}  [deleted stray]`);
    } else {
      if (APPLY) write(file, placeholder(spec));
      placeholders++;
      changedFiles.push(`${r}  [restoration placeholder]`);
    }
    continue;
  }

  const before = read(file);
  if (/<title>\s*404 Not Found\s*<\/title>/i.test(before)) {
    placeholders++;
    changedFiles.push(`${r}  [404 -> placeholder]`);
    if (APPLY) {
      write(file, placeholder({ section: 'Раздел', href: '/' }));
    }
    continue;
  }

  const after = repair(before);
  if (after !== before) {
    changed++;
    changedFiles.push(r);
    if (APPLY) write(file, after);
  }
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — repaired: ${changed}, placeholders: ${placeholders}, deleted: ${deleted}`);
if (!APPLY) {
  console.log(changedFiles.slice(0, 30).join('\n'));
  if (changedFiles.length > 30) console.log(`… and ${changedFiles.length - 30} more`);
}

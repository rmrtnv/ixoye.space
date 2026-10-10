/**
 * Creates styled "restoration in progress" stubs for texts that are
 * referenced by the Gnostic section but were never included in the repo
 * (the Mandean and Manichaean subsections).
 *
 * Stubs use the same site shell/header as every other page, so they get the
 * shared navigation (including the compact mobile bar).
 *
 * Idempotent: existing files are never overwritten.
 *
 * Usage: node scripts/create-restoration-stubs.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, rel } from './site-utils.mjs';
import { buildShell } from './structurize-pages.mjs';

const APPLY = process.argv.includes('--write');

const SOURCES = [
  { file: 'gnostic/manich_lit.html', section: 'Гностицизм', href: '/gnostic/index.html' },
  { file: 'gnostic/mand_lit.html', section: 'Гностицизм', href: '/gnostic/index.html' },
];

function head(title) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — в восстановлении — Русская Апокрифическая Студия</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/src/styles/main.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/favicon.svg">
<script src="/src/scripts/nav.js" defer></script>
</head>`;
}

function stub(title, relPath) {
  const content = `<p>Текст «${title}» входил в раздел, но его файл был утерян при архивации и пока недоступен. Мы работаем над восстановлением. Приносим извинения за неудобства.</p>`;
  return buildShell({
    relPath,
    h1: title,
    content,
    mailto: 'idixx@yandex.ru',
    head: head(title),
  });
}

let created = 0;

for (const { file } of SOURCES) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = /<a\s+href="(\/gnostic\/[^"]+\.s?html)"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const target = path.join(ROOT, m[1]);
    const title = m[2].trim().replace(/&nbsp;/g, ' ');
    if (fs.existsSync(target)) continue;
    created++;
    console.log(`${APPLY ? 'create' : 'would create'} ${rel(target)} — ${title}`);
    if (APPLY) fs.mkdirSync(path.dirname(target), { recursive: true });
    if (APPLY) fs.writeFileSync(target, stub(title, rel(target)), 'utf8');
  }
}

console.log(`${APPLY ? 'Created' : 'Missing'} ${created} restoration stub(s).`);

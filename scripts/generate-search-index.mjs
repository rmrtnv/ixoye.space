/**
 * Generates search-index.json for the client-side site search (poisk.html).
 *
 * Full text of every published page is included, with the repeated
 * navigation/footer boilerplate stripped to keep the index useful and small.
 *
 * Usage: node scripts/generate-search-index.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  collectPages,
  extractTitle,
  extractDescription,
  extractText,
  pageUrl,
  ROOT,
  rel,
} from './site-utils.mjs';

const APPLY = process.argv.includes('--write');
const MAX_CHARS = 12000;

// Recurring site chrome — removed so it does not pollute search results.
const BOILERPLATE = [
  'Русская апокрифическая студия',
  'Библиотека Наг-Хаммади',
  'Новозаветные апокрифы',
  'Ветхозаветные апокрифы',
  'Свитки Иудейской пустыни',
  'Исследования',
  'Гностицизм',
  'Герметизм',
  'Контакты',
  'Ссылки',
  'Поиск',
  'Новости',
  'О студии',
];

function cleanText(text) {
  let t = text;
  for (const phrase of BOILERPLATE) {
    t = t.split(phrase).join(' ');
  }
  t = t.replace(/\s+/g, ' ').trim();
  return t.slice(0, MAX_CHARS);
}

function cleanTitle(title) {
  return title
    .replace(/\s*[-—]\s*Русская Апокрифическая Студия\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const index = [];
for (const file of collectPages()) {
  const html = fs.readFileSync(file, 'utf8');
  const robots = html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] ?? '';
  if (/noindex/i.test(robots)) continue; // restoration stubs

  const title = cleanTitle(extractTitle(html));
  const description = extractDescription(html);
  const text = cleanText(extractText(html));
  if (!title && !text) continue;

  index.push({ u: pageUrl(file), t: title, d: description, x: text, f: rel(file) });
}

const json = JSON.stringify(index);
if (APPLY) {
  fs.writeFileSync(path.join(ROOT, 'search-index.json'), json, 'utf8');
  console.log(`Wrote search-index.json: ${index.length} pages, ${(json.length / 1024).toFixed(0)} KiB.`);
} else {
  console.log(`${index.length} pages, ${(json.length / 1024).toFixed(0)} KiB (dry run).`);
}

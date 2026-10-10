/**
 * Page-level enrichment pass (Phases 4–5).
 *
 * Idempotent additions to every published page:
 *  - favicon links
 *  - canonical URL
 *  - Open Graph / Twitter metadata derived from <title>/<description>
 *  - a "Поиск" link in the main navigation
 *  - alt="" on images that have no alt attribute
 *
 * Usage: node scripts/enrich-pages.mjs [--write]
 */
import { collectPages, extractTitle, extractDescription, pageUrl, rel, read, write } from './site-utils.mjs';

const APPLY = process.argv.includes('--write');
const SITE = 'https://ixoye.space';
const SITE_NAME = 'Русская Апокрифическая Студия';

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function enrich(html, file) {
  const title = extractTitle(html) || SITE_NAME;
  let description = extractDescription(html);
  if (!description || /^Русская Апокрифическая Студия$/i.test(description)) {
    description = 'Раннехристианские и апокрифические тексты на русском языке — Русская Апокрифическая Студия.';
  }
  const url = SITE + pageUrl(file);

  const additions = [];

  if (!/rel=["']icon["']/i.test(html)) {
    additions.push('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    additions.push('<link rel="apple-touch-icon" href="/favicon.svg">');
  }

  if (!/rel=["']canonical["']/i.test(html)) {
    additions.push(`<link rel="canonical" href="${esc(url)}">`);
  }

  if (!/property=["']og:title["']/i.test(html)) {
    const type = pageUrl(file) === '/' ? 'website' : 'article';
    additions.push(`<meta property="og:type" content="${type}">`);
    additions.push(`<meta property="og:site_name" content="${esc(SITE_NAME)}">`);
    additions.push('<meta property="og:locale" content="ru_RU">');
    additions.push(`<meta property="og:title" content="${esc(title)}">`);
    additions.push(`<meta property="og:description" content="${esc(description)}">`);
    additions.push(`<meta property="og:url" content="${esc(url)}">`);
    additions.push('<meta name="twitter:card" content="summary">');
  }

  if (additions.length) {
    html = html.replace(/<\/head>/i, `${additions.join('\n')}\n</head>`);
  }

  // Search link in the main navigation, right after "Ссылки" (present on every page).
  if (!/poisk\.html/i.test(html)) {
    html = html.replace(
      /(<a\s+href="[^"]*links\/index\.html"[^>]*>Ссылки<\/a>)/i,
      '$1 | <a href="/poisk.html" title="Поиск по сайту">Поиск</a>',
    );
  }

  // Ensure images carry an alt attribute (empty = decorative).
  html = html.replace(/<img\b[^>]*>/gi, (tag) =>
    /\salt=/i.test(tag) ? tag : tag.replace(/<img\b/i, '<img alt=""'),
  );

  return html;
}

let changed = 0;
for (const file of collectPages()) {
  const before = read(file);
  const after = enrich(before, file);
  if (after !== before) {
    changed++;
    if (APPLY) write(file, after);
  }
}
console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — enriched: ${changed} page(s).`);

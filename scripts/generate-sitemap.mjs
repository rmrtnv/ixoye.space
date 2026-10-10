/**
 * Generates sitemap.xml from the published pages.
 *
 * Usage: node scripts/generate-sitemap.mjs [--write]
 *        (prints to stdout when --write is omitted)
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectPages, pageUrl, ROOT } from './site-utils.mjs';

const APPLY = process.argv.includes('--write');
const SITE = 'https://ixoye.space';

const urls = collectPages()
  .filter((f) => !/robots/i.test(fs.readFileSync(f, 'utf8').match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] ?? ''))
  .map((f) => ({ loc: SITE + pageUrl(f), priority: pageUrl(f) === '/' ? '1.0' : '0.6' }))
  .sort((a, b) => a.loc.localeCompare(b.loc));

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <priority>${u.priority}</priority>\n  </url>`)
  .join('\n')}
</urlset>
`;

if (APPLY) {
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
  console.log(`Wrote sitemap.xml with ${urls.length} URLs.`);
} else {
  process.stdout.write(xml);
}

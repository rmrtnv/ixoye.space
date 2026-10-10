/**
 * Internal link checker for ixoye.space.
 *
 * Scans every published .html/.shtml page and verifies that local
 * href/src targets resolve to an existing file (or directory index).
 * External links, mailto, anchors and data URIs are ignored.
 *
 * Usage: node scripts/check-links.mjs
 * Exits non-zero when broken links are found (used by CI).
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectPages, rel, ROOT } from './site-utils.mjs';

const IGNORE_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

function decode(u) {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
}

function exists(target) {
  if (fs.existsSync(target)) return true;
  // A directory URL may be served via its index file.
  if (!path.extname(target) && fs.existsSync(path.join(target, 'index.html'))) {
    return true;
  }
  return false;
}

const broken = new Map(); // target -> [pages]

for (const file of collectPages()) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /(?:href|src)\s*=\s*["']?([^"'\s>]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1];
    if (IGNORE_SCHEME.test(raw)) continue;
    const clean = decode(raw.split('#')[0].split('?')[0]);
    if (!clean) continue;

    const target = clean.startsWith('/')
      ? path.join(ROOT, clean)
      : path.resolve(path.dirname(file), clean);

    if (!exists(target)) {
      const key = raw;
      if (!broken.has(key)) broken.set(key, []);
      broken.get(key).push(rel(file));
    }
  }
}

const rows = [...broken.entries()].sort((a, b) => b[1].length - a[1].length);
if (rows.length === 0) {
  console.log('✓ No broken internal links found.');
  process.exit(0);
}

console.log(`✗ ${rows.reduce((n, [, pages]) => n + pages.length, 0)} broken link(s) to ${rows.length} missing target(s):\n`);
for (const [target, pages] of rows) {
  console.log(`  ${target}`);
  for (const p of pages.slice(0, 3)) console.log(`      ${p}`);
  if (pages.length > 3) console.log(`      … and ${pages.length - 3} more`);
}
process.exit(1);

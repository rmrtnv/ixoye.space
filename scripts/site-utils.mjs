/**
 * Shared helpers for ixoye.space maintenance scripts.
 * Zero dependencies — Node built-ins only.
 */
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();

/** Directories that never contain published site pages. */
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'content',
  'scripts',
  '.agents_tmp',
  '.githooks',
  '.github',
]);

/** Recursively collect published .html/.shtml pages. */
export function collectPages(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') {
      if (entry.isDirectory()) continue;
    }
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collectPages(path.join(dir, entry.name), out);
    } else if (/\.(html|shtml)$/i.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Repository-relative POSIX path. */
export function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

/** Convert "a/b/index.html" -> "/a/b/" and "index.html" -> "/". */
export function pageUrl(p) {
  let r = rel(p);
  if (r === 'index.html') return '/';
  r = r.replace(/index\.html$/i, '');
  return '/' + r;
}

/** Decode the handful of HTML entities that appear in titles/descriptions. */
export function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function extractTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()) : '';
}

export function extractDescription(html) {
  const m =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
    html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
  return m ? decodeEntities(m[1].trim()) : '';
}

/** Strip tags/scripts/styles and collapse whitespace to plain text. */
export function extractText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function read(file) {
  return fs.readFileSync(file, 'utf8');
}

export function write(file, data) {
  fs.writeFileSync(file, data, 'utf8');
}

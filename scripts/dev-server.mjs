/**
 * Minimal static-file dev server for ixoye.space.
 *
 * Behaves like GitHub Pages so local testing matches production:
 *   - request the index (/, /apocrypha-new/, …)          -> index.html
 *   - /apocrypha-new (no trailing slash)                 -> 301 to /apocrypha-new/
 *   - /apocrypha-new/ev-evion.html                       -> served directly (no clean-URL rewriting)
 *   - /apocrypha-new/ev-evion (missing extension)        -> 404
 *
 * Instead of npm tooling with its own URL rewriting (serve's cleanUrls
 * broke relative links), this is a tiny zero-dependency Node server.
 *
 * Usage: node scripts/dev-server.mjs [--port 3000]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg !== -1 ? process.argv[portArg + 1] : process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.shtml': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveFile(res, file) {
  try {
    const data = fs.readFileSync(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
    res.end(data);
  } catch {
    send(res, 404, 'Not Found');
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed');
  }

  let urlPath;
  try {
    urlPath = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return send(res, 400, 'Bad Request');
  }

  if (urlPath.includes('..')) return send(res, 404, 'Not Found');

  let target;
  try {
    const decoded = decodeURIComponent(urlPath.replace(/^\/+/, ''));
    target = path.resolve(ROOT, decoded);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return send(res, 404, 'Not Found');
  } catch {
    return send(res, 400, 'Bad Request');
  }

  let stats;
  try {
    stats = fs.statSync(target);
  } catch {
    return send(res, 404, 'Not Found');
  }

  if (stats.isDirectory()) {
    if (!urlPath.endsWith('/')) {
      res.writeHead(301, { Location: `${urlPath}/` });
      return res.end();
    }
    const indexFile = path.join(target, 'index.html');
    return fs.existsSync(indexFile) ? serveFile(res, indexFile) : send(res, 404, 'Not Found');
  }

  if (stats.isFile()) return serveFile(res, target);
  return send(res, 404, 'Not Found');
});

server.listen(PORT, () => {
  console.log(`ixoye.space dev server → http://localhost:${PORT}`);
});
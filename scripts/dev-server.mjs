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
 * Service workers only run in a secure context. `http://localhost` already
 * counts as secure in desktop browsers, so plain `node scripts/dev-server.mjs`
 * is enough for ordinary local testing. To test the offline reading feature
 * from another device (e.g. a phone on the LAN), the page must be opened over
 * HTTPS — use `--https`; the first run generates a self-signed certificate in
 * .dev-certs/ (SANs: localhost + host .local names + your LAN IPv4 addresses)
 * with openssl. If the Mac's LAN address changes (DHCP), the stored cert no
 * longer covers it and the phone shows a warning again — the server detects
 * that on startup and regenerates (devices must re-trust once).
 *
 * Usage:
 *   node scripts/dev-server.mjs [--port 3000]
 *   node scripts/dev-server.mjs --https [--port 3443] [--regen-certs]
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg !== -1 ? process.argv[portArg + 1] : process.env.PORT || 3000);
const HTTPS = process.argv.includes('--https');

const CERTS_DIR = path.join(ROOT, '.dev-certs');
const CERT_FILE = path.join(CERTS_DIR, 'cert.pem');
const KEY_FILE = path.join(CERTS_DIR, 'key.pem');

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

const handler = (req, res) => {
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
};

// ---------------------------------------------------------------------------
// HTTPS: generate a self-signed cert (SANs: localhost + LAN IPv4 addresses).
// ---------------------------------------------------------------------------

function lanIPv4s() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      // Skip link-local (169.254/16): never usable from the phone, and
      // coming/going interfaces must not invalidate the stored cert.
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254.')) ips.push(ni.address);
    }
  }
  return [...new Set(ips)];
}

/**
 * Stable mDNS names for this Mac: unlike DHCP leases they survive reconnects,
 * so `https://<host>.local:<port>` keeps working (and stays covered by the
 * stored cert) while a bare-IP URL breaks after every lease change.
 */
function hostNames() {
  const names = new Set(['localhost']);
  try {
    const short = String(os.hostname() || '').split('.')[0].replace(/[^\w-]/g, '');
    if (short && short !== 'localhost') {
      names.add(short);
      names.add(`${short}.local`);
    }
  } catch { /* os.hostname unavailable */ }
  return [...names];
}

/** Parse the SAN extension of the stored cert into { dns:Set, ip:Set }. */
function storedCertSans() {
  try {
    const text = execFileSync('openssl', ['x509', '-in', CERT_FILE, '-noout', '-text'], { encoding: 'utf8' });
    const m = text.match(/X509v3 Subject Alternative Name:\s*\n\s*([^\n]+)/);
    if (!m) return null;
    const dns = new Set();
    const ip = new Set();
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (t.startsWith('DNS:')) dns.add(t.slice(4));
      else if (t.startsWith('IP Address:')) ip.add(t.slice(11));
    }
    return { dns, ip };
  } catch {
    return null;
  }
}

/** Subject CN of the stored cert (used as its recognizable identity). */
function storedCertCN() {
  try {
    const text = execFileSync('openssl', ['x509', '-in', CERT_FILE, '-noout', '-subject'], { encoding: 'utf8' });
    const m = text.match(/CN\s*=\s*([^\s/,]+)/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function ensureCerts() {
  const ips = lanIPv4s();
  const dnsNames = hostNames();
  const force = process.argv.includes('--regen-certs');

  if (!force && fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    const sans = storedCertSans();
    const covers =
      sans &&
      storedCertCN() === 'ixoye-dev-local' &&
      ips.every((ip) => sans.ip.has(ip)) &&
      dnsNames.every((d) => sans.dns.has(d)) &&
      sans.ip.has('127.0.0.1');
    if (covers) return { cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE), regenerated: false };
    console.log('Stored dev certificate no longer covers current LAN addresses — regenerating.');
    console.log('Devices must re-trust the new cert once (see below).');
  }
  fs.mkdirSync(CERTS_DIR, { recursive: true });

  // Stable human-readable identity: this is the name shown in
  // Settings → General → VPN & Device Management and in Certificate Trust
  // Settings. Never use an IP here — after every DHCP change the user could
  // no longer tell the new cert from the old one and trusts the wrong entry.
  const cn = 'ixoye-dev-local';
  const sans = ['DNS:localhost', 'IP:127.0.0.1']
    .concat(hostNames().filter((d) => d !== 'localhost').map((d) => `DNS:${d}`))
    .concat(ips.map((ip) => `IP:${ip}`));
  const baseArgs = [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', KEY_FILE, '-out', CERT_FILE,
    '-days', '365', '-nodes', '-subj', `/CN=${cn}`,
  ];

  // Prefer `-addext` (OpenSSL ≥ 1.1.1, LibreSSL ≥ 3.3); fall back to a config
  // file for older builds that only read extensions from a config section.
  const args = baseArgs.concat(['-addext', `subjectAltName=${sans.join(',')}`]);
  try {
    execFileSync('openssl', args, { stdio: 'ignore' });
  } catch {
    const config = path.join(CERTS_DIR, 'openssl.cnf');
    const numbered = [];
    for (let i = 0; i < sans.length; i++) {
      const [tag, value] = sans[i].split(/:(.+)/);
      numbered.push(`${tag}.${i + 1} = ${value}`);
    }
    fs.writeFileSync(
      config,
      `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n` +
      `[dn]\nCN=${cn}\n` +
      `[v3]\nsubjectAltName=@alt\nbasicConstraints=CA:FALSE\n` +
      `keyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n` +
      `[alt]\n${numbered.join('\n')}\n`
    );
    execFileSync('openssl', baseArgs.concat(['-config', config]), { stdio: 'ignore' });
    fs.rmSync(config, { force: true });
  }
  return { cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE), regenerated: true };
}

function listen() {
  if (HTTPS) {
    const { cert, key, regenerated } = ensureCerts();
    const server = https.createServer({ cert, key }, handler);
    const stable = hostNames().find((d) => d.endsWith('.local'));
    server.listen(PORT, () => {
      console.log(`ixoye.space dev server → https://localhost:${PORT}`);
      if (stable) console.log(`  phone/LAN (stable across DHCP) → https://${stable}:${PORT}`);
      for (const ip of lanIPv4s()) console.log(`  phone/LAN → https://${ip}:${PORT}`);
      if (regenerated) {
        console.log('');
        console.log('Сертификат ПЕРЕВЫПУЩЕН: удалите старый профиль с устройств и доверьте новый (см. ниже).');
      }
      console.log('');
      console.log('Сертификат самоподписанный: .dev-certs/cert.pem (имя «ixoye-dev-local»).');
      console.log('Чтобы браузер и устройство ему доверяли:');
      console.log('  macOS:  sudo security add-trusted-cert -d -r trustRoot \\');
      console.log('            -k /Library/Keychains/System.keychain .dev-certs/cert.pem');
      console.log('  iOS:    1) удалите старый профиль ixoye (Настройки → Основные →');
      console.log('             VPN и управление устройством);');
      console.log('          2) отправьте .dev-certs/cert.pem на устройство (AirDrop);');
      console.log('          3) установите профиль;');
      console.log('          4) включите «полное доверие» именно для «ixoye-dev-local»:');
      console.log('             Настройки → Основные → Об этом устройстве →');
      console.log('             Настройки доверия сертификатам.');
      console.log('          5) удалите и заново добавьте приложение на главный экран —');
      console.log('             только потом открывайте его.');
      console.log('  Важно: кнопка «посетить сайт» в Safari НЕ помогает приложению —');
      console.log('  исключение Safari не действует в отдельном приложении. Без полного');
      console.log('  доверия (п. 4) приложение будет показывать предупреждение по кругу.');
      console.log('  Android: Настройки → Безопасность → Установить сертификат (CA для сети),');
      console.log('          затем Chrome спросит разрешения при первом заходе.');
      console.log('После доверия перезапустите браузер. GitHub Pages всегда работает по HTTPS.');
    });
  } else {
    const server = http.createServer(handler);
    server.listen(PORT, () => {
      console.log(`ixoye.space dev server → http://localhost:${PORT}`);
    });
  }
}

listen();
// Service Worker for ixoye.space
// Provides offline functionality for the Russian Apocryphal Studio

let CURRENT_VERSION = '1';

// App shell files to cache immediately
const APP_SHELL = [
  '/',
  '/index.html',
  '/about.html',
  '/2_sif.html',
  '/manifest.json',
  '/src/styles/main.css',
  '/src/js/app.js'
];

// Content paths for network-first strategy
const CONTENT_PATHS = [
  '/index.html',
  '/about.html',
  '/2_sif.html',
  '/apocrypha-new/',
  '/apocrypha-old/',
  '/nag-hammadi/',
  '/gnostic/',
  '/kumran/',
  '/hermetic/',
  '/study/',
  '/contacts/',
  '/links/'
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    getVersion()
      .then(version => {
        CURRENT_VERSION = version;
        const staticCacheName = `ixoye-static-v${version}`;
        return caches.open(staticCacheName);
      })
      .then(cache => {
        console.log('[SW] Caching app shell');
        return cache.addAll(APP_SHELL);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        const staticCacheName = `ixoye-static-v${CURRENT_VERSION}`;
        const contentCacheName = `ixoye-content-v${CURRENT_VERSION}`;
        return Promise.all(
          cacheNames
            .filter(name => name !== staticCacheName && name !== contentCacheName)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - cache-first for static assets, network-first for content
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isContentPath(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

// Check if request is for static assets
function isStaticAsset(pathname) {
  const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.json'];
  return staticExtensions.some(ext => pathname.endsWith(ext)) ||
         pathname.endsWith('/') ||
         pathname.endsWith('index.html');
}

// Check if request is for content
function isContentPath(pathname) {
  return CONTENT_PATHS.some(path => pathname.startsWith(path));
}

// Cache-first strategy
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(`ixoye-static-v${CURRENT_VERSION}`);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Cache-first fetch failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

// Network-first strategy with cache fallback
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(`ixoye-content-v${CURRENT_VERSION}`);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Network-first fetch failed, trying cache:', error);
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline - Content not available', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }

  if (event.data === 'clearCache') {
    caches.keys().then(names => Promise.all(names.map(name => caches.delete(name))));
  }

  if (event.data === 'precacheAll') {
    event.waitUntil(precacheAll());
  }
});

async function getVersion() {
  try {
    const response = await fetch('/package.json');
    const data = await response.json();
    return data.version || '1';
  } catch (error) {
    console.log('[SW] Failed to fetch version, using fallback');
    return '1';
  }
}

async function precacheAll() {
  try {
    const response = await fetch('/precache-manifest.json');
    if (!response.ok) throw new Error('Manifest not found');
    const urls = await response.json();
    const cache = await caches.open(`ixoye-content-v${CURRENT_VERSION}`);
    console.log(`[SW] Precaching ${urls.length} URLs`);
    await cache.addAll(urls);
    console.log('[SW] Precaching complete');
  } catch (error) {
    console.error('[SW] Precaching failed:', error);
  }
}

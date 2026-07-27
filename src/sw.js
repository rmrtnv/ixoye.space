// Service Worker for ixoye.space
// Provides offline functionality for the Russian Apocryphal Studio

const CACHE_NAME = 'ixoye-space-v1';
const STATIC_CACHE = 'ixoye-static-v1';
const CONTENT_CACHE = 'ixoye-content-v1';

// App shell files to cache immediately
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/styles/main.css',
  '/src/js/app.js'
];

// Content directories to cache
const CONTENT_PATHS = [
  '/content/',
  '/apocryph1/',
  '/apocryph2/',
  '/nag_hammadi/',
  '/gnost/',
  '/kumran/',
  '/hermes/',
  '/study/',
  '/pics/'
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
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
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== CONTENT_CACHE)
            .map((name) => {
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

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== location.origin) return;

  // App shell strategy: Cache first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Content strategy: Network first with cache fallback
  if (isContentPath(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Default: Network first
  event.respondWith(networkFirst(request));
});

// Check if request is for static assets
function isStaticAsset(pathname) {
  const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2'];
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
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
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
      const cache = await caches.open(CONTENT_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Network-first fetch failed, trying cache:', error);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
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
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name));
    });
  }
});

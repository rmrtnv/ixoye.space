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
    event.waitUntil(precacheAll(event.source));
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

async function precacheAll(sourceClient) {
  let total = 0;
  
  try {
    console.log('[SW] Starting precacheAll...');
    
    // Fetch manifest
    const response = await fetch('/precache-manifest.json');
    console.log('[SW] Manifest fetch response:', response.status, response.statusText);
    
    if (!response.ok) throw new Error(`Manifest fetch failed: ${response.status} ${response.statusText}`);
    
    const urls = await response.json();
    console.log('[SW] Manifest parsed, URLs count:', urls.length);
    
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('Manifest is empty or not an array');
    }
    
    total = urls.length;
    const cache = await caches.open(`ixoye-content-v${CURRENT_VERSION}`);
    console.log(`[SW] Precaching ${total} URLs`);
    
    // Notify start with total count
    broadcast({ type: 'precacheStart', total: total }, sourceClient);
    
    let cachedCount = 0;
    let failedCount = 0;
    
    for (let i = 0; i < total; i++) {
      try {
        await cache.add(urls[i]);
        cachedCount++;
      } catch (error) {
        failedCount++;
        console.error(`[SW] Failed to cache ${urls[i]}:`, error);
      }
      
      // Report progress every 5 URLs or at the end
      if (i % 5 === 0 || i === total - 1) {
        broadcast({ 
          type: 'precacheProgress', 
          current: i + 1, 
          total: total,
          cached: cachedCount,
          failed: failedCount
        }, sourceClient);
      }
    }
    
    console.log(`[SW] Precaching complete: ${cachedCount} cached, ${failedCount} failed`);
    broadcast({ 
      type: 'precacheComplete', 
      cached: cachedCount, 
      failed: failedCount 
    }, sourceClient);
    
  } catch (error) {
    console.error('[SW] Precaching failed:', error);
    broadcast({ type: 'precacheError', error: error.message }, sourceClient);
  }
}

function broadcast(message, sourceClient) {
  // Send to source client directly (fixes iOS Safari standalone PWA matchAll issue)
  if (sourceClient && typeof sourceClient.postMessage === 'function') {
    try {
      sourceClient.postMessage(message);
    } catch (e) {
      console.error('[SW] Failed to postMessage to source:', e);
    }
  }
  
  // Also broadcast to all other clients via matchAll
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clients => {
      console.log('[SW] Broadcasting to', clients.length, 'clients');
      clients.forEach(client => {
        try {
          client.postMessage(message);
        } catch (e) {
          console.error('[SW] Failed to postMessage:', e);
        }
      });
    })
    .catch(err => console.error('[SW] matchAll failed:', err));
}
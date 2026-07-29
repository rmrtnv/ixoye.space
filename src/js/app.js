/**
 * ixoye.space - Russian Apocryphal Studio
 * Main application JavaScript
 */

// App configuration
const APP_CONFIG = {
  appName: 'Русская Апокрифическая Студия',
  version: '1.0.0',
  dbName: 'ixoye_space_db',
  dbVersion: 1,
  storeName: 'bookmarks'
};

// Global state
let db = null;

/**
 * Initialize the application
 */
async function initApp() {
  console.log(`[${APP_CONFIG.appName}] Initializing v${APP_CONFIG.version}`);

  // Register Service Worker
  await registerServiceWorker();

  // Initialize IndexedDB
  await initIndexedDB();

  // Set up UI event listeners
  setupEventListeners();

  // Check online status
  updateOnlineStatus();

  // Auto-precache when running as installed PWA on WiFi
  await maybePrecacheForOffline();

  console.log('[App] Initialization complete');
}

/**
 * Register Service Worker
 */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/src/sw.js');
      console.log('[SW] Registration successful:', registration.scope);
    } catch (error) {
      console.error('[SW] Registration failed:', error);
    }
  } else {
    console.warn('[SW] Service Worker not supported');
  }
}

/**
 * Initialize IndexedDB for bookmarks and preferences
 */
async function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(APP_CONFIG.dbName, APP_CONFIG.dbVersion);

    request.onerror = () => {
      console.error('[DB] Failed to open database');
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[DB] Database opened successfully');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains('bookmarks')) {
        database.createObjectStore('bookmarks', { keyPath: 'url' });
      }

      if (!database.objectStoreNames.contains('preferences')) {
        database.createObjectStore('preferences', { keyPath: 'key' });
      }

      console.log('[DB] Database schema created');
    };
  });
}

/**
 * Add bookmark
 */
async function addBookmark(url, title) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const transaction = db.transaction(['bookmarks'], 'readwrite');
    const store = transaction.objectStore('bookmarks');
    const request = store.put({ url, title, addedAt: new Date().toISOString() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove bookmark
 */
async function removeBookmark(url) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const transaction = db.transaction(['bookmarks'], 'readwrite');
    const store = transaction.objectStore('bookmarks');
    const request = store.delete(url);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all bookmarks
 */
async function getBookmarks() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const transaction = db.transaction(['bookmarks'], 'readonly');
    const store = transaction.objectStore('bookmarks');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save user preference
 */
async function savePreference(key, value) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const transaction = db.transaction(['preferences'], 'readwrite');
    const store = transaction.objectStore('preferences');
    const request = store.put({ key, value });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get user preference
 */
async function getPreference(key) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const transaction = db.transaction(['preferences'], 'readonly');
    const store = transaction.objectStore('preferences');
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Set up UI event listeners
 */
function setupEventListeners() {
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  window.addEventListener('beforeunload', saveScrollPosition);
}

/**
 * Update online/offline status indicator
 */
function updateOnlineStatus() {
  const status = navigator.onLine ? 'online' : 'offline';
  document.body.classList.toggle('offline', !navigator.onLine);

  const indicator = document.getElementById('online-status');
  if (indicator) {
    indicator.textContent = navigator.onLine ? '✓ Online' : '✗ Offline';
    indicator.className = navigator.onLine ? 'status-online' : 'status-offline';
  }

  console.log(`[App] Network status: ${status}`);
}

/**
 * Save scroll position for navigation restoration
 */
function saveScrollPosition() {
  const scrollPos = window.scrollY;
  sessionStorage.setItem('scrollPosition', scrollPos.toString());
}

/**
 * Auto-precache all content when running as installed PWA on WiFi
 */
async function maybePrecacheForOffline() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  if (!isStandalone) return;

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const isWifi = !connection ||
    connection.type !== 'cellular' ||
    connection.effectiveType !== '2g' ||
    connection.effectiveType === '4g';

  if (!isWifi) return;

  const sendPrecache = () => {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('precacheAll');
      console.log('[App] Sent precacheAll to SW');
    }
  };

  sendPrecache();

  // iOS/Safari: controller may not be set on first PWA launch
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', sendPrecache, { once: true });
  }
}

/**
 * Estimate storage usage
 */
async function getStorageEstimate() {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return {
      used: (estimate.usage / 1024 / 1024).toFixed(2),
      quota: (estimate.quota / 1024 / 1024).toFixed(2)
    };
  }
  return null;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Export for use in other scripts
window.App = {
  initApp,
  addBookmark,
  removeBookmark,
  getBookmarks,
  savePreference,
  getPreference,
  getStorageEstimate
};

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

  // Show offline download prompt for PWA users
  await maybeShowOfflinePrompt();

  console.log('[App] Initialization complete');
}

/**
 * Register Service Worker
 */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/src/sw.js', { scope: '/' });
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

  // Listen for Service Worker messages (precache progress)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleSWMessage);
  }
}

/**
 * Handle messages from Service Worker
 */
function handleSWMessage(event) {
  const data = event.data;
  if (!data) return;

  console.log('[App] Received SW message:', data.type, data);

  if (data.type === 'precacheStart') {
    onPrecacheStart(data.total);
  } else if (data.type === 'precacheProgress') {
    updatePrecacheProgress(data.current, data.total, data.cached, data.failed);
  } else if (data.type === 'precacheComplete') {
    onPrecacheComplete(data.cached, data.failed);
  } else if (data.type === 'precacheError') {
    onPrecacheError(data.error);
  }
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
 * Show offline download prompt when running as installed PWA
 */
async function maybeShowOfflinePrompt() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       (typeof navigator !== 'undefined' && navigator.standalone === true);
  
  if (!isStandalone) return;
  if (!navigator.onLine) return;

  // Check if user already dismissed or completed download
  const promptDismissed = sessionStorage.getItem('offline_prompt_dismissed');
  const precacheDone = sessionStorage.getItem('precache_done');
  
  if (precacheDone === 'true') return;
  if (promptDismissed === 'true') {
    // Re-show after 24 hours
    const dismissedAt = parseInt(sessionStorage.getItem('offline_prompt_dismissed_at') || '0');
    if (Date.now() - dismissedAt < 24 * 60 * 60 * 1000) return;
  }

  showOfflinePrompt();
}

/**
 * Show the offline download prompt
 */
function showOfflinePrompt() {
  const existing = document.getElementById('offline-prompt');
  if (existing) {
    existing.style.display = 'flex';
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'offline-prompt';
  modal.style.cssText = 'display:flex;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:2000;justify-content:center;align-items:center;';
  modal.innerHTML = `
    <div style="background:#fff;padding:24px;border-radius:8px;max-width:420px;width:90%;text-align:center;font-family:Times New Roman,Georgia,serif;">
      <h3 style="color:#BA6841;margin-top:0;">Скачать для офлайн-чтения?</h3>
      <p style="text-align:center;">Хотите сохранить все тексты на устройство для чтения без интернета? Это займёт несколько секунд при подключении к WiFi.</p>
      <div style="margin-top:16px;">
        <button id="btn-download" style="background:#BA6841;color:#fff;border:none;padding:10px 24px;border-radius:4px;cursor:pointer;font-family:Arial,Helvetica,sans-serif;font-size:1rem;">Скачать</button>
        <button id="btn-dismiss" style="background:#ccc;color:#333;border:none;padding:10px 24px;border-radius:4px;cursor:pointer;font-family:Arial,Helvetica,sans-serif;font-size:1rem;margin-left:8px;">Позже</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('btn-download').addEventListener('click', () => {
    modal.remove();
    startPrecache();
  });

  document.getElementById('btn-dismiss').addEventListener('click', () => {
    modal.remove();
    sessionStorage.setItem('offline_prompt_dismissed', 'true');
    sessionStorage.setItem('offline_prompt_dismissed_at', Date.now().toString());
  });
}

/**
 * Start precaching all content
 */
async function startPrecache() {
  showPrecacheProgress();

  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active || registration.waiting || registration.installing;
    
    if (worker) {
      worker.postMessage('precacheAll');
      console.log('[App] Sent precacheAll to SW');
    } else {
      console.warn('[App] No SW worker available');
      onPrecacheError('Service Worker not available');
    }
  } catch (error) {
    console.error('[App] startPrecache failed:', error);
    onPrecacheError(error.message);
  }
}

/**
 * Handle precache start - show total count
 */
function onPrecacheStart(total) {
  console.log('[App] Precaching started, total URLs:', total);
  showPrecacheProgress(total);
}

/**
 * Show precache progress UI
 */
function showPrecacheProgress(total) {
  const existing = document.getElementById('precache-progress');
  if (existing) {
    existing.style.display = 'flex';
    if (total) {
      const detail = document.getElementById('precache-detail');
      if (detail) detail.textContent = `0 / ${total}`;
    }
    return;
  }

  const progress = document.createElement('div');
  progress.id = 'precache-progress';
  progress.style.cssText = 'display:flex;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#BA6841;color:#fff;padding:16px 24px;border-radius:8px;z-index:2000;text-align:center;font-family:Arial,Helvetica,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,0.2);min-width:280px;flex-direction:column;gap:8px;';
  progress.innerHTML = `
    <p id="precache-status" style="margin:0;">Кэширование текстов...</p>
    <div style="background:rgba(255,255,255,0.3);border-radius:4px;height:8px;width:100%;">
      <div id="precache-bar" style="background:#fff;height:100%;width:0%;border-radius:4px;transition:width 0.3s;"></div>
    </div>
    <p id="precache-detail" style="margin:0;font-size:0.85rem;opacity:0.9;">0 / ${total || 0}</p>
    <button id="btn-close-progress" style="display:none;background:rgba(255,255,255,0.2);color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-family:Arial,Helvetica,sans-serif;font-size:0.85rem;margin-top:8px;">Закрыть</button>
  `;

  document.body.appendChild(progress);
  progress.style.display = 'flex';

  const closeBtn = document.getElementById('btn-close-progress');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const progress = document.getElementById('precache-progress');
      if (progress) progress.remove();
    });
  }
}

/**
 * Update precache progress bar
 */
function updatePrecacheProgress(current, total, cached, failed) {
  const bar = document.getElementById('precache-bar');
  const detail = document.getElementById('precache-detail');
  const status = document.getElementById('precache-status');

  if (bar) {
    const percent = Math.round((current / total) * 100);
    bar.style.width = `${percent}%`;
  }

  if (detail) {
    detail.textContent = `${current} / ${total}${cached !== undefined ? ` (кэшировано: ${cached}, ошибки: ${failed || 0})` : ''}`;
  }

  if (status && current === total) {
    status.textContent = 'Готово!';
  }
}

/**
 * Handle precache completion
 */
function onPrecacheComplete(cached, failed) {
  console.log('[App] Precaching complete:', { cached, failed });
  sessionStorage.setItem('precache_done', 'true');
  sessionStorage.removeItem('offline_prompt_dismissed');

  const status = document.getElementById('precache-status');
  const detail = document.getElementById('precache-detail');
  const closeBtn = document.getElementById('btn-close-progress');

  if (status) status.textContent = 'Готово! Все тексты сохранены.';
  if (detail) detail.textContent = `Кэшировано: ${cached}${failed ? `, ошибки: ${failed}` : ''}`;
  if (closeBtn) closeBtn.style.display = 'inline-block';
}

/**
 * Handle precache error
 */
function onPrecacheError(error) {
  console.error('[App] Precaching failed:', error);
  const status = document.getElementById('precache-status');
  const closeBtn = document.getElementById('btn-close-progress');
  
  if (status) status.textContent = 'Ошибка кэширования: ' + error;
  if (closeBtn) closeBtn.style.display = 'inline-block';
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
  getStorageEstimate,
  startPrecache,
  showOfflinePrompt
};
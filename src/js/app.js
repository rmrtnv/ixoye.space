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
  storeName: 'search_index'
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
      
      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[SW] New version available');
            showUpdateNotification();
          }
        });
      });
    } catch (error) {
      console.error('[SW] Registration failed:', error);
    }
  } else {
    console.warn('[SW] Service Worker not supported');
  }
}

/**
 * Initialize IndexedDB for search index and bookmarks
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
      
      // Create search index store
      if (!database.objectStoreNames.contains('search_index')) {
        database.createObjectStore('search_index', { keyPath: 'id', autoIncrement: true });
      }
      
      // Create bookmarks store
      if (!database.objectStoreNames.contains('bookmarks')) {
        database.createObjectStore('bookmarks', { keyPath: 'url' });
      }
      
      // Create user preferences store
      if (!database.objectStoreNames.contains('preferences')) {
        database.createObjectStore('preferences', { keyPath: 'key' });
      }
      
      console.log('[DB] Database schema created');
    };
  });
}

/**
 * Add content to search index
 */
async function addToSearchIndex(doc) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    const transaction = db.transaction(['search_index'], 'readwrite');
    const store = transaction.objectStore('search_index');
    const request = store.add(doc);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Search the index
 */
async function searchIndex(query) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    const results = [];
    const transaction = db.transaction(['search_index'], 'readonly');
    const store = transaction.objectStore('search_index');
    const request = store.openCursor();
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const doc = cursor.value;
        const searchableText = `${doc.title} ${doc.content} ${doc.keywords}`.toLowerCase();
        if (searchableText.includes(query.toLowerCase())) {
          results.push(doc);
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    
    request.onerror = () => reject(request.error);
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
  // Online/offline status
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);
  
  // Before unload - save scroll position
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
 * Handle keyboard shortcuts
 */
function handleKeyboardShortcuts(event) {
  // Ctrl/Cmd + F for search
  if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
    event.preventDefault();
    openSearch();
  }
  
  // Ctrl/Cmd + B for bookmarks
  if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
    event.preventDefault();
    toggleBookmarks();
  }
}

/**
 * Open search dialog
 */
function openSearch() {
  const query = prompt('Поиск по сайту:');
  if (query) {
    window.location.href = `/search?q=${encodeURIComponent(query)}`;
  }
}

/**
 * Toggle bookmarks panel
 */
function toggleBookmarks() {
  const panel = document.getElementById('bookmarks-panel');
  if (panel) {
    panel.classList.toggle('hidden');
  }
}

/**
 * Save scroll position for navigation restoration
 */
function saveScrollPosition() {
  const scrollPos = window.scrollY;
  sessionStorage.setItem('scrollPosition', scrollPos.toString());
}

/**
 * Show update notification
 */
function showUpdateNotification() {
  const notification = document.createElement('div');
  notification.className = 'update-notification';
  notification.innerHTML = `
    <p>Доступна новая версия сайта!</p>
    <button onclick="location.reload()">Обновить</button>
    <button onclick="this.parentElement.remove()">Позже</button>
  `;
  document.body.appendChild(notification);
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
  addToSearchIndex,
  searchIndex,
  addBookmark,
  removeBookmark,
  getBookmarks,
  savePreference,
  getPreference,
  getStorageEstimate
};

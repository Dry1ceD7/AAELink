/**
 * AAELink Service Worker
 * Offline-first with intelligent caching and background sync
 * BMAD Method: Resilient offline operation
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `aaelink-${CACHE_VERSION}`;
const API_CACHE = `aaelink-api-${CACHE_VERSION}`;
const STATIC_CACHE = `aaelink-static-${CACHE_VERSION}`;

// Assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

// API endpoints to cache
const API_CACHE_PATHS = [
  '/api/auth/me',
  '/api/channels',
  '/api/messages',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      console.log('[SW] Service worker installed');
      return self.skipWaiting(); // Activate immediately
    })
  );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return cacheName.startsWith('aaelink-') &&
                   !cacheName.includes(CACHE_VERSION);
          })
          .map((cacheName) => {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => {
      console.log('[SW] Service worker activated');
      return self.clients.claim(); // Take control immediately
    })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip WebSocket connections
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // API requests - Network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      networkFirstStrategy(request)
    );
    return;
  }

  // Static assets - Cache first, fallback to network
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      cacheFirstStrategy(request)
    );
    return;
  }

  // Default - Network first
  event.respondWith(
    networkFirstStrategy(request)
  );
});

// Cache-first strategy for static assets
async function cacheFirstStrategy(request) {
  const cache = await caches.open(STATIC_CACHE);

  try {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      // Update cache in background
      fetchAndCache(request, cache);
      return cachedResponse;
    }

    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache first failed:', error);
    // Return offline page if available
    const offlineResponse = await cache.match('/offline.html');
    return offlineResponse || new Response('Offline', { status: 503 });
  }
}

// Network-first strategy for API requests
async function networkFirstStrategy(request) {
  const cache = await caches.open(API_CACHE);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache successful responses
      if (shouldCacheApiResponse(request.url)) {
        cache.put(request, networkResponse.clone());
      }
    }

    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);

    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      // Add header to indicate cached response
      const headers = new Headers(cachedResponse.headers);
      headers.set('X-From-Cache', 'true');

      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: headers,
      });
    }

    // Return error response
    return new Response(
      JSON.stringify({
        error: 'Network error',
        offline: true
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Background fetch and cache update
async function fetchAndCache(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response);
    }
  } catch (error) {
    // Silent fail - we already returned cached version
  }
}

// Check if URL is a static asset
function isStaticAsset(pathname) {
  const staticExtensions = [
    '.js', '.css', '.png', '.jpg', '.jpeg',
    '.gif', '.svg', '.ico', '.woff', '.woff2'
  ];

  return staticExtensions.some(ext => pathname.endsWith(ext));
}

// Check if API response should be cached
function shouldCacheApiResponse(url) {
  return API_CACHE_PATHS.some(path => url.includes(path));
}

// Handle background sync for offline actions
self.addEventListener('sync', async (event) => {
  console.log('[SW] Background sync triggered:', event.tag);

  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  } else if (event.tag === 'sync-files') {
    event.waitUntil(syncFiles());
  }
});

// Sync offline messages
async function syncMessages() {
  try {
    // Get queued messages from IndexedDB
    const db = await openDB();
    const tx = db.transaction('offline_queue', 'readonly');
    const store = tx.objectStore('offline_queue');
    const messages = await store.getAll();

    for (const message of messages) {
      if (message.type === 'message') {
        await fetch('/api/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message.data),
        });

        // Remove from queue after successful sync
        const deleteTx = db.transaction('offline_queue', 'readwrite');
        await deleteTx.objectStore('offline_queue').delete(message.id);
      }
    }

    // Notify clients of successful sync
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'sync-complete',
        target: 'messages',
      });
    });
  } catch (error) {
    console.error('[SW] Message sync failed:', error);
    throw error; // Retry sync
  }
}

// Sync offline file uploads
async function syncFiles() {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_files', 'readonly');
    const store = tx.objectStore('offline_files');
    const files = await store.getAll();

    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file.blob, file.name);
      formData.append('metadata', JSON.stringify(file.metadata));

      await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      // Remove from queue after successful upload
      const deleteTx = db.transaction('offline_files', 'readwrite');
      await deleteTx.objectStore('offline_files').delete(file.id);
    }

    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'sync-complete',
        target: 'files',
      });
    });
  } catch (error) {
    console.error('[SW] File sync failed:', error);
    throw error;
  }
}

// Open IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AAELinkOffline', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains('offline_queue')) {
        db.createObjectStore('offline_queue', {
          keyPath: 'id',
          autoIncrement: true
        });
      }

      if (!db.objectStoreNames.contains('offline_files')) {
        db.createObjectStore('offline_files', {
          keyPath: 'id',
          autoIncrement: true
        });
      }

      if (!db.objectStoreNames.contains('cached_data')) {
        const store = db.createObjectStore('cached_data', {
          keyPath: 'key'
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// Handle push notifications
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'View',
        icon: '/icons/checkmark.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icons/xmark.png'
      },
    ]
  };

  event.waitUntil(
    self.registration.showNotification('AAELink', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'explore') {
    // Open the app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

console.log('[SW] Service worker loaded');

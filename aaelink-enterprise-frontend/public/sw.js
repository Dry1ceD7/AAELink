/**
 * AAELink Enterprise Service Worker
 * Offline-First Architecture Implementation
 * Version: 1.2.0
 */

const CACHE_NAME = 'aaelink-enterprise-v1.2.0';
const STATIC_CACHE = 'aaelink-static-v1.2.0';
const DYNAMIC_CACHE = 'aaelink-dynamic-v1.2.0';
const API_CACHE = 'aaelink-api-v1.2.0';

// Core assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// API endpoints to cache
const API_ENDPOINTS = [
  '/api/auth/login',
  '/api/users/profile',
  '/api/chat/messages',
  '/api/calendar/events',
  '/api/search'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE &&
                cacheName !== DYNAMIC_CACHE &&
                cacheName !== API_CACHE) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - implement offline-first strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle different types of requests
  if (isStaticAsset(request)) {
    event.respondWith(handleStaticAsset(request));
  } else if (isAPIRequest(request)) {
    event.respondWith(handleAPIRequest(request));
  } else if (isPageRequest(request)) {
    event.respondWith(handlePageRequest(request));
  } else {
    event.respondWith(handleOtherRequest(request));
  }
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);

  if (event.tag === 'offline-messages') {
    event.waitUntil(syncOfflineMessages());
  } else if (event.tag === 'offline-files') {
    event.waitUntil(syncOfflineFiles());
  } else if (event.tag === 'offline-events') {
    event.waitUntil(syncOfflineEvents());
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  const options = {
    body: event.data ? event.data.text() : 'New notification from AAELink',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
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
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('AAELink Enterprise', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);

  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/dashboard')
    );
  }
});

// Helper functions
function isStaticAsset(request) {
  const url = new URL(request.url);
  return url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/);
}

function isAPIRequest(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith('/api/');
}

function isPageRequest(request) {
  const url = new URL(request.url);
  return url.pathname === '/' || url.pathname.startsWith('/dashboard') || url.pathname.startsWith('/en');
}

function handleStaticAsset(request) {
  return caches.match(request)
    .then((response) => {
      if (response) {
        return response;
      }

      return fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE)
              .then((cache) => {
                cache.put(request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          // Return fallback for images
          if (request.destination === 'image') {
            return new Response('<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" fill="#f0f0f0"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#999">Image unavailable</text></svg>', {
              headers: { 'Content-Type': 'image/svg+xml' }
            });
          }
        });
    });
}

function handleAPIRequest(request) {
  return caches.open(API_CACHE)
    .then((cache) => {
      return cache.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached response and update in background
            fetch(request)
              .then((response) => {
                if (response.status === 200) {
                  cache.put(request, response.clone());
                }
              })
              .catch(() => {
                // Network error, keep using cached response
              });

            return cachedResponse;
          }

          // No cached response, fetch from network
          return fetch(request)
            .then((response) => {
              if (response.status === 200) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // Network error, return offline response
              return new Response(JSON.stringify({
                error: 'Offline',
                message: 'This request is not available offline',
                offline: true
              }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              });
            });
        });
    });
}

function handlePageRequest(request) {
  return caches.match(request)
    .then((response) => {
      if (response) {
        return response;
      }

      return fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE)
              .then((cache) => {
                cache.put(request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          // Return offline page
          return caches.match('/offline.html');
        });
    });
}

function handleOtherRequest(request) {
  return fetch(request)
    .catch(() => {
      return new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable'
      });
    });
}

// Background sync functions
async function syncOfflineMessages() {
  console.log('[SW] Syncing offline messages...');

  try {
    const offlineMessages = await getOfflineData('offline-messages');

    for (const message of offlineMessages) {
      try {
        const response = await fetch('/api/chat/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${message.token}`
          },
          body: JSON.stringify(message.data)
        });

        if (response.ok) {
          await removeOfflineData('offline-messages', message.id);
          console.log('[SW] Message synced successfully:', message.id);
        }
      } catch (error) {
        console.error('[SW] Failed to sync message:', error);
      }
    }
  } catch (error) {
    console.error('[SW] Failed to sync offline messages:', error);
  }
}

async function syncOfflineFiles() {
  console.log('[SW] Syncing offline files...');

  try {
    const offlineFiles = await getOfflineData('offline-files');

    for (const file of offlineFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file.data);
        formData.append('channelId', file.channelId);

        const response = await fetch('/api/files/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${file.token}`
          },
          body: formData
        });

        if (response.ok) {
          await removeOfflineData('offline-files', file.id);
          console.log('[SW] File synced successfully:', file.id);
        }
      } catch (error) {
        console.error('[SW] Failed to sync file:', error);
      }
    }
  } catch (error) {
    console.error('[SW] Failed to sync offline files:', error);
  }
}

async function syncOfflineEvents() {
  console.log('[SW] Syncing offline events...');

  try {
    const offlineEvents = await getOfflineData('offline-events');

    for (const event of offlineEvents) {
      try {
        const response = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${event.token}`
          },
          body: JSON.stringify(event.data)
        });

        if (response.ok) {
          await removeOfflineData('offline-events', event.id);
          console.log('[SW] Event synced successfully:', event.id);
        }
      } catch (error) {
        console.error('[SW] Failed to sync event:', error);
      }
    }
  } catch (error) {
    console.error('[SW] Failed to sync offline events:', error);
  }
}

// IndexedDB helper functions
async function getOfflineData(storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AAELinkOffline', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => resolve(getAllRequest.result);
      getAllRequest.onerror = () => reject(getAllRequest.error);
    };
  });
}

async function removeOfflineData(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AAELinkOffline', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const deleteRequest = store.delete(id);

      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
    };
  });
}

console.log('[SW] Service worker loaded successfully');

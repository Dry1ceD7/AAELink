/**
 * Service Worker for AAELink
 * Provides offline-first capabilities with caching and sync
 */

const CACHE_NAME = 'aaelink-v1';
const API_CACHE_NAME = 'aaelink-api-v1';
const STATIC_CACHE_NAME = 'aaelink-static-v1';

// Files to cache for offline use
const STATIC_FILES = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json',
  '/assets/logo-aae.svg',
  '/assets/logo-aae-text.svg',
  '/assets/logo-aae-transparent.svg'
];

// API endpoints to cache
const API_ENDPOINTS = [
  '/api/auth/session',
  '/api/channels',
  '/api/messages/',
  '/api/files'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');

  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('Service Worker installed');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME &&
                cacheName !== API_CACHE_NAME &&
                cacheName !== STATIC_CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - handle requests with caching strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Handle static file requests
  if (url.pathname.startsWith('/static/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg')) {
    event.respondWith(handleStaticRequest(request));
    return;
  }

  // Handle page requests (HTML)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(handlePageRequest(request));
    return;
  }
});

// Handle API requests with network-first strategy
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE_NAME);

  try {
    // Try network first
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('Network failed, trying cache for:', request.url);

    // Fall back to cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline response for API calls
    return new Response(
      JSON.stringify({
        error: 'Offline',
        message: 'This request is not available offline'
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Handle static file requests with cache-first strategy
async function handleStaticRequest(request) {
  const cache = await caches.open(STATIC_CACHE_NAME);

  // Try cache first
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    // Fall back to network
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('Failed to fetch static file:', request.url);
    return new Response('File not available offline', { status: 404 });
  }
}

// Handle page requests with network-first strategy
async function handlePageRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    // Try network first
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('Network failed, trying cache for page:', request.url);

    // Fall back to cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline page
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>AAELink - Offline</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              margin: 0; padding: 40px; text-align: center;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white; min-height: 100vh; display: flex;
              align-items: center; justify-content: center; flex-direction: column;
            }
            .offline-container { max-width: 400px; }
            .logo { width: 80px; height: 80px; margin: 0 auto 20px;
              background: white; border-radius: 50%; display: flex;
              align-items: center; justify-content: center; font-weight: bold;
              color: #667eea; font-size: 24px; }
            h1 { margin: 0 0 10px; font-size: 28px; }
            p { margin: 0 0 20px; opacity: 0.9; }
            .retry-btn {
              background: white; color: #667eea; border: none;
              padding: 12px 24px; border-radius: 6px; font-weight: bold;
              cursor: pointer; font-size: 16px;
            }
            .retry-btn:hover { opacity: 0.9; }
          </style>
        </head>
        <body>
          <div class="offline-container">
            <div class="logo">AAE</div>
            <h1>You're Offline</h1>
            <p>AAELink is not available right now. Please check your internet connection and try again.</p>
            <button class="retry-btn" onclick="window.location.reload()">
              Try Again
            </button>
          </div>
        </body>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag);

  if (event.tag === 'message-sync') {
    event.waitUntil(syncMessages());
  } else if (event.tag === 'file-sync') {
    event.waitUntil(syncFiles());
  }
});

// Sync offline messages
async function syncMessages() {
  try {
    const cache = await caches.open('aaelink-offline-queue');
    const requests = await cache.keys();

    for (const request of requests) {
      if (request.url.includes('/api/messages')) {
        try {
          await fetch(request);
          await cache.delete(request);
          console.log('Synced offline message');
        } catch (error) {
          console.log('Failed to sync message:', error);
        }
      }
    }
  } catch (error) {
    console.log('Message sync failed:', error);
  }
}

// Sync offline files
async function syncFiles() {
  try {
    const cache = await caches.open('aaelink-offline-queue');
    const requests = await cache.keys();

    for (const request of requests) {
      if (request.url.includes('/api/files')) {
        try {
          await fetch(request);
          await cache.delete(request);
          console.log('Synced offline file');
        } catch (error) {
          console.log('Failed to sync file:', error);
        }
      }
    }
  } catch (error) {
    console.log('File sync failed:', error);
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('Push notification received');

  const options = {
    body: event.data ? event.data.text() : 'New message in AAELink',
    icon: '/assets/logo-aae.svg',
    badge: '/assets/logo-aae.svg',
    tag: 'aaelink-message',
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: 'Open AAELink'
      },
      {
        action: 'close',
        title: 'Close'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('AAELink', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.action);

  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

console.log('Service Worker loaded');

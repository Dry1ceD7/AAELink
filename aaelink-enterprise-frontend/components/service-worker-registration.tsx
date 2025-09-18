/**
 * AAELink Enterprise Service Worker Registration
 * Handles service worker installation and updates
 * Version: 1.2.0
 */

'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      registerServiceWorker();
    }
  }, []);

  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });

      console.log('[SW] Service Worker registered successfully:', registration);

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content is available, show update notification
              if (confirm('New version available! Reload to update?')) {
                window.location.reload();
              }
            }
          });
        }
      });

      // Handle controller change (new service worker took control)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });

      // Register background sync
      if ('sync' in window.ServiceWorkerRegistration.prototype) {
        await registration.sync.register('offline-messages');
        await registration.sync.register('offline-files');
        await registration.sync.register('offline-events');
        console.log('[SW] Background sync registered');
      }

      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }

    } catch (error) {
      console.error('[SW] Service Worker registration failed:', error);
    }
  };

  return null; // This component doesn't render anything
}

export default ServiceWorkerRegistration;

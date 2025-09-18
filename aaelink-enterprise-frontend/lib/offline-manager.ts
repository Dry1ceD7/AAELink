/**
 * AAELink Enterprise Offline Manager
 * Handles offline state, sync status, and conflict resolution
 * Version: 1.2.0
 */

import { offlineStorage } from './offline-storage';

export interface OfflineStatus {
  isOnline: boolean;
  lastSync: Date | null;
  pendingSync: number;
  conflicts: number;
  storageUsed: number;
  storageTotal: number;
}

export interface SyncProgress {
  total: number;
  completed: number;
  failed: number;
  current: string | null;
}

class OfflineManager {
  private isOnline = typeof window !== 'undefined' ? navigator.onLine : true;
  private lastSync: Date | null = null;
  private syncProgress: SyncProgress = {
    total: 0,
    completed: 0,
    failed: 0,
    current: null
  };
  private listeners: Set<(status: OfflineStatus) => void> = new Set();
  private syncListeners: Set<(progress: SyncProgress) => void> = new Set();

  constructor() {
    this.setupEventListeners();
    this.loadLastSync();
  }

  private setupEventListeners(): void {
    if (typeof window === 'undefined') return;
    
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notifyListeners();
      this.startSync();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notifyListeners();
    });

    // Listen for visibility change to sync when tab becomes active
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isOnline) {
        this.startSync();
      }
    });
  }

  private async loadLastSync(): Promise<void> {
    if (typeof window === 'undefined') return;
    const lastSyncStr = localStorage.getItem('aaelink_last_sync');
    if (lastSyncStr) {
      this.lastSync = new Date(lastSyncStr);
    }
  }

  private async saveLastSync(): Promise<void> {
    if (typeof window === 'undefined') return;
    this.lastSync = new Date();
    localStorage.setItem('aaelink_last_sync', this.lastSync.toISOString());
  }

  // Public API
  getStatus(): OfflineStatus {
    return {
      isOnline: this.isOnline,
      lastSync: this.lastSync,
      pendingSync: 0, // Will be updated by sync process
      conflicts: 0, // Will be updated by conflict detection
      storageUsed: 0, // Will be updated by storage info
      storageTotal: 0 // Will be updated by storage info
    };
  }

  getSyncProgress(): SyncProgress {
    return { ...this.syncProgress };
  }

  // Event listeners
  addStatusListener(listener: (status: OfflineStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addSyncProgressListener(listener: (progress: SyncProgress) => void): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('Error in status listener:', error);
      }
    });
  }

  private notifySyncListeners(): void {
    this.syncListeners.forEach(listener => {
      try {
        listener(this.syncProgress);
      } catch (error) {
        console.error('Error in sync listener:', error);
      }
    });
  }

  // Sync operations
  async startSync(): Promise<void> {
    if (!this.isOnline) {
      console.log('[OfflineManager] Cannot sync - offline');
      return;
    }

    console.log('[OfflineManager] Starting sync...');

    try {
      // Get sync queue count
      const storageInfo = await offlineStorage.getStorageInfo();
      this.syncProgress = {
        total: storageInfo.total,
        completed: 0,
        failed: 0,
        current: 'Starting sync...'
      };
      this.notifySyncListeners();

      // Process sync queue
      await offlineStorage.processSyncQueue();

      // Update progress
      this.syncProgress.completed = this.syncProgress.total;
      this.syncProgress.current = 'Sync completed';
      this.notifySyncListeners();

      // Save last sync time
      await this.saveLastSync();

      console.log('[OfflineManager] Sync completed successfully');
    } catch (error) {
      console.error('[OfflineManager] Sync failed:', error);
      this.syncProgress.failed++;
      this.syncProgress.current = 'Sync failed';
      this.notifySyncListeners();
    }
  }

  async forceSync(): Promise<void> {
    console.log('[OfflineManager] Force sync requested');
    await this.startSync();
  }

  // Conflict resolution
  async detectConflicts(): Promise<any[]> {
    // This would typically check for conflicts between local and server data
    // For now, return empty array as conflicts are handled during sync
    return [];
  }

  async resolveConflict(conflictId: string, resolution: 'local' | 'server' | 'merge'): Promise<void> {
    await offlineStorage.resolveConflict(conflictId, resolution);
  }

  // Storage management
  async getStorageInfo(): Promise<{ used: number; total: number; byType: Record<string, number> }> {
    const info = await offlineStorage.getStorageInfo();

    // Estimate storage usage (rough calculation)
    const estimatedSize = info.total * 1024; // Assume 1KB per item average
    const totalStorage = 50 * 1024 * 1024; // 50MB limit

    return {
      used: estimatedSize,
      total: totalStorage,
      byType: info.byType
    };
  }

  async clearOfflineData(): Promise<void> {
    await offlineStorage.clearAllData();
    this.lastSync = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('aaelink_last_sync');
    }
    this.notifyListeners();
  }

  // Utility methods
  isDataStale(maxAgeMinutes: number = 5): boolean {
    if (!this.lastSync) return true;

    const now = new Date();
    const diffMinutes = (now.getTime() - this.lastSync.getTime()) / (1000 * 60);

    return diffMinutes > maxAgeMinutes;
  }

  async getOfflineCapabilities(): Promise<{
    canWorkOffline: boolean;
    features: string[];
    limitations: string[];
  }> {
    return {
      canWorkOffline: true,
      features: [
        'View cached messages',
        'Compose new messages',
        'Access uploaded files',
        'View calendar events',
        'Search local data',
        'User profile management'
      ],
      limitations: [
        'Real-time updates disabled',
        'File uploads queued for sync',
        'New user registration disabled',
        'Admin functions limited'
      ]
    };
  }

  // Background sync registration
  async registerBackgroundSync(): Promise<void> {
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const syncManager = (registration as any).sync;
        if (syncManager) {
          await syncManager.register('offline-messages');
          await syncManager.register('offline-files');
          await syncManager.register('offline-events');
          console.log('[OfflineManager] Background sync registered');
        }
      } catch (error) {
        console.error('[OfflineManager] Failed to register background sync:', error);
      }
    }
  }

  // Push notification setup
  async requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.log('[OfflineManager] Notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      console.log('[OfflineManager] Notifications denied');
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check online status
    if (!this.isOnline) {
      issues.push('Currently offline');
      recommendations.push('Connect to internet for full functionality');
    }

    // Check storage
    const storageInfo = await this.getStorageInfo();
    const usagePercent = (storageInfo.used / storageInfo.total) * 100;

    if (usagePercent > 90) {
      issues.push('Storage nearly full');
      recommendations.push('Clear offline data or increase storage limit');
    }

    // Check last sync
    if (this.isDataStale(30)) {
      issues.push('Data may be stale');
      recommendations.push('Sync with server when online');
    }

    // Check service worker
    if (!('serviceWorker' in navigator)) {
      issues.push('Service worker not supported');
      recommendations.push('Use a modern browser for offline features');
    }

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (issues.length === 0) {
      status = 'healthy';
    } else if (issues.length <= 2) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return { status, issues, recommendations };
  }
}

// Export singleton instance
export const offlineManager = new OfflineManager();
export default offlineManager;

/**
 * AAELink Enterprise Offline Storage
 * IndexedDB-based local storage with conflict resolution
 * Version: 1.2.0
 */

interface OfflineData {
  id: string;
  type: 'message' | 'file' | 'event' | 'user';
  data: any;
  timestamp: number;
  synced: boolean;
  conflict?: boolean;
  serverVersion?: any;
  localVersion?: any;
}

interface SyncQueue {
  id: string;
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

class OfflineStorage {
  private dbName = 'AAELinkOffline';
  private version = 1;
  private db: IDBDatabase | null = null;
  private syncQueue: SyncQueue[] = [];
  private isOnline = navigator.onLine;
  private syncInProgress = false;

  constructor() {
    this.init();
    this.setupEventListeners();
  }

  private async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores
        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('timestamp', 'timestamp');
          messageStore.createIndex('synced', 'synced');
          messageStore.createIndex('type', 'type');
        }

        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('timestamp', 'timestamp');
          fileStore.createIndex('synced', 'synced');
          fileStore.createIndex('channelId', 'channelId');
        }

        if (!db.objectStoreNames.contains('events')) {
          const eventStore = db.createObjectStore('events', { keyPath: 'id' });
          eventStore.createIndex('timestamp', 'timestamp');
          eventStore.createIndex('synced', 'synced');
          eventStore.createIndex('startDate', 'startDate');
        }

        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'id' });
          userStore.createIndex('timestamp', 'timestamp');
          userStore.createIndex('synced', 'synced');
        }

        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
          syncStore.createIndex('timestamp', 'timestamp');
          syncStore.createIndex('retries', 'retries');
        }

        if (!db.objectStoreNames.contains('conflicts')) {
          const conflictStore = db.createObjectStore('conflicts', { keyPath: 'id' });
          conflictStore.createIndex('timestamp', 'timestamp');
          conflictStore.createIndex('resolved', 'resolved');
        }
      };
    });
  }

  private setupEventListeners(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.processSyncQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  // Message operations
  async saveMessage(message: any): Promise<string> {
    const offlineData: OfflineData = {
      id: this.generateId(),
      type: 'message',
      data: message,
      timestamp: Date.now(),
      synced: false
    };

    await this.saveToStore('messages', offlineData);

    if (this.isOnline) {
      this.addToSyncQueue('create', 'message', message);
    }

    return offlineData.id;
  }

  async getMessages(channelId?: string): Promise<any[]> {
    const messages = await this.getAllFromStore('messages');

    if (channelId) {
      return messages
        .filter(msg => msg.data.channelId === channelId)
        .map(msg => msg.data)
        .sort((a, b) => a.timestamp - b.timestamp);
    }

    return messages.map(msg => msg.data).sort((a, b) => a.timestamp - b.timestamp);
  }

  async updateMessage(id: string, updates: any): Promise<void> {
    const message = await this.getFromStore('messages', id);
    if (message) {
      message.data = { ...message.data, ...updates };
      message.synced = false;
      message.timestamp = Date.now();

      await this.saveToStore('messages', message);

      if (this.isOnline) {
        this.addToSyncQueue('update', 'message', message.data);
      }
    }
  }

  async deleteMessage(id: string): Promise<void> {
    await this.deleteFromStore('messages', id);

    if (this.isOnline) {
      this.addToSyncQueue('delete', 'message', { id });
    }
  }

  // File operations
  async saveFile(file: any): Promise<string> {
    const offlineData: OfflineData = {
      id: this.generateId(),
      type: 'file',
      data: file,
      timestamp: Date.now(),
      synced: false
    };

    await this.saveToStore('files', offlineData);

    if (this.isOnline) {
      this.addToSyncQueue('create', 'file', file);
    }

    return offlineData.id;
  }

  async getFiles(channelId?: string): Promise<any[]> {
    const files = await this.getAllFromStore('files');

    if (channelId) {
      return files
        .filter(file => file.data.channelId === channelId)
        .map(file => file.data)
        .sort((a, b) => b.timestamp - a.timestamp);
    }

    return files.map(file => file.data).sort((a, b) => b.timestamp - a.timestamp);
  }

  // Event operations
  async saveEvent(event: any): Promise<string> {
    const offlineData: OfflineData = {
      id: this.generateId(),
      type: 'event',
      data: event,
      timestamp: Date.now(),
      synced: false
    };

    await this.saveToStore('events', offlineData);

    if (this.isOnline) {
      this.addToSyncQueue('create', 'event', event);
    }

    return offlineData.id;
  }

  async getEvents(startDate?: Date, endDate?: Date): Promise<any[]> {
    const events = await this.getAllFromStore('events');
    let filteredEvents = events.map(event => event.data);

    if (startDate) {
      filteredEvents = filteredEvents.filter(event =>
        new Date(event.startDate) >= startDate
      );
    }

    if (endDate) {
      filteredEvents = filteredEvents.filter(event =>
        new Date(event.startDate) <= endDate
      );
    }

    return filteredEvents.sort((a, b) =>
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
  }

  // User operations
  async saveUser(user: any): Promise<string> {
    const offlineData: OfflineData = {
      id: user.id || this.generateId(),
      type: 'user',
      data: user,
      timestamp: Date.now(),
      synced: false
    };

    await this.saveToStore('users', offlineData);

    if (this.isOnline) {
      this.addToSyncQueue('update', 'user', user);
    }

    return offlineData.id;
  }

  async getUser(id: string): Promise<any | null> {
    const user = await this.getFromStore('users', id);
    return user ? user.data : null;
  }

  // Conflict resolution
  async detectConflict(localData: any, serverData: any): Promise<boolean> {
    if (!localData || !serverData) return false;

    const localTimestamp = localData.timestamp || localData.updatedAt;
    const serverTimestamp = serverData.timestamp || serverData.updatedAt;

    return localTimestamp !== serverTimestamp;
  }

  async resolveConflict(conflictId: string, resolution: 'local' | 'server' | 'merge'): Promise<void> {
    const conflict = await this.getFromStore('conflicts', conflictId);
    if (!conflict) return;

    let resolvedData;

    switch (resolution) {
      case 'local':
        resolvedData = conflict.localVersion;
        break;
      case 'server':
        resolvedData = conflict.serverVersion;
        break;
      case 'merge':
        resolvedData = this.mergeData(conflict.localVersion, conflict.serverVersion);
        break;
    }

    // Update the original data
    await this.saveToStore(conflict.type, {
      id: conflict.id,
      type: conflict.type,
      data: resolvedData,
      timestamp: Date.now(),
      synced: true
    });

    // Remove from conflicts
    await this.deleteFromStore('conflicts', conflictId);
  }

  private mergeData(local: any, server: any): any {
    // Simple merge strategy - prefer non-null values
    const merged = { ...server };

    for (const key in local) {
      if (local[key] !== null && local[key] !== undefined) {
        if (typeof local[key] === 'object' && typeof server[key] === 'object') {
          merged[key] = this.mergeData(local[key], server[key]);
        } else {
          merged[key] = local[key];
        }
      }
    }

    return merged;
  }

  // Sync operations
  private async addToSyncQueue(action: 'create' | 'update' | 'delete', type: string, data: any): Promise<void> {
    const syncItem: SyncQueue = {
      id: this.generateId(),
      action,
      data,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: 3
    };

    await this.saveToStore('syncQueue', syncItem);
    this.syncQueue.push(syncItem);

    if (this.isOnline && !this.syncInProgress) {
      this.processSyncQueue();
    }
  }

  async processSyncQueue(): Promise<void> {
    if (this.syncInProgress || !this.isOnline) return;

    this.syncInProgress = true;

    try {
      const queue = await this.getAllFromStore('syncQueue');

      for (const item of queue) {
        try {
          await this.syncItem(item);
          await this.deleteFromStore('syncQueue', item.id);
        } catch (error) {
          console.error('Sync failed for item:', item.id, error);

          item.retries++;
          if (item.retries >= item.maxRetries) {
            await this.deleteFromStore('syncQueue', item.id);
          } else {
            await this.saveToStore('syncQueue', item);
          }
        }
      }
    } finally {
      this.syncInProgress = false;
    }
  }

  private async syncItem(item: SyncQueue): Promise<void> {
    const { action, data, type } = item;

    let url = '';
    let method = 'POST';

    switch (type) {
      case 'message':
        url = '/api/chat/messages';
        method = action === 'delete' ? 'DELETE' : 'POST';
        break;
      case 'file':
        url = '/api/files/upload';
        method = 'POST';
        break;
      case 'event':
        url = '/api/calendar/events';
        method = action === 'delete' ? 'DELETE' : 'POST';
        break;
      case 'user':
        url = '/api/users/profile';
        method = 'PUT';
        break;
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getAuthToken()}`
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`);
    }
  }

  private getAuthToken(): string {
    return localStorage.getItem('authToken') || '';
  }

  // Utility methods
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async saveToStore(storeName: string, data: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async getFromStore(storeName: string, id: string): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async getAllFromStore(storeName: string): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  private async deleteFromStore(storeName: string, id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Public API
  async clearAllData(): Promise<void> {
    if (!this.db) return;

    const storeNames = ['messages', 'files', 'events', 'users', 'syncQueue', 'conflicts'];

    for (const storeName of storeNames) {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      await store.clear();
    }
  }

  async getStorageInfo(): Promise<{ total: number; byType: Record<string, number> }> {
    const storeNames = ['messages', 'files', 'events', 'users'];
    const byType: Record<string, number> = {};
    let total = 0;

    for (const storeName of storeNames) {
      const count = await this.getStoreCount(storeName);
      byType[storeName] = count;
      total += count;
    }

    return { total, byType };
  }

  private async getStoreCount(storeName: string): Promise<number> {
    if (!this.db) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// Export singleton instance
export const offlineStorage = new OfflineStorage();
export default offlineStorage;

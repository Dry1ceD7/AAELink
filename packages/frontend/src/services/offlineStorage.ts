/**
 * AAELink Offline Storage Service
 * IndexedDB and local storage management
 * BMAD Method: Persistent offline data handling
 */

import * as Automerge from '@automerge/automerge';
import { DBSchema, IDBPDatabase, openDB } from 'idb';

// Database schema
interface AAELinkDB extends DBSchema {
  messages: {
    key: string;
    value: {
      id: string;
      conversationId: string;
      body: string;
      senderId: string;
      tempId?: string;
      createdAt: number;
      synced: boolean;
      metadata?: any;
    };
    indexes: {
      'by-conversation': string;
      'by-sync-status': boolean;
      'by-created': number;
    };
  };

  conversations: {
    key: string;
    value: {
      id: string;
      name: string;
      type: 'channel' | 'direct' | 'group';
      lastMessageAt: number;
      unreadCount: number;
      participants?: string[];
    };
    indexes: {
      'by-last-message': number;
    };
  };

  files: {
    key: string;
    value: {
      id: string;
      name: string;
      size: number;
      type: string;
      blob: Blob;
      uploadStatus: 'pending' | 'uploading' | 'completed' | 'failed';
      createdAt: number;
      metadata?: any;
    };
    indexes: {
      'by-status': string;
      'by-created': number;
    };
  };

  tasks: {
    key: string;
    value: {
      id: string;
      title: string;
      description?: string;
      status: 'pending' | 'in_progress' | 'completed';
      dueDate?: number;
      assigneeId?: string;
      crdtDoc?: Uint8Array; // Automerge document
      lastModified: number;
      synced: boolean;
    };
    indexes: {
      'by-status': string;
      'by-due-date': number;
      'by-sync': boolean;
    };
  };

  offlineQueue: {
    key: number;
    value: {
      id?: number;
      type: 'message' | 'file' | 'task' | 'reaction';
      action: 'create' | 'update' | 'delete';
      data: any;
      retries: number;
      createdAt: number;
    };
    indexes: {
      'by-type': string;
      'by-created': number;
    };
  };

  cache: {
    key: string;
    value: {
      key: string;
      data: any;
      timestamp: number;
      expiresAt?: number;
    };
    indexes: {
      'by-expiry': number;
    };
  };
}

class OfflineStorage {
  private db: IDBPDatabase<AAELinkDB> | null = null;
  private dbName = 'AAELinkOffline';
  private dbVersion = 1;

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    try {
      this.db = await openDB<AAELinkDB>(this.dbName, this.dbVersion, {
        upgrade(db, oldVersion, newVersion, transaction) {
          // Messages store
          if (!db.objectStoreNames.contains('messages')) {
            const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
            messageStore.createIndex('by-conversation', 'conversationId');
            messageStore.createIndex('by-sync-status', 'synced');
            messageStore.createIndex('by-created', 'createdAt');
          }

          // Conversations store
          if (!db.objectStoreNames.contains('conversations')) {
            const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
            convStore.createIndex('by-last-message', 'lastMessageAt');
          }

          // Files store
          if (!db.objectStoreNames.contains('files')) {
            const fileStore = db.createObjectStore('files', { keyPath: 'id' });
            fileStore.createIndex('by-status', 'uploadStatus');
            fileStore.createIndex('by-created', 'createdAt');
          }

          // Tasks store with CRDT support
          if (!db.objectStoreNames.contains('tasks')) {
            const taskStore = db.createObjectStore('tasks', { keyPath: 'id' });
            taskStore.createIndex('by-status', 'status');
            taskStore.createIndex('by-due-date', 'dueDate');
            taskStore.createIndex('by-sync', 'synced');
          }

          // Offline queue for sync
          if (!db.objectStoreNames.contains('offlineQueue')) {
            const queueStore = db.createObjectStore('offlineQueue', {
              keyPath: 'id',
              autoIncrement: true
            });
            queueStore.createIndex('by-type', 'type');
            queueStore.createIndex('by-created', 'createdAt');
          }

          // Cache store
          if (!db.objectStoreNames.contains('cache')) {
            const cacheStore = db.createObjectStore('cache', { keyPath: 'key' });
            cacheStore.createIndex('by-expiry', 'expiresAt');
          }
        },
      });

      console.log('IndexedDB initialized');

      // Clean expired cache entries
      await this.cleanExpiredCache();
    } catch (error) {
      console.error('Failed to initialize IndexedDB:', error);
      throw error;
    }
  }

  /**
   * Save message offline
   */
  async saveMessage(message: any): Promise<void> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('messages', 'readwrite');
    await tx.objectStore('messages').put({
      ...message,
      synced: false,
      createdAt: message.createdAt || Date.now(),
    });

    // Add to offline queue if it's a new message
    if (message.tempId) {
      await this.addToQueue('message', 'create', message);
    }
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string, limit = 50): Promise<any[]> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('by-conversation');
    const messages = await index.getAll(conversationId);

    return messages
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Save file for offline upload
   */
  async saveFile(file: File, metadata?: any): Promise<string> {
    if (!this.db) await this.initialize();

    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const tx = this.db!.transaction('files', 'readwrite');
    await tx.objectStore('files').put({
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type,
      blob: file,
      uploadStatus: 'pending',
      createdAt: Date.now(),
      metadata,
    });

    // Add to offline queue
    await this.addToQueue('file', 'create', { id: fileId });

    return fileId;
  }

  /**
   * Get pending file uploads
   */
  async getPendingFiles(): Promise<any[]> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('files', 'readonly');
    const index = tx.objectStore('files').index('by-status');
    return await index.getAll('pending');
  }

  /**
   * Save task with CRDT support
   */
  async saveTask(task: any): Promise<void> {
    if (!this.db) await this.initialize();

    // Create or update Automerge document
    let doc: any;
    if (task.crdtDoc) {
      doc = Automerge.load(task.crdtDoc);
    } else {
      doc = Automerge.from(task);
    }

    // Apply changes
    doc = Automerge.change(doc, 'Update task', (d: any) => {
      Object.assign(d, task);
    });

    const tx = this.db!.transaction('tasks', 'readwrite');
    await tx.objectStore('tasks').put({
      ...task,
      crdtDoc: Automerge.save(doc),
      lastModified: Date.now(),
      synced: false,
    });

    // Add to sync queue
    await this.addToQueue('task', 'update', { id: task.id });
  }

  /**
   * Merge task CRDT documents
   */
  async mergeTask(taskId: string, remoteCrdtDoc: Uint8Array): Promise<any> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('tasks', 'readonly');
    const localTask = await tx.objectStore('tasks').get(taskId);

    if (!localTask || !localTask.crdtDoc) {
      // No local version, use remote
      const remoteDoc = Automerge.load(remoteCrdtDoc);
      return Automerge.toJS(remoteDoc);
    }

    // Merge local and remote
    const localDoc = Automerge.load(localTask.crdtDoc);
    const remoteDoc = Automerge.load(remoteCrdtDoc);
    const mergedDoc = Automerge.merge(localDoc, remoteDoc);

    // Save merged version
    const writeTx = this.db!.transaction('tasks', 'readwrite');
    await writeTx.objectStore('tasks').put({
      ...localTask,
      ...Automerge.toJS(mergedDoc),
      crdtDoc: Automerge.save(mergedDoc),
      lastModified: Date.now(),
      synced: true,
    });

    return Automerge.toJS(mergedDoc);
  }

  /**
   * Add action to offline queue
   */
  async addToQueue(type: string, action: string, data: any): Promise<void> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('offlineQueue', 'readwrite');
    await tx.objectStore('offlineQueue').add({
      type,
      action,
      data,
      retries: 0,
      createdAt: Date.now(),
    });

    // Request background sync if available
    if ('serviceWorker' in navigator && 'sync' in self.registration) {
      await (self.registration as any).sync.register(`sync-${type}s`);
    }
  }

  /**
   * Get queued actions
   */
  async getQueuedActions(type?: string): Promise<any[]> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('offlineQueue', 'readonly');

    if (type) {
      const index = tx.objectStore('offlineQueue').index('by-type');
      return await index.getAll(type);
    }

    return await tx.objectStore('offlineQueue').getAll();
  }

  /**
   * Remove from queue
   */
  async removeFromQueue(id: number): Promise<void> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('offlineQueue', 'readwrite');
    await tx.objectStore('offlineQueue').delete(id);
  }

  /**
   * Cache data with optional expiry
   */
  async cacheData(key: string, data: any, ttlSeconds?: number): Promise<void> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('cache', 'readwrite');
    await tx.objectStore('cache').put({
      key,
      data,
      timestamp: Date.now(),
      expiresAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : undefined,
    });
  }

  /**
   * Get cached data
   */
  async getCachedData(key: string): Promise<any | null> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('cache', 'readonly');
    const cached = await tx.objectStore('cache').get(key);

    if (!cached) return null;

    // Check expiry
    if (cached.expiresAt && cached.expiresAt < Date.now()) {
      await this.removeCachedData(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Remove cached data
   */
  async removeCachedData(key: string): Promise<void> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('cache', 'readwrite');
    await tx.objectStore('cache').delete(key);
  }

  /**
   * Clean expired cache entries
   */
  async cleanExpiredCache(): Promise<void> {
    if (!this.db) await this.initialize();

    const tx = this.db!.transaction('cache', 'readwrite');
    const index = tx.objectStore('cache').index('by-expiry');
    const expiredKeys = await index.getAllKeys(IDBKeyRange.upperBound(Date.now()));

    for (const key of expiredKeys) {
      await tx.objectStore('cache').delete(key);
    }
  }

  /**
   * Clear all offline data
   */
  async clearAll(): Promise<void> {
    if (!this.db) await this.initialize();

    const stores = ['messages', 'conversations', 'files', 'tasks', 'offlineQueue', 'cache'];

    for (const store of stores) {
      const tx = this.db!.transaction(store as any, 'readwrite');
      await tx.objectStore(store as any).clear();
    }
  }

  /**
   * Get storage usage
   */
  async getStorageInfo(): Promise<{ usage: number; quota: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }

    return { usage: 0, quota: 0 };
  }
}

// Export singleton instance
export const offlineStorage = new OfflineStorage();

// Export for use in service worker
export default OfflineStorage;

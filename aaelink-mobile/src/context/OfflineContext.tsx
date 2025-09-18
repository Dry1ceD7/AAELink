/**
 * Offline Context for AAELink Mobile
 * Version: 1.2.0
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import React, { ReactNode, createContext, useContext, useEffect, useState } from 'react';

interface OfflineData {
  id: string;
  type: 'message' | 'file' | 'event' | 'user';
  data: any;
  timestamp: number;
  synced: boolean;
}

interface OfflineContextType {
  isOnline: boolean;
  isConnected: boolean;
  lastSync: Date | null;
  pendingSync: number;
  syncInProgress: boolean;
  syncData: (type: string, data: any) => Promise<void>;
  getOfflineData: (type: string) => Promise<any[]>;
  clearOfflineData: () => Promise<void>;
  forceSync: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextType | undefined>(undefined);

interface OfflineProviderProps {
  children: ReactNode;
}

export function OfflineProvider({ children }: OfflineProviderProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [isConnected, setIsConnected] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [syncInProgress, setSyncInProgress] = useState(false);

  useEffect(() => {
    // Set up network listener
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
      setIsConnected(state.isConnected ?? false);

      if (state.isConnected && !syncInProgress) {
        forceSync();
      }
    });

    // Load last sync time
    loadLastSync();

    return unsubscribe;
  }, []);

  const loadLastSync = async () => {
    try {
      const stored = await AsyncStorage.getItem('lastSync');
      if (stored) {
        setLastSync(new Date(stored));
      }
    } catch (error) {
      console.error('Failed to load last sync:', error);
    }
  };

  const saveLastSync = async () => {
    try {
      const now = new Date();
      setLastSync(now);
      await AsyncStorage.setItem('lastSync', now.toISOString());
    } catch (error) {
      console.error('Failed to save last sync:', error);
    }
  };

  const syncData = async (type: string, data: any): Promise<void> => {
    try {
      const offlineData: OfflineData = {
        id: Date.now().toString(),
        type: type as any,
        data,
        timestamp: Date.now(),
        synced: false,
      };

      const key = `offline_${type}`;
      const existing = await AsyncStorage.getItem(key);
      const items = existing ? JSON.parse(existing) : [];
      items.push(offlineData);

      await AsyncStorage.setItem(key, JSON.stringify(items));
      setPendingSync(prev => prev + 1);

      if (isOnline) {
        await processSyncQueue();
      }
    } catch (error) {
      console.error('Failed to sync data:', error);
    }
  };

  const getOfflineData = async (type: string): Promise<any[]> => {
    try {
      const key = `offline_${type}`;
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        const items: OfflineData[] = JSON.parse(stored);
        return items.map(item => item.data);
      }
      return [];
    } catch (error) {
      console.error('Failed to get offline data:', error);
      return [];
    }
  };

  const processSyncQueue = async () => {
    if (syncInProgress || !isOnline) return;

    setSyncInProgress(true);

    try {
      const types = ['message', 'file', 'event', 'user'];
      let syncedCount = 0;

      for (const type of types) {
        const key = `offline_${type}`;
        const stored = await AsyncStorage.getItem(key);

        if (stored) {
          const items: OfflineData[] = JSON.parse(stored);
          const unsynced = items.filter(item => !item.synced);

          for (const item of unsynced) {
            try {
              // Mock API call - replace with real implementation
              await new Promise(resolve => setTimeout(resolve, 100));

              item.synced = true;
              syncedCount++;
            } catch (error) {
              console.error(`Failed to sync ${type}:`, error);
            }
          }

          await AsyncStorage.setItem(key, JSON.stringify(items));
        }
      }

      setPendingSync(0);
      await saveLastSync();

    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncInProgress(false);
    }
  };

  const clearOfflineData = async (): Promise<void> => {
    try {
      const types = ['message', 'file', 'event', 'user'];
      for (const type of types) {
        await AsyncStorage.removeItem(`offline_${type}`);
      }
      setPendingSync(0);
    } catch (error) {
      console.error('Failed to clear offline data:', error);
    }
  };

  const forceSync = async (): Promise<void> => {
    await processSyncQueue();
  };

  const value: OfflineContextType = {
    isOnline,
    isConnected,
    lastSync,
    pendingSync,
    syncInProgress,
    syncData,
    getOfflineData,
    clearOfflineData,
    forceSync,
  };

  return (
    <OfflineContext.Provider value={value}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextType {
  const context = useContext(OfflineContext);
  if (context === undefined) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return context;
}

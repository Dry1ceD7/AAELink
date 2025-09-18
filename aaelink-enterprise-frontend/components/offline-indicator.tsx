/**
 * AAELink Enterprise Offline Indicator
 * Shows offline status and sync progress
 * Version: 1.2.0
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { OfflineStatus, SyncProgress, offlineManager } from '@/lib/offline-manager';
import {
    AlertCircle,
    CheckCircle,
    Clock,
    Database,
    RefreshCw,
    Settings,
    Wifi,
    WifiOff,
    XCircle
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface OfflineIndicatorProps {
  className?: string;
  showDetails?: boolean;
}

export function OfflineIndicator({ className = '', showDetails = false }: OfflineIndicatorProps) {
  const [status, setStatus] = useState<OfflineStatus>(offlineManager.getStatus());
  const [syncProgress, setSyncProgress] = useState<SyncProgress>(offlineManager.getSyncProgress());
  const [isExpanded, setIsExpanded] = useState(false);
  const [healthStatus, setHealthStatus] = useState<any>(null);

  useEffect(() => {
    const unsubscribeStatus = offlineManager.addStatusListener(setStatus);
    const unsubscribeSync = offlineManager.addSyncProgressListener(setSyncProgress);

    // Load health status
    loadHealthStatus();

    return () => {
      unsubscribeStatus();
      unsubscribeSync();
    };
  }, []);

  const loadHealthStatus = async () => {
    try {
      const health = await offlineManager.healthCheck();
      setHealthStatus(health);
    } catch (error) {
      console.error('Failed to load health status:', error);
    }
  };

  const handleForceSync = async () => {
    try {
      await offlineManager.forceSync();
      await loadHealthStatus();
    } catch (error) {
      console.error('Force sync failed:', error);
    }
  };

  const handleClearData = async () => {
    if (confirm('Are you sure you want to clear all offline data? This cannot be undone.')) {
      try {
        await offlineManager.clearOfflineData();
        await loadHealthStatus();
      } catch (error) {
        console.error('Clear data failed:', error);
      }
    }
  };

  const getStatusIcon = () => {
    if (status.isOnline) {
      return <Wifi className="w-4 h-4 text-green-500" />;
    }
    return <WifiOff className="w-4 h-4 text-red-500" />;
  };

  const getStatusText = () => {
    if (status.isOnline) {
      return 'Online';
    }
    return 'Offline';
  };

  const getStatusColor = () => {
    if (status.isOnline) {
      return 'bg-green-500';
    }
    return 'bg-red-500';
  };

  const getSyncIcon = () => {
    if (syncProgress.current === 'Sync completed') {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    if (syncProgress.failed > 0) {
      return <XCircle className="w-4 h-4 text-red-500" />;
    }
    if (syncProgress.current) {
      return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
    }
    return <Clock className="w-4 h-4 text-gray-500" />;
  };

  const getSyncProgress = () => {
    if (syncProgress.total === 0) return 0;
    return (syncProgress.completed / syncProgress.total) * 100;
  };

  const formatLastSync = () => {
    if (!status.lastSync) return 'Never';

    const now = new Date();
    const diff = now.getTime() - status.lastSync.getTime();
    const minutes = Math.floor(diff / (1000 * 60));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatStorageSize = (bytes: number) => {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!showDetails && status.isOnline) {
    return null; // Hide when online and not showing details
  }

  return (
    <div className={`fixed top-4 right-4 z-50 ${className}`}>
      <Card className="w-80 shadow-lg border-l-4 border-l-blue-500">
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              {getStatusIcon()}
              <span className="font-medium text-sm">
                {getStatusText()}
              </span>
              <Badge
                variant={status.isOnline ? "default" : "destructive"}
                className="text-xs"
              >
                {status.isOnline ? 'Connected' : 'Offline'}
              </Badge>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-6 w-6 p-0"
            >
              <Settings className="w-3 h-3" />
            </Button>
          </div>

          {/* Sync Progress */}
          {syncProgress.current && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  {getSyncIcon()}
                  <span className="text-xs text-gray-600">
                    {syncProgress.current}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {syncProgress.completed}/{syncProgress.total}
                </span>
              </div>

              {syncProgress.total > 0 && (
                <Progress
                  value={getSyncProgress()}
                  className="h-2"
                />
              )}
            </div>
          )}

          {/* Last Sync */}
          <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
            <span>Last sync: {formatLastSync()}</span>
            {status.isOnline && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleForceSync}
                className="h-6 px-2 text-xs"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Sync
              </Button>
            )}
          </div>

          {/* Expanded Details */}
          {isExpanded && (
            <div className="space-y-3 pt-3 border-t">
              {/* Storage Info */}
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Database className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium">Storage</span>
                </div>

                <div className="text-xs text-gray-600 space-y-1">
                  <div className="flex justify-between">
                    <span>Used:</span>
                    <span>{formatStorageSize(status.storageUsed)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total:</span>
                    <span>{formatStorageSize(status.storageTotal)}</span>
                  </div>

                  <Progress
                    value={(status.storageUsed / status.storageTotal) * 100}
                    className="h-1"
                  />
                </div>
              </div>

              {/* Health Status */}
              {healthStatus && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 text-orange-500" />
                    <span className="text-sm font-medium">Health</span>
                    <Badge
                      variant={
                        healthStatus.status === 'healthy' ? 'default' :
                        healthStatus.status === 'degraded' ? 'secondary' : 'destructive'
                      }
                      className="text-xs"
                    >
                      {healthStatus.status}
                    </Badge>
                  </div>

                  {healthStatus.issues.length > 0 && (
                    <div className="text-xs text-gray-600">
                      <div className="font-medium mb-1">Issues:</div>
                      <ul className="list-disc list-inside space-y-1">
                        {healthStatus.issues.map((issue: string, index: number) => (
                          <li key={index}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearData}
                  className="flex-1 text-xs"
                >
                  Clear Data
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadHealthStatus}
                  className="flex-1 text-xs"
                >
                  Refresh
                </Button>
              </div>
            </div>
          )}

          {/* Offline Notice */}
          {!status.isOnline && (
            <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
              <div className="flex items-center space-x-1">
                <AlertCircle className="w-3 h-3" />
                <span className="font-medium">Working Offline</span>
              </div>
              <p className="mt-1">
                Some features may be limited. Changes will sync when you're back online.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default OfflineIndicator;

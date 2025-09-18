/**
 * System Monitoring Component for Admin Dashboard
 * Version: 1.2.0
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    CheckCircle,
    Clock,
    Cpu,
    Database,
    Download,
    HardDrive,
    MemoryStick,
    RefreshCw,
    Server,
    Wifi,
    WifiOff
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    temperature: number;
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  disk: {
    used: number;
    total: number;
    percentage: number;
  };
  network: {
    status: 'online' | 'offline';
    latency: number;
    bandwidth: {
      upload: number;
      download: number;
    };
  };
  database: {
    status: 'healthy' | 'warning' | 'critical';
    connections: number;
    maxConnections: number;
    queryTime: number;
  };
  services: {
    name: string;
    status: 'running' | 'stopped' | 'error';
    uptime: number;
    lastCheck: Date;
  }[];
}

interface SystemLog {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  source: string;
  userId?: string;
}

interface SystemMonitoringProps {
  metrics: SystemMetrics;
  logs: SystemLog[];
  onRefresh: () => void;
  onExportLogs: () => void;
}

export function SystemMonitoring({ metrics, logs, onRefresh, onExportLogs }: SystemMonitoringProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedLogLevel, setSelectedLogLevel] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        onRefresh();
      }, 30000); // Refresh every 30 seconds

      return () => clearInterval(interval);
    }
    return undefined;
  }, [autoRefresh, onRefresh]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefresh();
    setIsRefreshing(false);
  };

  const handleExportLogs = () => {
    onExportLogs();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'running':
      case 'online':
        return 'text-green-500';
      case 'warning':
        return 'text-yellow-500';
      case 'critical':
      case 'error':
      case 'offline':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'running':
      case 'online':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'critical':
      case 'error':
      case 'offline':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getLogLevelColor = (level: SystemLog['level']) => {
    switch (level) {
      case 'error':
        return 'text-red-500 bg-red-50 dark:bg-red-900/20';
      case 'warning':
        return 'text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20';
      case 'info':
        return 'text-blue-500 bg-blue-50 dark:bg-blue-900/20';
      case 'debug':
        return 'text-gray-500 bg-gray-50 dark:bg-gray-900/20';
      default:
        return 'text-gray-500 bg-gray-50 dark:bg-gray-900/20';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const filteredLogs = logs.filter(log =>
    selectedLogLevel === 'all' || log.level === selectedLogLevel
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">System Monitoring</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Real-time system metrics and health monitoring
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-green-50 text-green-700' : ''}
          >
            <Activity className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-pulse' : ''}`} />
            Auto Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportLogs}>
            <Download className="w-4 h-4 mr-2" />
            Export Logs
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.cpu.usage.toFixed(1)}%</div>
            <div className="flex items-center space-x-2 mt-2">
              <Progress value={metrics.cpu.usage} className="flex-1" />
              <span className="text-xs text-muted-foreground">
                {metrics.cpu.temperature}°C
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics.cpu.cores} cores
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Memory</CardTitle>
            <MemoryStick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.memory.percentage.toFixed(1)}%</div>
            <div className="flex items-center space-x-2 mt-2">
              <Progress value={metrics.memory.percentage} className="flex-1" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatBytes(metrics.memory.used)} / {formatBytes(metrics.memory.total)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disk Space</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.disk.percentage.toFixed(1)}%</div>
            <div className="flex items-center space-x-2 mt-2">
              <Progress value={metrics.disk.percentage} className="flex-1" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatBytes(metrics.disk.used)} / {formatBytes(metrics.disk.total)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Network</CardTitle>
            {metrics.network.status === 'online' ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.network.latency}ms</div>
            <div className="flex items-center space-x-2 mt-2">
              <Badge className={getStatusColor(metrics.network.status)}>
                {metrics.network.status.toUpperCase()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ↑ {formatBytes(metrics.network.bandwidth.upload)}/s ↓ {formatBytes(metrics.network.bandwidth.download)}/s
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Database Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="w-5 h-5" />
            <span>Database Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status</span>
              <div className="flex items-center space-x-2">
                {getStatusIcon(metrics.database.status)}
                <span className={getStatusColor(metrics.database.status)}>
                  {metrics.database.status.toUpperCase()}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Connections</span>
              <span className="text-sm text-muted-foreground">
                {metrics.database.connections} / {metrics.database.maxConnections}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Query Time</span>
              <span className="text-sm text-muted-foreground">
                {metrics.database.queryTime}ms
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Services Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Server className="w-5 h-5" />
            <span>Services Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {metrics.services.map((service, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(service.status)}
                  <div>
                    <div className="font-medium text-sm">{service.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Uptime: {formatUptime(service.uptime)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge className={getStatusColor(service.status)}>
                    {service.status.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {service.lastCheck.toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Logs */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center space-x-2">
              <BarChart3 className="w-5 h-5" />
              <span>System Logs</span>
            </CardTitle>
            <div className="flex items-center space-x-2">
              <select
                value={selectedLogLevel}
                onChange={(e) => setSelectedLogLevel(e.target.value)}
                className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800"
              >
                <option value="all">All Levels</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className={`p-3 rounded-lg border-l-4 ${getLogLevelColor(log.level)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-xs font-medium uppercase">
                        {log.level}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {log.source}
                      </span>
                      {log.userId && (
                        <span className="text-xs text-muted-foreground">
                          User: {log.userId}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900 dark:text-white">
                      {log.message}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground ml-4">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

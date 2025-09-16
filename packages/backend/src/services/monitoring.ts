/**
 * Performance Monitoring Service
 * Handles metrics collection, performance monitoring, and alerting
 */

interface PerformanceMetrics {
  timestamp: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  memoryUsage: number;
  cpuUsage: number;
  activeConnections: number;
  errorRate: number;
}

interface SystemMetrics {
  timestamp: string;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  disk: {
    used: number;
    total: number;
    percentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    connections: number;
  };
}

interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  cooldown: number; // minutes
}

interface Alert {
  id: string;
  ruleId: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
}

class MonitoringService {
  private metrics: PerformanceMetrics[] = [];
  private systemMetrics: SystemMetrics[] = [];
  private alerts: Alert[] = [];
  private alertRules: AlertRule[] = [];
  private lastAlertTimes: Map<string, number> = new Map();
  private isMonitoring = false;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeAlertRules();
  }

  private initializeAlertRules() {
    this.alertRules = [
      {
        id: 'high_response_time',
        name: 'High Response Time',
        condition: 'responseTime',
        threshold: 2000, // 2 seconds
        severity: 'high',
        enabled: true,
        cooldown: 5
      },
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        condition: 'errorRate',
        threshold: 0.05, // 5%
        severity: 'critical',
        enabled: true,
        cooldown: 2
      },
      {
        id: 'high_memory_usage',
        name: 'High Memory Usage',
        condition: 'memoryUsage',
        threshold: 0.9, // 90%
        severity: 'high',
        enabled: true,
        cooldown: 10
      },
      {
        id: 'high_cpu_usage',
        name: 'High CPU Usage',
        condition: 'cpuUsage',
        threshold: 0.8, // 80%
        severity: 'medium',
        enabled: true,
        cooldown: 5
      }
    ];
  }

  public startMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    console.log('Starting performance monitoring...');

    // Collect system metrics every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.checkAlerts();
    }, 30000);

    // Initial collection
    this.collectSystemMetrics();
  }

  public stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    console.log('Performance monitoring stopped');
  }

  public recordRequestMetrics(
    endpoint: string,
    method: string,
    statusCode: number,
    responseTime: number,
    activeConnections: number
  ) {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const metric: PerformanceMetrics = {
      timestamp: new Date().toISOString(),
      endpoint,
      method,
      statusCode,
      responseTime,
      memoryUsage: memoryUsage.heapUsed / memoryUsage.heapTotal,
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
      activeConnections,
      errorRate: this.calculateErrorRate()
    };

    this.metrics.push(metric);

    // Keep only last 1000 metrics
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }

    // Check for immediate alerts
    this.checkRequestAlerts(metric);
  }

  private collectSystemMetrics() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const systemMetric: SystemMetrics = {
      timestamp: new Date().toISOString(),
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        percentage: memoryUsage.heapUsed / memoryUsage.heapTotal
      },
      cpu: {
        usage: (cpuUsage.user + cpuUsage.system) / 1000000,
        loadAverage: process.platform === 'linux' ? require('os').loadavg() : [0, 0, 0]
      },
      disk: {
        used: 0, // Would need additional library to get disk usage
        total: 0,
        percentage: 0
      },
      network: {
        bytesIn: 0, // Would need additional monitoring
        bytesOut: 0,
        connections: 0
      }
    };

    this.systemMetrics.push(systemMetric);

    // Keep only last 100 system metrics
    if (this.systemMetrics.length > 100) {
      this.systemMetrics = this.systemMetrics.slice(-100);
    }
  }

  private calculateErrorRate(): number {
    const recentMetrics = this.metrics.slice(-100); // Last 100 requests
    if (recentMetrics.length === 0) return 0;

    const errorCount = recentMetrics.filter(m => m.statusCode >= 400).length;
    return errorCount / recentMetrics.length;
  }

  private checkRequestAlerts(metric: PerformanceMetrics) {
    // Check response time
    if (metric.responseTime > 2000) {
      this.createAlert('high_response_time', `High response time: ${metric.responseTime}ms for ${metric.endpoint}`);
    }

    // Check error rate
    if (metric.errorRate > 0.05) {
      this.createAlert('high_error_rate', `High error rate: ${(metric.errorRate * 100).toFixed(2)}%`);
    }

    // Check memory usage
    if (metric.memoryUsage > 0.9) {
      this.createAlert('high_memory_usage', `High memory usage: ${(metric.memoryUsage * 100).toFixed(2)}%`);
    }
  }

  private checkAlerts() {
    const latestSystemMetric = this.systemMetrics[this.systemMetrics.length - 1];
    if (!latestSystemMetric) return;

    // Check CPU usage
    if (latestSystemMetric.cpu.usage > 0.8) {
      this.createAlert('high_cpu_usage', `High CPU usage: ${(latestSystemMetric.cpu.usage * 100).toFixed(2)}%`);
    }
  }

  private createAlert(ruleId: string, message: string) {
    const rule = this.alertRules.find(r => r.id === ruleId);
    if (!rule || !rule.enabled) return;

    const now = Date.now();
    const lastAlertTime = this.lastAlertTimes.get(ruleId) || 0;
    const cooldownMs = rule.cooldown * 60 * 1000;

    if (now - lastAlertTime < cooldownMs) return;

    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ruleId,
      message,
      severity: rule.severity,
      timestamp: new Date().toISOString(),
      resolved: false
    };

    this.alerts.push(alert);
    this.lastAlertTimes.set(ruleId, now);

    console.log(`[ALERT] ${rule.severity.toUpperCase()}: ${message}`);
  }

  public getPerformanceMetrics(limit: number = 100): PerformanceMetrics[] {
    return this.metrics.slice(-limit);
  }

  public getSystemMetrics(limit: number = 50): SystemMetrics[] {
    return this.systemMetrics.slice(-limit);
  }

  public getAlerts(filter?: {
    severity?: string;
    resolved?: boolean;
    limit?: number;
  }): Alert[] {
    let alerts = [...this.alerts];

    if (filter) {
      if (filter.severity) {
        alerts = alerts.filter(alert => alert.severity === filter.severity);
      }
      if (filter.resolved !== undefined) {
        alerts = alerts.filter(alert => alert.resolved === filter.resolved);
      }
    }

    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter?.limit) {
      alerts = alerts.slice(0, filter.limit);
    }

    return alerts;
  }

  public resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert || alert.resolved) return false;

    alert.resolved = true;
    alert.resolvedAt = new Date().toISOString();
    return true;
  }

  public getDashboardStats(): {
    totalRequests: number;
    averageResponseTime: number;
    errorRate: number;
    activeAlerts: number;
    systemHealth: 'healthy' | 'warning' | 'critical';
    uptime: number;
  } {
    const recentMetrics = this.metrics.slice(-100);
    const activeAlerts = this.alerts.filter(a => !a.resolved).length;
    
    const totalRequests = recentMetrics.length;
    const averageResponseTime = totalRequests > 0 
      ? recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests 
      : 0;
    const errorRate = this.calculateErrorRate();

    let systemHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (activeAlerts > 0) {
      const criticalAlerts = this.alerts.filter(a => !a.resolved && a.severity === 'critical').length;
      systemHealth = criticalAlerts > 0 ? 'critical' : 'warning';
    }

    return {
      totalRequests,
      averageResponseTime: Math.round(averageResponseTime),
      errorRate: Math.round(errorRate * 100) / 100,
      activeAlerts,
      systemHealth,
      uptime: process.uptime()
    };
  }

  public getPerformanceReport(): {
    topSlowEndpoints: Array<{ endpoint: string; averageTime: number; count: number }>;
    errorEndpoints: Array<{ endpoint: string; errorCount: number; errorRate: number }>;
    hourlyStats: Array<{ hour: string; requests: number; errors: number; avgResponseTime: number }>;
  } {
    const recentMetrics = this.metrics.slice(-500); // Last 500 requests

    // Top slow endpoints
    const endpointStats = new Map<string, { totalTime: number; count: number; errors: number }>();
    
    recentMetrics.forEach(metric => {
      const key = `${metric.method} ${metric.endpoint}`;
      const existing = endpointStats.get(key) || { totalTime: 0, count: 0, errors: 0 };
      existing.totalTime += metric.responseTime;
      existing.count += 1;
      if (metric.statusCode >= 400) existing.errors += 1;
      endpointStats.set(key, existing);
    });

    const topSlowEndpoints = Array.from(endpointStats.entries())
      .map(([endpoint, stats]) => ({
        endpoint,
        averageTime: Math.round(stats.totalTime / stats.count),
        count: stats.count
      }))
      .sort((a, b) => b.averageTime - a.averageTime)
      .slice(0, 10);

    const errorEndpoints = Array.from(endpointStats.entries())
      .filter(([_, stats]) => stats.errors > 0)
      .map(([endpoint, stats]) => ({
        endpoint,
        errorCount: stats.errors,
        errorRate: Math.round((stats.errors / stats.count) * 100) / 100
      }))
      .sort((a, b) => b.errorCount - a.errorCount)
      .slice(0, 10);

    // Hourly stats (simplified)
    const hourlyStats = this.getHourlyStats(recentMetrics);

    return {
      topSlowEndpoints,
      errorEndpoints,
      hourlyStats
    };
  }

  private getHourlyStats(metrics: PerformanceMetrics[]): Array<{ hour: string; requests: number; errors: number; avgResponseTime: number }> {
    const hourlyData = new Map<string, { requests: number; errors: number; totalTime: number }>();

    metrics.forEach(metric => {
      const hour = new Date(metric.timestamp).toISOString().substring(0, 13) + ':00:00Z';
      const existing = hourlyData.get(hour) || { requests: 0, errors: 0, totalTime: 0 };
      existing.requests += 1;
      if (metric.statusCode >= 400) existing.errors += 1;
      existing.totalTime += metric.responseTime;
      hourlyData.set(hour, existing);
    });

    return Array.from(hourlyData.entries())
      .map(([hour, data]) => ({
        hour,
        requests: data.requests,
        errors: data.errors,
        avgResponseTime: Math.round(data.totalTime / data.requests)
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour));
  }
}

// Create singleton instance
export const monitoringService = new MonitoringService();
export { MonitoringService };
export type { PerformanceMetrics, SystemMetrics, AlertRule, Alert };

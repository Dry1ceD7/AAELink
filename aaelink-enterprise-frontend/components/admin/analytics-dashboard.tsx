/**
 * Analytics Dashboard Component for Admin
 * Version: 1.2.0
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  Users, 
  MessageSquare, 
  FileText, 
  Calendar,
  Activity,
  Download,
  RefreshCw,
  Filter,
  Eye,
  EyeOff
} from 'lucide-react';

interface AnalyticsData {
  period: '7d' | '30d' | '90d' | '1y';
  userGrowth: {
    total: number;
    new: number;
    active: number;
    retention: number;
  };
  engagement: {
    messages: number;
    files: number;
    events: number;
    avgSessionTime: number;
  };
  activity: {
    date: string;
    users: number;
    messages: number;
    files: number;
    events: number;
  }[];
  topUsers: {
    id: string;
    name: string;
    email: string;
    activity: number;
    messages: number;
    files: number;
  }[];
  systemMetrics: {
    uptime: number;
    responseTime: number;
    errorRate: number;
    throughput: number;
  };
}

interface AnalyticsDashboardProps {
  data: AnalyticsData;
  onPeriodChange: (period: AnalyticsData['period']) => void;
  onRefresh: () => void;
  onExport: () => void;
}

export function AnalyticsDashboard({ data, onPeriodChange, onRefresh, onExport }: AnalyticsDashboardProps) {
  const [selectedMetric, setSelectedMetric] = useState<string>('users');
  const [showDetails, setShowDetails] = useState(false);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatPercentage = (num: number) => {
    return `${num.toFixed(1)}%`;
  };

  const getTrendIcon = (value: number, isPositive: boolean) => {
    if (isPositive) {
      return value > 0 ? (
        <TrendingUp className="w-4 h-4 text-green-500" />
      ) : (
        <TrendingDown className="w-4 h-4 text-red-500" />
      );
    }
    return value > 0 ? (
      <TrendingDown className="w-4 h-4 text-red-500" />
    ) : (
      <TrendingUp className="w-4 h-4 text-green-500" />
    );
  };

  const getTrendColor = (value: number, isPositive: boolean) => {
    if (isPositive) {
      return value > 0 ? 'text-green-500' : 'text-red-500';
    }
    return value > 0 ? 'text-red-500' : 'text-green-500';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Dashboard</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Comprehensive insights and performance metrics
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={() => setShowDetails(!showDetails)}>
            {showDetails ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
            {showDetails ? 'Hide Details' : 'Show Details'}
          </Button>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <Select value={data.period} onValueChange={onPeriodChange}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center space-x-2">
          <Select value={selectedMetric} onValueChange={setSelectedMetric}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Select metric" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="users">Users</SelectItem>
              <SelectItem value="messages">Messages</SelectItem>
              <SelectItem value="files">Files</SelectItem>
              <SelectItem value="events">Events</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(data.userGrowth.total)}</div>
            <div className="flex items-center space-x-2 mt-2">
              {getTrendIcon(data.userGrowth.new, true)}
              <span className={`text-sm ${getTrendColor(data.userGrowth.new, true)}`}>
                +{formatNumber(data.userGrowth.new)} new
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatPercentage(data.userGrowth.retention)} retention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(data.userGrowth.active)}</div>
            <div className="flex items-center space-x-2 mt-2">
              {getTrendIcon(data.userGrowth.active, true)}
              <span className={`text-sm ${getTrendColor(data.userGrowth.active, true)}`}>
                {formatPercentage((data.userGrowth.active / data.userGrowth.total) * 100)} of total
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Daily active users
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(data.engagement.messages)}</div>
            <div className="flex items-center space-x-2 mt-2">
              {getTrendIcon(data.engagement.messages, true)}
              <span className={`text-sm ${getTrendColor(data.engagement.messages, true)}`}>
                +12% from last period
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Total messages sent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Session</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(data.engagement.avgSessionTime)}</div>
            <div className="flex items-center space-x-2 mt-2">
              {getTrendIcon(data.engagement.avgSessionTime, true)}
              <span className={`text-sm ${getTrendColor(data.engagement.avgSessionTime, true)}`}>
                +5% from last period
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average session duration
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Activity Chart Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5" />
            <span>Activity Over Time</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500 dark:text-gray-400">
                Activity chart will be implemented here
              </p>
              <p className="text-sm text-gray-400 mt-2">
                Selected metric: {selectedMetric}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top Users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Users className="w-5 h-5" />
            <span>Top Active Users</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.topUsers.map((user, index) => (
              <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {user.name.split(' ').map(n => n[0]).join('')}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-sm">{user.name}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <div className="text-sm font-medium">{user.activity}</div>
                    <div className="text-xs text-muted-foreground">Activity Score</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{user.messages}</div>
                    <div className="text-xs text-muted-foreground">Messages</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{user.files}</div>
                    <div className="text-xs text-muted-foreground">Files</div>
                  </div>
                  <Badge variant="outline">#{index + 1}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Performance */}
      {showDetails && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Activity className="w-5 h-5" />
              <span>System Performance</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">
                  {formatPercentage(data.systemMetrics.uptime)}
                </div>
                <div className="text-sm text-muted-foreground">Uptime</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-500">
                  {data.systemMetrics.responseTime}ms
                </div>
                <div className="text-sm text-muted-foreground">Response Time</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-500">
                  {formatPercentage(data.systemMetrics.errorRate)}
                </div>
                <div className="text-sm text-muted-foreground">Error Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-500">
                  {formatNumber(data.systemMetrics.throughput)}
                </div>
                <div className="text-sm text-muted-foreground">Throughput (req/s)</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    CheckCircle,
    Clock,
    Database,
    Server,
    Settings,
    Shield,
    UserMinus,
    UserPlus,
    Users
} from 'lucide-react';
import { useState } from 'react';

interface AdminPanelProps {
  channelId: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive' | 'pending';
  lastLogin: string;
  joinDate: string;
}

interface SystemStats {
  totalUsers: number;
  activeUsers: number;
  totalChannels: number;
  totalMessages: number;
  systemUptime: string;
  databaseStatus: 'healthy' | 'warning' | 'error';
  redisStatus: 'healthy' | 'warning' | 'error';
  minioStatus: 'healthy' | 'warning' | 'error';
}

export function AdminPanel({ channelId }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState('overview');

  // Mock data
  const mockUsers: User[] = [
    {
      id: '1',
      name: 'John Doe',
      email: 'john.doe@aae.co.th',
      role: 'admin',
      status: 'active',
      lastLogin: '2024-09-18T08:30:00Z',
      joinDate: '2024-01-15T00:00:00Z'
    },
    {
      id: '2',
      name: 'Jane Smith',
      email: 'jane.smith@aae.co.th',
      role: 'manager',
      status: 'active',
      lastLogin: '2024-09-18T07:45:00Z',
      joinDate: '2024-02-20T00:00:00Z'
    },
    {
      id: '3',
      name: 'Mike Johnson',
      email: 'mike.johnson@aae.co.th',
      role: 'user',
      status: 'active',
      lastLogin: '2024-09-17T16:20:00Z',
      joinDate: '2024-03-10T00:00:00Z'
    },
    {
      id: '4',
      name: 'Sarah Wilson',
      email: 'sarah.wilson@aae.co.th',
      role: 'user',
      status: 'inactive',
      lastLogin: '2024-09-15T14:30:00Z',
      joinDate: '2024-04-05T00:00:00Z'
    }
  ];

  const mockStats: SystemStats = {
    totalUsers: 156,
    activeUsers: 142,
    totalChannels: 24,
    totalMessages: 12847,
    systemUptime: '15 days, 8 hours',
    databaseStatus: 'healthy',
    redisStatus: 'healthy',
    minioStatus: 'warning'
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'healthy':
        return 'text-green-600 bg-green-100 dark:bg-green-900 dark:text-green-300';
      case 'inactive':
      case 'warning':
        return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-300';
      case 'pending':
      case 'error':
        return 'text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-300';
      default:
        return 'text-gray-600 bg-gray-100 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
      case 'healthy':
        return <CheckCircle className="w-4 h-4" />;
      case 'inactive':
      case 'warning':
        return <AlertTriangle className="w-4 h-4" />;
      case 'pending':
      case 'error':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Admin Panel
          </h2>
          <Badge variant="outline" className="text-xs">
            {channelId}
          </Badge>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <Button size="sm">
            <UserPlus className="w-4 h-4 mr-2" />
            Add User
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Users className="w-8 h-8 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {mockStats.totalUsers}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Total Users
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Activity className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {mockStats.activeUsers}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Active Users
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-8 h-8 text-purple-500" />
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {mockStats.totalChannels}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Channels
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Database className="w-8 h-8 text-orange-500" />
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {mockStats.totalMessages.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Messages
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* System Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">System Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Database className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">Database</span>
                </div>
                <Badge className={getStatusColor(mockStats.databaseStatus)}>
                  {getStatusIcon(mockStats.databaseStatus)}
                  <span className="ml-1 capitalize">{mockStats.databaseStatus}</span>
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Server className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">Redis Cache</span>
                </div>
                <Badge className={getStatusColor(mockStats.redisStatus)}>
                  {getStatusIcon(mockStats.redisStatus)}
                  <span className="ml-1 capitalize">{mockStats.redisStatus}</span>
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Database className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">File Storage</span>
                </div>
                <Badge className={getStatusColor(mockStats.minioStatus)}>
                  {getStatusIcon(mockStats.minioStatus)}
                  <span className="ml-1 capitalize">{mockStats.minioStatus}</span>
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">Uptime</span>
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {mockStats.systemUptime}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">User Management</CardTitle>
                <div className="flex items-center space-x-2">
                  <Input
                    placeholder="Search users..."
                    className="w-64"
                  />
                  <Button size="sm">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Add User
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {mockUsers.map(user => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                          {user.name.split(' ').map(n => n[0]).join('')}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {user.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="text-xs">
                        {user.role}
                      </Badge>
                      <Badge className={getStatusColor(user.status)}>
                        {getStatusIcon(user.status)}
                        <span className="ml-1 capitalize">{user.status}</span>
                      </Badge>
                      <div className="flex items-center space-x-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Settings className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500">
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Tab */}
        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">System Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Settings className="w-12 h-12 mx-auto mb-2" />
                <p>System configuration options coming soon</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Security Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Shield className="w-12 h-12 mx-auto mb-2" />
                <p>Security settings coming soon</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

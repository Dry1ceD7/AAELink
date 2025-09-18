/**
 * AAELink Enterprise Dashboard
 * Main workspace interface with offline support
 * Version: 1.2.0
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { offlineManager } from '@/lib/offline-manager';
import { offlineStorage } from '@/lib/offline-storage';
import {
    Calendar,
    FileText,
    MessageSquare,
    Plus,
    RefreshCw,
    Search,
    Settings,
    Users,
    Wifi,
    WifiOff
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface DashboardProps {}

export default function Dashboard({}: DashboardProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'messages' | 'calendar' | 'files' | 'users'>('messages');

  useEffect(() => {
    // Set up offline status listener
    const unsubscribe = offlineManager.addStatusListener((status) => {
      setIsOnline(status.isOnline);
      setLastSync(status.lastSync);
    });

    // Load initial data
    loadDashboardData();

    return unsubscribe;
  }, []);

  const loadDashboardData = async () => {
    try {
      // Load messages
      const messageData = await offlineStorage.getMessages();
      setMessages(messageData);

      // Load events
      const eventData = await offlineEvents();
      setEvents(eventData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  };

  const handleSendMessage = async (content: string) => {
    const message = {
      id: Date.now().toString(),
      content,
      channelId: 'general',
      userId: 'current-user',
      timestamp: Date.now(),
      type: 'text'
    };

    try {
      await offlineStorage.saveMessage(message);
      setMessages(prev => [...prev, message]);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleCreateEvent = async (eventData: any) => {
    try {
      await offlineStorage.saveEvent(eventData);
      setEvents(prev => [...prev, eventData]);
    } catch (error) {
      console.error('Failed to create event:', error);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    // Implement search functionality
  };

  const handleForceSync = async () => {
    try {
      await offlineManager.forceSync();
      await loadDashboardData();
    } catch (error) {
      console.error('Force sync failed:', error);
    }
  };

  const formatLastSync = () => {
    if (!lastSync) return 'Never';

    const now = new Date();
    const diff = now.getTime() - lastSync.getTime();
    const minutes = Math.floor(diff / (1000 * 60));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                AAELink Enterprise
              </h1>
              <Badge variant={isOnline ? "default" : "destructive"}>
                {isOnline ? (
                  <><Wifi className="w-3 h-3 mr-1" /> Online</>
                ) : (
                  <><WifiOff className="w-3 h-3 mr-1" /> Offline</>
                )}
              </Badge>
            </div>

            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Last sync: {formatLastSync()}
              </div>

              {isOnline && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleForceSync}
                  className="flex items-center space-x-1"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Sync</span>
                </Button>
              )}

              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Navigation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant={activeTab === 'messages' ? 'default' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => setActiveTab('messages')}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Messages
                </Button>

                <Button
                  variant={activeTab === 'calendar' ? 'default' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => setActiveTab('calendar')}
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Calendar
                </Button>

                <Button
                  variant={activeTab === 'files' ? 'default' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => setActiveTab('files')}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Files
                </Button>

                <Button
                  variant={activeTab === 'users' ? 'default' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => setActiveTab('users')}
                >
                  <Users className="w-4 h-4 mr-2" />
                  Users
                </Button>
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-lg">Quick Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Messages</span>
                  <span className="text-sm font-medium">{messages.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Events</span>
                  <span className="text-sm font-medium">{events.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
                  <Badge variant={isOnline ? "default" : "destructive"} className="text-xs">
                    {isOnline ? 'Online' : 'Offline'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {/* Search Bar */}
            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search messages, files, events..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'messages' && (
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Messages</CardTitle>
                    <Button size="sm">
                      <Plus className="w-4 h-4 mr-1" />
                      New Message
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {messages.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No messages yet. Start a conversation!
                      </div>
                    ) : (
                      messages.map((message) => (
                        <div key={message.id} className="border-b border-gray-200 dark:border-gray-700 pb-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {message.userId}
                              </p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                {message.content}
                              </p>
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {new Date(message.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'calendar' && (
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Calendar</CardTitle>
                    <Button size="sm">
                      <Plus className="w-4 h-4 mr-1" />
                      New Event
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {events.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No events scheduled. Create your first event!
                      </div>
                    ) : (
                      events.map((event) => (
                        <div key={event.id} className="border-b border-gray-200 dark:border-gray-700 pb-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {event.title}
                              </p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                {event.description}
                              </p>
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {new Date(event.startDate).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'files' && (
              <Card>
                <CardHeader>
                  <CardTitle>Files</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    File management coming soon...
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'users' && (
              <Card>
                <CardHeader>
                  <CardTitle>Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    User management coming soon...
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

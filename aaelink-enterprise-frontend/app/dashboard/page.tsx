/**
 * AAELink Enterprise Dashboard
 * Main workspace interface with Discord+Telegram UX/UI
 * Version: 1.2.0
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { offlineManager } from '@/lib/offline-manager';
import { offlineStorage } from '@/lib/offline-storage';
import { authServiceInstance } from '@/lib/auth';
import { webSocketService } from '@/lib/websocket';
import { messageService, fileService, calendarService } from '@/lib/api';
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
    WifiOff,
    Hash,
    Bell,
    User,
    MoreHorizontal,
    Send,
    Smile,
    Paperclip,
    Phone,
    Video,
    Shield,
    BarChart3
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface DashboardProps {}

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement';
  unread: number;
  lastMessage?: string;
  lastMessageTime?: Date;
}

interface Message {
  id: string;
  content: string;
  userId: string;
  username: string;
  avatar?: string | undefined;
  timestamp: Date;
  type: 'text' | 'file' | 'image' | 'voice' | 'video';
  edited?: boolean;
  reactions?: { emoji: string; count: number; users: string[] }[];
}

export default function Dashboard(_props: DashboardProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [channels, setChannels] = useState<Channel[]>([
    { id: 'general', name: 'general', type: 'text', unread: 0 },
    { id: 'announcements', name: 'announcements', type: 'announcement', unread: 3 },
    { id: 'development', name: 'development', type: 'text', unread: 1 },
    { id: 'design', name: 'design', type: 'text', unread: 0 },
    { id: 'marketing', name: 'marketing', type: 'text', unread: 0 },
  ]);
  const [activeChannel, setActiveChannel] = useState('general');
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [user] = useState(authServiceInstance.getUser());

  useEffect(() => {
    // Set up offline status listener
    const unsubscribe = offlineManager.addStatusListener((status) => {
      setIsOnline(status.isOnline);
      setLastSync(status.lastSync);
    });

    // Set up WebSocket connection
    webSocketService.connect();
    webSocketService.on('new_message', (message: any) => {
      setMessages(prev => [...prev, message]);
    });
    webSocketService.on('typing', (data: any) => {
      // Handle typing indicators
    });

    // Load initial data
    loadDashboardData();

    return () => {
      unsubscribe();
      webSocketService.disconnect();
    };
  }, []);

  const loadDashboardData = async () => {
    try {
      // Load messages for active channel
      const messageData = await messageService.getMessages(activeChannel);
      setMessages(messageData);

      // Load events
      const eventData = await calendarService.getEvents();
      setEvents(eventData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      // Fallback to offline storage
      const offlineMessages = await offlineStorage.getMessages(activeChannel);
      setMessages(offlineMessages);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    const message: Message = {
      id: Date.now().toString(),
      content: newMessage,
      userId: user?.id || 'current-user',
      username: user?.name || 'You',
      avatar: user?.avatar,
      timestamp: new Date(),
      type: 'text'
    };

    try {
      // Send via WebSocket for real-time
      webSocketService.sendMessage('new_message', {
        channelId: activeChannel,
        content: newMessage,
        type: 'text'
      });

      // Also save to offline storage
      await offlineStorage.saveMessage(message);
      setMessages(prev => [...prev, message]);
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!isTyping) {
      setIsTyping(true);
      webSocketService.sendTyping(activeChannel, true);
      
      setTimeout(() => {
        setIsTyping(false);
        webSocketService.sendTyping(activeChannel, false);
      }, 1000);
    }
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

  const formatMessageTime = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / (1000 * 60));

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return timestamp.toLocaleDateString();
  };

  return (
    <div className="h-screen flex bg-gray-100 dark:bg-gray-900">
      {/* Server/Channel Sidebar - Discord Style - Hidden on mobile */}
      <div className="hidden lg:flex w-64 bg-gray-800 dark:bg-gray-900 flex-col">
        {/* Server Header */}
        <div className="h-12 bg-gray-700 dark:bg-gray-800 flex items-center px-4 border-b border-gray-600">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">AAE</span>
          </div>
          <span className="ml-3 text-white font-semibold">AAELink Enterprise</span>
        </div>

        {/* Channels */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-2 py-2">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Text Channels
            </div>
            {channels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => setActiveChannel(channel.id)}
                className={`w-full flex items-center px-2 py-1.5 rounded text-left hover:bg-gray-700 dark:hover:bg-gray-800 group ${
                  activeChannel === channel.id ? 'bg-gray-700 dark:bg-gray-800' : ''
                }`}
              >
                <Hash className="w-4 h-4 text-gray-400 mr-2" />
                <span className="text-gray-300 flex-1">{channel.name}</span>
                {channel.unread > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center">
                    {channel.unread}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="px-2 py-2">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Voice Channels
            </div>
            <button className="w-full flex items-center px-2 py-1.5 rounded text-left hover:bg-gray-700 dark:hover:bg-gray-800 group">
              <Phone className="w-4 h-4 text-gray-400 mr-2" />
              <span className="text-gray-300">General Voice</span>
            </button>
            <button className="w-full flex items-center px-2 py-1.5 rounded text-left hover:bg-gray-700 dark:hover:bg-gray-800 group">
              <Video className="w-4 h-4 text-gray-400 mr-2" />
              <span className="text-gray-300">Video Calls</span>
            </button>
          </div>
        </div>

        {/* User Info */}
        <div className="h-16 bg-gray-700 dark:bg-gray-800 border-t border-gray-600 flex items-center px-4">
          <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <div className="ml-3 flex-1">
            <div className="text-white text-sm font-medium">{user?.name || 'User'}</div>
            <div className="text-gray-400 text-xs">
              {isOnline ? 'Online' : 'Offline'}
            </div>
          </div>
          <div className="flex space-x-1">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Settings className="w-4 h-4 text-gray-400" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="w-4 h-4 text-gray-400" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Chat Area - Telegram Style */}
      <div className="flex-1 flex flex-col lg:ml-0">
        {/* Channel Header */}
        <div className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-4">
          <Hash className="w-5 h-5 text-gray-500 mr-2" />
          <span className="text-gray-900 dark:text-white font-semibold">
            {channels.find(c => c.id === activeChannel)?.name || 'general'}
          </span>
          <div className="ml-auto flex items-center space-x-2">
            <Badge variant={isOnline ? "default" : "destructive"} className="text-xs">
              {isOnline ? (
                <><Wifi className="w-3 h-3 mr-1" /> Online</>
              ) : (
                <><WifiOff className="w-3 h-3 mr-1" /> Offline</>
              )}
            </Badge>
            {isOnline && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleForceSync}
                className="text-gray-500 hover:text-gray-700"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700">
              <Bell className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700">
              <Search className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Welcome to #{channels.find(c => c.id === activeChannel)?.name || 'general'}!
                </h3>
                <p className="text-gray-500 dark:text-gray-400">
                  This is the beginning of your conversation.
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div key={message.id} className="flex items-start space-x-3 group hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg p-2 -m-2">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                    {message.avatar ? (
                      <img src={message.avatar} alt={message.username} className="w-10 h-10 rounded-full" />
                    ) : (
                      <span className="text-white font-medium text-sm">
                        {message.username.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline space-x-2">
                      <span className="font-medium text-gray-900 dark:text-white text-sm">
                        {message.username}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatMessageTime(message.timestamp)}
                      </span>
                      {message.edited && (
                        <span className="text-xs text-gray-400">(edited)</span>
                      )}
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 text-sm mt-1">
                      {message.content}
                    </p>
                    {message.reactions && message.reactions.length > 0 && (
                      <div className="flex space-x-1 mt-2">
                        {message.reactions.map((reaction, idx) => (
                          <button
                            key={idx}
                            className="flex items-center space-x-1 bg-gray-200 dark:bg-gray-700 rounded-full px-2 py-1 text-xs hover:bg-gray-300 dark:hover:bg-gray-600"
                          >
                            <span>{reaction.emoji}</span>
                            <span className="text-gray-600 dark:text-gray-400">{reaction.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Message Input - Telegram Style */}
        <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end space-x-3">
              <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700">
                <Paperclip className="w-5 h-5" />
              </Button>
              <div className="flex-1 relative">
                <Input
                  value={newMessage}
                  onChange={handleTyping}
                  onKeyPress={handleKeyPress}
                  placeholder={`Message #${channels.find(c => c.id === activeChannel)?.name || 'general'}`}
                  className="pr-12 resize-none"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  <Smile className="w-5 h-5" />
                </Button>
              </div>
              <Button
                onClick={handleSendMessage}
                disabled={!newMessage.trim()}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            {isTyping && (
              <div className="text-xs text-gray-500 mt-1">
                Someone is typing...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Sidebar - Discord Style - Hidden on mobile */}
      <div className="hidden xl:flex w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex-col">
        {/* Sidebar Header */}
        <div className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center px-4">
          <span className="font-semibold text-gray-900 dark:text-white">Channel Info</span>
        </div>

        {/* Channel Members */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Members — {channels.find(c => c.id === activeChannel)?.name || 'general'}
          </div>
          <div className="space-y-2">
            {[
              { name: 'John Doe', status: 'online', role: 'Admin' },
              { name: 'Jane Smith', status: 'away', role: 'User' },
              { name: 'Mike Johnson', status: 'online', role: 'User' },
              { name: 'Sarah Wilson', status: 'busy', role: 'Moderator' },
            ].map((member, index) => (
              <div key={index} className="flex items-center space-x-3 py-1">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-medium">
                    {member.name.split(' ').map(n => n[0]).join('')}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {member.name}
                    </span>
                    {member.role === 'Admin' && (
                      <Shield className="w-3 h-3 text-red-500" />
                    )}
                  </div>
                  <div className="text-xs text-gray-500 capitalize">{member.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Quick Actions
          </div>
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full justify-start">
              <Calendar className="w-4 h-4 mr-2" />
              Schedule Meeting
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start">
              <FileText className="w-4 h-4 mr-2" />
              Share File
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start">
              <BarChart3 className="w-4 h-4 mr-2" />
              View Analytics
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation - Telegram+LINE Style */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-50">
        <div className="flex items-center justify-around py-2">
          <button className="flex flex-col items-center space-y-1 p-2 text-blue-500">
            <MessageSquare className="w-6 h-6" />
            <span className="text-xs font-medium">Chats</span>
          </button>
          <button className="flex flex-col items-center space-y-1 p-2 text-gray-500 hover:text-gray-700">
            <Calendar className="w-6 h-6" />
            <span className="text-xs">Calendar</span>
          </button>
          <button className="flex flex-col items-center space-y-1 p-2 text-gray-500 hover:text-gray-700">
            <FileText className="w-6 h-6" />
            <span className="text-xs">Files</span>
          </button>
          <button className="flex flex-col items-center space-y-1 p-2 text-gray-500 hover:text-gray-700">
            <Users className="w-6 h-6" />
            <span className="text-xs">Users</span>
          </button>
          <button className="flex flex-col items-center space-y-1 p-2 text-gray-500 hover:text-gray-700">
            <Settings className="w-6 h-6" />
            <span className="text-xs">Settings</span>
          </button>
        </div>
      </div>

      {/* Mobile Channel Selector - Telegram Style */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-40">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">AAE</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">AAELink</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {channels.find(c => c.id === activeChannel)?.name || 'general'}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant={isOnline ? "default" : "destructive"} className="text-xs">
              {isOnline ? 'Online' : 'Offline'}
            </Badge>
            <Button variant="ghost" size="sm" className="text-gray-500">
              <Search className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-500">
              <Bell className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Channel List - Telegram Style */}
      <div className="lg:hidden fixed top-16 left-0 right-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-30">
        <div className="flex overflow-x-auto px-4 py-2 space-x-2">
          {channels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => setActiveChannel(channel.id)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium ${
                activeChannel === channel.id
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              #{channel.name}
              {channel.unread > 0 && (
                <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                  {channel.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile Content Padding */}
      <div className="lg:hidden pt-24 pb-16"></div>
    </div>
  );
}

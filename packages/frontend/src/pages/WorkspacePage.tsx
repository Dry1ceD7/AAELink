import React, { useEffect, useState } from 'react';
import AdminConsole from '../components/AdminConsole';
import AdvancedSearch from '../components/AdvancedSearch';
import Calendar from '../components/Calendar';
import ChannelList from '../components/ChannelList';
import FileUpload from '../components/FileUpload';
import Logo from '../components/Logo';
import MessageInput from '../components/MessageInput';
import MessageList from '../components/MessageList';
import SearchBar from '../components/SearchBar';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { offlineStorage } from '../services/offlineStorage';
import { WebSocketService } from '../services/websocket';

const WorkspacePage: React.FC = () => {
  const { user, logout } = useAuth();
  const { theme, seniorMode, toggleTheme, setSeniorMode } = useTheme();
  const { success } = useToast();

  const [selectedChannel, setSelectedChannel] = useState('general');
  const [messages, setMessages] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'calendar' | 'admin'>('chat');

  useEffect(() => {
    initializeOfflineStorage();
    loadChannels();
    loadMessages();

    // Initialize WebSocket connection
    if (user?.id) {
      initializeWebSocket();
    }

    // Set up online/offline listeners
    offlineStorage.onOnlineStatusChange((online) => {
      setIsOnline(online);
      if (online) {
        // Sync offline actions when coming back online
        offlineStorage.syncOfflineActions();
      }
    });

    return () => {
      // Cleanup WebSocket connection
      WebSocketService.disconnect();
    };
  }, [user?.id]);

  const initializeOfflineStorage = async () => {
    try {
      await offlineStorage.initialize();
      console.log('Offline storage initialized');
    } catch (error) {
      console.error('Failed to initialize offline storage:', error);
    }
  };

  const loadChannels = async () => {
    try {
      // Mock channels for demo
      const mockChannels = [
        { id: 'general', name: 'general', description: 'General discussion' },
        { id: 'announcements', name: 'announcements', description: 'Company announcements' },
        { id: 'development', name: 'development', description: 'Development team' },
        { id: 'design', name: 'design', description: 'Design team' },
      ];
      setChannels(mockChannels);
    } catch (error) {
      console.error('Failed to load channels:', error);
    }
  };

  const loadMessages = async () => {
    try {
      // Try to load from offline storage first
      const offlineMessages = await offlineStorage.getMessages(selectedChannel);

      if (offlineMessages.length > 0) {
        setMessages(offlineMessages);
        setLoading(false);
      }

      // If online, also try to load from server
      if (isOnline) {
        try {
          const response = await fetch(`http://localhost:3002/api/messages/${selectedChannel}`);
          if (response.ok) {
            const serverMessages = await response.json();
            setMessages(serverMessages.messages || []);

            // Save server messages to offline storage
            for (const message of serverMessages.messages || []) {
              await offlineStorage.saveMessage({ ...message, synced: true });
            }
          }
        } catch (error) {
          console.log('Failed to load messages from server, using offline data');
        }
      }

      // If no messages in storage and offline, show demo messages
      if (offlineMessages.length === 0 && !isOnline) {
        const mockMessages = [
          {
            id: '1',
            content: 'Welcome to AAELink! 🎉 (Offline Mode)',
            userId: 'admin_001',
            channelId: selectedChannel,
            createdAt: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            id: '2',
            content: 'You are currently offline. Messages will sync when you reconnect.',
            userId: 'admin_001',
            channelId: selectedChannel,
            createdAt: new Date(Date.now() - 1800000).toISOString(),
          },
        ];
        setMessages(mockMessages);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const initializeWebSocket = async () => {
    try {
      await WebSocketService.connect(user!.id);

      // Set up WebSocket callbacks
      WebSocketService.setCallbacks({
        onMessage: (data) => {
          const newMessage = {
            id: `msg_${Date.now()}`,
            content: data.content,
            userId: data.userId || 'system',
            channelId: selectedChannel,
            createdAt: new Date().toISOString(),
          };
          setMessages(prev => [...prev, newMessage]);
        },
        onTyping: (userId, channelId, isTyping) => {
          if (channelId === selectedChannel) {
            // Handle typing indicators
            console.log(`User ${userId} is ${isTyping ? 'typing' : 'not typing'} in ${channelId}`);
          }
        },
        onPresence: (userId, channelId, action) => {
          console.log(`User ${userId} ${action} channel ${channelId}`);
        },
        onConnected: () => {
          console.log('WebSocket connected');
          // Join the current channel
          WebSocketService.joinChannel(selectedChannel);
        },
        onDisconnected: () => {
          console.log('WebSocket disconnected');
        },
        onError: (error) => {
          console.error('WebSocket error:', error);
        }
      });

    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
    }
  };

  const handleSendMessage = async (content: string) => {
    try {
      const newMessage = {
        id: `msg_${Date.now()}`,
        content,
        userId: user?.id || 'admin_001',
        channelId: selectedChannel,
        createdAt: new Date().toISOString(),
      };

      // Add to local state immediately for optimistic updates
      setMessages(prev => [...prev, newMessage]);

      // Save to offline storage
      await offlineStorage.saveMessage(newMessage);

      if (isOnline) {
        // Send via WebSocket for real-time delivery
        if (WebSocketService.isConnected()) {
          WebSocketService.sendMessage(selectedChannel, content);
        }

        // Also try to send via API
        try {
          await fetch('http://localhost:3002/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channelId: selectedChannel,
              content,
              type: 'text'
            }),
            credentials: 'include'
          });

          // Mark as synced
          await offlineStorage.markMessageSynced(newMessage.id);
        } catch (error) {
          console.log('Failed to send message to server, will retry when online');
          // Queue for offline sync
          await offlineStorage.queueOfflineAction({
            type: 'message',
            data: { channelId: selectedChannel, content, type: 'text' }
          });
        }
      } else {
        // Queue for offline sync
        await offlineStorage.queueOfflineAction({
          type: 'message',
          data: { channelId: selectedChannel, content, type: 'text' }
        });
      }

      success(isOnline ? 'Message sent successfully!' : 'Message queued for sync!');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('channelId', selectedChannel);

      const response = await fetch('http://localhost:3002/api/files/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (response.ok) {
        const result = await response.json();
        success(`File "${file.name}" uploaded successfully!`);

        // Add file message to chat
        const fileMessage = {
          id: `msg_${Date.now()}`,
          content: `📎 ${file.name}`,
          userId: user?.id || 'admin_001',
          channelId: selectedChannel,
          createdAt: new Date().toISOString(),
          type: 'file',
          fileData: result.file
        };

        setMessages(prev => [...prev, fileMessage]);
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      console.error('Failed to upload file:', error);
      success(`Failed to upload "${file.name}"`, 'error');
    }
  };

  const handleSearch = (query: string) => {
    if (query.trim()) {
      setShowAdvancedSearch(true);
    }
  };

  const handleSearchResultClick = (result: any) => {
    console.log('Search result clicked:', result);
    // Handle navigation to search result
    if (result.type === 'channel') {
      handleChannelChange(result.id);
    } else if (result.type === 'message') {
      handleChannelChange(result.metadata.channelId);
    }
  };

  const handleChannelChange = (channelId: string) => {
    // Leave current channel
    if (WebSocketService.isConnected()) {
      WebSocketService.leaveChannel(selectedChannel);
    }

    // Switch to new channel
    setSelectedChannel(channelId);

    // Join new channel
    if (WebSocketService.isConnected()) {
      WebSocketService.joinChannel(channelId);
    }

    // Load messages for new channel
    loadMessages();
  };

  const handleLogout = async () => {
    await logout();
    success('Logged out successfully!');
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between h-16 px-4">
          <div className="flex items-center space-x-4">
            <Logo variant="text" size="md" />
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {user?.displayName} • {user?.role}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <SearchBar onSearch={handleSearch} />

            {/* Online/Offline Indicator */}
            <div className={`px-2 py-1 rounded-full text-xs font-medium ${
              isOnline
                ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
            }`}>
              {isOnline ? '🟢 Online' : '🔴 Offline'}
            </div>

            <button
              onClick={toggleTheme}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
              title={`Current theme: ${theme}`}
            >
              {theme === 'light' && '☀️'}
              {theme === 'dark' && '🌙'}
              {theme === 'high-contrast' && '🔆'}
            </button>

            <button
              onClick={() => setSeniorMode(!seniorMode)}
              className={`p-2 rounded-md ${
                seniorMode
                  ? 'text-blue-600 bg-blue-100 dark:bg-blue-900/20'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
              title={seniorMode ? 'Disable Senior Mode' : 'Enable Senior Mode'}
            >
              👴
            </button>

            <button
              onClick={handleLogout}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex space-x-1 px-4">
          {[
            { id: 'chat', label: 'Chat', icon: '💬' },
            { id: 'calendar', label: 'Calendar', icon: '📅' },
            { id: 'admin', label: 'Admin', icon: '⚙️' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id as any)}
              className={`px-4 py-2 text-sm rounded-t-lg ${
                activeView === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {activeView === 'chat' && (
          <>
            {/* Sidebar */}
            <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Channels
            </h2>
          </div>

            <ChannelList
              channels={channels}
              selectedChannel={selectedChannel}
              onChannelSelect={handleChannelChange}
            />
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Channel Header */}
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              # {selectedChannel}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {channels.find(c => c.id === selectedChannel)?.description}
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-gray-500 dark:text-gray-400">Loading messages...</p>
                </div>
              </div>
            ) : (
              <MessageList messages={messages} currentUserId={user?.id} />
            )}
          </div>

          {/* Message Input */}
          <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-end space-x-2">
              <FileUpload onFileUpload={handleFileUpload} />
              <MessageInput onSendMessage={handleSendMessage} />
            </div>
          </div>
        </div>
        </>
        )}

        {activeView === 'calendar' && (
          <div className="flex-1 p-6">
            <Calendar
              onEventClick={(event) => console.log('Event clicked:', event)}
              onEventCreate={(event) => console.log('Event created:', event)}
              className="h-full"
            />
          </div>
        )}

        {activeView === 'admin' && (
          <div className="flex-1 p-6">
            <AdminConsole onClose={() => setActiveView('chat')} />
          </div>
        )}
      </div>

      {/* Advanced Search Modal */}
      {showAdvancedSearch && (
        <AdvancedSearch
          onResultClick={handleSearchResultClick}
          onClose={() => setShowAdvancedSearch(false)}
        />
      )}
    </div>
  );
};

export default WorkspacePage;

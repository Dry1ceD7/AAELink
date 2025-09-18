'use client';

import { useState } from 'react';
import { MessageCircle, Video, FileText, Calendar, Users, Store, Settings, Search, Bell, Plus, Hash, Lock, Volume2, Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export default function DashboardPage() {
  const [activeChannel, setActiveChannel] = useState('general');
  const [searchQuery, setSearchQuery] = useState('');
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const channels = [
    { id: 'general', name: 'general', type: 'text', unread: 0 },
    { id: 'announcements', name: 'announcements', type: 'text', unread: 3 },
    { id: 'development', name: 'development', type: 'text', unread: 0 },
    { id: 'design', name: 'design', type: 'text', unread: 1 },
    { id: 'marketing', name: 'marketing', type: 'text', unread: 0 },
    { id: 'voice-general', name: 'General Voice', type: 'voice', unread: 0 },
    { id: 'voice-meeting', name: 'Meeting Room', type: 'voice', unread: 0 },
  ];

  const messages = [
    {
      id: '1',
      author: 'John Doe',
      avatar: 'JD',
      content: 'Hey team! How is the project going?',
      timestamp: new Date(Date.now() - 2 * 60 * 1000),
      reactions: [
        { emoji: '👍', count: 3, users: ['user1', 'user2', 'user3'] },
        { emoji: '❤️', count: 1, users: ['user1'] }
      ]
    },
    {
      id: '2',
      author: 'Alice Smith',
      avatar: 'AS',
      content: 'Great progress! We should schedule a meeting to discuss the next phase.',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      reactions: [
        { emoji: '👍', count: 2, users: ['user2', 'user3'] }
      ]
    },
    {
      id: '3',
      author: 'Mike Johnson',
      avatar: 'MJ',
      content: 'I\'ve uploaded the latest design mockups to the files section.',
      timestamp: new Date(Date.now() - 10 * 60 * 1000),
      reactions: []
    }
  ];

  const onlineUsers = [
    { id: '1', name: 'John Doe', status: 'online', avatar: 'JD' },
    { id: '2', name: 'Alice Smith', status: 'away', avatar: 'AS' },
    { id: '3', name: 'Mike Johnson', status: 'online', avatar: 'MJ' },
    { id: '4', name: 'Sarah Wilson', status: 'busy', avatar: 'SW' },
  ];

  return (
    <div className="discord-layout">
      {/* Left Sidebar */}
      <div className="discord-sidebar">
        {/* Server List */}
        <div className="discord-server-list">
          <div className="discord-server-item">
            <span className="text-white text-lg font-bold">AAE</span>
          </div>
        </div>

        {/* Channel List */}
        <div className="discord-channel-list scrollbar-thin">
          <div className="discord-channel-section">
            <h3 className="discord-channel-section-title">AAELink Workspace</h3>
            <div className="space-y-1">
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => setActiveChannel(channel.id)}
                  className={`discord-channel-item w-full text-left ${
                    activeChannel === channel.id ? 'active' : ''
                  }`}
                >
                  {channel.type === 'text' ? (
                    <Hash className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                  <span className="flex-1">#{channel.name}</span>
                  {channel.unread > 0 && (
                    <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center">
                      {channel.unread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="discord-channel-section">
            <h3 className="discord-channel-section-title">Direct Messages</h3>
            <div className="space-y-1">
              <button className="discord-channel-item w-full text-left">
                <MessageCircle className="h-4 w-4" />
                <span>Alice Smith</span>
                <span className="bg-green-500 w-2 h-2 rounded-full ml-auto"></span>
              </button>
              <button className="discord-channel-item w-full text-left">
                <MessageCircle className="h-4 w-4" />
                <span>Mike Johnson</span>
                <span className="bg-yellow-500 w-2 h-2 rounded-full ml-auto"></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="discord-main">
        {/* Message Header */}
        <div className="discord-message-header">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-white">
                #{channels.find(c => c.id === activeChannel)?.name}
              </h1>
              <div className="flex items-center gap-2">
                <Button variant="discord" size="sm">
                  <MessageCircle className="h-4 w-4 mr-2" />
                  Messages
                </Button>
                <Button variant="discord-secondary" size="sm">
                  <FileText className="h-4 w-4 mr-2" />
                  Files
                </Button>
                <Button variant="discord-secondary" size="sm">
                  <Calendar className="h-4 w-4 mr-2" />
                  Calendar
                </Button>
                <Button variant="discord-secondary" size="sm">
                  <Users className="h-4 w-4 mr-2" />
                  Teams
                </Button>
                <Button variant="discord-secondary" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </Button>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-64 bg-discord-dark border-discord-dark text-white placeholder-gray-400"
                />
              </div>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
              </Button>
              <div className="text-sm text-gray-300">
                Welcome, <span className="font-medium text-white">Admin User</span>
              </div>
              <Button variant="ghost" className="text-white hover:bg-discord-dark">
                Logout
              </Button>
            </div>
          </div>
        </div>

        {/* Message Area */}
        <div className="discord-message-area">
          <div className="flex items-center justify-between p-4 border-b bg-gray-50 dark:bg-discord-dark">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <h2 className="text-lg font-semibold">#{channels.find(c => c.id === activeChannel)?.name}</h2>
              <span className="text-sm text-gray-500">{messages.length} messages</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">Search</Button>
              <Button variant="outline" size="sm">Members</Button>
              <Button variant="outline" size="sm">Settings</Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="flex h-full">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                {messages.map((message) => (
                  <div key={message.id} className="discord-message">
                    <div className="discord-message-avatar">
                      {message.avatar}
                    </div>
                    <div className="discord-message-content">
                      <div className="discord-message-header">
                        <span className="discord-message-author">{message.author}</span>
                        <span className="discord-message-timestamp">
                          {message.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="discord-message-text">{message.content}</div>
                      {message.reactions.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {message.reactions.map((reaction, index) => (
                            <button
                              key={index}
                              className="flex items-center gap-1 px-2 py-1 bg-discord-dark rounded-full text-xs hover:bg-discord-dark/80 transition-colors"
                            >
                              <span>{reaction.emoji}</span>
                              <span>{reaction.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Right Panel */}
              <div className="discord-user-panel">
                <div className="mb-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Online
                  </h3>
                  <div className="space-y-2">
                    {onlineUsers.map((user) => (
                      <div key={user.id} className="flex items-center space-x-2">
                        <div className="relative">
                          <div className="w-6 h-6 bg-discord-blurple rounded-full flex items-center justify-center text-xs font-semibold">
                            {user.avatar}
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-discord-darker ${
                            user.status === 'online' ? 'bg-green-500' :
                            user.status === 'away' ? 'bg-yellow-500' :
                            user.status === 'busy' ? 'bg-red-500' : 'bg-gray-500'
                          }`}></div>
                        </div>
                        <span className="text-sm text-gray-300">{user.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator className="my-4 bg-discord-dark" />

                <div className="mb-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Voice Controls
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      variant={isVoiceConnected ? "destructive" : "discord"}
                      size="sm"
                      onClick={() => setIsVoiceConnected(!isVoiceConnected)}
                    >
                      {isVoiceConnected ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant={isMuted ? "destructive" : "discord-secondary"}
                      size="sm"
                      onClick={() => setIsMuted(!isMuted)}
                    >
                      {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Message Input */}
          <div className="discord-message-input">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon">
                <Plus className="h-4 w-4" />
              </Button>
              <div className="flex-1 relative">
                <Input
                  placeholder={`Message #${channels.find(c => c.id === activeChannel)?.name}`}
                  className="pr-10"
                />
                <Button variant="ghost" size="icon" className="absolute right-2 top-1/2 transform -translate-y-1/2">
                  <MessageCircle className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="discord" disabled>
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

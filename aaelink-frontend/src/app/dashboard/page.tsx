'use client'

import { ChatWindow } from '@/components/chat/chat-window'
import { FileUpload } from '@/components/files/file-upload'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/toaster'
import { useToast } from '@/hooks/use-toast'
import { Bell, Calendar, FileText, MessageCircle, Search, Settings, Store, Users, Video } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DashboardPage() {
  const [activeChannel, setActiveChannel] = useState('general')
  const [activeTab, setActiveTab] = useState('messages')
  const [searchQuery, setSearchQuery] = useState('')
  const [messages, setMessages] = useState([
    {
      id: '1',
      user: {
        id: '1',
        name: 'John Doe',
        avatar: '',
        initials: 'JD',
        status: 'online' as const
      },
      content: "Hey, how's the project going?",
      timestamp: new Date(Date.now() - 2 * 60 * 1000),
      reactions: [
        { emoji: '👍', count: 2, users: ['2', '3'] },
        { emoji: '❤️', count: 1, users: ['2'] }
      ],
      isOwn: false
    },
    {
      id: '2',
      user: {
        id: '2',
        name: 'Alice Smith',
        avatar: '',
        initials: 'AS',
        status: 'away' as const
      },
      content: 'Can we schedule a meeting for tomorrow?',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      reactions: [
        { emoji: '👍', count: 1, users: ['1'] }
      ],
      isOwn: true
    }
  ])
  const router = useRouter()
  const { toast } = useToast()

  const handleLogout = () => {
    router.push('/')
  }

  const handleSendMessage = (content: string) => {
    const newMessage = {
      id: Date.now().toString(),
      user: {
        id: 'current-user',
        name: 'You',
        avatar: '',
        initials: 'YU',
        status: 'online' as const
      },
      content,
      timestamp: new Date(),
      reactions: [],
      isOwn: true
    }
    setMessages(prev => [...prev, newMessage])
  }

  const handleFileUpload = (files: File[]) => {
    files.forEach(file => {
      const newMessage = {
        id: Date.now().toString() + Math.random(),
        user: {
          id: 'current-user',
          name: 'You',
          avatar: '',
          initials: 'YU',
          status: 'online' as const
        },
        content: `📎 ${file.name}`,
        timestamp: new Date(),
        reactions: [],
        isOwn: true
      }
      setMessages(prev => [...prev, newMessage])
    })
  }

  const handleReaction = (messageId: string, emoji: string) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        const existingReaction = msg.reactions.find(r => r.emoji === emoji)
        if (existingReaction) {
          existingReaction.count += 1
          existingReaction.users.push('current-user')
        } else {
          msg.reactions.push({
            emoji,
            count: 1,
            users: ['current-user']
          })
        }
      }
      return msg
    }))
  }

  const channels = [
    { id: 'general', name: 'general', active: true, icon: MessageCircle },
    { id: 'video-calls', name: 'video-calls', active: false, icon: Video },
    { id: 'files', name: 'files', active: false, icon: FileText },
    { id: 'search', name: 'search', active: false, icon: Search },
    { id: 'calendar', name: 'calendar', active: false, icon: Calendar },
    { id: 'teams', name: 'teams', active: false, icon: Users },
    { id: 'marketplace', name: 'marketplace', active: false, icon: Store }
  ]

  const tabs = [
    { id: 'messages', name: 'Messages', icon: MessageCircle },
    { id: 'files', name: 'Files', icon: FileText },
    { id: 'calendar', name: 'Calendar', icon: Calendar },
    { id: 'teams', name: 'Teams', icon: Users },
    { id: 'settings', name: 'Settings', icon: Settings }
  ]

  return (
    <div className="discordLayout">
      {/* Discord-style Sidebar */}
      <div className="discordSidebar">
        <div className="discordServerList">
          <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mb-2 cursor-pointer hover:bg-blue-700 transition-colors">
            <span className="text-white text-lg font-bold">AAE</span>
          </div>
        </div>
        <div className="discordChannelList">
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              AAELink Workspace
            </h3>
            <div className="space-y-1">
              {channels.map((channel) => {
                const IconComponent = channel.icon
                return (
                  <button
                    key={channel.id}
                    className={`w-full text-left p-2 text-sm rounded transition-colors flex items-center gap-2 ${
                      channel.active
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                    onClick={() => setActiveChannel(channel.id)}
                  >
                    <IconComponent className="h-4 w-4" />
                    # {channel.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="discord-main">
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-white">#{activeChannel}</h1>
              <div className="flex items-center gap-2">
                {tabs.map((tab) => (
                  <Button
                    key={tab.id}
                    variant={activeTab === tab.id ? "aae" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab(tab.id)}
                    className="text-white"
                  >
                    <tab.icon className="h-4 w-4 mr-2" />
                    {tab.name}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-64 bg-gray-700 border-gray-600 text-white"
                />
              </div>
              <button className="p-2 text-gray-400 hover:text-gray-300 relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
              </button>
              <div className="text-sm text-gray-300">
                Welcome, <span className="font-medium text-white">Admin User</span>
              </div>
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="text-white hover:bg-gray-700"
              >
                Logout
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'messages' && (
            <ChatWindow
              channelName={activeChannel}
              channelId={activeChannel}
              messages={messages}
              onSendMessage={handleSendMessage}
              onSendFile={handleFileUpload}
              onReaction={handleReaction}
              onReply={(messageId) => console.log('Reply to:', messageId)}
              onShare={(messageId) => console.log('Share:', messageId)}
              isConnected={true}
            />
          )}

          {activeTab === 'files' && (
            <div className="p-6">
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-white">File Management</h2>
                <Card className="p-6">
                  <FileUpload
                    onFileUpload={handleFileUpload}
                    maxFiles={10}
                    maxSize={50}
                  />
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'calendar' && (
            <div className="p-6">
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Calendar</h2>
                <Card className="p-6">
                  <div className="text-center py-12">
                    <Calendar className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">Calendar Coming Soon</h3>
                    <p className="text-gray-500">Calendar integration will be available soon.</p>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'teams' && (
            <div className="p-6">
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Teams</h2>
                <Card className="p-6">
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">Team Management Coming Soon</h3>
                    <p className="text-gray-500">Team management features will be available soon.</p>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="p-6">
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Settings</h2>
                <Card className="p-6">
                  <div className="text-center py-12">
                    <Settings className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">Settings Coming Soon</h3>
                    <p className="text-gray-500">Settings panel will be available soon.</p>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Panel */}
      <div className="discordUserPanel">
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Online
          </h3>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-300">Admin User</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-yellow-500 rounded-full"></div>
              <span className="text-sm text-gray-300">John Doe</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gray-500 rounded-full"></div>
              <span className="text-sm text-gray-300">Alice Smith</span>
            </div>
          </div>
        </div>
      </div>

      <Toaster />
    </div>
  )
}

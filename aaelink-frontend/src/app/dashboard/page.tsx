'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Search, Settings, LogOut, MessageCircle, Video, FileText, Calendar, Users, Store } from 'lucide-react'

export default function DashboardPage() {
  const [activeChannel, setActiveChannel] = useState('general')
  const [messages, setMessages] = useState([
    {
      id: 1,
      user: 'John Doe',
      avatar: 'JD',
      message: "Hey, how's the project going?",
      time: '2m ago',
      color: 'bg-blue-600'
    },
    {
      id: 2,
      user: 'Alice Smith',
      avatar: 'AS',
      message: 'Can we schedule a meeting for tomorrow?',
      time: '5m ago',
      color: 'bg-green-500'
    }
  ])
  const router = useRouter()

  const handleLogout = () => {
    router.push('/')
  }

  const channels = [
    { id: 'general', name: 'general', active: true },
    { id: 'video-calls', name: 'video-calls', active: false },
    { id: 'files', name: 'files', active: false },
    { id: 'search', name: 'search', active: false },
    { id: 'calendar', name: 'calendar', active: false },
    { id: 'teams', name: 'teams', active: false },
    { id: 'marketplace', name: 'marketplace', active: false }
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
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  className={`w-full text-left p-2 text-sm rounded transition-colors ${
                    channel.active
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                  onClick={() => setActiveChannel(channel.id)}
                >
                  # {channel.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="discord-main">
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-white"># messages</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button className="p-2 text-gray-400 hover:text-gray-300 relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
              </button>
              <div className="text-sm text-gray-300">
                Welcome, <span className="font-medium text-white">Admin User</span>
              </div>
              <button 
                className="telegramButton telegramButtonSecondary"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
        <div className="discordContent">
          <div className="p-6">
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-white">Messages</h2>
              <div className="telegramCard">
                <div className="space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <div className={`w-10 h-10 ${msg.color} rounded-full flex items-center justify-center`}>
                        <span className="text-white text-sm font-bold">{msg.avatar}</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{msg.user}</h3>
                        <p className="text-sm text-gray-600">{msg.message}</p>
                      </div>
                      <span className="text-xs text-gray-500">{msg.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
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
    </div>
  )
}
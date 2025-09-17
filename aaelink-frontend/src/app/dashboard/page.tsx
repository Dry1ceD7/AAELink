'use client'

import { Bell, Camera, CameraOff, Download, FileText, MessageCircle, Mic, MicOff, Monitor, Search, Settings, Share2, Upload, Users, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';


export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('messages')
  const [isInCall, setIsInCall] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOn, setIsVideoOn] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 767)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('aaelink_authenticated')
    router.push('/')
  }

  const handleCall = () => {
    setIsInCall(!isInCall)
  }

  const handleScreenShare = () => {
    setIsScreenSharing(!isScreenSharing)
  }

  const handleMute = () => {
    setIsMuted(!isMuted)
  }

  const handleVideo = () => {
    setIsVideoOn(!isVideoOn)
  }

  if (isMobile) {
    return (
      <div className="mobileLayout">
        {/* Mobile Header */}
        <div className="mobileHeader">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center mr-3">
                <span className="text-white text-sm font-bold">AAE</span>
              </div>
              <h1 className="text-lg font-semibold text-gray-900">AAELink</h1>
            </div>
            <div className="flex items-center space-x-2">
              <button className="p-2 text-gray-400 hover:text-gray-600 relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
              </button>
              <button
                onClick={handleLogout}
                className={`"telegramMobileButton telegramMobileButtonSecondary"`}
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Content */}
        <div className="mobileContent">
          <div className="lineMobileCard">
            <h2 className="text-xl font-bold text-gray-900 mb-4">AAELink Workspace</h2>
            <p className="text-gray-600 mb-6">Welcome to your enterprise workspace portal</p>

            {/* Mobile Tab Content */}
            {activeTab === 'messages' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Messages</h3>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                    <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-sm font-bold">JD</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">John Doe</h4>
                      <p className="text-sm text-gray-600">Hey, how's the project going?</p>
                    </div>
                    <span className="text-xs text-gray-500">2m ago</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Bottom Navigation */}
        <div className="mobileBottomNav">
          <div className="mobileBottomNavItems">
            <button
              onClick={() => setActiveTab('messages')}
              className={`"mobileBottomNavItem" ${activeTab === 'messages' ? 'active' : ''}`}
            >
              <MessageCircle className="mobileBottomNavIcon" />
              <span className="mobileBottomNavLabel">Chats</span>
            </button>
            <button
              onClick={() => setActiveTab('calls')}
              className={`"mobileBottomNavItem" ${activeTab === 'calls' ? 'active' : ''}`}
            >
              <Video className="mobileBottomNavIcon" />
              <span className="mobileBottomNavLabel">Calls</span>
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`"mobileBottomNavItem" ${activeTab === 'files' ? 'active' : ''}`}
            >
              <FileText className="mobileBottomNavIcon" />
              <span className="mobileBottomNavLabel">Files</span>
            </button>
            <button
              onClick={() => setActiveTab('teams')}
              className={`"mobileBottomNavItem" ${activeTab === 'teams' ? 'active' : ''}`}
            >
              <Users className="mobileBottomNavIcon" />
              <span className="mobileBottomNavLabel">Teams</span>
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`"mobileBottomNavItem" ${activeTab === 'profile' ? 'active' : ''}`}
            >
              <Settings className="mobileBottomNavIcon" />
              <span className="mobileBottomNavLabel">Profile</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="discordLayout">
      {/* Discord Sidebar */}
      <div className="discordSidebar">
        {/* Server List */}
        <div className="discordServerList">
          <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mb-2 cursor-pointer hover:bg-blue-700 transition-colors">
            <span className="text-white text-lg font-bold">AAE</span>
          </div>
        </div>

        {/* Channel List */}
        <div className="discordChannelList">
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">AAELink Workspace</h3>
            <div className="space-y-1">
              <button
                onClick={() => setActiveTab('messages')}
                className={`w-full text-left p-2 text-sm rounded transition-colors ${
                  activeTab === 'messages'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                # general
              </button>
              <button
                onClick={() => setActiveTab('calls')}
                className={`w-full text-left p-2 text-sm rounded transition-colors ${
                  activeTab === 'calls'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                # video-calls
              </button>
              <button
                onClick={() => setActiveTab('files')}
                className={`w-full text-left p-2 text-sm rounded transition-colors ${
                  activeTab === 'files'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                # files
              </button>
              <button
                onClick={() => setActiveTab('search')}
                className={`w-full text-left p-2 text-sm rounded transition-colors ${
                  activeTab === 'search'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                # search
              </button>
              <button
                onClick={() => setActiveTab('calendar')}
                className={`w-full text-left p-2 text-sm rounded transition-colors ${
                  activeTab === 'calendar'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                # calendar
              </button>
              <button
                onClick={() => setActiveTab('teams')}
                className={`w-full text-left p-2 text-sm rounded transition-colors ${
                  activeTab === 'teams'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                # teams
              </button>
              <button
                onClick={() => setActiveTab('marketplace')}
                className={`w-full text-left p-2 text-sm rounded transition-colors ${
                  activeTab === 'marketplace'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                # marketplace
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="discord-main">
        {/* Header */}
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-white">#{activeTab}</h1>
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
                onClick={handleLogout}
                className={`"telegramButton telegramButtonSecondary"`}
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="discordContent">
          <div className="p-6">
            {activeTab === 'messages' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Messages</h2>
                <div className="telegramCard">
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-bold">JD</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">John Doe</h3>
                        <p className="text-sm text-gray-600">Hey, how's the project going?</p>
                      </div>
                      <span className="text-xs text-gray-500">2m ago</span>
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                      <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-bold">AS</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">Alice Smith</h3>
                        <p className="text-sm text-gray-600">Can we schedule a meeting for tomorrow?</p>
                      </div>
                      <span className="text-xs text-gray-500">5m ago</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'calls' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">Video Calls</h2>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="text-center">
                    <div className="w-32 h-32 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                      <Video className="h-16 w-16 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Start a Video Call</h3>
                    <p className="text-gray-600 mb-6">Connect with your team members instantly</p>
                    <button
                      onClick={handleCall}
                      className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                        isInCall
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {isInCall ? 'End Call' : 'Start Call'}
                    </button>
                  </div>

                  {isInCall && (
                    <div className="mt-8 bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium text-gray-900">Call Controls</h4>
                        <div className="flex space-x-2">
                          <button
                            onClick={handleMute}
                            className={`p-2 rounded-full ${
                              isMuted ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700'
                            }`}
                          >
                            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                          </button>
                          <button
                            onClick={handleVideo}
                            className={`p-2 rounded-full ${
                              isVideoOn ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                            }`}
                          >
                            {isVideoOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
                          </button>
                          <button
                            onClick={handleScreenShare}
                            className={`p-2 rounded-full ${
                              isScreenSharing ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700'
                            }`}
                          >
                            <Monitor className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">
                        <p>Call Duration: 00:05:23</p>
                        <p>Participants: 3</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'files' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">Files</h2>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Recent Files</h3>
                    <div className="flex space-x-2">
                      <button className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        <Upload className="h-4 w-4 mr-2" />
                        Upload
                      </button>
                      <button className="flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <FileText className="h-5 w-5 text-blue-500" />
                        <div>
                          <p className="font-medium text-gray-900">Project Proposal.pdf</p>
                          <p className="text-sm text-gray-600">2.3 MB • Modified 2 hours ago</p>
                        </div>
                      </div>
                      <button className="text-gray-400 hover:text-gray-600">
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <FileText className="h-5 w-5 text-green-500" />
                        <div>
                          <p className="font-medium text-gray-900">Meeting Notes.docx</p>
                          <p className="text-sm text-gray-600">1.1 MB • Modified 1 day ago</p>
                        </div>
                      </div>
                      <button className="text-gray-400 hover:text-gray-600">
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'search' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">Search</h2>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search messages, files, and more..."
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="mt-6">
                    <h3 className="font-medium text-gray-900 mb-3">Recent Searches</h3>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                        <Search className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700">project timeline</span>
                      </div>
                      <div className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                        <Search className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700">meeting notes</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'calendar' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">Calendar</h2>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="grid grid-cols-7 gap-4 mb-4">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                      <div key={day} className="text-center font-medium text-gray-700 py-2">
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-4">
                    {Array.from({ length: 35 }, (_, i) => (
                      <div
                        key={i}
                        className={`h-20 border border-gray-200 rounded-lg p-2 ${
                          i === 15 ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="text-sm font-medium">{i + 1}</div>
                        {i === 15 && (
                          <div className="text-xs mt-1">Team Meeting</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'teams' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">Teams</h2>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
                      <h3 className="font-medium text-gray-900 mb-2">Development Team</h3>
                      <p className="text-sm text-gray-600 mb-3">5 members</p>
                      <div className="flex -space-x-2">
                        {Array.from({ length: 5 }, (_, i) => (
                          <div
                            key={i}
                            className="w-8 h-8 bg-gray-300 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium"
                          >
                            {i + 1}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
                      <h3 className="font-medium text-gray-900 mb-2">Design Team</h3>
                      <p className="text-sm text-gray-600 mb-3">3 members</p>
                      <div className="flex -space-x-2">
                        {Array.from({ length: 3 }, (_, i) => (
                          <div
                            key={i}
                            className="w-8 h-8 bg-gray-300 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium"
                          >
                            {i + 1}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'marketplace' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">Marketplace</h2>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
                      <div className="w-full h-32 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg mb-3"></div>
                      <h3 className="font-medium text-gray-900 mb-2">Professional Theme</h3>
                      <p className="text-sm text-gray-600 mb-3">Clean and modern design</p>
                      <button className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700">
                        Install
                      </button>
                    </div>
                    <div className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
                      <div className="w-full h-32 bg-gradient-to-br from-green-500 to-teal-600 rounded-lg mb-3"></div>
                      <h3 className="font-medium text-gray-900 mb-2">Nature Theme</h3>
                      <p className="text-sm text-gray-600 mb-3">Calm and refreshing</p>
                      <button className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700">
                        Install
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* User Panel */}
      <div className="discordUserPanel">
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Online</h3>
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

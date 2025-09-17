'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    // Simulate authentication
    if (usernameOrEmail === 'admin' || usernameOrEmail === 'admin@aae.co.th') {
      if (password === '12345678') {
        // Redirect to dashboard
        router.push('/dashboard')
        return
      }
    }

    // Show error (in a real app, you'd show a proper error message)
    alert('Invalid credentials. Use admin/admin@aae.co.th and password 12345678')
    setIsLoading(false)
  }

  const handlePasskeyLogin = () => {
    // Simulate passkey authentication
    alert('Passkey authentication would be implemented here')
  }

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
              <div className="p-2 text-sm text-gray-300 hover:bg-gray-700 rounded cursor-pointer">
                # general
              </div>
              <div className="p-2 text-sm text-gray-300 hover:bg-gray-700 rounded cursor-pointer">
                # announcements
              </div>
              <div className="p-2 text-sm text-gray-300 hover:bg-gray-700 rounded cursor-pointer">
                # development
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="discordMain">
        <div className="discordContent">
          <div className="max-w-md mx-auto">
            <div className="text-center mb-8 animateFadeIn">
              <div className="mx-auto w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mb-4">
                <span className="text-white text-2xl font-bold">AAE</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900">AAELink</h1>
              <p className="text-gray-600 mt-2">Advanced ID Asia Engineering Co.,Ltd</p>
              <p className="text-sm text-gray-500 mt-1">Enterprise Workspace Portal</p>
            </div>

            <div className="telegramCard animateSlideIn">
              <div className="p-6 text-center">
                <h2 className="text-xl font-semibold text-gray-900">Sign In</h2>
                <p className="text-sm text-gray-600 mt-1">Enter your credentials to access AAELink</p>
              </div>
              <div className="px-6 pb-6">
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Username or Email
                    </label>
                    <input
                      type="text"
                      className="telegramInput"
                      value={usernameOrEmail}
                      onChange={(e) => setUsernameOrEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      className="telegramInput"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-3">
                    <button
                      type="submit"
                      className="telegramButton w-full"
                      disabled={isLoading}
                    >
                      {isLoading ? 'Signing In...' : 'Sign In to AAELink'}
                    </button>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-gray-300"></span>
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-white px-2 text-gray-500">Or</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="telegramButton telegramButtonSecondary w-full"
                      onClick={handlePasskeyLogin}
                    >
                      🔐 Login with Passkey
                    </button>
                  </div>
                </form>
                <div className="mt-6 p-3 bg-gray-50 rounded-md">
                  <p className="text-xs text-gray-600 text-center">
                    🔒 Secure AAELink access only. Authorized AAE personnel only.
                  </p>
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
          </div>
        </div>
      </div>
    </div>
  )
}
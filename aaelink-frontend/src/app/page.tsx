'use client'

import { useEffect, useState } from 'react'


export default function LoginPage() {
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 767)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    // Simulate API call
    setTimeout(() => {
      if ((usernameOrEmail === 'admin' || usernameOrEmail === 'admin@aae.co.th') && password === '12345678') {
        showToast('Login successful! Redirecting to AAELink dashboard...', 'success')
        localStorage.setItem('aaelink_authenticated', 'true')
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 500)
      } else {
        showToast('Invalid credentials. Please try again.', 'error')
        setIsLoading(false)
      }
    }, 500)
  }

  const handlePasskeyLogin = async () => {
    setIsLoading(true)
    showToast('Passkey authentication initiated...', 'info')

    // Simulate passkey flow
    setTimeout(() => {
      showToast('Passkey authentication successful! Redirecting to AAELink dashboard...', 'success')
      localStorage.setItem('aaelink_authenticated', 'true')
      setTimeout(() => {
        window.location.href = '/dashboard'
      }, 500)
    }, 1000)
  }

  if (isMobile) {
    return (
      <div className="mobileLayout">
        {/* Mobile Header */}
        <div className="mobileHeader">
          <div className="flex items-center justify-center">
            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mr-3">
              <span className="text-white text-lg font-bold">AAE</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">AAELink</h1>
              <p className="text-xs text-gray-600">Enterprise Workspace</p>
            </div>
          </div>
        </div>

        {/* Mobile Content */}
        <div className="mobileContent">
          <div className={`"lineMobileCard lineMobileCardBlue"`}>
            <div className="text-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome Back</h2>
              <p className="text-sm text-gray-600">Sign in to your AAELink account</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Username or Email
                </label>
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  className="telegramMobileInput"
                  placeholder="Enter your username or email"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="telegramMobileInput"
                  placeholder="Enter your password"
                  required
                />
              </div>

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={isLoading}
                  className={`"telegramMobileButton telegramMobileButtonLarge" w-full`}
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
                  onClick={handlePasskeyLogin}
                  disabled={isLoading}
                  className={`"telegramMobileButton telegramMobileButtonSecondary" w-full`}
                >
                  🔐 Login with Passkey
                </button>
              </div>
            </form>

            {/* Security Notice */}
            <div className="mt-6 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600 text-center">
                🔒 Secure AAELink access only. Authorized AAE personnel only.
              </p>
            </div>
          </div>
        </div>

        {/* Toast Notification */}
        {toast && (
          <div className="fixed top-4 right-4 z-50 animate-fade-in">
            <div className={`px-4 py-2 rounded-lg shadow-lg text-white ${
              toast.type === 'success' ? 'bg-green-500' :
              toast.type === 'error' ? 'bg-red-500' :
              'bg-blue-500'
            }`}>
              {toast.message}
            </div>
          </div>
        )}
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
            {/* AAELink Logo */}
            <div className={`text-center mb-8 "animateFadeIn"`}>
              <div className="mx-auto w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mb-4">
                <span className="text-white text-2xl font-bold">AAE</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900">AAELink</h1>
              <p className="text-gray-600 mt-2">Advanced ID Asia Engineering Co.,Ltd</p>
              <p className="text-sm text-gray-500 mt-1">Enterprise Workspace Portal</p>
            </div>

            {/* Login Form */}
            <div className={`"telegramCard animateSlideIn"`}>
              <div className="p-6 text-center">
                <h2 className="text-xl font-semibold text-gray-900">Sign In</h2>
                <p className="text-sm text-gray-600 mt-1">Enter your credentials to access AAELink</p>
              </div>

              <div className="px-6 pb-6">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Username or Email
                    </label>
                    <input
                      type="text"
                      value={usernameOrEmail}
                      onChange={(e) => setUsernameOrEmail(e.target.value)}
                      className="telegramInput"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="telegramInput"
                      required
                    />
                  </div>

                  <div className="space-y-3">
                    <button
                      type="submit"
                      disabled={isLoading}
                      className={`$"telegramButton" w-full`}
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
                      onClick={handlePasskeyLogin}
                      disabled={isLoading}
                      className={`"telegramButton telegramButtonSecondary" w-full`}
                    >
                      🔐 Login with Passkey
                    </button>
                  </div>
                </form>

                {/* Security Notice */}
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
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Online</h3>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-300">Admin User</span>
            </div>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 "animateFadeIn"`}>
          <div className={`px-4 py-2 rounded-md shadow-lg text-white ${
            toast.type === 'success' ? 'bg-green-500' :
            toast.type === 'error' ? 'bg-red-500' :
            'bg-blue-500'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import LanguageSelector from '../components/LanguageSelector';
import { Logo } from '../components/Logo';
import WebAuthnLogin from '../components/WebAuthnLogin';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('admin@aae.co.th');
  const [password, setPassword] = useState('12345678');
  const [isRegistering, setIsRegistering] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showWebAuthn, setShowWebAuthn] = useState(false);

  const { login, register } = useAuth();
  const { theme, seniorMode, toggleTheme, setSeniorMode } = useTheme();
  const { success, error } = useToast();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let successResult = false;

        if (isRegistering) {
          successResult = await register(email, password, displayName);
          if (successResult) {
            success(t('auth.registerSuccess'));
          } else {
            error(t('auth.registerFailed', 'Registration failed. Please try again.'));
          }
        } else {
          successResult = await login(email, password);
          if (successResult) {
            success(t('auth.loginSuccess'));
          } else {
            error(t('auth.loginFailed', 'Login failed. Please check your credentials.'));
          }
        }

      if (successResult) {
        navigate('/');
      }
    } catch (err) {
      error('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center p-4">
      {/* Theme and Settings Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LanguageSelector showLabel={false} className="w-32" />
        <button
          onClick={toggleTheme}
          className="p-2 text-white/80 hover:text-white bg-white/10 rounded-md hover:bg-white/20 transition-colors"
          title={`Current theme: ${theme}`}
        >
          {theme === 'light' && '☀️'}
          {theme === 'dark' && '🌙'}
          {theme === 'high-contrast' && '🔆'}
        </button>

        <button
          onClick={() => setSeniorMode(!seniorMode)}
          className={`p-2 rounded-md transition-colors ${
            seniorMode
              ? 'text-white bg-white/20'
              : 'text-white/80 bg-white/10 hover:bg-white/20'
          }`}
          title={seniorMode ? 'Disable Senior Mode' : 'Enable Senior Mode'}
        >
          👴
        </button>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <Logo variant="text" size="lg" className="mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              AAELink
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              {t('common.enterprisePlatform', 'Enterprise Workspace Platform')}
            </p>
          </div>

          {/* WebAuthn Section */}
          {showWebAuthn ? (
            <WebAuthnLogin
              onSuccess={() => navigate('/')}
              onError={(err) => console.error('WebAuthn error:', err)}
            />
          ) : (
            <>
              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('auth.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="admin@aae.co.th"
                required
                disabled={loading}
              />
            </div>

            {/* Display Name Input (for registration) */}
            {isRegistering && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('auth.displayName')}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Your display name"
                  required={isRegistering}
                  disabled={loading}
                />
              </div>
            )}

            {/* Password Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('auth.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="Enter your password"
                required
                disabled={loading}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                  {isRegistering ? t('auth.creatingAccount', 'Creating Account...') : t('auth.signingIn', 'Signing In...')}
                </span>
              ) : (
                isRegistering ? t('auth.register') : t('auth.login')
              )}
            </button>

            {/* Toggle between login and register */}
            <div className="text-center">
              <button
                type="button"
                onClick={() => setIsRegistering(!isRegistering)}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
                disabled={loading}
              >
                {isRegistering
                  ? 'Already have an account? Sign in'
                  : 'Need an account? Create one'}
              </button>
            </div>
          </form>

          {/* Toggle between email/password and WebAuthn */}
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowWebAuthn(!showWebAuthn)}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 focus:outline-none"
              >
                {showWebAuthn
                  ? 'Use email and password instead'
                  : 'Use passkey authentication instead'}
              </button>
            </div>
          </div>
            </>
          )}

          {/* Demo Info */}
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-md">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Demo Account:</strong><br />
              Email: admin@aae.co.th<br />
              Password: 12345678
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

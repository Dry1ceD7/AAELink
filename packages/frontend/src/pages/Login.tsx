/**
 * AAELink Login Page
 * WebAuthn (Passkey) Authentication
 * BMAD Method: Security-first, accessible login
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const { success: showSuccess, error: showError, warning: showWarning } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Handle user registration
   */
  const handleRegister = async () => {
    if (!email || !password || !displayName) {
      showError('Please fill in all fields');
      return;
    }

    if (password.length < 8) {
      showError('Password must be at least 8 characters long');
      return;
    }

    setIsLoading(true);

    try {
      const success = await register(email, password, displayName);
      
      if (success) {
        showSuccess('Registration successful! Welcome to AAELink!');
        navigate('/');
      } else {
        showError('Registration failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Registration error:', err);
      showError(err.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle user authentication
   */
  const handleAuthenticate = async () => {
    if (!email || !password) {
      showError('Please enter both email and password');
      return;
    }

    setIsLoading(true);

    try {
      const success = await login(email, password);
      
      if (success) {
        showSuccess('Login successful! Welcome back!');
        navigate('/');
      } else {
        showError('Invalid email or password. Please try again.');
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      showError(err.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-700 dark:from-blue-900 dark:to-purple-900 p-4">
      {/* Top bar with theme and language controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSelector />
      </div>

      {/* Login card - centered both axes, max width constrained */}
      <Card className="w-full max-w-md p-8 bg-white dark:bg-gray-800 shadow-2xl">
        {/* Logo and title */}
        <div className="text-center mb-8">
          <Logo variant="text" size="lg" className="mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            {t('login.subtitle')}
          </p>
        </div>

        {/* Login form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isRegistering) {
              handleRegister();
            } else {
              handleAuthenticate();
            }
          }}
          className="space-y-6"
        >
          {/* Email input */}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Email
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              disabled={isLoading}
              autoComplete="email"
              className="w-full"
              aria-label="Email"
            />
          </div>

          {/* Password input */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              disabled={isLoading}
              autoComplete={isRegistering ? "new-password" : "current-password"}
              className="w-full"
              aria-label="Password"
            />
          </div>

          {/* Display name input (only for registration) */}
          {isRegistering && (
            <div>
              <label
                htmlFor="displayName"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Full Name
              </label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your full name"
                required={isRegistering}
                disabled={isLoading}
                autoComplete="name"
                className="w-full"
                aria-label="Full Name"
              />
            </div>
          )}

          {/* Submit button */}
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                Loading...
              </span>
            ) : isRegistering ? (
              'Create Account'
            ) : (
              'Sign In'
            )}
          </Button>

          {/* Toggle between sign in and register */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
              disabled={isLoading}
            >
              {isRegistering
                ? 'Already have an account? Sign in'
                : 'Need an account? Sign up'}
            </button>
          </div>
        </form>

        {/* Help text */}
        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-center text-gray-600 dark:text-gray-400">
            Secure access to AAELink workspace
          </p>
          <p className="text-sm text-center mt-2">
            <a
              href="mailto:it@company.com"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Contact IT Support
            </a>
          </p>
        </div>
      </Card>

      {/* Footer */}
      <div className="absolute bottom-4 text-center text-white/80 text-sm">
        <p>© 2024 Advanced ID Asia Engineering Co., Ltd.</p>
      </div>
    </div>
  );
};


export default LoginPage;

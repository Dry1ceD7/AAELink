/**
 * AAELink Login Page
 * WebAuthn (Passkey) Authentication
 * BMAD Method: Security-first, accessible login
 */

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { Logo } from '../components/ui/Logo';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { toast } from '../hooks/useToast';
import { api } from '../services/api';
import { useAuthStore } from '../stores/authStore';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setUser, setAuthenticated } = useAuthStore();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Handle WebAuthn registration
   */
  const handleRegister = async () => {
    if (!email || !displayName) {
      toast({
        title: t('login.error'),
        description: t('login.fillAllFields'),
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      // Get registration options from server
      const optionsResponse = await api.post('/auth/webauthn/register/options', {
        email,
        displayName,
      });

      // Start WebAuthn registration
      const attestation = await startRegistration(optionsResponse.data);

      // Verify with server
      const verifyResponse = await api.post('/auth/webauthn/register/verify', {
        email,
        displayName,
        response: attestation,
      });

      if (verifyResponse.data.ok) {
        setUser(verifyResponse.data.user);
        setAuthenticated(true);

        toast({
          title: t('login.success'),
          description: t('login.registrationComplete'),
        });

        navigate('/');
      }
    } catch (error: any) {
      console.error('Registration error:', error);

      toast({
        title: t('login.error'),
        description: error.message || t('login.registrationFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle WebAuthn authentication
   */
  const handleAuthenticate = async () => {
    if (!email) {
      toast({
        title: t('login.error'),
        description: t('login.enterEmail'),
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      // Get authentication options from server
      const optionsResponse = await api.post('/auth/webauthn/authenticate/options', {
        email,
      });

      // Start WebAuthn authentication
      const assertion = await startAuthentication(optionsResponse.data);

      // Verify with server
      const verifyResponse = await api.post('/auth/webauthn/authenticate/verify', {
        email,
        response: assertion,
      });

      if (verifyResponse.data.ok) {
        setUser(verifyResponse.data.user);
        setAuthenticated(true);

        toast({
          title: t('login.success'),
          description: t('login.welcomeBack'),
        });

        navigate('/');
      }
    } catch (error: any) {
      console.error('Authentication error:', error);

      // Check if user needs to register first
      if (error.response?.data?.error === 'No passkeys registered') {
        setIsRegistering(true);
        toast({
          title: t('login.noPasskeys'),
          description: t('login.pleaseRegister'),
          variant: 'warning',
        });
      } else {
        toast({
          title: t('login.error'),
          description: error.message || t('login.authenticationFailed'),
          variant: 'destructive',
        });
      }
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
          <Logo className="w-20 h-20 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            AAELink
          </h1>
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
              {t('login.email')}
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
              aria-label={t('login.email')}
            />
          </div>

          {/* Display name input (only for registration) */}
          {isRegistering && (
            <div>
              <label
                htmlFor="displayName"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                {t('login.displayName')}
              </label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('login.displayNamePlaceholder')}
                required={isRegistering}
                disabled={isLoading}
                autoComplete="name"
                className="w-full"
                aria-label={t('login.displayName')}
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
                {t('login.loading')}
              </span>
            ) : isRegistering ? (
              <>
                <KeyIcon className="w-5 h-5 mr-2" />
                {t('login.registerWithPasskey')}
              </>
            ) : (
              <>
                <KeyIcon className="w-5 h-5 mr-2" />
                {t('login.signInWithPasskey')}
              </>
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
                ? t('login.alreadyHaveAccount')
                : t('login.needToRegister')}
            </button>
          </div>
        </form>

        {/* Help text */}
        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-center text-gray-600 dark:text-gray-400">
            {t('login.helpText')}
          </p>
          <p className="text-sm text-center mt-2">
            <a
              href="mailto:it@company.com"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('login.contactIT')}
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

// Key icon component
const KeyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
    />
  </svg>
);

export default LoginPage;

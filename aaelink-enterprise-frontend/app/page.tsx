'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Lock, Shield, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      toast.error('Please enter both username and password');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Login successful');
        router.push('/dashboard');
      } else {
        toast.error(data.message || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('An error occurred during login');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    try {
      // WebAuthn implementation will go here
      toast.info('Passkey authentication coming soon');
    } catch (error) {
      console.error('Passkey error:', error);
      toast.error('Passkey authentication failed');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-aae-blue-900 via-aae-blue-800 to-aae-blue-700 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md mx-auto sm:max-w-lg lg:max-w-xl">
        {/* Logo and Branding */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="mx-auto w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 bg-white rounded-full flex items-center justify-center mb-4 shadow-lg">
            <span className="text-aae-blue-600 text-xl sm:text-2xl lg:text-3xl font-bold">AAE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-2">AAELink Enterprise</h1>
          <p className="text-aae-blue-100 text-xs sm:text-sm lg:text-base">Advanced ID Asia Engineering Co.,Ltd</p>
          <p className="text-aae-blue-200 text-xs sm:text-sm mt-1">Secure Enterprise Workspace Portal</p>
        </div>

        {/* Login Form */}
        <Card className="telegram-card animate-slide-in shadow-xl">
          <CardHeader className="text-center pb-4 px-4 sm:px-6">
            <CardTitle className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center justify-center gap-2">
              <Shield className="h-4 w-4 sm:h-5 sm:w-5 text-aae-blue-600" />
              Secure Access
            </CardTitle>
            <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
              Enter your credentials to access AAELink
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 px-4 sm:px-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Username or Email
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10"
                    placeholder="Enter username or email"
                    required
                    disabled={isLoading}
                    aria-label="Username or Email"
                    aria-describedby="username-help"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    placeholder="Enter password"
                    required
                    disabled={isLoading}
                    aria-label="Password"
                    aria-describedby="password-help"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full telegram-button"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Signing In...
                  </div>
                ) : (
                  'Sign In to AAELink'
                )}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white dark:bg-gray-800 px-2 text-gray-500 dark:text-gray-400">
                  Or
                </span>
              </div>
            </div>

            <Button
              type="button"
              className="w-full telegram-button-secondary"
              onClick={handlePasskeyLogin}
              disabled={isLoading}
            >
              <Shield className="h-4 w-4 mr-2" />
              Login with Passkey
            </Button>
          </CardContent>
        </Card>

        {/* Security Notice */}
        <div className="mt-6 p-3 sm:p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
          <div className="flex items-start gap-2 sm:gap-3">
            <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-aae-blue-200 mt-0.5 flex-shrink-0" />
            <div className="text-xs sm:text-sm text-aae-blue-100">
              <p className="font-medium mb-1">🔒 Secure AAELink Access</p>
              <p className="text-xs text-aae-blue-200">
                Authorized AAE personnel only. All activities are logged and monitored for security compliance.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 sm:mt-8 text-aae-blue-200 text-xs sm:text-sm">
          <p>© 2024 Advanced ID Asia Engineering Co.,Ltd</p>
          <p className="mt-1">Version 1.2.0 | Local-First Architecture</p>
        </div>
      </div>
    </div>
  );
}

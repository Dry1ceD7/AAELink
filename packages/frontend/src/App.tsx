/**
 * AAELink Main App Component
 * Discord-style layout with Telegram simplicity
 * BMAD Method: UX-first responsive design
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { Suspense, useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/Toaster';
import i18n from './i18n';
import { useAuthStore } from './stores/authStore';
import { useThemeStore } from './stores/themeStore';

// Lazy load major routes
const LoginPage = React.lazy(() => import('./pages/Login'));
const WorkspacePage = React.lazy(() => import('./pages/Workspace'));
const SettingsPage = React.lazy(() => import('./pages/Settings'));
const AdminPage = React.lazy(() => import('./pages/Admin'));

// Create query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

// Loading component
const AppLoader: React.FC = () => (
  <div className="flex items-center justify-center min-h-screen min-h-[100dvh] bg-gradient-to-br from-blue-600 to-purple-700">
    <div className="text-center">
      <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
      <p className="text-white text-lg">Loading AAELink...</p>
    </div>
  </div>
);

// Protected route wrapper
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Admin route wrapper
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useAuthStore((state) => state.user);

  if (!user || !['sysadmin', 'org_admin'].includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

function App() {
  const { theme, seniorMode, initTheme } = useThemeStore();
  const { checkSession } = useAuthStore();

  // Initialize theme and check session on mount
  useEffect(() => {
    initTheme();
    checkSession();

    // Register service worker for PWA
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').then(
        (registration) => {
          console.log('Service Worker registered:', registration);
        },
        (error) => {
          console.error('Service Worker registration failed:', error);
        }
      );
    }
  }, [initTheme, checkSession]);

  // Apply theme and senior mode classes
  useEffect(() => {
    const root = document.documentElement;

    // Remove all theme classes
    root.classList.remove('light', 'dark', 'high-contrast');
    // Add current theme
    root.classList.add(theme);

    // Toggle senior mode
    if (seniorMode) {
      root.classList.add('senior-mode');
    } else {
      root.classList.remove('senior-mode');
    }
  }, [theme, seniorMode]);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <BrowserRouter>
          <Suspense fallback={<AppLoader />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />

              {/* Protected routes */}
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <WorkspacePage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/settings/*"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />

              {/* Admin routes */}
              <Route
                path="/admin/*"
                element={
                  <AdminRoute>
                    <AdminPage />
                  </AdminRoute>
                }
              />

              {/* Default redirect */}
              <Route path="/" element={<Navigate to="/channels" replace />} />
            </Routes>
          </Suspense>

          {/* Global toast notifications */}
          <Toaster />
        </BrowserRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

export default App;

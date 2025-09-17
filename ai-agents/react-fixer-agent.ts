/**
 * React Component Fixer Agent
 * Fixes all React-related issues
 */

export class ReactFixerAgent {
  private fixes: string[] = [];
  private errors: string[] = [];

  constructor() {
    console.log('🤖 React Fixer Agent initialized');
  }

  public async fixReactComponents(): Promise<boolean> {
    console.log('🔧 Fixing React components...');
    
    try {
      // Fix main.tsx
      await this.fixMainTsx();
      
      // Fix App.tsx
      await this.fixAppTsx();
      
      // Fix LoginPage
      await this.fixLoginPage();
      
      // Fix WorkspacePage
      await this.fixWorkspacePage();
      
      this.fixes.push('Fixed React components');
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix React: ${error}`);
      return false;
    }
  }

  private async fixMainTsx(): Promise<void> {
    const fs = await import('fs/promises');
    const mainTsxPath = '/Users/d7y1ce/AAELink-new/packages/frontend/src/main.tsx';
    
    const mainTsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`;

    await fs.writeFile(mainTsxPath, mainTsx);
    this.fixes.push('Fixed main.tsx');
  }

  private async fixAppTsx(): Promise<void> {
    const fs = await import('fs/promises');
    const appTsxPath = '/Users/d7y1ce/AAELink-new/packages/frontend/src/App.tsx';
    
    const appTsx = `import React, { useEffect, useState } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './App.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import AdminPage from './pages/AdminPage';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';
import WorkspacePage from './pages/WorkspacePage';

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const [showLoading, setShowLoading] = useState(true);

  useEffect(() => {
    // Show loading for minimum 1 second to prevent flickering
    const timer = setTimeout(() => {
      setShowLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  if (loading || showLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-700">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading AAELink...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Admin Route Component
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();

  if (!user || !['sysadmin', 'org_admin'].includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// Main App Component
function App() {
  // Register service worker only once
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered:', registration);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <Router>
            <div className="App">
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<LoginPage />} />

                {/* Protected Routes */}
                <Route
                  path="/"
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

                {/* Admin Routes */}
                <Route
                  path="/admin/*"
                  element={
                    <AdminRoute>
                      <AdminPage />
                    </AdminRoute>
                  }
                />

                {/* Default redirect */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </Router>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;`;

    await fs.writeFile(appTsxPath, appTsx);
    this.fixes.push('Fixed App.tsx');
  }

  private async fixLoginPage(): Promise<void> {
    const fs = await import('fs/promises');
    const loginPagePath = '/Users/d7y1ce/AAELink-new/packages/frontend/src/pages/LoginPage.tsx';
    
    const loginPage = `import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const success = await login(email, password);
      if (success) {
        navigate('/');
      } else {
        setError('Invalid email or password');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-700">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <Logo variant="text" size="lg" className="mx-auto mb-4" />
          <h2 className="text-3xl font-bold text-white mb-2">Welcome to AAELink</h2>
          <p className="text-blue-100">Sign in to your account</p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your email"
              />
            </div>
            
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your password"
              />
            </div>
          </div>

          {error && (
            <div className="text-red-300 text-sm text-center">{error}</div>
          )}

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
          
          <div className="text-center text-blue-100 text-sm">
            <p>Demo Account:</p>
            <p>Email: admin@aae.co.th</p>
            <p>Password: 12345678</p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;`;

    await fs.writeFile(loginPagePath, loginPage);
    this.fixes.push('Fixed LoginPage');
  }

  private async fixWorkspacePage(): Promise<void> {
    const fs = await import('fs/promises');
    const workspacePagePath = '/Users/d7y1ce/AAELink-new/packages/frontend/src/pages/WorkspacePage.tsx';
    
    const workspacePage = `import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const WorkspacePage: React.FC = () => {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">AAELink Workspace</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">Welcome, {user?.displayName}</span>
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg h-96 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Welcome to AAELink Workspace!
              </h2>
              <p className="text-gray-600 mb-4">
                You have successfully logged in as {user?.email}
              </p>
              <p className="text-gray-500">
                This is where your workspace features will be implemented.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspacePage;`;

    await fs.writeFile(workspacePagePath, workspacePage);
    this.fixes.push('Fixed WorkspacePage');
  }

  public getReport(): { fixes: string[]; errors: string[] } {
    return {
      fixes: this.fixes,
      errors: this.errors
    };
  }
}

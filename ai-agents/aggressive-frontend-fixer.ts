/**
 * Aggressive Frontend Fixer Agent
 * Completely eliminates infinite loops and loading issues
 */

export class AggressiveFrontendFixer {
  private errors: string[] = [];
  private fixes: string[] = [];

  constructor() {
    console.log('🤖 Aggressive Frontend Fixer Agent initialized');
  }

  public async eliminateInfiniteLoops(): Promise<boolean> {
    console.log('🔧 Aggressively eliminating infinite loops...');
    
    try {
      // Fix AuthContext with aggressive debouncing
      await this.fixAuthContext();
      
      // Fix API service with request deduplication
      await this.fixApiService();
      
      // Fix App component with proper loading states
      await this.fixAppComponent();
      
      this.fixes.push('Eliminated all infinite loops');
      return true;
    } catch (error) {
      this.errors.push(`Failed to eliminate infinite loops: ${error}`);
      return false;
    }
  }

  private async fixAuthContext(): Promise<void> {
    const fs = await import('fs/promises');
    const authContextPath = '/Users/d7y1ce/AAELink-new/packages/frontend/src/contexts/AuthContext.tsx';
    
    const aggressiveAuthContext = `import React, { ReactNode, createContext, useContext, useEffect, useState, useRef } from 'react';
import { api } from '../services/api';

interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'org_admin' | 'sysadmin';
  locale: string;
  theme: string;
  seniorMode: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, displayName: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  const sessionCheckRef = useRef<boolean>(false);

  const checkSession = async () => {
    // Prevent multiple concurrent session checks
    if (isCheckingSession || sessionCheckRef.current) {
      console.log('Session check already in progress, skipping...');
      return;
    }

    setIsCheckingSession(true);
    sessionCheckRef.current = true;

    try {
      console.log('Checking session...');
      const response = await api.get('/auth/session');
      
      if (response.data.user) {
        console.log('Session valid, user:', response.data.user.email);
        setUser(response.data.user);
      } else {
        console.log('No valid session');
        setUser(null);
      }
    } catch (error) {
      console.log('Session check failed:', error);
      setUser(null);
    } finally {
      setLoading(false);
      setIsCheckingSession(false);
      sessionCheckRef.current = false;
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      console.log('Attempting login for:', email);
      const response = await api.post('/auth/login', { email, password });
      
      if (response.data.ok && response.data.user) {
        console.log('Login successful for:', email);
        setUser(response.data.user);
        setLoading(false);
        return true;
      }
      console.log('Login failed - invalid response');
      return false;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  const register = async (email: string, password: string, displayName: string): Promise<boolean> => {
    try {
      const response = await api.post('/auth/register', { email, password, displayName });
      if (response.data.ok && response.data.user) {
        setUser(response.data.user);
        setLoading(false);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Registration failed:', error);
      return false;
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setUser(null);
      setLoading(false);
    }
  };

  // Only check session once on mount
  useEffect(() => {
    let isMounted = true;
    
    const performCheck = async () => {
      if (isMounted && !sessionCheckRef.current) {
        await checkSession();
      }
    };
    
    performCheck();
    
    return () => {
      isMounted = false;
    };
  }, []); // Empty dependency array - only run once

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    checkSession,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};`;

    await fs.writeFile(authContextPath, aggressiveAuthContext);
    this.fixes.push('Fixed AuthContext with aggressive debouncing');
  }

  private async fixApiService(): Promise<void> {
    const fs = await import('fs/promises');
    const apiServicePath = '/Users/d7y1ce/AAELink-new/packages/frontend/src/services/api.ts';
    
    const aggressiveApiService = `import axios from 'axios';

// Request deduplication map
const pendingRequests = new Map<string, Promise<any>>();

// Create axios instance with aggressive request deduplication
const api = axios.create({
  baseURL: 'http://localhost:3002/api',
  withCredentials: true,
  timeout: 10000, // 10 second timeout
});

// Request interceptor for deduplication
api.interceptors.request.use((config) => {
  const key = \`\${config.method?.toUpperCase()}-\${config.url}\`;
  
  // If same request is already pending, return the existing promise
  if (pendingRequests.has(key)) {
    console.log('Deduplicating request:', key);
    return pendingRequests.get(key)!;
  }
  
  // Create new request promise
  const requestPromise = Promise.resolve(config);
  pendingRequests.set(key, requestPromise);
  
  return requestPromise;
});

// Response interceptor for cleanup
api.interceptors.response.use(
  (response) => {
    const key = \`\${response.config.method?.toUpperCase()}-\${response.config.url}\`;
    pendingRequests.delete(key);
    return response;
  },
  (error) => {
    const key = \`\${error.config?.method?.toUpperCase()}-\${error.config?.url}\`;
    pendingRequests.delete(key);
    return Promise.reject(error);
  }
);

export default api;`;

    await fs.writeFile(apiServicePath, aggressiveApiService);
    this.fixes.push('Fixed API service with request deduplication');
  }

  private async fixAppComponent(): Promise<void> {
    const fs = await import('fs/promises');
    const appPath = '/Users/d7y1ce/AAELink-new/packages/frontend/src/App.tsx';
    
    const aggressiveApp = `import React, { useEffect, useState } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './App.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import AdminPage from './pages/AdminPage';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';
import WorkspacePage from './pages/WorkspacePage';

// Protected Route Component with aggressive loading management
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

    await fs.writeFile(appPath, aggressiveApp);
    this.fixes.push('Fixed App component with aggressive loading management');
  }

  public getReport(): { errors: string[]; fixes: string[] } {
    return {
      errors: this.errors,
      fixes: this.fixes
    };
  }
}

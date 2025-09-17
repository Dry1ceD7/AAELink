import React, { ReactNode, createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
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

  const checkSession = useCallback(async () => {
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
  }, []); // Empty dependency array to prevent infinite loop

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
      if (response.data.ok) {
        setUser(response.data.user);
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
  }, []); // Empty dependency array - only run once on mount

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
};

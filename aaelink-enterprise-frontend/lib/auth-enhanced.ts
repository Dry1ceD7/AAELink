/**
 * AAELink Enterprise Enhanced Authentication Service
 * Comprehensive auth management with security features
 * Version: 1.2.0
 */

'use client';

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  avatar: string;
  permissions: string[];
  lastLogin?: Date;
  isActive: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface LoginCredentials {
  username: string;
  password: string;
}

interface RegisterData {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

class EnhancedAuthService {
  private state: AuthState = {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  };

  private listeners: ((state: AuthState) => void)[] = [];

  constructor() {
    this.loadStoredAuth();
  }

  private loadStoredAuth(): void {
    if (typeof window === 'undefined') return;

    try {
      const storedToken = localStorage.getItem('aaelink_token');
      const storedUser = localStorage.getItem('aaelink_user');

      if (storedToken && storedUser) {
        this.state.token = storedToken;
        this.state.user = JSON.parse(storedUser);
        this.state.isAuthenticated = true;
        this.notifyListeners();
      }
    } catch (error) {
      console.error('Failed to load stored auth:', error);
      this.clearAuth();
    }
  }

  private storeAuth(token: string, user: User): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem('aaelink_token', token);
      localStorage.setItem('aaelink_user', JSON.stringify(user));
    } catch (error) {
      console.error('Failed to store auth:', error);
    }
  }

  private clearAuth(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem('aaelink_token');
      localStorage.removeItem('aaelink_user');
    } catch (error) {
      console.error('Failed to clear auth:', error);
    }

    this.state = {
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener({ ...this.state }));
  }

  async login(credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> {
    this.state.isLoading = true;
    this.state.error = null;
    this.notifyListeners();

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      const data = await response.json();

      if (data.success) {
        this.state.user = data.user;
        this.state.token = data.token;
        this.state.isAuthenticated = true;
        this.state.error = null;

        this.storeAuth(data.token, data.user);
        this.notifyListeners();

        return { success: true };
      } else {
        this.state.error = data.message || 'Login failed';
        this.notifyListeners();
        return { success: false, error: this.state.error };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      this.state.error = errorMessage;
      this.notifyListeners();
      return { success: false, error: errorMessage };
    } finally {
      this.state.isLoading = false;
      this.notifyListeners();
    }
  }

  async register(data: RegisterData): Promise<{ success: boolean; error?: string }> {
    this.state.isLoading = true;
    this.state.error = null;
    this.notifyListeners();

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        this.state.user = result.user;
        this.state.token = result.token;
        this.state.isAuthenticated = true;
        this.state.error = null;

        this.storeAuth(result.token, result.user);
        this.notifyListeners();

        return { success: true };
      } else {
        this.state.error = result.message || 'Registration failed';
        this.notifyListeners();
        return { success: false, error: this.state.error };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Registration failed';
      this.state.error = errorMessage;
      this.notifyListeners();
      return { success: false, error: errorMessage };
    } finally {
      this.state.isLoading = false;
      this.notifyListeners();
    }
  }

  async logout(): Promise<void> {
    this.clearAuth();
    
    // Call logout endpoint if needed
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.state.token}`,
        },
      });
    } catch (error) {
      console.error('Logout API call failed:', error);
    }
  }

  async refreshToken(): Promise<boolean> {
    if (!this.state.token) return false;

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.state.token}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        this.state.token = data.token;
        this.storeAuth(data.token, this.state.user!);
        this.notifyListeners();
        return true;
      } else {
        this.clearAuth();
        return false;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.clearAuth();
      return false;
    }
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`,
        },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      const data = await response.json();

      if (data.success) {
        return { success: true };
      } else {
        return { success: false, error: data.message || 'Password change failed' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Password change failed';
      return { success: false, error: errorMessage };
    }
  }

  hasPermission(permission: string): boolean {
    if (!this.state.user) return false;
    return this.state.user.permissions.includes(permission);
  }

  hasRole(role: string): boolean {
    if (!this.state.user) return false;
    return this.state.user.role === role;
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  getState(): AuthState {
    return { ...this.state };
  }

  getToken(): string | null {
    return this.state.token;
  }

  getUser(): User | null {
    return this.state.user;
  }

  isAuthenticated(): boolean {
    return this.state.isAuthenticated;
  }
}

// Create singleton instance
export const authService = new EnhancedAuthService();
export default authService;

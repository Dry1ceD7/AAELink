/**
 * AAELink Enterprise Authentication Service
 * Handles authentication state and token management
 * Version: 1.2.0
 */

import { authService } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'admin' | 'user' | 'moderator';
  status: 'online' | 'away' | 'busy' | 'offline';
  lastSeen: Date;
  permissions: string[];
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
}

class AuthService {
  private state: AuthState = {
    isAuthenticated: false,
    user: null,
    token: null,
    isLoading: false,
    error: null,
  };

  private listeners: Set<(state: AuthState) => void> = new Set();

  constructor() {
    this.initializeAuth();
  }

  private async initializeAuth(): Promise<void> {
    if (typeof window === 'undefined') return;

    this.setState({ isLoading: true });

    try {
      const token = localStorage.getItem('authToken');
      if (token) {
        // Verify token with backend
        const user = await authService.getProfile();
        this.setState({
          isAuthenticated: true,
          user,
          token,
          isLoading: false,
          error: null,
        });
      } else {
        this.setState({
          isAuthenticated: false,
          user: null,
          token: null,
          isLoading: false,
          error: null,
        });
      }
    } catch (error) {
      console.error('Auth initialization failed:', error);
      this.clearAuth();
    }
  }

  async login(email: string, password: string): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const response = await authService.login({ email, password });
      const { token, user } = response;

      if (typeof window !== 'undefined') {
        localStorage.setItem('authToken', token);
      }

      this.setState({
        isAuthenticated: true,
        user,
        token,
        isLoading: false,
        error: null,
      });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Login failed';
      this.setState({
        isAuthenticated: false,
        user: null,
        token: null,
        isLoading: false,
        error: errorMessage,
      });
      throw error;
    }
  }

  async register(email: string, password: string, name: string): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const response = await authService.register({ email, password, name });
      const { token, user } = response;

      if (typeof window !== 'undefined') {
        localStorage.setItem('authToken', token);
      }

      this.setState({
        isAuthenticated: true,
        user,
        token,
        isLoading: false,
        error: null,
      });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Registration failed';
      this.setState({
        isAuthenticated: false,
        user: null,
        token: null,
        isLoading: false,
        error: errorMessage,
      });
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await authService.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      this.clearAuth();
    }
  }

  async refreshToken(): Promise<void> {
    try {
      const response = await authService.refreshToken();
      const { token } = response;

      if (typeof window !== 'undefined') {
        localStorage.setItem('authToken', token);
      }

      this.setState({
        token,
        error: null,
      });
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.clearAuth();
    }
  }

  async updateProfile(data: Partial<User>): Promise<void> {
    if (!this.state.user) throw new Error('Not authenticated');

    try {
      const updatedUser = await authService.updateProfile(data);
      this.setState({
        user: updatedUser,
        error: null,
      });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Profile update failed';
      this.setState({ error: errorMessage });
      throw error;
    }
  }

  private clearAuth(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('authToken');
    }

    this.setState({
      isAuthenticated: false,
      user: null,
      token: null,
      isLoading: false,
      error: null,
    });
  }

  private setState(updates: Partial<AuthState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('Error in auth listener:', error);
      }
    });
  }

  // Public API
  getState(): AuthState {
    return { ...this.state };
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isAuthenticated(): boolean {
    return this.state.isAuthenticated;
  }

  getUser(): User | null {
    return this.state.user;
  }

  getToken(): string | null {
    return this.state.token;
  }

  hasPermission(permission: string): boolean {
    if (!this.state.user) return false;
    return this.state.user.permissions.includes(permission) || this.state.user.role === 'admin';
  }

  hasRole(role: string): boolean {
    if (!this.state.user) return false;
    return this.state.user.role === role;
  }

  isAdmin(): boolean {
    return this.hasRole('admin');
  }

  isModerator(): boolean {
    return this.hasRole('moderator') || this.isAdmin();
  }

  // Token validation
  isTokenValid(): boolean {
    if (!this.state.token) return false;

    try {
      const tokenParts = this.state.token.split('.');
      if (tokenParts.length !== 3 || !tokenParts[1]) return false;
      
      const payload = JSON.parse(atob(tokenParts[1]));
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    } catch {
      return false;
    }
  }

  // Auto-refresh token
  startTokenRefresh(): void {
    if (typeof window === 'undefined') return;

    setInterval(() => {
      if (this.isAuthenticated() && !this.isTokenValid()) {
        this.refreshToken();
      }
    }, 60000); // Check every minute
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    isAuthenticated: boolean;
    tokenValid: boolean;
    user: User | null;
  }> {
    return {
      status: this.isAuthenticated() && this.isTokenValid() ? 'healthy' : 'unhealthy',
      isAuthenticated: this.isAuthenticated(),
      tokenValid: this.isTokenValid(),
      user: this.getUser(),
    };
  }
}

// Export singleton instance
export const authServiceInstance = new AuthService();
export default authServiceInstance;
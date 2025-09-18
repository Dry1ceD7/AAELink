/**
 * AAELink Enterprise Enhanced API Service
 * Comprehensive API management with error handling and caching
 * Version: 1.2.0
 */

'use client';

import { authService } from './auth-enhanced';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  status?: number;
}

interface ApiConfig {
  baseURL: string;
  timeout: number;
  retries: number;
  retryDelay: number;
}

class EnhancedApiService {
  private config: ApiConfig;
  private cache: Map<string, { data: any; timestamp: number; ttl: number }> = new Map();

  constructor() {
    this.config = {
      baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    useCache: boolean = false,
    cacheTTL: number = 300000 // 5 minutes
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.baseURL}${endpoint}`;
    const cacheKey = `${options.method || 'GET'}:${url}:${JSON.stringify(options.body || '')}`;

    // Check cache first
    if (useCache && options.method === 'GET') {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
        return { success: true, data: cached.data };
      }
    }

    const token = authService.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const requestOptions: RequestInit = {
      ...options,
      headers,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(url, {
          ...requestOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await response.json();

        if (response.ok) {
          // Cache successful GET requests
          if (useCache && options.method === 'GET') {
            this.cache.set(cacheKey, {
              data: data.data || data,
              timestamp: Date.now(),
              ttl: cacheTTL,
            });
          }

          return {
            success: true,
            data: data.data || data,
            message: data.message,
            status: response.status,
          };
        } else {
          // Handle authentication errors
          if (response.status === 401) {
            authService.logout();
            return {
              success: false,
              error: 'Authentication required',
              status: response.status,
            };
          }

          return {
            success: false,
            error: data.message || data.error || 'Request failed',
            status: response.status,
          };
        }
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.config.retries) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * (attempt + 1)));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Request failed after retries',
    };
  }

  // Authentication endpoints
  async login(credentials: { username: string; password: string }): Promise<ApiResponse> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  async register(data: {
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }): Promise<ApiResponse> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async logout(): Promise<ApiResponse> {
    return this.request('/api/auth/logout', {
      method: 'POST',
    });
  }

  async refreshToken(): Promise<ApiResponse> {
    return this.request('/api/auth/refresh', {
      method: 'POST',
    });
  }

  // User management
  async getUsers(): Promise<ApiResponse> {
    return this.request('/api/users', { method: 'GET' }, true);
  }

  async getUser(id: string): Promise<ApiResponse> {
    return this.request(`/api/users/${id}`, { method: 'GET' }, true);
  }

  async updateUser(id: string, data: any): Promise<ApiResponse> {
    return this.request(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: string): Promise<ApiResponse> {
    return this.request(`/api/users/${id}`, { method: 'DELETE' });
  }

  // Chat and messaging
  async getMessages(channelId: string): Promise<ApiResponse> {
    return this.request(`/api/chat/messages/${channelId}`, { method: 'GET' }, true);
  }

  async sendMessage(channelId: string, content: string, type: string = 'text'): Promise<ApiResponse> {
    return this.request('/api/chat/messages', {
      method: 'POST',
      body: JSON.stringify({ channelId, content, type }),
    });
  }

  async getChannels(): Promise<ApiResponse> {
    return this.request('/api/chat/channels', { method: 'GET' }, true);
  }

  async createChannel(data: { name: string; type: string; description?: string }): Promise<ApiResponse> {
    return this.request('/api/chat/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // File management
  async uploadFile(file: File, channelId: string): Promise<ApiResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('channelId', channelId);

    return this.request('/api/files/upload', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    });
  }

  async getFiles(channelId: string): Promise<ApiResponse> {
    return this.request(`/api/files/${channelId}`, { method: 'GET' }, true);
  }

  async deleteFile(fileId: string): Promise<ApiResponse> {
    return this.request(`/api/files/${fileId}`, { method: 'DELETE' });
  }

  // Calendar and events
  async getEvents(): Promise<ApiResponse> {
    return this.request('/api/calendar/events', { method: 'GET' }, true);
  }

  async createEvent(data: any): Promise<ApiResponse> {
    return this.request('/api/calendar/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateEvent(id: string, data: any): Promise<ApiResponse> {
    return this.request(`/api/calendar/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteEvent(id: string): Promise<ApiResponse> {
    return this.request(`/api/calendar/events/${id}`, { method: 'DELETE' });
  }

  // Search
  async search(query: string, type?: string): Promise<ApiResponse> {
    const params = new URLSearchParams({ q: query });
    if (type) params.append('type', type);
    
    return this.request(`/api/search?${params}`, { method: 'GET' }, true);
  }

  // ERP integration
  async getERPDashboard(): Promise<ApiResponse> {
    return this.request('/api/erp/dashboard', { method: 'GET' }, true);
  }

  async getERPData(endpoint: string): Promise<ApiResponse> {
    return this.request(`/api/erp/${endpoint}`, { method: 'GET' }, true);
  }

  // Admin functions
  async getSystemStats(): Promise<ApiResponse> {
    return this.request('/api/admin/stats', { method: 'GET' }, true);
  }

  async getSystemLogs(): Promise<ApiResponse> {
    return this.request('/api/admin/logs', { method: 'GET' }, true);
  }

  // Health check
  async healthCheck(): Promise<ApiResponse> {
    return this.request('/health', { method: 'GET' }, true, 60000); // 1 minute cache
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
  }

  // Clear specific cache entry
  clearCacheEntry(pattern: string): void {
    for (const [key] of this.cache) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }
}

// Create singleton instance
export const apiService = new EnhancedApiService();
export default apiService;

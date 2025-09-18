/**
 * AAELink Enterprise API Service
 * Centralized API communication with backend
 * Version: 1.2.0
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

// Request deduplication map
const pendingRequests = new Map<string, Promise<any>>();

// Create axios instance with configuration
const createApiInstance = (baseURL: string): AxiosInstance => {
  const api = axios.create({
    baseURL,
    withCredentials: true,
    timeout: 30000, // 30 second timeout
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor for deduplication and auth
  api.interceptors.request.use(
    (config) => {
      const key = `${config.method?.toUpperCase()}-${config.url}`;

      // If same request is already pending, return the existing promise
      if (pendingRequests.has(key)) {
        console.log('Deduplicating request:', key);
        return pendingRequests.get(key)!;
      }

      // Add auth token if available
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('authToken');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }

      // Create new request promise
      const requestPromise = Promise.resolve(config);
      pendingRequests.set(key, requestPromise);

      return requestPromise;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor for cleanup and error handling
  api.interceptors.response.use(
    (response) => {
      const key = `${response.config.method?.toUpperCase()}-${response.config.url}`;
      pendingRequests.delete(key);
      return response;
    },
    (error) => {
      const key = `${error.config?.method?.toUpperCase()}-${error.config?.url}`;
      pendingRequests.delete(key);

      if (error.response?.status === 401) {
        // Handle unauthorized - clear token and redirect to login
        if (typeof window !== 'undefined') {
          localStorage.removeItem('authToken');
          window.location.href = '/login';
        }
      }

      return Promise.reject(error);
    }
  );

  return api;
};

// API instances for different services
export const api = createApiInstance(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api');
export const enterpriseApi = createApiInstance(process.env.NEXT_PUBLIC_ENTERPRISE_API_URL || 'http://localhost:3002/api');

// API Service Class
export class ApiService {
  private api: AxiosInstance;

  constructor(apiInstance: AxiosInstance = api) {
    this.api = apiInstance;
  }

  // Generic request method
  async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response: AxiosResponse<T> = await this.api.request(config);
      return response.data;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // GET request
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  // POST request
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  // PUT request
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }

  // DELETE request
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  // PATCH request
  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PATCH', url, data });
  }
}

// Specific API services
export class AuthService extends ApiService {
  async login(credentials: { email: string; password: string }) {
    return this.post('/auth/login', credentials);
  }

  async register(userData: { email: string; password: string; name: string }) {
    return this.post('/auth/register', userData);
  }

  async logout() {
    return this.post('/auth/logout');
  }

  async refreshToken() {
    return this.post('/auth/refresh');
  }

  async getProfile() {
    return this.get('/auth/profile');
  }

  async updateProfile(data: any) {
    return this.put('/auth/profile', data);
  }
}

export class MessageService extends ApiService {
  async getMessages(channelId: string, page = 1, limit = 50) {
    return this.get(`/messages?channelId=${channelId}&page=${page}&limit=${limit}`);
  }

  async sendMessage(channelId: string, content: string, type = 'text') {
    return this.post('/messages', { channelId, content, type });
  }

  async editMessage(messageId: string, content: string) {
    return this.put(`/messages/${messageId}`, { content });
  }

  async deleteMessage(messageId: string) {
    return this.delete(`/messages/${messageId}`);
  }

  async getChannels() {
    return this.get('/messages/channels');
  }

  async createChannel(name: string, type = 'text') {
    return this.post('/messages/channels', { name, type });
  }
}

export class FileService extends ApiService {
  async uploadFile(file: File, channelId?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (channelId) {
      formData.append('channelId', channelId);
    }

    return this.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async getFiles(channelId?: string, page = 1, limit = 50) {
    const params = new URLSearchParams();
    if (channelId) params.append('channelId', channelId);
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    return this.get(`/files?${params.toString()}`);
  }

  async deleteFile(fileId: string) {
    return this.delete(`/files/${fileId}`);
  }

  async getFileUrl(fileId: string) {
    return this.get(`/files/${fileId}/url`);
  }
}

export class CalendarService extends ApiService {
  async getEvents(startDate?: string, endDate?: string) {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    return this.get(`/calendar/events?${params.toString()}`);
  }

  async createEvent(eventData: any) {
    return this.post('/calendar/events', eventData);
  }

  async updateEvent(eventId: string, eventData: any) {
    return this.put(`/calendar/events/${eventId}`, eventData);
  }

  async deleteEvent(eventId: string) {
    return this.delete(`/calendar/events/${eventId}`);
  }
}

export class UserService extends ApiService {
  async getUsers(page = 1, limit = 50) {
    return this.get(`/users?page=${page}&limit=${limit}`);
  }

  async getUser(userId: string) {
    return this.get(`/users/${userId}`);
  }

  async updateUser(userId: string, userData: any) {
    return this.put(`/users/${userId}`, userData);
  }

  async deleteUser(userId: string) {
    return this.delete(`/users/${userId}`);
  }

  async searchUsers(query: string) {
    return this.get(`/users/search?q=${encodeURIComponent(query)}`);
  }
}

export class SearchService extends ApiService {
  async search(query: string, type?: string) {
    const params = new URLSearchParams();
    params.append('q', query);
    if (type) params.append('type', type);

    return this.get(`/search?${params.toString()}`);
  }

  async searchMessages(query: string, channelId?: string) {
    const params = new URLSearchParams();
    params.append('q', query);
    if (channelId) params.append('channelId', channelId);

    return this.get(`/search/messages?${params.toString()}`);
  }

  async searchFiles(query: string, channelId?: string) {
    const params = new URLSearchParams();
    params.append('q', query);
    if (channelId) params.append('channelId', channelId);

    return this.get(`/search/files?${params.toString()}`);
  }
}

// Enterprise-specific services
export class EnterpriseService extends ApiService {
  constructor() {
    super(enterpriseApi);
  }

  async getDashboard() {
    return this.get('/dashboard');
  }

  async getAnalytics() {
    return this.get('/analytics');
  }

  async getSystemStatus() {
    return this.get('/system/status');
  }

  async getUsers() {
    return this.get('/admin/users');
  }

  async createUser(userData: any) {
    return this.post('/admin/users', userData);
  }

  async updateUser(userId: string, userData: any) {
    return this.put(`/admin/users/${userId}`, userData);
  }

  async deleteUser(userId: string) {
    return this.delete(`/admin/users/${userId}`);
  }

  async getERPData(type: string, params?: any) {
    return this.get(`/erp/${type}`, { params });
  }

  async syncERPData() {
    return this.post('/erp/sync');
  }

  async getN8NWorkflows() {
    return this.get('/n8n/workflows');
  }

  async createN8NWorkflow(workflowData: any) {
    return this.post('/n8n/workflows', workflowData);
  }

  async triggerN8NWorkflow(workflowId: string, data?: any) {
    return this.post(`/n8n/workflows/${workflowId}/trigger`, data);
  }
}

// Export service instances
export const authService = new AuthService();
export const messageService = new MessageService();
export const fileService = new FileService();
export const calendarService = new CalendarService();
export const userService = new UserService();
export const searchService = new SearchService();
export const enterpriseService = new EnterpriseService();

// Export default API instance
export default api;
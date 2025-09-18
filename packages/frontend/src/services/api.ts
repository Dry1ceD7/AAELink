import axios from 'axios';

// Request deduplication map
const pendingRequests = new Map<string, Promise<any>>();

// Create axios instance with aggressive request deduplication
const api = axios.create({
  baseURL: '/api', // Use relative URL for proxy
  withCredentials: true,
  timeout: 10000, // 10 second timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for deduplication
api.interceptors.request.use((config) => {
  const key = `${config.method?.toUpperCase()}-${config.url}`;

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

    // Enhanced error handling
    if (error.response?.status === 401) {
      console.log('Unauthorized - redirecting to login');
      // Clear any stored auth data
      localStorage.removeItem('auth-token');
      // Redirect to login if not already there
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else if (error.response?.status === 403) {
      console.log('Forbidden - insufficient permissions');
    } else if (error.response?.status >= 500) {
      console.error('Server error:', error.response?.data);
    } else if (error.code === 'NETWORK_ERROR') {
      console.error('Network error - check connection');
    }

    return Promise.reject(error);
  }
);

export default api;

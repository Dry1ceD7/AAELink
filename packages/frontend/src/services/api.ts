import axios from 'axios';

// Request deduplication map
const pendingRequests = new Map<string, Promise<any>>();

// Create axios instance with aggressive request deduplication
const api = axios.create({
  baseURL: 'http://localhost:3002/api',
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

    if (error.response?.status === 401) {
      console.log('Unauthorized - not redirecting to prevent loops');
    }

    return Promise.reject(error);
  }
);

export default api;

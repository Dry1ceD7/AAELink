/**
 * AI Frontend Fixer Agent
 * Specialized in fixing frontend infinite loops and flickering
 */

export class FrontendFixerAgent {
  private errors: string[] = [];
  private fixes: string[] = [];

  constructor() {
    console.log('🤖 Frontend Fixer Agent initialized');
  }

  public async fixInfiniteLoop(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing infinite loop in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Fix common infinite loop patterns
      content = content.replace(
        /useEffect\(\(\)\s*=>\s*\{[\s\S]*?checkSession\(\)[\s\S]*?\},\s*\[\]\)/g,
        `useEffect(() => {
  const checkAuth = async () => {
    try {
      await checkSession();
    } catch (error) {
      console.error('Session check failed:', error);
    }
  };

  checkAuth();
}, []);`
      );

      await fs.writeFile(filePath, content);
      this.fixes.push(`Fixed infinite loop in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix infinite loop: ${error}`);
      return false;
    }
  }

  public async fixAuthStore(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing auth store in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Fix auth store to prevent infinite loops
      const authStoreFix = `import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  locale: string;
  theme: string;
  seniorMode: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  checkSession: () => Promise<void>;
  setUser: (user: User | null) => void;
  setAuthenticated: (authenticated: boolean) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,

  checkSession: async () => {
    if (get().isLoading) return; // Prevent concurrent calls

    set({ isLoading: true });

    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        set({
          user: data.user,
          isAuthenticated: true,
          isLoading: false
        });
      } else {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false
        });
      }
    } catch (error) {
      console.error('Session check failed:', error);
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false
      });
    }
  },

  setUser: (user) => set({ user }),
  setAuthenticated: (authenticated) => set({ isAuthenticated: authenticated }),
  setLoading: (loading) => set({ isLoading: loading }),
}));`;

      await fs.writeFile(filePath, authStoreFix);
      this.fixes.push(`Fixed auth store in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix auth store: ${error}`);
      return false;
    }
  }

  public async fixApiCalls(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing API calls in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Add debouncing and error handling to API calls
      content = content.replace(
        /const\s+api\s*=\s*axios\.create\(/g,
        `const api = axios.create(`
      );

      // Add request interceptor for debouncing
      const apiFix = `import axios from 'axios';

// Create axios instance with debouncing
const api = axios.create({
  baseURL: 'http://localhost:3002/api',
  withCredentials: true,
  timeout: 5000, // 5 second timeout
});

// Request interceptor to prevent duplicate calls
const pendingRequests = new Map();

api.interceptors.request.use((config) => {
  const key = \`\${config.method}-\${config.url}\`;

  if (pendingRequests.has(key)) {
    return Promise.reject(new Error('Request already in progress'));
  }

  pendingRequests.set(key, true);
  return config;
});

api.interceptors.response.use(
  (response) => {
    const key = \`\${response.config.method}-\${response.config.url}\`;
    pendingRequests.delete(key);
    return response;
  },
  (error) => {
    const key = \`\${error.config?.method}-\${error.config?.url}\`;
    pendingRequests.delete(key);
    return Promise.reject(error);
  }
);

export default api;`;

      await fs.writeFile(filePath, apiFix);
      this.fixes.push(`Fixed API calls in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix API calls: ${error}`);
      return false;
    }
  }

  public getReport(): { errors: string[]; fixes: string[] } {
    return {
      errors: this.errors,
      fixes: this.fixes
    };
  }
}

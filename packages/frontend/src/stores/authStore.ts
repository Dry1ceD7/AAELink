import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'org_admin' | 'sysadmin';
  avatar?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setAuthenticated: (authenticated: boolean) => void;
  checkSession: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      
      setAuthenticated: (authenticated) => set({ isAuthenticated: authenticated }),
      
      checkSession: async () => {
        try {
          const response = await fetch('/api/auth/session', {
            credentials: 'include',
          });
          
          if (response.ok) {
            const data = await response.json();
            set({ user: data.user, isAuthenticated: true });
          } else {
            set({ user: null, isAuthenticated: false });
          }
        } catch (error) {
          console.error('Session check failed:', error);
          set({ user: null, isAuthenticated: false });
        }
      },
      
      logout: () => {
        set({ user: null, isAuthenticated: false });
        // Clear session on server
        fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        }).catch(console.error);
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);

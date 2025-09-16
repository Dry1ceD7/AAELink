import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'high-contrast';

interface ThemeState {
  theme: Theme;
  seniorMode: boolean;
  setTheme: (theme: Theme) => void;
  setSeniorMode: (enabled: boolean) => void;
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      seniorMode: false,
      
      setTheme: (theme) => set({ theme }),
      
      setSeniorMode: (enabled) => set({ seniorMode: enabled }),
      
      initTheme: () => {
        // Check system preference if no saved theme
        const savedTheme = localStorage.getItem('theme-store');
        if (!savedTheme) {
          const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          set({ theme: systemTheme });
        }
      },
    }),
    {
      name: 'theme-storage',
    }
  )
);

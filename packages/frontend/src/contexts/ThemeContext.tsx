import React, { ReactNode, createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'high-contrast';

interface ThemeContextType {
  theme: Theme;
  seniorMode: boolean;
  setTheme: (theme: Theme) => void;
  setSeniorMode: (enabled: boolean) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('light');
  const [seniorMode, setSeniorMode] = useState(false);

  useEffect(() => {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('aaelink-theme') as Theme;
    const savedSeniorMode = localStorage.getItem('aaelink-senior-mode') === 'true';

    if (savedTheme) {
      setTheme(savedTheme);
    }
    if (savedSeniorMode) {
      setSeniorMode(savedSeniorMode);
    }
  }, []);

  useEffect(() => {
    // Apply theme to document
    const root = document.documentElement;

    // Remove all theme classes
    root.classList.remove('light', 'dark', 'high-contrast');
    // Add current theme
    root.classList.add(theme);

    // Toggle senior mode
    if (seniorMode) {
      root.classList.add('senior-mode');
    } else {
      root.classList.remove('senior-mode');
    }

    // Save to localStorage
    localStorage.setItem('aaelink-theme', theme);
    localStorage.setItem('aaelink-senior-mode', seniorMode.toString());
  }, [theme, seniorMode]);

  const toggleTheme = () => {
    setTheme(prev => {
      switch (prev) {
        case 'light': return 'dark';
        case 'dark': return 'high-contrast';
        case 'high-contrast': return 'light';
        default: return 'light';
      }
    });
  };

  const value = {
    theme,
    seniorMode,
    setTheme,
    setSeniorMode,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

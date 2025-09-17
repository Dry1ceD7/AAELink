import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ThemeContextType {
  theme: 'light' | 'dark' | 'high-contrast';
  seniorMode: boolean;
  toggleTheme: () => void;
  toggleSeniorMode: () => void;
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
  const [theme, setTheme] = useState<'light' | 'dark' | 'high-contrast'>('light');
  const [seniorMode, setSeniorMode] = useState(false);

  useEffect(() => {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'high-contrast';
    const savedSeniorMode = localStorage.getItem('seniorMode') === 'true';
    
    if (savedTheme) setTheme(savedTheme);
    if (savedSeniorMode) setSeniorMode(savedSeniorMode);
  }, []);

  useEffect(() => {
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('senior-mode', seniorMode);
  }, [theme, seniorMode]);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'high-contrast' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const toggleSeniorMode = () => {
    const newSeniorMode = !seniorMode;
    setSeniorMode(newSeniorMode);
    localStorage.setItem('seniorMode', newSeniorMode.toString());
  };

  const value = {
    theme,
    seniorMode,
    toggleTheme,
    toggleSeniorMode,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
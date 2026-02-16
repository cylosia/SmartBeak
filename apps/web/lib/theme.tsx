import React, { createContext, useContext, useEffect, useState } from 'react';

/**
 * Theme Context and Provider
 * Supports light/dark mode with system preference detection
 */

export type Theme = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'acp-theme';

/**
 * Get initial theme from localStorage or default to system
 */
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';

  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored && ['light', 'dark', 'system'].includes(stored)) {
    return stored;
  }
  return 'system';
}

/**
 * Resolve system theme to light/dark
 */
function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Theme Provider Component
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');
  const [mounted, setMounted] = useState(false);

  // Initialize theme on mount
  useEffect(() => {
    const initial = getInitialTheme();
    setThemeState(initial);
    setResolvedTheme(initial === 'system' ? resolveSystemTheme() : initial);
    setMounted(true);
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        setResolvedTheme(resolveSystemTheme());
      }
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  // Apply theme to document
  useEffect(() => {
    if (!mounted || typeof document === 'undefined') return;

    const root = document.documentElement;
    const isDark = resolvedTheme === 'dark';

    if (isDark) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    // Set data attribute for CSS selectors
    root.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    setResolvedTheme(newTheme === 'system' ? resolveSystemTheme() : newTheme);

    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newTheme);
    }
  };

  const toggleTheme = () => {
    const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Theme Toggle Button Component
 */
export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
      style={{
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--panel)',
        color: 'var(--text)',
        cursor: 'pointer',
      }}
    >
      {resolvedTheme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}

/**
 * Theme Selector Component
 */
export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <select
      value={theme}
      onChange={(e) => {
        // P2-12 FIX: Validate value before casting to Theme
        const val = (e.target as HTMLSelectElement).value;
        if (val === 'light' || val === 'dark' || val === 'system') {
          setTheme(val);
        }
      }}
      style={{
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--panel)',
        color: 'var(--text)',
      }}
    >
      <option value='system'>System</option>
      <option value='light'>Light</option>
      <option value='dark'>Dark</option>
    </select>
  );
}

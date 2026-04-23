'use client'

import { useEffect, useState } from 'react'
import { Button } from './ui/button'

const THEME_KEY = 'aae_theme'
type Theme = 'light' | 'dark'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const stored = (window.localStorage.getItem(THEME_KEY) as Theme | null) ?? null
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
    const initial: Theme = stored ?? (prefersDark ? 'dark' : 'light')
    setTheme(initial)
    applyTheme(initial)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    applyTheme(next)
    window.localStorage.setItem(THEME_KEY, next)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={toggle}
      title={theme === 'light' ? 'Dark mode' : 'Light mode'}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </Button>
  )
}

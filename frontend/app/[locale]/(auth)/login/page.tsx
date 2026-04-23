'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Logo } from '@/components/brand/logo'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { ApiError } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

export default function LoginPage() {
  const t = useTranslations()
  const router = useRouter()
  const { user, isHydrated, login } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isHydrated && user) router.replace('/dashboard')
  }, [isHydrated, user, router])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email.trim(), password)
      router.replace('/dashboard')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t('auth.invalidCredentials'))
      } else {
        setError(t('common.error'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Logo size={32} withWordmark />
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-[--radius-card] border border-[color:var(--border)] bg-[color:var(--surface)] p-8 shadow-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <Logo size={56} />
            <h1 className="mt-4 text-2xl font-bold text-[color:var(--fg)]">
              {t('auth.loginTitle')}
            </h1>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              {t('auth.loginSubtitle')}
            </p>
          </div>

          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder={t('auth.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              {loading ? t('auth.signingIn') : t('auth.login')}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-[color:var(--muted)]">
            {t('auth.noAccount')} {t('auth.contactIT')}
          </p>
        </div>
      </div>
    </main>
  )
}

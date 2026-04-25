'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useEffect, useState } from 'react'
import { Logo } from '@/components/brand/logo'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { ApiError, supportApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

export default function LoginPage() {
  const t = useTranslations()
  const router = useRouter()
  const { user, isHydrated, login } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportMessage, setSupportMessage] = useState('')
  const [supportSent, setSupportSent] = useState(false)
  const [supportLoading, setSupportLoading] = useState(false)

  useEffect(() => {
    if (isHydrated && user) router.replace('/dashboard')
  }, [isHydrated, user, router])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email.trim(), password, remember)
      router.replace('/dashboard')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t('auth.invalidIdentifier'))
      } else {
        setError(t('common.error'))
      }
    } finally {
      setLoading(false)
    }
  }

  const onEmergencySupport = async (e: React.FormEvent) => {
    e.preventDefault()
    setSupportLoading(true)
    setError(null)
    try {
      await supportApi.createEmergency({
        requester: email.trim() || t('support.unknownRequester'),
        subject: t('support.defaultSubject'),
        message: supportMessage.trim(),
      })
      setSupportSent(true)
      setSupportMessage('')
    } catch {
      setError(t('support.failed'))
    } finally {
      setSupportLoading(false)
    }
  }

  return (
    <main
      data-aae-shell="true"
      className="fixed inset-0 flex flex-col overflow-hidden bg-[color:var(--bg)]"
    >
      <header className="flex items-center justify-between px-6 py-4 shrink-0">
        <Logo size={32} withWordmark />
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 min-h-0 flex items-center justify-center px-6 py-6 overflow-hidden">
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
              <Label htmlFor="email">{t('auth.identifier')}</Label>
              <Input
                id="email"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                placeholder={t('auth.identifierPlaceholder')}
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

            <label className="flex items-center gap-2 text-sm text-[color:var(--fg)] select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[color:var(--border)] accent-[color:var(--brand)]"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={loading}
              />
              {t('auth.rememberMe')}
            </label>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              {loading ? t('auth.signingIn') : t('auth.login')}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => {
              setSupportOpen((v) => !v)
              setSupportSent(false)
            }}
            className="mt-4 w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm font-medium text-[color:var(--fg)] transition hover:bg-[color:var(--surface-hover)]"
          >
            {t('support.emergencyButton')}
          </button>

          {supportOpen && (
            <form
              onSubmit={onEmergencySupport}
              className="mt-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] p-4"
            >
              <h2 className="text-sm font-semibold text-[color:var(--fg)]">
                {t('support.title')}
              </h2>
              <p className="mt-1 text-xs text-[color:var(--muted)]">
                {t('support.description')}
              </p>
              {supportSent ? (
                <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                  {t('support.queued')}
                </div>
              ) : (
                <>
                  <textarea
                    className="mt-3 min-h-24 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--fg)] outline-none focus:ring-2 focus:ring-[color:var(--brand)]"
                    placeholder={t('support.placeholder')}
                    value={supportMessage}
                    onChange={(e) => setSupportMessage(e.target.value)}
                    required
                    minLength={4}
                    maxLength={4000}
                    disabled={supportLoading}
                  />
                  <Button
                    type="submit"
                    className="mt-3 w-full"
                    loading={supportLoading}
                  >
                    {supportLoading ? t('support.sending') : t('support.send')}
                  </Button>
                </>
              )}
            </form>
          )}

          <p className="mt-6 text-center text-xs text-[color:var(--muted)]">
            {t('auth.noAccount')} {t('auth.contactIT')}
          </p>
        </div>
      </div>
    </main>
  )
}

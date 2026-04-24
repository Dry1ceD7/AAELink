'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Bell,
  Globe,
  KeyRound,
  Palette,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserCircle,
  X,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Link } from '@/i18n/navigation'
import {
  resetPreferences,
  setPreferences,
  usePreferences,
  type DensityMode,
  type StartPage,
} from '@/lib/settings-store'
import { hasRole, useAuthStore } from '@/lib/store'
import { useUIStore } from '@/lib/ui-store'
import { cn } from '@/lib/utils'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

interface Tab {
  id: string
  labelKey: string
  Icon: IconType
}

const tabs: Tab[] = [
  { id: 'appearance', labelKey: 'settings.tabs.appearance', Icon: Palette },
  { id: 'language', labelKey: 'settings.tabs.language', Icon: Globe },
  {
    id: 'notifications',
    labelKey: 'settings.tabs.notifications',
    Icon: Bell,
  },
  { id: 'productivity', labelKey: 'settings.tabs.productivity', Icon: Sparkles },
  { id: 'account', labelKey: 'settings.tabs.account', Icon: UserCircle },
  { id: 'admin', labelKey: 'settings.tabs.admin', Icon: ShieldCheck },
]

export function SettingsDrawer() {
  const t = useTranslations()
  const { settingsOpen, closeSettings } = useUIStore()
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<string>('appearance')
  const prefs = usePreferences()

  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, closeSettings])

  const isAdmin = hasRole(user, 'it_admin')
  const visibleTabs = tabs.filter((t) => (t.id === 'admin' ? isAdmin : true))

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity',
          settingsOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={closeSettings}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.settings')}
        className={cn(
          'fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 transition-opacity',
          settingsOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div
          className={cn(
            'w-full max-w-4xl h-[680px] max-h-[92vh] flex flex-col sm:flex-row overflow-hidden',
            'rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-2xl',
            'transition-transform duration-200',
            settingsOpen ? 'scale-100' : 'scale-95',
          )}
        >
          {/* Sidebar nav */}
          <aside className="shrink-0 sm:w-56 border-b sm:border-b-0 sm:border-r border-[color:var(--border)] bg-[color:var(--bg)]/40">
            <div className="hidden sm:block px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted)]">
              {t('nav.settings')}
            </div>
            <nav className="flex sm:flex-col px-2 py-2 gap-0.5 overflow-x-auto">
              {visibleTabs.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setTab(it.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap',
                    tab === it.id
                      ? 'bg-[color:var(--accent)]/12 text-[color:var(--accent)] font-medium'
                      : 'text-[color:var(--fg)] hover:bg-[color:var(--border)]/40',
                  )}
                >
                  <it.Icon className="h-4 w-4" />
                  {t(it.labelKey)}
                </button>
              ))}
            </nav>
          </aside>

          {/* Body */}
          <div className="flex-1 min-w-0 flex flex-col">
            <header className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-[color:var(--border)]">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--fg)]">
                  {t(`settings.tabs.${tab}`)}
                </h2>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                  {t(`settings.descriptions.${tab}`)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSettings}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
              {tab === 'appearance' && (
                <Section>
                  <Row
                    label={t('settings.themeTitle')}
                    description={t('settings.themeDesc')}
                  >
                    <ThemeToggle />
                  </Row>
                  <RowSelect
                    label={t('settings.densityTitle')}
                    description={t('settings.densityDesc')}
                    value={prefs.density}
                    onChange={(v) =>
                      setPreferences({ density: v as DensityMode })
                    }
                    options={[
                      { value: 'comfortable', label: t('settings.density.comfortable') },
                      { value: 'compact', label: t('settings.density.compact') },
                    ]}
                  />
                  <Toggle
                    checked={prefs.reduceMotion}
                    onChange={(v) => setPreferences({ reduceMotion: v })}
                    label={t('settings.reduceMotionTitle')}
                    description={t('settings.reduceMotionDesc')}
                  />
                </Section>
              )}

              {tab === 'language' && (
                <Section>
                  <Row
                    label={t('settings.languageTitle')}
                    description={t('settings.languageDesc')}
                  >
                    <LocaleSwitcher />
                  </Row>
                  <Toggle
                    checked={prefs.showSeconds}
                    onChange={(v) => setPreferences({ showSeconds: v })}
                    label={t('settings.showSecondsTitle')}
                    description={t('settings.showSecondsDesc')}
                  />
                </Section>
              )}

              {tab === 'notifications' && (
                <Section>
                  <Toggle
                    checked={prefs.notifyDesktop}
                    onChange={(v) => setPreferences({ notifyDesktop: v })}
                    label={t('settings.notifyDesktopTitle')}
                    description={t('settings.notifyDesktopDesc')}
                  />
                  <Toggle
                    checked={prefs.notifyEmail}
                    onChange={(v) => setPreferences({ notifyEmail: v })}
                    label={t('settings.notifyEmailTitle')}
                    description={t('settings.notifyEmailDesc')}
                  />
                  <Toggle
                    checked={prefs.notifySounds}
                    onChange={(v) => setPreferences({ notifySounds: v })}
                    label={t('settings.notifySoundsTitle')}
                    description={t('settings.notifySoundsDesc')}
                  />
                </Section>
              )}

              {tab === 'productivity' && (
                <Section>
                  <RowSelect
                    label={t('settings.startPageTitle')}
                    description={t('settings.startPageDesc')}
                    value={prefs.startPage}
                    onChange={(v) =>
                      setPreferences({ startPage: v as StartPage })
                    }
                    options={[
                      { value: 'dashboard', label: t('nav.dashboard') },
                      { value: 'tickets', label: t('nav.tickets') },
                    ]}
                  />
                </Section>
              )}

              {tab === 'account' && (
                <Section>
                  <LinkRow
                    href="/profile"
                    onNavigate={closeSettings}
                    Icon={UserCircle}
                    label={t('profile.title')}
                    description={t('profile.subtitle')}
                  />
                  <LinkRow
                    href="/profile"
                    onNavigate={closeSettings}
                    Icon={KeyRound}
                    label={t('profile.passwordTitle')}
                    description={t('profile.subtitle')}
                  />
                </Section>
              )}

              {tab === 'admin' && isAdmin && (
                <Section>
                  <LinkRow
                    href="/admin"
                    onNavigate={closeSettings}
                    Icon={ShieldCheck}
                    label={t('admin.title')}
                    description={t('admin.subtitle')}
                  />
                </Section>
              )}
            </div>

            <footer className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[color:var(--border)]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => resetPreferences()}
                aria-label={t('settings.resetDefaults')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('settings.resetDefaults')}
              </Button>
              <Button onClick={closeSettings}>{t('common.close')}</Button>
            </footer>
          </div>
        </div>
      </div>
    </>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]/40 p-2 space-y-0.5">
      {children}
    </div>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md px-3 py-2.5 hover:bg-[color:var(--border)]/30">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[color:var(--fg)]">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-[color:var(--muted)]">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function RowSelect({
  label,
  description,
  value,
  onChange,
  options,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Row label={label} description={description}>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-44"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </Row>
  )
}

function LinkRow({
  href,
  onNavigate,
  Icon,
  label,
  description,
}: {
  href: string
  onNavigate?: () => void
  Icon: IconType
  label: string
  description: string
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-[color:var(--border)]/30"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--accent)]/10 text-[color:var(--accent)]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[color:var(--fg)]">
          {label}
        </span>
        <span className="block text-xs text-[color:var(--muted)]">
          {description}
        </span>
      </span>
    </Link>
  )
}

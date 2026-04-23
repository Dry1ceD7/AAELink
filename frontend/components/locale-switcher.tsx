'use client'

import { useLocale } from 'next-intl'
import { startTransition } from 'react'
import { Select } from './ui/input'
import { routing } from '@/i18n/routing'
import { usePathname, useRouter } from '@/i18n/navigation'

const labels: Record<string, string> = {
  en: 'English',
  th: 'ไทย',
  de: 'Deutsch',
}

export function LocaleSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const change = (next: string) => {
    if (next === locale) return
    startTransition(() => {
      router.replace(pathname, { locale: next as 'en' | 'th' | 'de' })
    })
  }

  return (
    <Select
      aria-label="Language"
      value={locale}
      onChange={(e) => change(e.target.value)}
      className="w-32 h-9"
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {labels[l] ?? l.toUpperCase()}
        </option>
      ))}
    </Select>
  )
}

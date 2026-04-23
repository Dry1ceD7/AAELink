import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'th', 'de'],
  defaultLocale: 'en',
  localePrefix: 'as-needed', // /en is omitted, /th and /de are explicit
})

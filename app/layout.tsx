import type { Metadata, Viewport } from 'next'
import './styles.css'
import { Lato, Open_Sans } from 'next/font/google'
import { DesktopNavigateSubscriber } from './components/DesktopNavigateSubscriber'
import { UiDensityBoot } from './components/UiDensityBoot'
import { ThemeBoot } from './components/ThemeBoot'
import { PreferencesBoot } from './components/PreferencesBoot'

const lato = Lato({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-lato'
})

const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-open-sans'
})

export const metadata: Metadata = {
  title: 'AAELink',
  description: 'Team hub with workspaces, channels, tickets, and documents.',
  applicationName: 'AAELink',
  appleWebApp: {
    capable: true,
    title: 'AAELink',
    statusBarStyle: 'default'
  },
  icons: {
    icon: [
      { url: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' }
    ],
    apple: [{ url: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' }]
  }
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#12086F' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0640' }
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lato.variable} ${openSans.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var pref = localStorage.getItem('aaelink-theme');
                  var effective = pref;
                  if (!pref || pref === 'system') {
                    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  }
                  document.documentElement.setAttribute('data-theme', effective);
                  document.documentElement.style.colorScheme = effective;
                } catch (e) {}
                try {
                  var raw = localStorage.getItem('aaelink-user-prefs');
                  if (raw) {
                    var p = JSON.parse(raw);
                    if (p.accentColor) document.documentElement.style.setProperty('--aae-accent', p.accentColor);
                    if (p.uiScale && p.uiScale !== 100) document.documentElement.style.fontSize = p.uiScale + '%';
                    if (p.messageDensity) document.documentElement.setAttribute('data-density', p.messageDensity);
                    if (p.highContrast) document.documentElement.classList.add('high-contrast');
                    if (p.reduceMotion) document.documentElement.classList.add('reduce-motion');
                  }
                } catch (e) {}
              })();
            `
          }}
        />
      </head>
      <body className={lato.className}>
        <UiDensityBoot />
        <ThemeBoot />
        <PreferencesBoot />
        <DesktopNavigateSubscriber />
        {children}
      </body>
    </html>
  )
}

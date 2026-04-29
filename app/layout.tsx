import type { Metadata, Viewport } from 'next'
import './styles.css'
import { Open_Sans } from 'next/font/google'
import { DesktopNavigateSubscriber } from './components/DesktopNavigateSubscriber'
import { UiDensityBoot } from './components/UiDensityBoot'

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
    { media: '(prefers-color-scheme: light)', color: '#005596' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' }
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={openSans.variable}>
      <body className={openSans.className}>
        <UiDensityBoot />
        <DesktopNavigateSubscriber />
        {children}
      </body>
    </html>
  )
}

import { OfflineIndicator } from '@/components/offline-indicator';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AAELink Enterprise - Company Workspace',
  description: 'Advanced ID Asia Engineering Co.,Ltd - Secure Enterprise Workspace Platform',
  keywords: ['AAELink', 'Enterprise', 'Workspace', 'AAE', 'Company Chat'],
  authors: [{ name: 'Advanced ID Asia Engineering Co.,Ltd' }],
  creator: 'Advanced ID Asia Engineering Co.,Ltd',
  publisher: 'Advanced ID Asia Engineering Co.,Ltd',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1e2124' },
  ],
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://aaelink.local',
    siteName: 'AAELink Enterprise',
    title: 'AAELink Enterprise - Company Workspace',
    description: 'Advanced ID Asia Engineering Co.,Ltd - Secure Enterprise Workspace Platform',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AAELink Enterprise - Company Workspace',
    description: 'Advanced ID Asia Engineering Co.,Ltd - Secure Enterprise Workspace Platform',
  },
  other: {
    'X-UA-Compatible': 'IE=edge',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="AAELink" />
        <meta name="application-name" content="AAELink" />
        <meta name="msapplication-TileColor" content="#2563eb" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
      </head>
      <body className={inter.className}>
        <Providers>
          {children}
          <OfflineIndicator showDetails={true} />
          <ServiceWorkerRegistration />
        </Providers>
      </body>
    </html>
  );
}

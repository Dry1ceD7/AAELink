import type { MetadataRoute } from 'next'

/** Installable web app (Add to Home Screen / install). Icons are served from `/public/icons`. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AAELink',
    short_name: 'AAELink',
    description: 'Team hub with workspaces, channels, tickets, and documents.',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#005596',
    icons: [
      {
        src: '/icons/pwa-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icons/pwa-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      }
    ]
  }
}

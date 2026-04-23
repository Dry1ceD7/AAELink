import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://auth:8001'
const TICKET_URL = process.env.TICKET_SERVICE_URL || 'http://ticket:8002'
const MEDIA_URL = process.env.MEDIA_SERVICE_URL || 'http://media:8004'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'minio',
        port: '9000',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  async rewrites() {
    return [
      { source: '/api/v1/auth/:path*', destination: `${AUTH_URL}/api/v1/auth/:path*` },
      { source: '/api/v1/admin/:path*', destination: `${AUTH_URL}/api/v1/admin/:path*` },
      { source: '/api/v1/tickets/:path*', destination: `${TICKET_URL}/api/v1/tickets/:path*` },
      { source: '/api/v1/tickets', destination: `${TICKET_URL}/api/v1/tickets` },
      { source: '/api/media/:path*', destination: `${MEDIA_URL}/api/media/:path*` },
    ]
  },
}

export default withNextIntl(nextConfig)

import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory containing this config (AAELink app root). Pins Turbopack so a parent lockfile does not steal the workspace root. */
const appDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Next.js dev blocks cross-origin requests to `/_next/*` unless the page origin's
 * hostname is allowlisted. Other PCs open `http://192.168.x.x:3040`; that hostname
 * must be listed or scripts/styles fail with 403. Merges with built-in localhost.
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
 */
function buildAllowedDevOrigins() {
  const hosts = []
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (app) {
    try {
      hosts.push(new URL(app).hostname)
    } catch {
      /* ignore */
    }
  }
  const extra = process.env.NEXT_ALLOWED_DEV_HOSTS?.trim()
  if (extra) {
    for (const h of extra.split(/[\s,]+/).filter(Boolean)) {
      hosts.push(h)
    }
  }
  return [...new Set(hosts)]
}

const allowedDevOrigins = buildAllowedDevOrigins()

/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Hide the Next.js route indicator in dev (Electron and end-user demos). */
  devIndicators: false,
  turbopack: {
    root: appDir
  },
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
  experimental: {
    serverActions: {}
  },
  serverExternalPackages: ['pg', '@aws-sdk/client-s3']
}

export default nextConfig

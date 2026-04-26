/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {}
  },
  serverExternalPackages: ['pg', '@aws-sdk/client-s3']
}

export default nextConfig

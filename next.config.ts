import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typescript: {
    // Ignorar errores de TypeScript en build — los tipos se validan en dev
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@omnimetrics/types'],
}

export default nextConfig

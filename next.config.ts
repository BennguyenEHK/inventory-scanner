import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    // Allow Tavily verification image URLs from any HTTPS host
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

export default nextConfig

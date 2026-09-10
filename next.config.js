/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['papaparse'],
  },
}

module.exports = nextConfig

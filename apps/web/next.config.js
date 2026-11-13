/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || (isProd ? '/clipfarm' : ''),
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || (isProd ? '/clipfarm/' : undefined),
  transpilePackages: []
};

module.exports = nextConfig;

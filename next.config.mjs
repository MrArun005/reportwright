/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // report definitions and fonts are read from disk by API routes
  outputFileTracingIncludes: { '/api/**': ['./reports/**', './public/fonts/**'] },
};
export default nextConfig;

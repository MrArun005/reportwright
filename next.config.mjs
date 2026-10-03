/** @type {import('next').NextConfig} */
const embedOrigin = process.env.PW_EMBED_ORIGINS || '';
const cors = (value) => [{ key: 'Access-Control-Allow-Origin', value }, { key: 'Access-Control-Allow-Methods', value: 'GET' }];

const nextConfig = {
  reactStrictMode: true,
  // report definitions and fonts are read from disk by API routes
  outputFileTracingIncludes: { '/api/**': ['./reports/**', './public/fonts/**', './public/harfbuzz-subset.wasm'] },
  async headers() {
    return [
      // static assets the embeddable viewer needs on other sites
      { source: '/fonts/:path*', headers: cors('*') },
      { source: '/harfbuzz-subset.wasm', headers: cors('*') },
      { source: '/embed/:path*', headers: cors('*') },
      // report definitions and sample data: only for the origin you allow (PW_EMBED_ORIGINS)
      ...(embedOrigin ? [
        { source: '/api/reports/:path*', headers: cors(embedOrigin) },
        { source: '/api/sample/:path*', headers: cors(embedOrigin) },
        { source: '/api/fonts', headers: cors(embedOrigin) },
      ] : []),
    ];
  },
};
export default nextConfig;

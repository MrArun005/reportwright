import { pageHeaders } from './src/server/headers.js';

/** @type {import('next').NextConfig} */
const embedOrigin = process.env.PW_EMBED_ORIGINS || '';
// ETag exposed: an embedded designer reads a report's revision for If-Match (its saves would otherwise be 428)
const cors = (value) => [{ key: 'Access-Control-Allow-Origin', value }, { key: 'Access-Control-Allow-Methods', value: 'GET' }, { key: 'Access-Control-Expose-Headers', value: 'ETag' }];

const nextConfig = {
  reactStrictMode: true,
  // the Docker image runs Next's standalone server (PW_STANDALONE=1 at build time); `next start` stays as it was
  ...(process.env.PW_STANDALONE ? { output: 'standalone' } : {}),
  // report definitions and fonts are read from disk by API routes
  // pw-worker/: the render worker's own bundle (scripts/build-worker.mjs), for the standalone output, which has no src/
  outputFileTracingIncludes: { '/api/**': ['./reports/**', './public/fonts/**', './public/harfbuzz-subset.wasm', './public/icc/**', './pw-worker/**'] },
  async headers() {
    return [
      // security headers on every page and answer (src/server/headers.js); routes serving report output add their own
      ...pageHeaders(embedOrigin),
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

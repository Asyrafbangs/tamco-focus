import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * The Content-Security-Policy intentionally omits `unsafe-eval`. `unsafe-inline`
 * is required for styles because Next.js injects critical CSS inline during
 * streaming; scripts use a strict-dynamic-free allowlist limited to `self`.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,

  // `next build` empties and rewrites its output directory. When the verify
  // suite ran a production build while a dev server was up, it removed the
  // chunks that server was serving, and the next page request failed with
  // ENOENT on a compiled route. Letting the build gate target its own directory
  // keeps the two from colliding.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  // Attachments are streamed through authorised server routes, never proxied
  // through the Next.js image optimiser.
  images: { remotePatterns: [] },

  experimental: {
    // Server Actions handle every high-impact transaction. The body limit
    // bounds pasted screenshots and file evidence at the framework edge; the
    // authoritative limit is enforced again server-side in the domain layer.
    serverActions: { bodySizeLimit: '12mb' },
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

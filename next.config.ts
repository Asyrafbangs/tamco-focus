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

  /**
   * v45 section 55 — `/team-focus` was folded into Work as a scope, not a
   * destination. The route is gone, but links to it are not: they sit in old
   * notification emails, in bookmarks, and in people's muscle memory. A 308
   * sends them where the screen actually lives instead of a 404 that reads as
   * "your team view was deleted".
   *
   * v53 §22 — `/team` follows it. It had been kept as "compatibility and
   * depth", but the depth moved into the Team Member drawer inside Work and
   * the page became a second implementation of the same three questions,
   * reading its own copies of the same queries. Two screens answering one
   * question is how they start to disagree. Only the compatibility is left,
   * and a redirect is all compatibility needs.
   */
  async redirects() {
    return [
      { source: '/team-focus', destination: '/work?scope=team', permanent: true },
      { source: '/team', destination: '/work?scope=team', permanent: true },
    ];
  },
};

export default nextConfig;

import { createHash } from 'node:crypto';

/**
 * The rate-limit bucket for a public report (v288, §6).
 *
 * Its own module, and not beside the rest of the public-reporting domain,
 * because it needs `node:crypto`: `esh-public-report.ts` is imported by the
 * form itself, and a Node built-in in a client bundle does not build.
 *
 * A hash of the caller's address, the date and a secret. The counter table
 * holds a bucket and a count and nothing else — no report refers to a bucket
 * and no bucket refers to a report — so even somebody holding the whole
 * database cannot turn the counters back into a list of who reported what. It
 * also changes every day regardless.
 *
 * With no address at all — a proxy that strips it — there is no bucket, and
 * the per-location limit is what remains. An absent header must never become
 * one shared bucket: that would put every anonymous reporter behind a single
 * counter and rate-limit the whole site down to six reports.
 */
export function throttleBucket(address: string | null, today = new Date()): string | null {
  const trimmed = (address ?? '').split(',')[0]?.trim() ?? '';
  if (!trimmed) return null;
  const day = today.toISOString().slice(0, 10);
  /*
   * `ESH_` and not `PUBLIC_`. Vercel treats `PUBLIC_` as a public framework
   * prefix — SvelteKit and Astro use it — and refuses to store such a variable
   * as a secret at all, on the grounds that the name says it is public. This
   * value is read on the server and must never be one.
   */
  const salt = process.env.ESH_REPORT_SALT ?? 'tamco-public-report';
  return createHash('sha256')
    .update(`${trimmed}:${day}:${salt}`, 'utf8')
    .digest('hex')
    .slice(0, 48);
}

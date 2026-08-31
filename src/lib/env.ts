/**
 * Environment configuration, validated once at module load.
 *
 * Two separate schemas on purpose. `publicEnv` holds only values that are safe
 * in a browser bundle; `serverEnv` holds the rest and is guarded by
 * `server-only`, so importing it from a client component is a build error
 * rather than a leaked service-role key.
 */

import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!parsedPublic.success) {
  throw new Error(
    'Supabase connection settings are missing or malformed. Copy .env.example to ' +
      '.env.local and run the local setup script to populate it.\n' +
      parsedPublic.error.issues
        .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
        .join('\n'),
  );
}

export const publicEnv = parsedPublic.data;

/** Attachment policy, read by both the upload route and the client-side
 * pre-check so the two cannot disagree about what is allowed. */
export const attachmentPolicy = {
  maxBytes: Number(process.env.ATTACHMENT_MAX_BYTES ?? 10_485_760),
  allowedMimeTypes: (
    process.env.ATTACHMENT_ALLOWED_MIME ??
    'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  signedUrlTtlSeconds: Number(process.env.ATTACHMENT_SIGNED_URL_TTL_SECONDS ?? 120),
  /**
   * Honest by default. Nothing in this application fabricates a scan result;
   * when this is false, files are stored unscanned and
   * `docs/future-deployment.md` records it as a pre-production gate.
   */
  virusScanEnabled: process.env.ATTACHMENT_VIRUS_SCAN_ENABLED === 'true',
} as const;

/*
 * `weeklySummaryDay` and `weeklySummaryHour` used to sit here and were read by
 * nothing. The deployed schedule comes from `weeklyWindow`'s own defaults,
 * because `/api/cron` does not pass either one — so setting WEEKLY_SUMMARY_DAY
 * or WEEKLY_SUMMARY_HOUR in the hosting environment changed nothing at all,
 * while looking exactly like the control that decided when mail went out.
 * Those two variables are read only by `scripts/run-weekly-summaries.ts`, which
 * runs from somebody's own machine. Removed rather than wired up: the schedule
 * is asserted by a test against `vercel.json`, and a value that can be changed
 * without the test seeing it would put the Tuesday bug straight back.
 */
export const orgConfig = {
  timeZone: process.env.ORG_TIMEZONE ?? 'Asia/Kuala_Lumpur',
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
} as const;

/**
 * The origin to put in an emailed link, taken from the request that asked.
 *
 * `orgConfig.appBaseUrl` reads `APP_BASE_URL` and falls back to localhost. That
 * fallback is right for a worker with no request, and catastrophic for a
 * password reset: with the variable unset in the hosting platform, every
 * recovery email pointed at `http://localhost:3000/auth/callback`, so the link
 * opened nothing on the recipient's machine. Nobody could tell from the app
 * that anything was wrong — the mail sent, the token was valid, the address in
 * it was simply not this website.
 *
 * A request knows its own origin, so anything sent in response to one uses that
 * and cannot be misconfigured. `x-forwarded-*` is set by the platform proxy;
 * `host` covers running it directly.
 */
export async function requestOrigin(): Promise<string> {
  const { headers } = await import('next/headers');
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  if (!host) return orgConfig.appBaseUrl;
  const protocol =
    headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

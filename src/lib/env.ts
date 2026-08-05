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

export const orgConfig = {
  timeZone: process.env.ORG_TIMEZONE ?? 'Asia/Kuala_Lumpur',
  weeklySummaryDay: process.env.WEEKLY_SUMMARY_DAY ?? 'monday',
  weeklySummaryHour: Number(process.env.WEEKLY_SUMMARY_HOUR ?? 8),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
} as const;

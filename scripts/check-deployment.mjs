#!/usr/bin/env node
/**
 * What is actually deployed, asked of the database rather than of a document.
 *
 * Stage D's problem is that nobody in a session can read Production: the
 * permission classifier blocks it, and every claim about it has to come from
 * the account owner running something themselves. This is that something.
 *
 * It answers three questions and refuses to guess at any of them:
 *
 *   1. **Which migrations are applied?** Read from
 *      `supabase_migrations.schema_migrations` and compared against the files
 *      in this checkout, so the answer is a list of versions rather than
 *      `db push` saying "up to date" — which has misled twice.
 *   2. **Is the configuration present?** The variables whose absence is
 *      silent: `EMAIL_TRANSPORT` (production ran for weeks on `log` with every
 *      cron run returning 200), `CRON_SECRET` (without it the endpoint
 *      answers 503 and nothing scheduled runs at all), `ATTACHMENT_ALLOWED_MIME`
 *      and the scanner pair.
 *   3. **Is the service-role key the one you think it is?** Its project ref
 *      and its issued-at date, decoded from the token itself. After a rotation
 *      that date is how you tell the new key from the old one.
 *
 * It never prints a key, a token or a secret: only whether one is set, and for
 * the service-role key the claims that are not secret. It writes nothing and
 * changes nothing — there is no flag that makes it write.
 *
 * Usage, with the target's variables in the shell (Node's `--env-file` never
 * overrides an existing variable, so exporting them is the reliable way):
 *
 *   TAMCO_ENV=production \
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node scripts/check-deployment.mjs
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resolveEnvironment } from './lib/environment.mjs';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

/** The migration versions this checkout contains, in order. */
function migrationsOnDisk() {
  const directory = path.join(root, 'supabase', 'migrations');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ version: name.split('_')[0], name }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * A JWT's own claims, without verifying it — this is not authentication, it is
 * "which key is this". A malformed token says so rather than throwing.
 */
function keyClaims(token) {
  const middle = (token ?? '').split('.')[1];
  if (!middle) return null;
  try {
    const json = Buffer.from(middle.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const claims = JSON.parse(json);
    return {
      role: claims.role ?? null,
      ref: claims.ref ?? claims.iss ?? null,
      issuedAt: claims.iat ? new Date(claims.iat * 1000).toISOString() : null,
      expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

function say(status, text) {
  const mark = status === 'ok' ? '  ok  ' : status === 'warn' ? ' warn ' : ' MISS ';
  console.log(`${mark} ${text}`);
}

/**
 * Which migrations the remote database has, from the CLI that owns the answer.
 *
 * `supabase migration list --linked` prints local and remote versions side by
 * side, which is the comparison this question needs. It is used rather than a
 * query because the migrations table is not exposed to PostgREST - reading it
 * over REST answers 406 - and because `db push` reporting "Remote database is
 * up to date" has misled twice.
 */
function migrationList() {
  try {
    const printed = execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['supabase', 'migration', 'list', '--linked'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
    );
    return { ok: true, printed };
  } catch (cause) {
    const detail = cause?.stderr || cause?.stdout || (cause instanceof Error ? cause.message : '');
    // The tail, not the whole output: the CLI's failures end with the part
    // that says what to do, and the rest is a banner.
    return { ok: false, detail: String(detail).trim().slice(-300) };
  }
}

async function main() {
  const resolved = resolveEnvironment();
  console.log(`\nTarget: ${resolved.environment.toUpperCase()} (${resolved.host})\n`);
  if (resolved.environment === 'local') {
    console.log('This is the local stack. Run it against a deployed target to learn anything.\n');
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!key) {
    say('miss', 'SUPABASE_SERVICE_ROLE_KEY is not set, so nothing can be read.');
    process.exitCode = 1;
    return;
  }

  console.log('Service-role key');
  const claims = keyClaims(key);
  if (!claims) {
    say('warn', 'the key is not a JWT this can read; it may still be valid.');
  } else {
    say(claims.role === 'service_role' ? 'ok' : 'miss', `role: ${claims.role ?? 'unknown'}`);
    say('ok', `project: ${claims.ref ?? 'unknown'}`);
    // After a rotation this is the line that proves which key is in use.
    say('ok', `issued: ${claims.issuedAt ?? 'unknown'}`);
    if (claims.expiresAt) say('ok', `expires: ${claims.expiresAt}`);
  }

  console.log('');
  console.log('Migrations');
  const disk = migrationsOnDisk();
  say(
    'ok',
    `${disk.length} migration files in this checkout, newest ${disk[disk.length - 1]?.name}`,
  );
  /*
   * `--no-migrations` skips the only step that reaches the linked project, so
   * the configuration checks can be run anywhere — including from a session
   * that is not allowed to read a deployed database at all.
   */
  const list = process.argv.includes('--no-migrations')
    ? { ok: false, detail: 'skipped: --no-migrations' }
    : migrationList();
  if (list.ok) {
    // Printed verbatim: the CLI's own two columns are the answer, and
    // summarising them would be one more place for this to go stale.
    console.log(list.printed.trim());
    console.log('');
    console.log('  A version under Local with nothing under Remote is not applied.');
    console.log('  Push it with `npx supabase db push --linked` once its branch is merged.');
  } else {
    say('warn', 'the remote migration list could not be read:');
    if (list.detail) console.log(`        ${list.detail}`);
    console.log('        Run `npx supabase migration list --linked` yourself to compare.');
  }

  console.log('\nConfiguration');
  const transport = process.env.EMAIL_TRANSPORT ?? '';
  say(
    transport === 'smtp' ? 'ok' : transport ? 'warn' : 'miss',
    `EMAIL_TRANSPORT: ${transport || 'not set'}${
      transport && transport !== 'smtp' ? ' — mail is not being sent' : ''
    }`,
  );
  say(
    process.env.CRON_SECRET ? 'ok' : 'miss',
    'CRON_SECRET' + (process.env.CRON_SECRET ? '' : ' — the cron endpoint answers 503'),
  );
  const mime = process.env.ATTACHMENT_ALLOWED_MIME ?? '';
  say(
    mime ? 'ok' : 'warn',
    `ATTACHMENT_ALLOWED_MIME: ${mime ? `${mime.split(',').length} types` : 'not set (the built-in list applies)'}`,
  );

  const scanner = process.env.ESH_SCANNER_URL ?? '';
  const scannerToken = process.env.ESH_SCANNER_TOKEN ?? '';
  const loopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(scanner);
  if (!scanner) {
    say('warn', 'ESH_SCANNER_URL: not set — every file stays "Not scanned", which the app says');
  } else if (!scannerToken && !loopback) {
    say(
      'miss',
      'ESH_SCANNER_URL is remote but ESH_SCANNER_TOKEN is empty — the worker refuses to send evidence',
    );
  } else {
    say('ok', 'scanner configured');
  }
  say(
    process.env.PUBLIC_REPORT_SALT ? 'ok' : 'warn',
    'PUBLIC_REPORT_SALT' +
      (process.env.PUBLIC_REPORT_SALT ? '' : ' — rate-limit buckets fall back to a constant salt'),
  );

  console.log(
    '\nNothing was written. Public QR reporting is opened from the application, by an administrator, with a reason.\n',
  );
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});

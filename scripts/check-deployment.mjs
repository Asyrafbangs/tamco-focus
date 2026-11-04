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

/** One read through PostgREST, as the service role. Never writes. */
async function read(url, key, path) {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${path.split('?')[0]} answered ${response.status}`);
  }
  return response.json();
}

/**
 * The part of the smoke test a machine can do: read-only assertions about what
 * the deployment actually holds.
 *
 * Everything here is a `select`. Nothing is created, changed or sent — the
 * cron is reported from the rows it already wrote rather than run, because
 * running it sends real email, and that is the operator's decision rather than
 * a side effect of a status check.
 *
 * What it cannot do is the half that needs a person: opening a finding,
 * classifying it, uploading a photograph, confirming a reader without access
 * gets a 404, and receiving the mail. Those stay in the runbook.
 */
async function smoke(url, key) {
  console.log('');
  console.log('Read-only production checks');
  let failed = false;
  const miss = (text) => {
    failed = true;
    say('miss', text);
  };

  try {
    const settings = await read(url, key, 'esh_qr_intake_settings?select=enabled');
    /*
     * v290 - the state, said plainly, rather than an expectation that has since
     * been overtaken.
     *
     * This failed whenever the switch was on, because when it was written the
     * channel had never been opened. It was opened deliberately on 4 November
     * 2026 for a one-area pilot, so the check now reports a miss for the state
     * the owner chose - and a check that is red for a correct deployment stops
     * being read, which matters here because this command is the only evidence
     * anybody has that the scheduled run is working.
     *
     * Open is still worth saying loudly: anonymous reports can arrive and
     * somebody has to be watching the queue. It is a warning, not a failure.
     */
    if (settings.length !== 1)
      miss(`public reporting settings: ${settings.length} rows, expected 1`);
    else if (settings[0].enabled !== false)
      say('warn', 'public QR reporting is OPEN — reports can arrive; somebody must be watching');
    else say('ok', 'public QR reporting is closed');
  } catch (cause) {
    miss(`public reporting settings unreadable: ${cause.message}`);
  }

  try {
    const categories = await read(url, key, 'esh_hazard_categories?select=code&active=eq.true');
    if (categories.length === 9) say('ok', 'nine hazard categories, active');
    else miss(`hazard categories: ${categories.length}, expected 9`);
  } catch (cause) {
    miss(`hazard categories unreadable (v287 applied?): ${cause.message}`);
  }

  try {
    const distribution = await read(url, key, 'esh_hazard_distribution?select=code,findings');
    say('ok', `the hazard distribution view answers (${distribution.length} categories)`);
  } catch (cause) {
    miss(`the hazard distribution view is unreadable: ${cause.message}`);
  }

  // The view v287 replaced. If `create or replace` had gone wrong, this is
  // where the register stops serving rows.
  try {
    const rows = await read(url, key, 'esh_register_rows?select=finding_id,hazard_label&limit=5');
    const classified = rows.filter((row) => row.hazard_label).length;
    say('ok', `the register view serves rows (${rows.length} read, ${classified} classified)`);
  } catch (cause) {
    miss(`the register view is unreadable: ${cause.message}`);
  }

  try {
    await read(url, key, 'esh_report_intake_photos?select=id&limit=1');
    say('ok', 'the public report photo table exists (v288 applied)');
  } catch (cause) {
    miss(`v288 objects missing: ${cause.message}`);
  }

  /*
   * Nothing may read as scanned while no scanner is configured. The states are
   * counted rather than listed: a file name is somebody's evidence.
   */
  try {
    const assets = await read(url, key, 'esh_evidence_assets?select=scan_state&limit=1000');
    const states = new Map();
    for (const asset of assets) {
      states.set(asset.scan_state, (states.get(asset.scan_state) ?? 0) + 1);
    }
    const printed = [...states].map(([state, count]) => `${state}: ${count}`).join(', ');
    if (!process.env.ESH_SCANNER_URL && states.has('clean')) {
      miss(`evidence reads "clean" with no scanner configured (${printed})`);
    } else {
      say('ok', `evidence scan states — ${printed || 'no evidence yet'}`);
    }
  } catch (cause) {
    miss(`evidence assets unreadable: ${cause.message}`);
  }

  /*
   * When the scheduler last ran, from the rows it writes itself. This is the
   * honest version of "are the cron jobs working" that does not send anything:
   * a worker that has not run today is the symptom a missing CRON_SECRET
   * produces.
   */
  try {
    const runs = await read(
      url,
      key,
      'esh_worker_runs?select=worker,ran_at,ok&order=ran_at.desc&limit=5',
    );
    if (runs.length === 0) miss('no worker run has ever been recorded');
    else {
      const newest = runs[0];
      const age = (Date.now() - new Date(newest.ran_at).getTime()) / 3_600_000;
      const line = `last worker run: ${newest.worker} ${newest.ran_at} (${age.toFixed(1)}h ago)`;
      if (age > 36) miss(`${line} — the scheduler has not run since`);
      else say('ok', line);
    }
  } catch (cause) {
    miss(`worker runs unreadable: ${cause.message}`);
  }

  if (failed) process.exitCode = 1;
  console.log('');
  console.log('  Still needs a person: open a finding, classify it, upload a photograph,');
  console.log('  confirm a reader with no access gets a 404, and receive one email.');
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
  /*
   * Present is not enough. A `CRON_SECRET` with a leading or trailing space —
   * the shape a value pasted from a password manager or an editor takes —
   * cannot go into an HTTP header, so Vercel refuses the build outright and
   * every production deployment fails in three seconds. It did, twice, on
   * 4 November 2026, and the symptom was a merged feature that never appeared
   * on the site rather than anything mentioning cron.
   *
   * It also breaks the endpoint itself: the route compares the bearer exactly,
   * so a secret with a stray newline never matches and the scheduled work
   * simply never runs.
   */
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret) {
    say('miss', 'CRON_SECRET — the cron endpoint answers 503 and nothing scheduled runs');
  } else if (cronSecret !== cronSecret.trim()) {
    say(
      'miss',
      'CRON_SECRET has leading or trailing whitespace — Vercel refuses the build, and the ' +
        'endpoint would never match the bearer. Re-save it with no spaces or newlines.',
    );
  } else {
    say('ok', 'CRON_SECRET');
  }
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
    process.env.ESH_REPORT_SALT ? 'ok' : 'warn',
    'ESH_REPORT_SALT' +
      (process.env.ESH_REPORT_SALT ? '' : ' — rate-limit buckets fall back to a constant salt'),
  );

  if (process.argv.includes('--smoke')) {
    await smoke(resolved.url, key);
  } else {
    console.log('');
    console.log('  Add --smoke for the read-only production checks.');
  }

  console.log(
    '\nNothing was written. Public QR reporting is opened from the application, by an administrator, with a reason.\n',
  );
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});

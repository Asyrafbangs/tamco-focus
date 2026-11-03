import { readFileSync } from 'node:fs';

/**
 * Positive environment identification, for anything that can change data.
 *
 * The rule this exists to enforce is section 36 of the migration instruction:
 * never infer the environment from memory, and stop the command outright if it
 * cannot be identified. Everything destructive in this repository routes
 * through `assertLocal` so there is one place to be right rather than a habit
 * to be remembered.
 *
 * Two independent signals have to agree:
 *
 *   the Supabase URL   loopback means local, anything else means hosted
 *   TAMCO_ENV          the operator's declaration of intent
 *
 * A remote URL with no declaration is refused rather than guessed, and a
 * declaration that contradicts the URL is refused rather than trusted — a
 * `.env.local` pointed at Production while still labelled `local` is exactly
 * the accident the rule is about.
 */

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|host\.docker\.internal)(:\d+)?/i;

export const ENVIRONMENTS = ['local', 'staging', 'production'];

export class EnvironmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

/**
 * @param {{ url?: string, declared?: string }} [input]
 * @returns {{ environment: 'local'|'staging'|'production', url: string, declared: string|null, host: string }}
 */
export function resolveEnvironment(input = {}) {
  const url = input.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const declared = (input.declared ?? process.env.TAMCO_ENV ?? '').trim().toLowerCase() || null;

  if (!url) {
    throw new EnvironmentError(
      'NEXT_PUBLIC_SUPABASE_URL is not set, so the target database cannot be identified. ' +
        'Refusing to continue.',
    );
  }
  if (declared && !ENVIRONMENTS.includes(declared)) {
    throw new EnvironmentError(
      `TAMCO_ENV is "${declared}", which is not one of ${ENVIRONMENTS.join(', ')}. ` +
        'Refusing to continue.',
    );
  }

  let host;
  try {
    host = new URL(url).host;
  } catch {
    throw new EnvironmentError(`NEXT_PUBLIC_SUPABASE_URL is not a URL: ${url}`);
  }

  const looksLocal = LOOPBACK.test(url);

  if (looksLocal) {
    if (declared && declared !== 'local') {
      throw new EnvironmentError(
        `TAMCO_ENV says "${declared}" but the Supabase URL is loopback (${host}). ` +
          'The two disagree, so the target cannot be identified. Refusing to continue.',
      );
    }
    return { environment: 'local', url, declared, host };
  }

  if (!declared) {
    throw new EnvironmentError(
      `The Supabase URL is remote (${host}) and TAMCO_ENV is not set, so this could be ` +
        'Staging or Production. Set TAMCO_ENV explicitly. Refusing to guess.',
    );
  }
  if (declared === 'local') {
    throw new EnvironmentError(
      `TAMCO_ENV says "local" but the Supabase URL is remote (${host}). ` + 'Refusing to continue.',
    );
  }

  return { environment: declared, url, declared, host };
}

/**
 * Refuses anything destructive outside the local stack.
 *
 * @param {string} action human-readable description, used in the refusal
 */
export function assertLocal(action) {
  const resolved = resolveEnvironment();
  if (resolved.environment !== 'local') {
    throw new EnvironmentError(
      `Refusing to ${action}: the target is ${resolved.environment.toUpperCase()} (${resolved.host}).\n` +
        'Development fixtures, resets and destructive scripts run against the local stack only.' +
        shellOverrideHint(),
    );
  }
  return resolved;
}

/**
 * Where that URL came from, when the answer is "this shell".
 *
 * The refusal above is correct and has fired three times in one session for
 * the same reason: `TAMCO_ENV` and `NEXT_PUBLIC_SUPABASE_URL` were still set
 * from a production command, and `--env-file` cannot override a variable
 * already in the environment. Saying only "the target is PRODUCTION" sends the
 * reader looking at `.env.local`, which is innocent — so when the shell is what
 * disagrees with the file, the refusal now says so and gives the line that
 * clears it.
 *
 * Only ever reached on the refusal path, and a file it cannot read simply
 * yields no hint.
 */
function shellOverrideHint() {
  const shellUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!shellUrl) return '';
  let fileUrl = null;
  try {
    const file = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
    fileUrl = /^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(file)?.[1]?.trim() ?? null;
  } catch {
    return '';
  }
  if (!fileUrl || fileUrl === shellUrl) return '';
  return (
    `\n\nThis shell sets NEXT_PUBLIC_SUPABASE_URL, which overrides the ${fileUrl} in\n` +
    '.env.local. Clear the production variables in this window first:\n\n' +
    '  Remove-Item Env:\\TAMCO_ENV, Env:\\NEXT_PUBLIC_SUPABASE_URL, ' +
    'Env:\\SUPABASE_SERVICE_ROLE_KEY, Env:\\SUPABASE_DB_URL -ErrorAction SilentlyContinue'
  );
}

/** Refuses only against Production, for work Staging is allowed to do. */
export function assertNotProduction(action) {
  const resolved = resolveEnvironment();
  if (resolved.environment === 'production') {
    throw new EnvironmentError(
      `Refusing to ${action}: the target is PRODUCTION (${resolved.host}).`,
    );
  }
  return resolved;
}

/**
 * The Supabase project a hosted URL names, or null when it names none.
 *
 * Only `*.supabase.co` and `*.supabase.in` carry the ref in the hostname. A
 * loopback URL or a custom domain returns null, which means "no claim to
 * check" rather than "no project".
 */
export function projectRefOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = /^([a-z0-9-]+)\.supabase\.(co|in)$/.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A JWT's own claims, unverified. This is "which key is this", not auth. */
function keyClaims(key) {
  const middle = (key ?? '').split('.')[1];
  if (!middle) return null;
  try {
    return JSON.parse(
      Buffer.from(middle.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
  } catch {
    return null;
  }
}

/**
 * Refuse a key that was issued for a different project than the target.
 *
 * `--env-file` never overrides a variable already in the shell, so setting
 * `NEXT_PUBLIC_SUPABASE_URL` to Production while leaving
 * `SUPABASE_SERVICE_ROLE_KEY` to come from `.env.local` sends the **local**
 * demo key to Production. Every request then fails on authorisation, and the
 * failure surfaces wherever the first request happened to be — on 3 November
 * 2026 that was the storage bucket check, which reported the production bucket
 * as "unavailable or public" and read like a security finding.
 *
 * The two claims are enough to tell: a hosted key carries its `ref`, and the
 * local stack's demo keys are issued by `supabase-demo`.
 */
export function assertKeyMatchesTarget(url, key) {
  const ref = projectRefOf(url);
  if (!ref) return;
  const claims = keyClaims(key);
  // Not a JWT - a new-style `sb_secret_...` key carries no readable claim.
  if (!claims) return;
  if (claims.iss === 'supabase-demo' || (!claims.ref && claims.iss !== 'supabase')) {
    throw new EnvironmentError(
      `The key in use is the local stack's own key, and the target is ${ref}.\n` +
        'Set SUPABASE_SERVICE_ROLE_KEY in the shell as well as the URL: a value in\n' +
        '.env.local cannot override one already set, and `--env-file` never overrides\n' +
        'the shell. Refusing to continue.',
    );
  }
  if (claims.ref && claims.ref !== ref) {
    throw new EnvironmentError(
      `The key was issued for project ${claims.ref} and the target is ${ref}. ` +
        'Refusing to continue.',
    );
  }
}

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
        'Development fixtures, resets and destructive scripts run against the local stack only.',
    );
  }
  return resolved;
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

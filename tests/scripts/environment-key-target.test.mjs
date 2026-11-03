import assert from 'node:assert/strict';
import test from 'node:test';

import { assertKeyMatchesTarget, projectRefOf } from '../../scripts/lib/environment.mjs';

/**
 * A key pointed at the wrong project, caught before the first request.
 *
 * On 3 November 2026 a production backup was run with the URL set in the
 * shell and the key left to come from `.env.local`. `--env-file` never
 * overrides a variable already in the shell, so the **local** demo key went to
 * Production; every request failed on authorisation, and the failure surfaced
 * wherever the first request happened to be — the storage bucket check, which
 * reported a private production bucket as "unavailable or public" and read
 * like a security finding.
 *
 * Nothing here makes a network call. The whole point is that the mistake is
 * visible in the two values before anything is sent.
 */

/** A JWT with these claims. The signature is irrelevant: nothing verifies it. */
function keyWith(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.not-a-signature`;
}

const LOCAL_KEY = keyWith({ iss: 'supabase-demo', role: 'service_role' });
const HOSTED_KEY = keyWith({ iss: 'supabase', ref: 'ypxbykvyjjtroyftzemi', role: 'service_role' });
const OTHER_KEY = keyWith({ iss: 'supabase', ref: 'someotherproject', role: 'service_role' });

test('a hosted URL names its project, and a loopback one names none', () => {
  assert.equal(projectRefOf('https://ypxbykvyjjtroyftzemi.supabase.co'), 'ypxbykvyjjtroyftzemi');
  assert.equal(projectRefOf('http://127.0.0.1:54321'), null);
  assert.equal(projectRefOf('not a url'), null);
});

test('the local stack key is refused against a hosted project', () => {
  assert.throws(
    () => assertKeyMatchesTarget('https://ypxbykvyjjtroyftzemi.supabase.co', LOCAL_KEY),
    /local stack's own key/,
  );
  // And the message says what to do, because the fix is one shell variable.
  assert.throws(
    () => assertKeyMatchesTarget('https://ypxbykvyjjtroyftzemi.supabase.co', LOCAL_KEY),
    /SUPABASE_SERVICE_ROLE_KEY in the shell/,
  );
});

test("a key for another project names both projects rather than saying 'invalid'", () => {
  assert.throws(
    () => assertKeyMatchesTarget('https://ypxbykvyjjtroyftzemi.supabase.co', OTHER_KEY),
    /someotherproject.*ypxbykvyjjtroyftzemi/,
  );
});

test('the right key for the right project passes', () => {
  assert.doesNotThrow(() =>
    assertKeyMatchesTarget('https://ypxbykvyjjtroyftzemi.supabase.co', HOSTED_KEY),
  );
});

/*
 * The local stack is where the local key belongs, and a loopback URL carries
 * no project to compare against anyway. Refusing here would break every
 * development command.
 */
test('the local key against the local stack passes', () => {
  assert.doesNotThrow(() => assertKeyMatchesTarget('http://127.0.0.1:54321', LOCAL_KEY));
});

/*
 * A new-style `sb_secret_…` key is not a JWT and carries no readable claim, so
 * there is nothing to check. Guessing would mean refusing a valid key.
 */
test('a key with no readable claims is left alone', () => {
  assert.doesNotThrow(() =>
    assertKeyMatchesTarget('https://ypxbykvyjjtroyftzemi.supabase.co', 'sb_secret_abcdef123456'),
  );
  assert.doesNotThrow(() => assertKeyMatchesTarget('https://ypxbykvyjjtroyftzemi.supabase.co', ''));
});

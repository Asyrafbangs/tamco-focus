import { expect, test } from '@playwright/test';

/**
 * §38 — the scheduled endpoint must be reachable by a scheduler, and by nobody
 * else.
 *
 * Both halves matter, and the first one nearly shipped broken. The session
 * proxy matched `/api/cron` and redirected it to sign-in, which a scheduler
 * reads as a perfectly good 307 — so routine generation and the weekly summary
 * would have silently never run, with nothing anywhere reporting a failure.
 *
 * A redirect is therefore as much a failure here as a 200 would be for an
 * unauthenticated caller, and this asserts against both.
 */
test('the scheduled endpoint refuses callers but is not redirected away', async ({ request }) => {
  const unauthenticated = await request.get('/api/cron', { maxRedirects: 0 });

  expect(
    unauthenticated.status(),
    'a redirect means the scheduler never reaches the endpoint',
  ).not.toBe(307);
  expect(unauthenticated.status()).not.toBe(302);

  // 401 when the secret is configured, 503 when it is not. Either proves the
  // route ran and refused; neither runs the work.
  expect([401, 503]).toContain(unauthenticated.status());

  const wrongSecret = await request.get('/api/cron', {
    headers: { authorization: 'Bearer not-the-configured-secret' },
    maxRedirects: 0,
  });
  expect([401, 503]).toContain(wrongSecret.status());

  // And nothing about the endpoint is described to whoever is probing it.
  const body = await unauthenticated.text();
  expect(body).not.toContain('routine');
  expect(body).not.toContain('weekly');
});

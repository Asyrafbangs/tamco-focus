import { describe, expect, it } from 'vitest';

import { resolveEmailTransport } from '@/server/workers/email-transport';

/**
 * The behaviour these pin is the one that made notification email look healthy
 * while delivering nothing: a ternary that treated every unrecognised value as
 * "log", which records a delivery as sent without sending it.
 */
describe('choosing an email transport', () => {
  it('defaults to log when nothing is configured', () => {
    const transport = resolveEmailTransport({});
    expect(transport).toMatchObject({ name: 'log' });
    // No sender, which is what makes the worker record a delivery as sent
    // without anything leaving. Honest for local work, disastrous unnoticed.
    expect('error' in transport).toBe(false);
    if (!('error' in transport)) expect(transport.send).toBeUndefined();
  });

  it('refuses an unrecognised transport instead of silently logging', () => {
    for (const value of ['brevo', 'inbucke', 'SMTP-ish', 'true']) {
      const transport = resolveEmailTransport({ EMAIL_TRANSPORT: value });
      expect('error' in transport).toBe(true);
      if ('error' in transport) expect(transport.error).toMatch(/not a transport/i);
    }
  });

  it('refuses smtp with no host rather than falling back', () => {
    const transport = resolveEmailTransport({ EMAIL_TRANSPORT: 'smtp' });
    expect('error' in transport).toBe(true);
    if ('error' in transport) expect(transport.error).toMatch(/EMAIL_SMTP_HOST/);
  });

  it('refuses smtp with a host but no credentials', () => {
    const transport = resolveEmailTransport({
      EMAIL_TRANSPORT: 'smtp',
      EMAIL_SMTP_HOST: 'smtp-relay.brevo.com',
    });
    expect('error' in transport).toBe(true);
    if ('error' in transport) {
      expect(transport.error).toMatch(/EMAIL_SMTP_USER/);
      expect(transport.error).toMatch(/silently discard/i);
    }
  });

  it('resolves smtp when fully configured', () => {
    const transport = resolveEmailTransport({
      EMAIL_TRANSPORT: 'smtp',
      EMAIL_SMTP_HOST: 'smtp-relay.brevo.com',
      EMAIL_SMTP_PORT: '587',
      EMAIL_SMTP_USER: 'relay-login',
      EMAIL_SMTP_PASSWORD: 'relay-key',
      EMAIL_FROM: 'noreply@focus.tamco.com.my',
    });
    expect('error' in transport).toBe(false);
    if (!('error' in transport)) {
      expect(transport.name).toBe('smtp');
      expect(transport.send).toBeTypeOf('function');
      expect(transport.description).toContain('smtp-relay.brevo.com:587');
      // The description is written to the run log, so it must not carry the key.
      expect(transport.description).not.toContain('relay-key');
    }
  });

  it('is case and whitespace tolerant, since this comes from a dashboard field', () => {
    const transport = resolveEmailTransport({ EMAIL_TRANSPORT: '  LOG ' });
    expect(transport).toMatchObject({ name: 'log' });
  });

  it('still supports the local capture transport', () => {
    const transport = resolveEmailTransport({ EMAIL_TRANSPORT: 'inbucket' });
    expect('error' in transport).toBe(false);
    if (!('error' in transport)) {
      expect(transport.name).toBe('inbucket');
      expect(transport.send).toBeTypeOf('function');
    }
  });
});

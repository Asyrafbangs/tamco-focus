import { describe, expect, it } from 'vitest';

import { resolveEmailTransport } from '@/server/workers/email-transport';
import { smtpConfigFromEnv } from '@/server/workers/smtp-transport';

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
      EMAIL_SMTP_PASSWORD: 'relay key',
      EMAIL_FROM: 'noreply@focus.tamco.com.my',
    });
    expect('error' in transport).toBe(false);
    if (!('error' in transport)) {
      expect(transport.name).toBe('smtp');
      expect(transport.send).toBeTypeOf('function');
      expect(transport.description).toContain('smtp-relay.brevo.com:587');
      // The description is written to the run log, so it must not carry the key.
      expect(transport.description).not.toContain('relay key');
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

/**
 * What a pasted environment variable actually looks like.
 *
 * Production was configured through a web form, and the first real send failed
 * with `501 5.1.7 Invalid address` from the relay - a reply that names nothing
 * and reads like a mailbox permissions problem. The cause is always in the
 * value: a space that came with the paste, or a display name that came with
 * the address. Both are now handled here, where the variable can be named,
 * rather than by a remote server that cannot see one.
 */
describe('reading mail configuration a person typed', () => {
  const base = {
    EMAIL_SMTP_HOST: 'smtp.office365.com',
    EMAIL_SMTP_USER: 'sender@example.com',
    EMAIL_SMTP_PASSWORD: 'pw',
    EMAIL_FROM: 'sender@example.com',
  };

  it('trims whitespace off the host, user and sender', () => {
    const config = smtpConfigFromEnv({
      ...base,
      EMAIL_SMTP_HOST: '  smtp.office365.com  ',
      EMAIL_SMTP_USER: ' sender@example.com\n',
      EMAIL_FROM: ' sender@example.com ',
    });
    expect(config).toMatchObject({
      host: 'smtp.office365.com',
      user: 'sender@example.com',
      from: 'sender@example.com',
    });
  });

  it('leaves the password exactly as given', () => {
    // Trailing space is legal in a password, and silently changing a
    // credential is worse than a clear 535 from the server.
    const config = smtpConfigFromEnv({ ...base, EMAIL_SMTP_PASSWORD: ' pw ' });
    expect(config).toMatchObject({ password: ' pw ' });
  });

  it('accepts the Name <address> form and keeps the name', () => {
    const config = smtpConfigFromEnv({ ...base, EMAIL_FROM: 'TAMCO Focus <sender@example.com>' });
    expect(config).toMatchObject({ from: 'sender@example.com', fromName: 'TAMCO Focus' });
  });

  it('lets EMAIL_FROM_NAME win over a name that travelled with the address', () => {
    const config = smtpConfigFromEnv({
      ...base,
      EMAIL_FROM: '"Old Name" <sender@example.com>',
      EMAIL_FROM_NAME: 'TAMCO Focus',
    });
    expect(config).toMatchObject({ fromName: 'TAMCO Focus' });
  });

  it('refuses a sender that is not one address, and says which variable', () => {
    for (const value of [
      // A field that already held the address when it was typed into again.
      'sender@example.comsender@example.com',
      'one@example.com, two@example.com',
      'not-an-address',
      '<>',
    ]) {
      const config = smtpConfigFromEnv({ ...base, EMAIL_FROM: value });
      expect(config).toMatchObject({ error: expect.stringContaining('EMAIL_FROM') });
    }
  });

  it('refuses a port that is not a port', () => {
    // 587587 is what a field already containing 587 produces when somebody
    // types 587 into it. It used to become a connection timeout.
    for (const value of ['587587', 'five-eight-seven', '0', '99999']) {
      const config = smtpConfigFromEnv({ ...base, EMAIL_SMTP_PORT: value });
      expect(config).toMatchObject({ error: expect.stringContaining('EMAIL_SMTP_PORT') });
    }
  });

  it('still defaults the port to 587', () => {
    expect(smtpConfigFromEnv(base)).toMatchObject({ port: 587 });
  });
});

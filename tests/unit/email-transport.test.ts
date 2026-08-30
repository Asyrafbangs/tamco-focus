import { describe, expect, it } from 'vitest';

import { resolveEmailTransport } from '@/server/workers/email-transport';
import {
  isPermanentReplyCode,
  PermanentDeliveryError,
  scrubError,
  sendSmtp,
  smtpConfigFromEnv,
} from '@/server/workers/smtp-transport';

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

/**
 * A real relay only gets an address that could actually receive mail.
 *
 * The seed fixtures use `@tamco.local`. The moment a real SMTP transport was
 * configured, a worker run handed two of them to Office 365, which accepted
 * them at RCPT and bounced them afterwards — nobody received anything, and the
 * sending mailbox collected the failures. `sendSmtp` is the one place every
 * real send passes through, so the refusal lives there rather than in each
 * worker; the inbucket capture is deliberately left alone, because catching
 * `.local` is precisely its purpose.
 */
describe('refusing to send to an address that cannot receive mail', () => {
  const config = {
    host: 'smtp.office365.com',
    port: 587,
    user: 'sender@example.org',
    password: 'pw',
    from: 'sender@example.org',
  };
  const message = { subject: 's', text: 't', html: '<p>h</p>' };

  it.each([
    'izzah@tamco.local',
    'someone@corp.internal',
    'someone@box.lan',
    'someone@host.test',
    'someone@nowhere.invalid',
  ])('refuses %s, naming the reserved name', async (to) => {
    await expect(sendSmtp(config, { ...message, to })).rejects.toThrow(/reserved name/i);
  });

  /*
   * `someone@localhost` is refused a step earlier, by the shape check: a
   * domain with no dot is not an address at all. Different sentence, same
   * outcome, so what this pins is that it never reaches a relay.
   */
  it.each(['not-an-address', 'someone@localhost', 'one@a.com, two@b.com'])(
    'refuses %s as not one address',
    async (to) => {
      await expect(sendSmtp(config, { ...message, to })).rejects.toThrow(/not one email address/i);
    },
  );

  /*
   * A routable address must get past the guard. It cannot reach a real server
   * from a unit test, so the pass condition is that it fails for a network
   * reason rather than a refusal.
   */
  it('lets a routable address through to the connection attempt', async () => {
    await expect(
      sendSmtp({ ...config, host: '127.0.0.1', port: 1 }, { ...message, to: 'real@tamco.com.my' }),
    ).rejects.not.toThrow(/reserved name|not one email address/i);
  });
});

/**
 * Which failures a retry could ever fix.
 *
 * The queue's default assumption is "transient": back off and try again, up to
 * ten times. For an address that cannot receive mail that is ten attempts and
 * a day of delay before anybody learns the address is wrong. The workers
 * decide from the TYPE of the error, so what matters here is that the type
 * survives — including through the scrubbing that rewrites the message on its
 * way out, which returned a plain Error and would have made every permanent
 * failure look transient again.
 */
describe('telling a permanent failure from a transient one', () => {
  const config = {
    host: '127.0.0.1',
    port: 1,
    user: 'sender@example.org',
    password: 'pw',
    from: 'sender@example.org',
  };
  const message = { subject: 's', text: 't', html: '<p>h</p>' };

  it.each(['izzah@tamco.local', 'not-an-address'])(
    'reports %s as permanent, not as something to retry',
    async (to) => {
      await expect(sendSmtp(config, { ...message, to })).rejects.toBeInstanceOf(
        PermanentDeliveryError,
      );
    },
  );

  it('leaves a connection failure retryable', async () => {
    // Nothing is listening on port 1, so this fails for a reason that could
    // genuinely be different in ten minutes.
    const problem = await sendSmtp(config, { ...message, to: 'real@tamco.com.my' }).catch(
      (caught: unknown) => caught,
    );
    expect(problem).toBeInstanceOf(Error);
    expect(problem).not.toBeInstanceOf(PermanentDeliveryError);
  });
});

/**
 * The two decisions that make a failure terminal, tested where they live.
 *
 * The first version of these tests exercised only the pre-flight address
 * checks, which throw before the session is opened and so never reach the
 * scrubbing on the way out. They passed with the bug reintroduced — the exact
 * shape of a test that confirms the wrong thing. These reach the decisions
 * themselves.
 */
describe('what makes a delivery failure terminal', () => {
  const config = {
    host: 'smtp.office365.com',
    port: 587,
    user: 'sender@example.org',
    password: 'a-real-looking-secret',
    from: 'sender@example.org',
  };

  it('treats 5xx as permanent and 4xx as worth retrying', () => {
    // 550 unknown mailbox, 552 too large: no retry helps.
    for (const code of [500, 550, 552, 571, 599]) expect(isPermanentReplyCode(code)).toBe(true);
    // 421 shutting down, 450 mailbox busy, 452 out of storage: try later.
    for (const code of [220, 250, 421, 450, 452, 499])
      expect(isPermanentReplyCode(code)).toBe(false);
  });

  it('keeps the error kind through the scrubbing, and removes the password', () => {
    const permanent = scrubError(
      new PermanentDeliveryError(`Recipient refused: 550 no such user ${config.password}`),
      config,
    );
    expect(permanent).toBeInstanceOf(PermanentDeliveryError);
    expect(permanent.message).not.toContain(config.password);
    expect(permanent.message).toContain('[redacted]');
  });

  it('does not promote a transient failure into a permanent one', () => {
    const transient = scrubError(new Error('Recipient refused: 450 mailbox busy'), config);
    expect(transient).toBeInstanceOf(Error);
    expect(transient).not.toBeInstanceOf(PermanentDeliveryError);
  });
});

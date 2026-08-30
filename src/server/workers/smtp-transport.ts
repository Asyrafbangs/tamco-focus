import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

/**
 * The production SMTP transport.
 *
 * `sendLocalSmtp` talks to Inbucket: no encryption, no authentication, and a
 * comment saying production must use an approved provider. Nothing ever
 * implemented that, and `EMAIL_TRANSPORT` accepted only `log` and `inbucket` —
 * so anything that was not the literal string `inbucket` silently fell through
 * to `log`, wrote the message to stdout, and reported success. Notifications
 * and weekly summaries have therefore never been delivered in Production, and
 * nothing distinguished that from a quiet week.
 *
 * This speaks enough SMTP to hand a message to a relay and know whether it was
 * accepted:
 *
 *   port 465        implicit TLS from the first byte
 *   any other port  plain connection upgraded with STARTTLS
 *
 * The upgrade is not optional. A relay that will not offer STARTTLS is refused
 * rather than fallen back to plaintext, because falling back would put
 * credentials and the contents of somebody's week on the wire in clear.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** The From address. Must be one the relay is willing to send as. */
  from: string;
  /** Display name shown to recipients. */
  fromName?: string;
}

export interface SmtpMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const TIMEOUT_MS = 20_000;

/**
 * A failure that a retry cannot fix.
 *
 * The queue's default assumption is that a failure was transient — the relay
 * was busy, the network blinked — so it backs off and tries again up to ten
 * times. That is wrong for an address that cannot receive mail: it will not
 * start resolving, and the nine further attempts only delay somebody noticing.
 *
 * Thrown only where the fault is THIS recipient. A 5xx at AUTH is permanent
 * for the connection but is a configuration problem affecting every message,
 * so it stays retryable and recovers when the credential is fixed.
 */
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

/** The reply code, kept so a caller can tell 4xx from 5xx. */
class SmtpReplyError extends Error {
  readonly code: number;
  constructor(label: string, line: string) {
    super(`${label} refused: ${line}`);
    this.name = 'SmtpReplyError';
    this.code = Number.parseInt(line.slice(0, 3), 10);
  }
}

/**
 * Names reserved so they can never resolve on the public internet.
 *
 * `local`, `localhost`, `test`, `invalid` and `example` are reserved by
 * RFC 6761 and RFC 2606; `internal` and `lan` are not reserved by an RFC but
 * are used the same way and never route. Mail to any of them is undeliverable
 * by construction, so a relay that accepts it is only promising a bounce.
 */
const UNROUTABLE_TLDS = new Set([
  'local',
  'localhost',
  'internal',
  'lan',
  'test',
  'invalid',
  'example',
]);

/** RFC 2047 for anything a header cannot carry raw. */
const encodeHeader = (value: string) =>
  /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

class SmtpSession {
  private socket: Socket | TLSSocket;
  private buffer = '';
  private waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private failure: Error | null = null;

  constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.attach();
  }

  private attach() {
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        // A space after the code ends a reply; a hyphen means more follows.
        if (/^\d{3} /.test(line)) this.waiters.shift()?.resolve(line);
      }
    });
    this.socket.on('error', (error: Error) => {
      this.failure = error;
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    });
  }

  /** The live socket, so STARTTLS can wrap it. */
  get rawSocket(): Socket | TLSSocket {
    return this.socket;
  }

  /** Swaps in the encrypted socket after STARTTLS, keeping the same session. */
  replaceSocket(socket: TLSSocket) {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket = socket;
    this.buffer = '';
    this.attach();
  }

  reply(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      const timer = setTimeout(
        () => reject(new Error('The mail server did not respond in time.')),
        TIMEOUT_MS,
      );
      this.waiters.push({
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject,
        timer,
      });
    });
  }

  write(value: string) {
    this.socket.write(value);
  }

  async command(value: string, expected: RegExp, label: string): Promise<string> {
    this.write(`${value}\r\n`);
    const line = await this.reply();
    if (!expected.test(line)) throw new SmtpReplyError(label, line);
    return line;
  }

  end() {
    this.socket.end();
  }
}

const openSocket = (config: SmtpConfig): Promise<Socket | TLSSocket> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    if (config.port === 465) {
      const socket = tlsConnect(
        { host: config.host, port: config.port, servername: config.host },
        () => {
          socket.off('error', onError);
          resolve(socket);
        },
      );
      socket.once('error', onError);
      return;
    }
    const socket = createConnection({ host: config.host, port: config.port }, () => {
      socket.off('error', onError);
      resolve(socket);
    });
    socket.once('error', onError);
  });

/**
 * Hands one message to the relay.
 *
 * Resolves only when the server has accepted it for delivery; anything else
 * throws, so the caller records a failed attempt and retries rather than
 * marking a message sent that never left.
 */
/**
 * Removes the credential from anything on its way to a log.
 *
 * Nothing here puts it there today: the errors carry the server's reply, not
 * what we sent. This exists because that is one refactor away from being
 * untrue, and a mail relay password in a platform log is the kind of mistake
 * that is only ever found afterwards. The base64 forms are covered too, since
 * AUTH LOGIN sends them that way.
 */
export function redactCredentials(text: string, config: SmtpConfig): string {
  const secrets = [
    config.password,
    config.user,
    Buffer.from(config.password, 'utf8').toString('base64'),
    Buffer.from(config.user, 'utf8').toString('base64'),
  ].filter((value) => value && value.length > 3);

  return secrets.reduce((carried, secret) => carried.split(secret).join('[redacted]'), text);
}

/** A 5xx names this message or recipient; a 4xx is the relay saying "not now". */
export const isPermanentReplyCode = (code: number) => code >= 500 && code < 600;

/**
 * Rebuilds an error with the credential removed, keeping what KIND it is.
 *
 * The kind is load-bearing: the queue decides whether to retry from it, so
 * flattening everything to `Error` on the way out — which is what this did —
 * quietly turns every permanent failure back into one that retries ten times.
 * The scrubbing and the class have to survive together or neither is doing its
 * job.
 */
export function scrubError(problem: unknown, config: SmtpConfig): Error {
  const message = problem instanceof Error ? problem.message : String(problem);
  const scrubbed = redactCredentials(message, config);
  return problem instanceof PermanentDeliveryError
    ? new PermanentDeliveryError(scrubbed)
    : new Error(scrubbed);
}

export async function sendSmtp(config: SmtpConfig, message: SmtpMessage): Promise<string> {
  /*
   * Checked at run time as well as in the types, because the callers that
   * matter most are not always TypeScript. A script that passed three of the
   * four parts got "Cannot read properties of undefined (reading 'replace')"
   * from deep inside the body encoder, which says nothing at all about what
   * was actually wrong.
   */
  for (const part of ['to', 'subject', 'text', 'html'] as const) {
    if (typeof message[part] !== 'string' || message[part].length === 0) {
      throw new Error(`The message has no ${part}, so there is nothing to send.`);
    }
  }

  /*
   * A real relay only gets an address that could actually receive mail.
   *
   * This is the one place every real send passes through, which is why the
   * check lives here rather than in each worker. `sendLocalSmtp` — the
   * inbucket capture used for local work — is deliberately untouched, because
   * catching `@tamco.local` is exactly its job.
   *
   * The seed fixtures use `.local`, and the moment a real transport was
   * configured they went to Office 365, which accepted them at RCPT and
   * bounced them afterwards. Nobody received anything; the sending mailbox
   * received the failures. Refusing here turns a delayed bounce into an
   * immediate, legible error against the delivery that caused it.
   */
  const recipient = message.to.trim();
  if (!ONE_ADDRESS.test(recipient)) {
    throw new PermanentDeliveryError(
      `"${message.to}" is not one email address, so it cannot be sent to.`,
    );
  }
  const tld = recipient.slice(recipient.lastIndexOf('.') + 1).toLowerCase();
  if (UNROUTABLE_TLDS.has(tld)) {
    throw new PermanentDeliveryError(
      `Refusing to send to "${recipient}": .${tld} is a reserved name that cannot receive mail. ` +
        'Fixture addresses belong on the inbucket transport, not on a real relay.',
    );
  }

  const session = new SmtpSession(await openSocket(config));

  try {
    const greeting = await session.reply();
    if (!/^220 /.test(greeting)) throw new Error(`Unexpected greeting: ${greeting}`);

    await session.command('EHLO tamco-focus', /^250 /, 'EHLO');

    if (config.port !== 465) {
      // Refused rather than downgraded: sending credentials in clear to save a
      // failed delivery is not a trade worth making.
      await session.command('STARTTLS', /^220 /, 'STARTTLS');
      const secure = tlsConnect({ socket: session.rawSocket, servername: config.host });
      await new Promise<void>((resolve, reject) => {
        secure.once('secureConnect', () => resolve());
        secure.once('error', reject);
      });
      session.replaceSocket(secure);
      await session.command('EHLO tamco-focus', /^250 /, 'EHLO after STARTTLS');
    }

    await session.command('AUTH LOGIN', /^334 /, 'AUTH LOGIN');
    await session.command(Buffer.from(config.user, 'utf8').toString('base64'), /^334 /, 'Username');
    await session.command(
      Buffer.from(config.password, 'utf8').toString('base64'),
      /^235 /,
      'Authentication',
    );

    await session.command(`MAIL FROM:<${config.from}>`, /^250 /, 'Sender');
    /*
     * The relay's verdict on this recipient specifically. A 5xx here means the
     * mailbox does not exist or will not accept us and no retry changes that,
     * so it is recorded as permanent; a 4xx is a "not now" and stays
     * retryable. Every other step is left alone deliberately — a 5xx at AUTH
     * is permanent for the connection but is a configuration fault affecting
     * every message, and must recover when the credential is fixed.
     */
    try {
      await session.command(`RCPT TO:<${message.to}>`, /^250 /, 'Recipient');
    } catch (problem) {
      if (problem instanceof SmtpReplyError && isPermanentReplyCode(problem.code)) {
        throw new PermanentDeliveryError(problem.message);
      }
      throw problem;
    }
    await session.command('DATA', /^354 /, 'DATA');

    const boundary = `tamco-focus-${crypto.randomUUID()}`;
    // Dot-stuffing: a line that is only "." would end the message early.
    const stuff = (body: string) => body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');

    session.write(
      [
        `From: ${config.fromName ? `${encodeHeader(config.fromName)} <${config.from}>` : config.from}`,
        `To: <${message.to}>`,
        `Subject: ${encodeHeader(message.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${crypto.randomUUID()}@tamco-focus>`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        stuff(message.text),
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        stuff(message.html),
        `--${boundary}--`,
        '.',
        '',
      ].join('\r\n'),
    );

    const accepted = await session.reply();
    if (!/^250 /.test(accepted)) {
      // The content itself was refused. A 5xx will refuse it again tomorrow.
      const code = Number.parseInt(accepted.slice(0, 3), 10);
      const rejection = `Message rejected: ${accepted}`;
      throw isPermanentReplyCode(code)
        ? new PermanentDeliveryError(rejection)
        : new Error(rejection);
    }

    await session.command('QUIT', /^221 /, 'QUIT').catch(() => {
      // The message is already accepted; a rude disconnect at QUIT is not a
      // delivery failure and must not cause a retry that sends it twice.
    });

    return accepted;
  } catch (problem) {
    /*
     * Re-thrown scrubbed, so no caller can log what it never needed to see —
     * but as the same KIND of error. The queue decides whether to retry from
     * the type, and wrapping everything in a plain Error here would quietly
     * make every permanent failure look transient again, which is the whole
     * behaviour this scrubbing sits in front of.
     */
    throw scrubError(problem, config);
  } finally {
    session.end();
  }
}

/**
 * Reads the transport from the environment, or explains what is missing.
 *
 * Returns null when SMTP is not configured, which is how a local or
 * preview environment stays on the log transport without special-casing.
 */
/** One address, and nothing else that could end up inside `MAIL FROM:<>`. */
const ONE_ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * Reads an address from configuration the way a person supplies one.
 *
 * These values are pasted into a web form, and the two ways that goes wrong
 * both end in the same place: the relay answering `501 5.1.7 Invalid address`
 * to `MAIL FROM`. That reply names nothing, so it reads as a mailbox
 * permissions problem in Exchange, and the afternoon goes on the wrong
 * question - when the actual content was a trailing space, or a display name
 * that came along with the address.
 *
 * So: trim it, accept the `Name <address>` form and keep the name, and refuse
 * anything still not a single address with the variable named in the message.
 */
function readAddress(value: string): { address: string; display: string } | { error: string } {
  const raw = value.trim();
  const wrapped = /^(.*)<([^<>]+)>$/.exec(raw);
  const address = (wrapped?.[2] ?? raw).trim();
  const display = (wrapped?.[1] ?? '').trim().replace(/^"|"$/g, '').trim();
  if (!ONE_ADDRESS.test(address)) {
    return {
      error: `"${raw}" is not one email address. Give a single address, optionally as Name <address>.`,
    };
  }
  return { address, display };
}

export function smtpConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SmtpConfig | { error: string } | null {
  const host = env.EMAIL_SMTP_HOST?.trim();
  if (!host) return null;

  const missing = ['EMAIL_SMTP_USER', 'EMAIL_SMTP_PASSWORD', 'EMAIL_FROM'].filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length) {
    return {
      error: `EMAIL_SMTP_HOST is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not. Refusing to fall back to the log transport, which would silently discard mail.`,
    };
  }

  /*
   * A port that is not a port, caught here rather than as a connection
   * timeout. `587587` is not hypothetical: it is what a field already
   * containing 587 produces when somebody types 587 into it.
   */
  const port = Number(env.EMAIL_SMTP_PORT?.trim() || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: `EMAIL_SMTP_PORT="${env.EMAIL_SMTP_PORT}" is not a port number.` };
  }

  const from = readAddress(env.EMAIL_FROM!);
  if ('error' in from) return { error: `EMAIL_FROM: ${from.error}` };

  return {
    host,
    port,
    // Not an address in general - some relays authenticate by username - so
    // this is trimmed and otherwise left alone.
    user: env.EMAIL_SMTP_USER!.trim(),
    // The password is NOT trimmed: trailing space is legal in one, and
    // silently changing a credential is worse than a clear 535.
    password: env.EMAIL_SMTP_PASSWORD!,
    from: from.address,
    // A name supplied on its own wins; otherwise one that travelled in with
    // the address is used rather than discarded.
    fromName: env.EMAIL_FROM_NAME?.trim() || from.display || 'TAMCO Focus',
  };
}

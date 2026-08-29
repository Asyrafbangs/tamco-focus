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
    if (!expected.test(line)) throw new Error(`${label} refused: ${line}`);
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

export async function sendSmtp(config: SmtpConfig, message: SmtpMessage): Promise<string> {
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
    await session.command(`RCPT TO:<${message.to}>`, /^250 /, 'Recipient');
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
    if (!/^250 /.test(accepted)) throw new Error(`Message rejected: ${accepted}`);

    await session.command('QUIT', /^221 /, 'QUIT').catch(() => {
      // The message is already accepted; a rude disconnect at QUIT is not a
      // delivery failure and must not cause a retry that sends it twice.
    });

    return accepted;
  } catch (problem) {
    // Re-thrown scrubbed, so no caller can log what it never needed to see.
    const message_ = problem instanceof Error ? problem.message : String(problem);
    throw new Error(redactCredentials(message_, config));
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
export function smtpConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SmtpConfig | { error: string } | null {
  const host = env.EMAIL_SMTP_HOST;
  if (!host) return null;

  const missing = ['EMAIL_SMTP_USER', 'EMAIL_SMTP_PASSWORD', 'EMAIL_FROM'].filter(
    (name) => !env[name],
  );
  if (missing.length) {
    return {
      error: `EMAIL_SMTP_HOST is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not. Refusing to fall back to the log transport, which would silently discard mail.`,
    };
  }

  return {
    host,
    port: Number(env.EMAIL_SMTP_PORT ?? 587),
    user: env.EMAIL_SMTP_USER!,
    password: env.EMAIL_SMTP_PASSWORD!,
    from: env.EMAIL_FROM!,
    fromName: env.EMAIL_FROM_NAME ?? 'TAMCO Focus',
  };
}

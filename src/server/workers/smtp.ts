import { createConnection } from 'node:net';

interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

const encodeHeader = (value: string) =>
  `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

/** Minimal local SMTP transport for Supabase Inbucket. Production email must
 * use an approved provider with its own idempotency key. */
export async function sendLocalSmtp(
  message: SmtpMessage,
  options: { host?: string; port?: number } = {},
) {
  const socket = createConnection({
    host: options.host ?? '127.0.0.1',
    port: options.port ?? 54325,
  });
  socket.setEncoding('utf8');
  const responses: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  let terminalError: Error | null = null;
  let buffer = '';
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (/^\d{3} /.test(line)) {
        const waiter = responses.shift();
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(line);
        }
      }
    }
  });
  socket.on('error', (error) => {
    terminalError = error;
    for (const waiter of responses.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  });

  const response = () =>
    new Promise<string>((resolve, reject) => {
      if (terminalError) {
        reject(terminalError);
        return;
      }
      const timer = setTimeout(() => reject(new Error('Local SMTP response timed out.')), 10_000);
      responses.push({ resolve, reject, timer });
    });
  const command = async (value: string, expected: RegExp) => {
    socket.write(`${value}\r\n`);
    const line = await response();
    if (!expected.test(line)) throw new Error(`Local SMTP refused ${value.split(' ')[0]}: ${line}`);
  };

  const greeting = await response();
  if (!/^220 /.test(greeting)) throw new Error(`Local SMTP did not greet the worker: ${greeting}`);
  await command('EHLO tamco-focus.local', /^250 /);
  await command(`MAIL FROM:<${message.from}>`, /^250 /);
  await command(`RCPT TO:<${message.to}>`, /^250 /);
  await command('DATA', /^354 /);

  const boundary = `tamco-focus-${crypto.randomUUID()}`;
  const plain = message.text.replace(/^\./gm, '..');
  const html = message.html.replace(/^\./gm, '..');
  socket.write(
    [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      plain,
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html,
      `--${boundary}--`,
      '.',
      '',
    ].join('\r\n'),
  );
  const accepted = await response();
  if (!/^250 /.test(accepted))
    throw new Error(`Local SMTP did not accept the message: ${accepted}`);
  await command('QUIT', /^221 /);
  socket.end();
}

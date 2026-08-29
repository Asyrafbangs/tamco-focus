#!/usr/bin/env node
/**
 * Proves a mail configuration works, without showing anybody what it is.
 *
 * The alternative is setting five environment variables in Vercel and finding
 * out on the next cron run, at 06:00, from a log line - by which time the only
 * evidence is a failure message and nobody remembers which of the five was
 * wrong. This sends one message using exactly the code the application uses,
 * and says which step failed.
 *
 * It prints the host, the port, the sender and the server's replies. It never
 * prints the password, and the transport scrubs the credential from any error
 * before it is thrown.
 *
 *   npm run mail:verify -- you@tamco.com.my
 *
 * Reads `.env.local`, so the credential is tested from the file that is
 * already gitignored and never has to be typed into a terminal, where it would
 * land in shell history.
 */

import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });

const recipient = process.argv[2];
if (!recipient || !recipient.includes('@')) {
  console.error('Give it an address to send to:  npm run mail:verify -- you@tamco.com.my');
  process.exit(1);
}

const { smtpConfigFromEnv, sendSmtp } = await import('../src/server/workers/smtp-transport.ts');

const configured = smtpConfigFromEnv(process.env);
if (!configured) {
  console.error(
    'No SMTP configuration found in .env.local.\n' +
      'Set EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASSWORD and EMAIL_FROM.',
  );
  process.exit(1);
}
if ('error' in configured) {
  console.error(configured.error);
  process.exit(1);
}

const { host, port, from, fromName, user } = configured;

/*
 * Microsoft 365 refuses to send as an address the authenticated mailbox does
 * not own, with `550 5.7.60 SendAsDenied` - which reads like a permissions
 * problem in Exchange rather than a typo in an environment variable. Said here
 * first, because that is the one people lose an afternoon to.
 */
if (
  /office365|outlook|protection\.outlook/i.test(host) &&
  from.toLowerCase() !== user.toLowerCase()
) {
  console.warn(
    `\nNote: EMAIL_FROM (${from}) is not the mailbox you are authenticating as (${user}).\n` +
      'Microsoft 365 will refuse this with "SendAsDenied" unless that mailbox has been\n' +
      'granted Send As rights. Trying anyway.\n',
  );
}

console.log(`\nSending one test message`);
console.log(`  host      ${host}:${port}`);
console.log(`  as        ${fromName} <${from}>`);
console.log(`  to        ${recipient}`);
console.log(`  password  (not shown)\n`);

try {
  const body = 'If you are reading this, the mail configuration works.';
  const accepted = await sendSmtp(configured, {
    to: recipient,
    subject: 'TAMCO Focus mail check',
    // Both parts, because the transport sends multipart/alternative and a
    // missing half is a TypeError rather than a refusal. This script is
    // JavaScript, so nothing type-checked that for me the first time.
    text: `${body}

Sent by npm run mail:verify. Nothing was stored.`,
    html: `<p>${body}</p><p>Sent by <code>npm run mail:verify</code>. Nothing was stored.</p>`,
  });
  console.log(`Accepted by the server: ${accepted}`);
  console.log('\nIt works. Set the same five values in Vercel, Production scope only.\n');
} catch (problem) {
  const message = problem instanceof Error ? problem.message : String(problem);
  console.error(`\nRefused: ${message}\n`);

  // The failures worth naming, because the SMTP code alone does not explain
  // itself and the guesswork is always the same three things.
  if (/535|Username|AUTH/i.test(message)) {
    console.error(
      'That is an authentication failure. Usually one of:\n' +
        '  - SMTP AUTH is disabled for the mailbox (Microsoft 365 disables it by default)\n' +
        '  - the account requires MFA, which SMTP basic auth cannot satisfy\n' +
        '  - the password is an account password where an app password is required\n',
    );
  } else if (/SendAsDenied|5\.7\.60/i.test(message)) {
    console.error('EMAIL_FROM must be the mailbox you authenticate as, or have Send As rights.\n');
  } else if (/STARTTLS/i.test(message)) {
    console.error('The server would not start TLS. Check the port: 587 for Microsoft 365.\n');
  } else if (/ENOTFOUND|ECONNREFUSED|timed out/i.test(message)) {
    console.error('Could not reach the server. Check the host and port, and any firewall.\n');
  }
  process.exit(1);
}

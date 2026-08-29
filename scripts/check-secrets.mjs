#!/usr/bin/env node
/**
 * Refuses to let a credential be committed.
 *
 * GitHub's push protection is the usual place this belongs, but it needs paid
 * Advanced Security on a private repository, so it is not available here. This
 * runs earlier anyway: before the commit exists, rather than when the push is
 * rejected. A secret that reaches a commit has to be rotated even if the push
 * never lands, because it is already in the local history and in every clone.
 *
 * Scans what is STAGED, not the working tree - the working tree legitimately
 * holds `.env.local`, and scanning it would cry wolf on every commit until
 * somebody learned to pass `--no-verify`, which defeats the whole thing.
 *
 * Run by `npm run check:secrets`, and by the pre-commit hook.
 */

import { execFileSync } from 'node:child_process';

/** What a leaked credential looks like, in the forms this project could hold. */
const PATTERNS = [
  {
    name: 'Supabase service-role or anon JWT',
    // A JWT whose payload names a Supabase role. The header is always this.
    pattern: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  },
  {
    name: 'Supabase secret key',
    pattern: /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  },
  {
    name: 'SMTP or mail password assigned in code',
    pattern: /(EMAIL_SMTP_PASSWORD|SMTP_PASSWORD|MAIL_PASSWORD)\s*[:=]\s*['"][^'"\s]{6,}['"]/i,
  },
  {
    name: 'Cron shared secret assigned in code',
    pattern: /CRON_SECRET\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  },
  {
    name: 'Private key block',
    pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    name: 'Microsoft/Azure client secret assigned in code',
    pattern: /(CLIENT_SECRET|AZURE_CLIENT_SECRET)\s*[:=]\s*['"][^'"\s]{16,}['"]/i,
  },
];

/*
 * Files that are allowed to contain what looks like a secret.
 *
 * The local Supabase stack ships fixed demo keys that are published in
 * Supabase's own documentation, and the seed password is test data the suite
 * depends on. Flagging those trains people to ignore this script.
 */
const ALLOWED = [/^\.env\.example$/, /^supabase\/config\.toml$/, /^scripts\/check-secrets\.mjs$/];

function staged() {
  const names = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return names.filter((name) => !ALLOWED.some((allowed) => allowed.test(name)));
}

const findings = [];
for (const file of staged()) {
  let content = '';
  try {
    content = execFileSync('git', ['show', `:${file}`], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    continue; // Binary, deleted, or unreadable: nothing to scan.
  }
  // The demo keys the local stack prints on every start are not secrets.
  if (content.includes('supabase-demo')) continue;

  for (const { name, pattern } of PATTERNS) {
    const match = pattern.exec(content);
    if (!match) continue;
    const line = content.slice(0, match.index).split('\n').length;
    findings.push(`${file}:${line} — ${name}`);
  }
}

if (findings.length > 0) {
  console.error('\nRefusing to commit. Something here looks like a credential:\n');
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    '\nIf it is real: take it out, and rotate it — it may already be in your local history.\n' +
      'If it is not: add the file to ALLOWED in scripts/check-secrets.mjs and say why.\n',
  );
  process.exit(1);
}

console.log(`No credentials in ${staged().length} staged file(s).`);

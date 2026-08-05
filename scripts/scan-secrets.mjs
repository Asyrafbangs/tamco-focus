#!/usr/bin/env node
/**
 * Fails if anything that looks like a credential is tracked by Git.
 *
 * Deliberately scans only tracked files: an untracked `.env.local` full of real
 * keys is exactly how local development is meant to work, and flagging it would
 * train people to ignore this check.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const PATTERNS = [
  {
    name: 'JWT / Supabase key',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  { name: 'AWS access key id', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{16,}/ },
  { name: 'Slack token', pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  {
    name: 'Assigned service-role key',
    pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?(?!$|\s|placeholder)[A-Za-z0-9._-]{20,}/,
  },
];

/** Files whose content legitimately describes credentials without holding any. */
const ALLOWLIST = [
  '.env.example',
  'scripts/scan-secrets.mjs',
  'docs/local-operations.md',
  'docs/future-deployment.md',
  'LOCAL_FIRST_BUILD_GUIDE.md',
];

const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const findings = [];

for (const relativePath of tracked) {
  if (ALLOWLIST.includes(relativePath)) continue;

  const fullPath = join(repoRoot, relativePath);

  let contents;
  try {
    // Skip anything large enough to be a binary or a lockfile.
    if (statSync(fullPath).size > 2_000_000) continue;
    contents = readFileSync(fullPath, 'utf8');
  } catch {
    continue;
  }

  for (const { name, pattern } of PATTERNS) {
    const match = pattern.exec(contents);
    if (!match) continue;

    const line = contents.slice(0, match.index).split('\n').length;
    findings.push({ relativePath, line, name });
  }
}

// A committed .env is a finding in itself, whatever it contains.
const committedEnv = tracked.filter(
  (path) => /(^|\/)\.env($|\.)/.test(path) && path !== '.env.example',
);

for (const path of committedEnv) {
  findings.push({ relativePath: path, line: 1, name: 'Committed environment file' });
}

if (findings.length === 0) {
  console.log(`ok  scanned ${tracked.length} tracked files, no credentials found.`);
  process.exit(0);
}

console.error('\nPossible credentials found in tracked files:\n');
for (const finding of findings) {
  console.error(`  ${finding.relativePath}:${finding.line}  ${finding.name}`);
}
console.error('\nRemove the value, rotate it, and keep secrets in .env.local (untracked).\n');

process.exit(1);

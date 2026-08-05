#!/usr/bin/env node
/**
 * Fails if the committed database types do not match the live local schema.
 *
 * Regenerates into memory and compares. A drifted type file is worse than no
 * type file: it type-checks green while describing a schema that no longer
 * exists.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const typesPath = join(repoRoot, 'src', 'lib', 'database.types.ts');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

let generated;
try {
  generated = execFileSync(
    npx,
    ['supabase', 'gen', 'types', 'typescript', '--local', '--schema', 'public'],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (cause) {
  console.error(
    'Could not generate database types. The local Supabase stack must be running.\n' +
      'Start it with `npm run supabase:start`, then try again.\n' +
      `Underlying error: ${cause.message}`,
  );
  process.exit(1);
}

if (!existsSync(typesPath)) {
  console.error(
    'src/lib/database.types.ts does not exist.\n' +
      'Generate it with `npm run db:types` and commit the result.',
  );
  process.exit(1);
}

const committed = readFileSync(typesPath, 'utf8');

// Normalise trailing whitespace so a line-ending difference is not a failure.
const normalise = (value) => value.replace(/\r\n/g, '\n').trimEnd();

if (normalise(committed) !== normalise(generated)) {
  console.error(
    'src/lib/database.types.ts is out of date with the local schema.\n' +
      'Run `npm run db:types` and commit the result.',
  );
  process.exit(1);
}

console.log('ok  generated database types match the local schema.');

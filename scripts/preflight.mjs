#!/usr/bin/env node
/**
 * Checks the local prerequisites and explains, specifically, what is missing.
 *
 * ONE_SHOT_LOCAL_BUILD_PROMPT.md requires clear error messages when Docker,
 * Node, ports, or environment variables are absent. A developer on a clean
 * machine should learn everything they need from one run of this.
 *
 * Exit code 0 means the full local stack can start. Exit code 1 means something
 * required is missing; the report says what, and what to do about it.
 */

import { execFileSync } from 'node:child_process';
import { dirname as pathDirname } from 'node:path';
import { createConnection } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];

function record(name, ok, detail, remedy) {
  results.push({ name, ok, detail, remedy });
}

/**
 * Runs a command and returns its trimmed output, or null if it is unavailable.
 *
 * Every plausible spelling is tried rather than one guess. On Windows `npm`
 * resolves to a `.cmd` shim from cmd.exe but to a shell script from Git Bash,
 * and which one `execFileSync` can see depends on the parent shell — guessing a
 * single form reported perfectly working tools as missing.
 */
function tryCommand(command, args, extraCandidates = []) {
  const candidates =
    process.platform === 'win32'
      ? [`${command}.cmd`, `${command}.exe`, command, ...extraCandidates]
      : [command, ...extraCandidates];

  for (const executable of candidates) {
    try {
      return execFileSync(executable, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Try the next spelling.
    }
  }

  return null;
}

/**
 * Docker Desktop can install per-machine or per-user, and only the former puts
 * `docker` on the system PATH. Checking the per-user location too avoids
 * reporting a working installation as absent.
 */
const DOCKER_CANDIDATES = [
  join(
    process.env.LOCALAPPDATA ?? '',
    'Programs',
    'DockerDesktop',
    'resources',
    'bin',
    'docker.exe',
  ),
  join(process.env.ProgramFiles ?? '', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
].filter((path) => path.length > 20);

// --- Node -------------------------------------------------------------------

const nodeMajor = Number(process.versions.node.split('.')[0]);
record(
  'Node.js',
  nodeMajor >= 20,
  `v${process.versions.node}`,
  'Install Node.js 20 or newer from https://nodejs.org.',
);

// --- Package manager --------------------------------------------------------

// npm ships beside the Node binary. Resolving it from `process.execPath` avoids
// PATH lookup entirely, which matters under Git Bash: its PATH holds
// `/c/...` entries that the Windows process API cannot resolve, so every
// bare-name lookup fails even for tools that are plainly installed.
const nodeDir = pathDirname(process.execPath);
const npmCliCandidates = [
  join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  join(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
];
let npmVersion = tryCommand('npm', ['-v'], [join(nodeDir, 'npm.cmd'), join(nodeDir, 'npm')]);

// Node 24 no longer lets execFile execute a Windows `.cmd` shim directly.
// Invoking npm's JavaScript entrypoint with the current Node executable avoids
// a shell and verifies the same installed package that `npm.cmd` delegates to.
for (const npmCli of npmCliCandidates) {
  if (npmVersion || !existsSync(npmCli)) continue;
  try {
    npmVersion = execFileSync(process.execPath, [npmCli, '-v'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Keep looking; the final report carries the remedy if all candidates fail.
  }
}
record(
  'npm',
  Boolean(npmVersion),
  npmVersion ?? 'not found',
  'npm ships with Node.js. Reinstall Node.js if it is missing.',
);

// --- Git --------------------------------------------------------------------

const gitVersion = tryCommand('git', ['--version']);
record(
  'Git',
  Boolean(gitVersion),
  gitVersion ?? 'not found',
  'Install Git from https://git-scm.com.',
);

// --- Docker -----------------------------------------------------------------
//
// The local Supabase stack runs in containers. Without a container runtime
// there is no Postgres, no Auth, and no Storage, so this is the one
// prerequisite that blocks everything downstream.

const dockerVersion = tryCommand('docker', ['--version'], DOCKER_CANDIDATES);
let dockerRunning = false;

if (dockerVersion) {
  dockerRunning =
    tryCommand('docker', ['info', '--format', '{{.ServerVersion}}'], DOCKER_CANDIDATES) !== null;
}

record(
  'Docker engine',
  dockerRunning,
  !dockerVersion
    ? 'not installed'
    : dockerRunning
      ? dockerVersion
      : `${dockerVersion} (installed, but the engine is not running)`,
  !dockerVersion
    ? [
        'Install Docker Desktop from https://www.docker.com/products/docker-desktop.',
        'On Windows it also needs WSL 2: run `wsl --install` from an elevated',
        'PowerShell, then restart. Docker is required for the local Supabase',
        'stack (Postgres, Auth, Storage). Nothing that touches the database —',
        'db:reset, db:types, integration tests, RLS tests, or E2E tests — can',
        'run without it.',
      ].join('\n    ')
    : 'Start Docker Desktop and wait for it to report "Engine running".',
);

// --- Supabase CLI -----------------------------------------------------------

const supabaseVersion = tryCommand(process.execPath, [
  join(repoRoot, 'scripts', 'supabase-cli.mjs'),
  '--version',
]);
record(
  'Supabase CLI',
  Boolean(supabaseVersion),
  supabaseVersion ?? 'not found',
  'Run `npm install` — the CLI is a pinned dev dependency of this repository.',
);

// --- Ports ------------------------------------------------------------------
//
// The ports declared in supabase/config.toml. A conflict here produces a
// confusing failure deep inside `supabase start`, so it is worth catching now.

const REQUIRED_PORTS = [
  { port: 54321, purpose: 'Supabase API' },
  { port: 54322, purpose: 'Postgres' },
  { port: 54323, purpose: 'Supabase Studio' },
  { port: 54324, purpose: 'Inbucket (local mail)' },
  { port: 3000, purpose: 'Next.js dev server' },
];

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const settle = (free) => {
      socket.destroy();
      resolve(free);
    };

    socket.setTimeout(600);
    socket.once('connect', () => settle(false));
    socket.once('timeout', () => settle(true));
    socket.once('error', () => settle(true));
  });
}

const portChecks = await Promise.all(
  REQUIRED_PORTS.map(async (entry) => ({ ...entry, free: await isPortFree(entry.port) })),
);

// A port held by an already-running Supabase stack is fine; only report the
// ones that are occupied when the stack is not up.
const busyPorts = portChecks.filter((entry) => !entry.free);

record(
  'Required ports',
  busyPorts.length === 0 || dockerRunning,
  busyPorts.length === 0
    ? 'all free'
    : `in use: ${busyPorts.map((entry) => `${entry.port} (${entry.purpose})`).join(', ')}`,
  'Stop whatever is holding the port, or run `npm run supabase:stop` if a ' +
    'previous stack is still up.',
);

// --- Environment file -------------------------------------------------------

const envPath = join(repoRoot, '.env.local');
const envExists = existsSync(envPath);

let envComplete = false;
let envDetail = 'missing';

if (envExists) {
  const contents = readFileSync(envPath, 'utf8');
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const missing = required.filter((key) => !new RegExp(`^${key}=.+$`, 'm').test(contents));
  const placeholder = /placeholder-/.test(contents);

  envComplete = missing.length === 0 && !placeholder;
  envDetail =
    missing.length > 0
      ? `missing ${missing.join(', ')}`
      : placeholder
        ? 'present, but still holds placeholder keys'
        : 'present';
}

record(
  'Environment (.env.local)',
  envComplete,
  envDetail,
  'Run the setup script (`scripts/setup-local.ps1` or `scripts/setup-local.sh`). ' +
    'It reads the real keys from `supabase status` and writes them in.',
);

// --- Report -----------------------------------------------------------------

const width = Math.max(...results.map((entry) => entry.name.length));
console.log('\nTAMCO Focus — local prerequisites\n');

for (const entry of results) {
  const mark = entry.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark}  ${entry.name.padEnd(width)}  ${entry.detail}`);
}

const failures = results.filter((entry) => !entry.ok);

if (failures.length === 0) {
  console.log('\nEverything required is present. Run `npm run db:reset` then `npm run dev`.\n');
  process.exit(0);
}

console.log('\nWhat to do:\n');
for (const failure of failures) {
  console.log(`  ${failure.name}:\n    ${failure.remedy}\n`);
}

console.log(
  'Until these are resolved, the parts of the build that do not need a database\n' +
    'still work: `npm run lint`, `npm run typecheck`, `npm run test:unit`, and\n' +
    '`npm run build`.\n',
);

process.exit(1);

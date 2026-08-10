import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { config } from 'dotenv';

const repoRoot = join(import.meta.dirname, '..');

// The gate owns its own server. `E2E_PORT` moves that server aside when the
// default is already spoken for, without ever borrowing what is there.
const port = Number(process.env.E2E_PORT ?? 3000);
const origin = `http://127.0.0.1:${port}`;

/**
 * Refuse to run when something else already owns the port.
 *
 * `waitForServer` below asks whether *something* answers on :3000, not whether
 * the server this script started is the one answering. With a `npm run dev`
 * session open, the spawned production server cannot bind, the probe gets a
 * 200 from the development server instead, and the whole suite runs against a
 * dev build while the gate reports a pass. The gate then means nothing, and
 * says nothing about meaning nothing — the worst of both.
 *
 * Failing loudly is the only honest option: a green End-to-end gate has to be
 * a statement about the production build.
 */
async function assertPortFree() {
  try {
    const response = await fetch(`${origin}/sign-in`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (response.status) {
      throw new Error(
        `Port ${port} is already in use - probably \`npm run dev\`. The end-to-end ` +
          'gate must run against its own production build, so it will not borrow ' +
          'that server. Free the port with `npm run stop:dev`, or run this gate ' +
          'elsewhere with E2E_PORT=3100.',
      );
    }
  } catch (error) {
    // Anything other than our own refusal means nothing is listening, which is
    // what we want.
    if (error instanceof Error && error.message.startsWith('Port ')) throw error;
  }
}

await assertPortFree();

// Needed for the auth readiness probe below. Without it the probe would find
// no anon key, skip itself, and quietly restore the race it exists to close.
config({ path: join(repoRoot, '.env.local'), quiet: true });
const server = spawn(process.execPath, ['scripts/start-e2e-server.mjs'], {
  cwd: repoRoot,
  env: { ...process.env, NEXT_DIST_DIR: '.next-e2e', E2E_PORT: String(port) },
  stdio: ['ignore', 'ignore', 'inherit'],
});

/**
 * Waits for Supabase Auth, not just the application server.
 *
 * The app answers `/sign-in` as soon as Next has compiled it, which says
 * nothing about whether GoTrue can authenticate anybody. Since a database
 * reset now runs immediately before this gate, the containers are often still
 * restarting when the first test signs in — and the failure surfaces as
 * `sign-in?error=invalid`, which reads exactly like a wrong password rather
 * than a service that is not up yet. Several tests then fail across viewports
 * for what looks like an application bug.
 *
 * The integration suite already probes Supabase after its own reset for this
 * reason. Doing it here as well makes the gate correct regardless of what ran
 * before it.
 */
async function waitForAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
      if (response.ok) return;
    } catch {
      // The auth service is still restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Supabase Auth did not become ready within 60 seconds of the reset.');
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error('The E2E application server stopped early.');
    try {
      const response = await fetch(`${origin}/sign-in`);
      if (response.status < 500) return;
    } catch {
      // Compilation or startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The E2E application server did not become ready within 60 seconds.');
}

async function stopServer() {
  if (!server.pid || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  if (server.exitCode !== null) return;

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    } catch (error) {
      try {
        process.kill(server.pid, 0);
      } catch {
        return;
      }
      throw error;
    }
  } else {
    server.kill('SIGKILL');
  }
}

let exitCode = 1;
try {
  await waitForServer();
  await waitForAuth();
  const playwright = spawn(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PLAYWRIGHT_EXTERNAL_SERVER: '1',
        // Playwright must aim at the same server this script started.
        APP_BASE_URL: origin,
      },
      stdio: 'inherit',
    },
  );
  const [code] = await once(playwright, 'exit');
  exitCode = typeof code === 'number' ? code : 1;
} finally {
  await stopServer();
}

process.exit(exitCode);

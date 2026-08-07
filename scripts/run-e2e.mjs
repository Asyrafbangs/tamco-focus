import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const server = spawn(process.execPath, ['scripts/start-e2e-server.mjs'], {
  cwd: repoRoot,
  env: { ...process.env, NEXT_DIST_DIR: '.next-e2e' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error('The E2E application server stopped early.');
    try {
      const response = await fetch('http://127.0.0.1:3000/sign-in');
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
  const playwright = spawn(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
    {
      cwd: repoRoot,
      env: { ...process.env, PLAYWRIGHT_EXTERNAL_SERVER: '1' },
      stdio: 'inherit',
    },
  );
  const [code] = await once(playwright, 'exit');
  exitCode = typeof code === 'number' ? code : 1;
} finally {
  await stopServer();
}

process.exit(exitCode);

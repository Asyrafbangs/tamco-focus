/**
 * Frees port 3000.
 *
 * `npm run dev` spawns Next as a child process. Stopping the npm wrapper — with
 * Ctrl+C in some terminals, or by killing the task from a tool — reaps the
 * wrapper and leaves the child still listening. The port stays busy while every
 * visible sign says the server stopped, and the next `verify` run then refuses
 * with "Port 3000 is already in use" for a server nobody can see.
 *
 * This kills whatever actually holds the listening socket, which is the only
 * thing that reliably frees it.
 */

import { execFileSync } from 'node:child_process';

const PORT = 3000;

function listenerPids() {
  if (process.platform === 'win32') {
    // `netstat -ano` is present on every Windows install; PowerShell's
    // Get-NetTCPConnection is not available in every shell this runs from.
    const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const [, local, , state, pid] = parts;
      if (state !== 'LISTENING') continue;
      if (!local?.endsWith(`:${PORT}`)) continue;
      if (pid && pid !== '0') pids.add(pid);
    }
    return [...pids];
  }

  try {
    const output = execFileSync('lsof', ['-t', `-i:${PORT}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // lsof exits non-zero when nothing matches.
    return [];
  }
}

const pids = listenerPids();

if (pids.length === 0) {
  console.log(`Port ${PORT} is already free.`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), 'SIGTERM');
    }
    console.log(`Stopped process ${pid} listening on port ${PORT}.`);
  } catch (error) {
    console.error(
      `Could not stop process ${pid}: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  }
}

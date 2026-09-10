import { createServer } from 'node:http';

import next from 'next';

process.env.NEXT_DIST_DIR = '.next-verify';

// Chosen by the runner, as `E2E_PORT` is for the end-to-end server. Defaults to
// 3100 so nothing about the ordinary gate changes; an override lets the suite
// run beside another application that already holds the port, rather than
// failing on EADDRINUSE with nothing wrong in this one.
const port = Number(process.env.SMOKE_PORT ?? 3100);
const origin = `http://127.0.0.1:${port}`;

const app = next({ dev: false, dir: process.cwd(), hostname: '127.0.0.1', port });
await app.prepare();
const server = createServer((request, response) => {
  void app.getRequestHandler()(request, response);
});
server.on('upgrade', app.getUpgradeHandler());

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const signIn = await fetch(`${origin}/sign-in`);
  const signInHtml = await signIn.text();
  if (!signIn.ok || !signInHtml.includes('Sign in to see what needs your attention today.')) {
    throw new Error(`Production sign-in smoke failed with HTTP ${signIn.status}.`);
  }
  if (signIn.headers.get('x-content-type-options') !== 'nosniff') {
    throw new Error('Production security headers are missing.');
  }

  const protectedRoute = await fetch(`${origin}/more`, { redirect: 'manual' });
  if (![307, 308].includes(protectedRoute.status)) {
    throw new Error(
      `Protected-route smoke expected a redirect, received ${protectedRoute.status}.`,
    );
  }

  process.stdout.write(
    'ok  production server started, served sign-in, enforced headers, and gated /more.\n',
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await app.close();
}

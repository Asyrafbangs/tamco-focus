import { createServer } from 'node:http';

import next from 'next';

process.env.NEXT_DIST_DIR = '.next-verify';

const app = next({ dev: false, dir: process.cwd(), hostname: '127.0.0.1', port: 3100 });
await app.prepare();
const server = createServer((request, response) => {
  void app.getRequestHandler()(request, response);
});
server.on('upgrade', app.getUpgradeHandler());

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3100, '127.0.0.1', resolve);
  });

  const signIn = await fetch('http://127.0.0.1:3100/sign-in');
  const signInHtml = await signIn.text();
  if (!signIn.ok || !signInHtml.includes('Sign in to see what needs your attention today.')) {
    throw new Error(`Production sign-in smoke failed with HTTP ${signIn.status}.`);
  }
  if (signIn.headers.get('x-content-type-options') !== 'nosniff') {
    throw new Error('Production security headers are missing.');
  }

  const protectedRoute = await fetch('http://127.0.0.1:3100/more', { redirect: 'manual' });
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

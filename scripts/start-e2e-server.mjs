import { createServer } from 'node:http';

import next from 'next';

process.env.NEXT_DIST_DIR = '.next-e2e';

const app = next({ dev: true, dir: process.cwd(), hostname: '127.0.0.1', port: 3000 });
await app.prepare();

const server = createServer((request, response) => {
  void app.getRequestHandler()(request, response);
});
server.on('upgrade', app.getUpgradeHandler());

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => server.close(resolve));
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());

server.listen(3000, '127.0.0.1', () => {
  process.stdout.write('E2E server ready at http://127.0.0.1:3000\n');
});

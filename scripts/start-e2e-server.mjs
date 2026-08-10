import { createServer } from 'node:http';

import next from 'next';

process.env.NEXT_DIST_DIR = '.next-e2e';

// Chosen by the runner. Defaults to 3000 so nothing about the ordinary gate
// changes; an override lets the suite run beside a development server the
// person is actually using rather than demanding they close it.
const port = Number(process.env.E2E_PORT ?? 3000);

const app = next({ dev: true, dir: process.cwd(), hostname: '127.0.0.1', port });
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

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`E2E server ready at http://127.0.0.1:${port}\n`);
});

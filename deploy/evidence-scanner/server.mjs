import { createServer } from 'node:http';
import { connect } from 'node:net';

/**
 * The shim in front of clamd (v271).
 *
 * `docs/evidence-scanner.md` defines a deliberately tiny contract so that this
 * file can stay small enough to read in one sitting: POST the bytes, get back
 * `{"infected": boolean, "detail": string | null}`. Everything that decides
 * what happens to a file afterwards lives in the database, not here.
 *
 * Nothing is written to disk. The bytes arrive in memory, go straight to
 * clamd's INSTREAM socket, and are dropped — so a crash leaves no copy of
 * somebody's site photograph on the host.
 */

const PORT = Number(process.env.PORT ?? 8080);
const CLAMD_HOST = process.env.CLAMD_HOST ?? '127.0.0.1';
const CLAMD_PORT = Number(process.env.CLAMD_PORT ?? 3310);
const TOKEN = process.env.ESH_SCANNER_TOKEN ?? '';

/*
 * v226's per-file limit. The scanner refuses anything larger before reading
 * it, because the application cannot produce one and an unbounded body on a
 * public endpoint is a way to exhaust the machine's memory.
 */
const MAX_BYTES = 26_214_400;

if (!TOKEN) {
  console.error('ESH_SCANNER_TOKEN is not set; refusing to start an open scanning service');
  process.exit(1);
}

/** Timing-safe enough for a comparison that is not between secrets of our own. */
function authorised(request) {
  const header = request.headers.authorization ?? '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (offered.length !== TOKEN.length) return false;
  let same = 0;
  for (let i = 0; i < TOKEN.length; i += 1) same |= offered.charCodeAt(i) ^ TOKEN.charCodeAt(i);
  return same === 0;
}

/**
 * One INSTREAM session. clamd wants the stream in length-prefixed chunks and a
 * zero-length chunk to finish, then answers one line.
 */
function scan(bytes) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: CLAMD_HOST, port: CLAMD_PORT });
    let answer = '';
    socket.setTimeout(60_000);
    socket.on('timeout', () => socket.destroy(new Error('clamd timed out')));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      answer += chunk.toString('latin1');
    });
    socket.on('close', () => {
      const line = answer.trim();
      if (!line) return reject(new Error('clamd said nothing'));
      // "stream: OK" | "stream: Eicar-Signature FOUND" | "... ERROR"
      if (line.endsWith('ERROR')) return reject(new Error(line));
      if (line.endsWith('FOUND')) {
        const detail = line.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '');
        return resolve({ infected: true, detail: detail || 'unnamed signature' });
      }
      if (line.endsWith('OK')) return resolve({ infected: false, detail: null });
      reject(new Error(`clamd answered ${line}`));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const size = Buffer.alloc(4);
      size.writeUInt32BE(bytes.length);
      socket.write(size);
      socket.write(bytes);
      socket.write(Buffer.alloc(4)); // a zero-length chunk ends the stream
    });
  });
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

createServer((request, response) => {
  // For the host's own health check: says nothing about who is asking.
  if (request.method === 'GET' && request.url === '/health') {
    return send(response, 200, { ok: true });
  }
  if (request.method !== 'POST') return send(response, 405, { error: 'post the bytes' });
  if (!authorised(request)) return send(response, 401, { error: 'unauthorised' });

  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > MAX_BYTES) return send(response, 413, { error: 'too large' });

  const chunks = [];
  let total = 0;
  request.on('data', (chunk) => {
    total += chunk.length;
    if (total > MAX_BYTES) {
      send(response, 413, { error: 'too large' });
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', async () => {
    if (response.writableEnded) return;
    try {
      send(response, 200, await scan(Buffer.concat(chunks)));
    } catch (cause) {
      /*
       * A 503, never a verdict. The worker records `unavailable` for anything
       * that is not a clean 200 with parseable JSON, and that is the whole
       * point: a scanner that could not look must not be read as one that
       * looked and found nothing.
       */
      console.error(`[scanner] ${cause instanceof Error ? cause.message : cause}`);
      send(response, 503, { error: 'scanner unavailable' });
    }
  });
}).listen(PORT, () =>
  console.info(`evidence scanner on ${PORT}, clamd ${CLAMD_HOST}:${CLAMD_PORT}`),
);

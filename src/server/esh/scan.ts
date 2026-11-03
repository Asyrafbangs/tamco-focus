import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * v270 — evidence is scanned after it has landed, never before.
 *
 * The owner uploads, the file attaches, they submit. This runs later on the
 * scheduled worker. Somebody on a plant floor with one bar of signal is not
 * made to wait for a virus scanner, and a scanner that is down does not stop
 * work being reported.
 *
 * The scanner is whatever answers `ESH_SCANNER_URL`, so the host is a
 * configuration choice rather than something welded into the application: a
 * ClamAV container anywhere that can run one. With the variable unset the
 * whole thing is inert and evidence behaves exactly as it did before, which is
 * the only honest default for a feature that depends on infrastructure the
 * application does not own.
 *
 * The expected contract is deliberately tiny, so a dozen lines in front of
 * `clamd` satisfies it: POST the bytes, get back
 * `{"infected": boolean, "detail": string | null}`.
 */

export interface ScanSummary {
  claimed: number;
  clean: number;
  infected: number;
  unavailable: number;
  skipped: boolean;
  /** Why nothing ran, when nothing ran. */
  reason?: 'not_configured' | 'no_token';
}

interface ClaimedFile {
  id: string;
  object_key: string;
  name: string;
  type: string | null;
  size: number | null;
  /** v271 - whether this is the camera's own file rather than the copy. */
  source?: boolean;
}

const BUCKET = 'finding-evidence';

/** A scan that cannot finish promptly is a scan to try again next run. */
const SCAN_TIMEOUT_MS = 20_000;

export async function runEshScanWorker(
  client: SupabaseClient,
  options: { scannerUrl?: string; token?: string; limit?: number } = {},
): Promise<ScanSummary> {
  const scannerUrl = options.scannerUrl ?? process.env.ESH_SCANNER_URL ?? '';
  const token = options.token ?? process.env.ESH_SCANNER_TOKEN ?? '';
  const empty: ScanSummary = {
    claimed: 0,
    clean: 0,
    infected: 0,
    unavailable: 0,
    skipped: true,
  };
  if (!scannerUrl) return { ...empty, reason: 'not_configured' };

  /*
   * v271 - a scanner reached over the internet must be ours.
   *
   * Every byte of somebody's evidence is POSTed to this URL. An endpoint with
   * no shared secret in front of it is an open scanning service for anyone who
   * learns the address, and a place to send site photographs by accident if
   * the variable is ever mistyped. So a remote scanner without a token is a
   * misconfiguration the worker refuses rather than a default it tolerates --
   * the files stay `not_scanned`, which is true, and the log says why.
   *
   * A scanner on the loopback interface needs no token: nothing outside the
   * machine can reach it, and this is how it runs in development.
   */
  if (!token && !isLoopback(scannerUrl)) {
    console.error(
      '[esh-scan] ESH_SCANNER_URL is set to a remote host but ESH_SCANNER_TOKEN is empty; ' +
        'refusing to send evidence to an unauthenticated scanner',
    );
    return { ...empty, reason: 'no_token' };
  }

  const { data, error } = await client.rpc('esh_scan_claim', { p_limit: options.limit ?? 20 });
  if (error) {
    console.error(`[esh-scan] claim failed: ${error.message}`);
    return { ...empty, skipped: false };
  }
  const files = ((data ?? {}) as { files?: ClaimedFile[] }).files ?? [];
  const summary: ScanSummary = {
    claimed: files.length,
    clean: 0,
    infected: 0,
    unavailable: 0,
    skipped: false,
  };

  for (const file of files) {
    const verdict = await scanOne(client, scannerUrl, token, file);
    summary[verdict] += 1;
  }
  return summary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Enough of an unusable answer to diagnose it, and never the whole body. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value !== 'object') return typeof value;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length ? `keys ${keys.slice(0, 5).join(', ')}` : 'an empty object';
}

/** Localhost, by any of its spellings, and nothing that merely looks like it. */
function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

async function scanOne(
  client: SupabaseClient,
  scannerUrl: string,
  token: string,
  file: ClaimedFile,
): Promise<'clean' | 'infected' | 'unavailable'> {
  let verdict: 'clean' | 'infected' | 'unavailable' = 'unavailable';
  let detail: string | null = null;

  try {
    const download = await client.storage.from(BUCKET).download(file.object_key);
    if (download.error || !download.data) {
      throw new Error(download.error?.message ?? 'no body');
    }
    const bytes = await download.data.arrayBuffer();

    const response = await fetch(scannerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': file.type ?? 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: bytes,
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`scanner returned ${response.status}`);

    /*
     * v285 - a 200 is not a verdict, and neither is valid JSON without one.
     *
     * This used to read `answer.infected ? 'infected' : 'clean'`, which made
     * every answer that was not a verdict a clean bill of health: `{}`,
     * `{"error":"engine offline"}`, `{"status":"queued"}`, a null `infected`,
     * an array - all of them have a falsy `infected` and all of them were
     * recorded as scanned. A scanner reporting its own failure in valid JSON is
     * exactly the case where this matters, and `clean` is a claim the column
     * exists to never make without grounds. Only a real boolean is a verdict;
     * anything else is `unavailable`, which is true, visible and retried.
     */
    /*
     * v285 - a 200 is not a verdict, and neither is valid JSON without one.
     *
     * This used to read `answer.infected ? 'infected' : 'clean'`, which made
     * every answer that was not a verdict a clean bill of health: `{}`,
     * `{"error":"engine offline"}`, `{"status":"queued"}`, a null `infected`,
     * an array - all of them have a falsy `infected` and all of them were
     * recorded as scanned. A scanner reporting its own failure in valid JSON is
     * exactly the case where this matters, and `clean` is a claim the column
     * exists to never make without grounds. Only a real boolean is a verdict;
     * anything else is `unavailable`, which is true, visible and retried.
     */
    const answer: unknown = await response.json();
    const reported = isRecord(answer) ? answer.infected : undefined;
    if (typeof reported !== 'boolean') {
      throw new Error(`scanner answered without a verdict: ${describe(answer)}`);
    }
    verdict = reported ? 'infected' : 'clean';
    const reportedDetail = isRecord(answer) ? answer.detail : null;
    detail = typeof reportedDetail === 'string' ? reportedDetail : null;
  } catch (cause) {
    /*
     * `unavailable`, never `clean`. The whole point of the column is that
     * nothing ever claims a file was checked when it was not, and a scanner
     * that times out has checked nothing.
     */
    verdict = 'unavailable';
    detail = cause instanceof Error ? cause.message.slice(0, 200) : 'scan failed';
  }

  const { error } = await client.rpc('esh_scan_record', {
    p_asset_id: file.id,
    p_verdict: verdict,
    p_detail: detail,
  });
  if (error) console.error(`[esh-scan] record failed for ${file.id}: ${error.message}`);
  return verdict;
}

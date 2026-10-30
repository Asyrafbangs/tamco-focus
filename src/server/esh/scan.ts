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
}

interface ClaimedFile {
  id: string;
  object_key: string;
  name: string;
  type: string | null;
  size: number | null;
}

const BUCKET = 'finding-evidence';

/** A scan that cannot finish promptly is a scan to try again next run. */
const SCAN_TIMEOUT_MS = 20_000;

export async function runEshScanWorker(
  client: SupabaseClient,
  options: { scannerUrl?: string; limit?: number } = {},
): Promise<ScanSummary> {
  const scannerUrl = options.scannerUrl ?? process.env.ESH_SCANNER_URL ?? '';
  const empty: ScanSummary = {
    claimed: 0,
    clean: 0,
    infected: 0,
    unavailable: 0,
    skipped: true,
  };
  if (!scannerUrl) return empty;

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
    const verdict = await scanOne(client, scannerUrl, file);
    summary[verdict] += 1;
  }
  return summary;
}

async function scanOne(
  client: SupabaseClient,
  scannerUrl: string,
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
      },
      body: bytes,
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`scanner returned ${response.status}`);

    const answer = (await response.json()) as { infected?: boolean; detail?: string };
    verdict = answer.infected ? 'infected' : 'clean';
    detail = answer.detail ?? null;
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

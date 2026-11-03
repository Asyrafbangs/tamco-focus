import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * v286 — the uploads that never finished, swept up afterwards.
 *
 * An evidence upload is agreed by a procedure, put into private storage by the
 * browser, then read back and recorded by the server. When the third step
 * never happens — the signal goes, the tab closes, a navigation cancels the
 * Server Action — the row stays in `uploading` and the object, if any bytes
 * arrived, stays in the bucket with nothing in the application pointing at it.
 * v271's background upload of the camera's own file has the same shape, and its
 * `pending` state is a sentence ESH reads: "Full-size original still arriving",
 * indefinitely.
 *
 * The procedure decides and records; this removes the objects. That order
 * matters: a key is handed back only once the row no longer refers to it, so
 * nothing in the application can be pointing at an object that is about to be
 * deleted. A removal that fails is left for the next run rather than retried
 * here — the row is already correct, and the only cost of waiting is a day of
 * storage.
 */

export interface OrphanSummary {
  /** Uploads that never finished, now refused. */
  abandoned: number;
  /** Originals that never arrived, now recorded as unavailable. */
  sources: number;
  /** Objects actually deleted from the bucket. */
  removed: number;
  /** Keys the sweep could not delete; the rows are correct regardless. */
  failed: number;
}

const BUCKET = 'finding-evidence';

interface ClaimedOrphan {
  id: string;
  object_key: string | null;
}

export async function runEshOrphanWorker(
  client: SupabaseClient,
  options: { olderThanMinutes?: number; limit?: number } = {},
): Promise<OrphanSummary> {
  const summary: OrphanSummary = { abandoned: 0, sources: 0, removed: 0, failed: 0 };

  const { data, error } = await client.rpc('esh_evidence_claim_orphans', {
    p_older_than_minutes: options.olderThanMinutes ?? 120,
    p_limit: options.limit ?? 50,
  });
  if (error) {
    console.error(`[esh-orphans] claim failed: ${error.code ?? 'unknown'}: ${error.message}`);
    return summary;
  }

  const claimed = (data ?? {}) as { abandoned?: ClaimedOrphan[]; sources?: ClaimedOrphan[] };
  const abandoned = claimed.abandoned ?? [];
  const sources = claimed.sources ?? [];
  summary.abandoned = abandoned.length;
  summary.sources = sources.length;

  const keys = [...abandoned, ...sources]
    .map((row) => row.object_key)
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
  if (keys.length === 0) return summary;

  /*
   * One call for the lot. Storage reports a missing object as a success here,
   * which is the right answer: an upload that was agreed and never began has
   * no object, and its row still needed clearing.
   */
  const { error: removeError } = await client.storage.from(BUCKET).remove(keys);
  if (removeError) {
    console.error(`[esh-orphans] could not remove ${keys.length} objects: ${removeError.message}`);
    summary.failed = keys.length;
    return summary;
  }
  summary.removed = keys.length;
  return summary;
}

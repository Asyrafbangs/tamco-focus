import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runEshScanWorker } from '@/server/esh/scan';

/**
 * v285 — valid JSON is not a verdict.
 *
 * The worker used to decide with `answer.infected ? 'infected' : 'clean'`, so
 * every answer whose `infected` was merely falsy became a clean bill of
 * health: an empty object, a scanner reporting its own failure, a queue
 * acknowledgement, an explicit null. The file was then recorded as scanned and
 * never looked at again, and the label a reader sees — "Scanned" — was a claim
 * nothing supported.
 *
 * `esh-scan-worker-v271` looks as though it covered this. It does not: its
 * nonsense case answers with `<html>not json</html>`, which fails to parse and
 * takes the catch. The gap was everything that parses and still says nothing.
 *
 * Each shape below is a separate case on purpose. A loop would report one
 * failure for the whole set and hide which shape regressed.
 */

const FILE = {
  id: '11111111-1111-4111-8111-111111111111',
  object_key: 'finding/action/asset.jpg',
  name: 'walkway.jpg',
  type: 'image/jpeg',
  size: 120_000,
};

function stubClient() {
  const recorded: Array<{ verdict: string; detail: string | null }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'esh_scan_claim') return { data: { ok: true, files: [FILE] }, error: null };
    recorded.push({
      verdict: String(args.p_verdict),
      detail: args.p_detail == null ? null : String(args.p_detail),
    });
    return { data: { ok: true }, error: null };
  });
  const download = vi.fn(async () => ({ data: new Blob([new Uint8Array(8)]), error: null }));
  return {
    client: { rpc, storage: { from: () => ({ download }) } } as unknown as SupabaseClient,
    recorded,
  };
}

/** Answer the scanner with this body, and report what was recorded. */
async function verdictFor(body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
  const { client, recorded } = stubClient();
  const summary = await runEshScanWorker(client, {
    scannerUrl: 'https://scanner.example.com/scan',
    token: 'sh-secret',
  });
  return { verdict: recorded[0]?.verdict, detail: recorded[0]?.detail, summary };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('v285 an answer without a verdict is unavailable, never clean', () => {
  it('an empty object', async () => {
    const { verdict, summary } = await verdictFor('{}');
    expect(verdict).toBe('unavailable');
    expect(summary.clean).toBe(0);
  });

  // The case that matters most: the scanner is telling us it failed.
  it('a scanner reporting its own failure', async () => {
    const { verdict } = await verdictFor(JSON.stringify({ error: 'engine offline' }));
    expect(verdict).toBe('unavailable');
  });

  it('an acknowledgement rather than a result', async () => {
    const { verdict } = await verdictFor(JSON.stringify({ status: 'queued', id: 'abc' }));
    expect(verdict).toBe('unavailable');
  });

  it('an explicit null where the boolean belongs', async () => {
    const { verdict } = await verdictFor(JSON.stringify({ infected: null, detail: 'unknown' }));
    expect(verdict).toBe('unavailable');
  });

  // `"false"` is a string: truthy, so the old code called this INFECTED, which
  // is the same defect pointing the other way.
  it('a stringified boolean', async () => {
    const { verdict } = await verdictFor(JSON.stringify({ infected: 'false' }));
    expect(verdict).toBe('unavailable');
  });

  it('a number', async () => {
    const { verdict } = await verdictFor(JSON.stringify({ infected: 0 }));
    expect(verdict).toBe('unavailable');
  });

  it('a bare JSON value that is not an object', async () => {
    expect((await verdictFor('null')).verdict).toBe('unavailable');
    expect((await verdictFor('true')).verdict).toBe('unavailable');
    expect((await verdictFor('[]')).verdict).toBe('unavailable');
  });

  it('says what was wrong with the answer, without logging the body', async () => {
    const { detail } = await verdictFor(JSON.stringify({ error: 'engine offline', trace: 'x' }));
    expect(detail).toMatch(/without a verdict/);
    expect(detail).toMatch(/keys error, trace/);
    // The body itself is somebody's file being described; the keys are enough.
    expect(detail).not.toMatch(/engine offline/);
  });
});

describe('v285 a real verdict is still a verdict', () => {
  it('a clean answer is clean, and keeps its detail', async () => {
    const { verdict, summary } = await verdictFor(
      JSON.stringify({ infected: false, detail: null }),
    );
    expect(verdict).toBe('clean');
    expect(summary.clean).toBe(1);
  });

  it('an infected answer quarantines, and keeps the signature name', async () => {
    const { verdict, detail, summary } = await verdictFor(
      JSON.stringify({ infected: true, detail: 'Eicar-Test-Signature' }),
    );
    expect(verdict).toBe('infected');
    expect(detail).toBe('Eicar-Test-Signature');
    expect(summary.infected).toBe(1);
  });

  // A detail that is not a string is dropped rather than coerced: the column
  // is read by people, and "[object Object]" tells them nothing.
  it('ignores a detail that is not text', async () => {
    const { verdict, detail } = await verdictFor(
      JSON.stringify({ infected: false, detail: { a: 1 } }),
    );
    expect(verdict).toBe('clean');
    expect(detail).toBeNull();
  });
});

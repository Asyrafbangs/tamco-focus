import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runEshScanWorker } from '@/server/esh/scan';

/**
 * v270/v271 — the scan worker, and the two ways it can quietly do harm.
 *
 * The first is calling something `clean` that nothing looked at. The second is
 * newer and worse: every byte of somebody's site photograph is POSTed to
 * whatever `ESH_SCANNER_URL` names, so a remote URL with no shared secret in
 * front of it is both an open scanning service and a way to send evidence
 * somewhere by typo. These assertions hold both lines.
 */

const FILE = {
  id: '11111111-1111-4111-8111-111111111111',
  object_key: 'finding/action/asset.jpg',
  name: 'walkway.jpg',
  type: 'image/jpeg',
  size: 120_000,
};

/** Just enough Supabase to be claimed from and recorded to. */
function stubClient(files = [FILE]) {
  const recorded: Array<{ verdict: string; detail: string | null }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'esh_scan_claim') return { data: { ok: true, files }, error: null };
    recorded.push({
      verdict: String(args.p_verdict),
      detail: args.p_detail == null ? null : String(args.p_detail),
    });
    return { data: { ok: true }, error: null };
  });
  const download = vi.fn(async () => ({ data: new Blob([new Uint8Array(8)]), error: null }));
  const client = {
    rpc,
    storage: { from: () => ({ download }) },
  } as unknown as SupabaseClient;
  return { client, rpc, recorded };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('v271 the scan worker', () => {
  it('does nothing at all without a scanner, and says which nothing', async () => {
    const { client, rpc } = stubClient();
    const summary = await runEshScanWorker(client, { scannerUrl: '' });
    expect(summary.skipped).toBe(true);
    expect(summary.reason).toBe('not_configured');
    // Nothing is claimed, so nothing is left marked `pending` by a worker
    // that was never going to look at it.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses to send evidence to a remote scanner with no shared secret', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const { client, rpc } = stubClient();
    const summary = await runEshScanWorker(client, {
      scannerUrl: 'https://scanner.example.com/scan',
      token: '',
    });
    expect(summary.reason).toBe('no_token');
    /*
     * The assertion that matters is the negative one: not one byte left the
     * application. A misconfigured URL must not become a channel for site
     * photographs.
     */
    expect(fetchStub).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('needs no secret for a scanner on this machine, which is how it runs locally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ infected: false }), { status: 200 })),
    );
    const { client, recorded } = stubClient();
    const summary = await runEshScanWorker(client, {
      scannerUrl: 'http://127.0.0.1:3310/scan',
      token: '',
    });
    expect(summary.skipped).toBe(false);
    expect(recorded).toEqual([{ verdict: 'clean', detail: null }]);
  });

  it('sends the secret as a bearer token when it has one', async () => {
    const fetchStub = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ infected: false }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const { client } = stubClient();
    await runEshScanWorker(client, {
      scannerUrl: 'https://scanner.example.com/scan',
      token: 'sh-secret',
    });
    const headers = fetchStub.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sh-secret');
  });

  it('calls a scanner it could not reach unavailable, never clean', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gateway timeout', { status: 504 })),
    );
    const { client, recorded } = stubClient();
    const summary = await runEshScanWorker(client, {
      scannerUrl: 'https://scanner.example.com/scan',
      token: 'sh-secret',
    });
    expect(summary.unavailable).toBe(1);
    expect(summary.clean).toBe(0);
    expect(recorded[0]?.verdict).toBe('unavailable');
  });

  it('calls a scanner that answered nonsense unavailable too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>not json</html>', { status: 200 })),
    );
    const { client, recorded } = stubClient();
    await runEshScanWorker(client, {
      scannerUrl: 'https://scanner.example.com/scan',
      token: 'sh-secret',
    });
    // A 200 is not a verdict. Parsing has to succeed before anything is said
    // about the file.
    expect(recorded[0]?.verdict).toBe('unavailable');
  });

  it('quarantines what a scanner names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ infected: true, detail: 'Eicar-Test-Signature' }), {
            status: 200,
          }),
      ),
    );
    const { client, recorded } = stubClient();
    const summary = await runEshScanWorker(client, {
      scannerUrl: 'https://scanner.example.com/scan',
      token: 'sh-secret',
    });
    expect(summary.infected).toBe(1);
    // The signature name is kept, so a quarantined file can be explained to
    // the person whose evidence just disappeared.
    expect(recorded[0]).toEqual({ verdict: 'infected', detail: 'Eicar-Test-Signature' });
  });
});

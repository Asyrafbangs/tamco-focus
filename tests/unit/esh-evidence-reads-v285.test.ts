import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v285 — the two evidence reads, where absence and failure both came back null.
 *
 * `readObject` and `signedDownloadFor` in `src/server/esh/evidence.ts` read
 * Storage rather than a table, and that is what makes them a harder case than
 * the rest of v285: Storage reports an absent object as an error like any
 * other, so "the object is not there" and "Storage did not answer" arrive in
 * the same shape and have to be told apart by status. A 404 is genuinely
 * absent. A 5xx, or a `StorageUnknownError` carrying no status at all because
 * the request never arrived, is a read that did not happen.
 *
 * What the conflation cost, in the callers' own words:
 *
 * - Both routes serving an evidence file turned `null` into a 404, having
 *   already read the asset row and found `state = 'ready'`. They knew the file
 *   existed and then told the reader it did not.
 * - `cellsOf` in `import-actions` said "That file is no longer in the store.
 *   Upload it again." — false twice over for an outage: the file is where the
 *   coordinator left it, and re-uploading fixes nothing, which is exactly what
 *   they have just been told to do.
 *
 * Both functions now report `failed`, and both keep their old answer for an
 * object that genuinely is not there. The companion cases below are what hold
 * that second half in place.
 */

const state = vi.hoisted(() => ({
  download: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceRoleClient: () => ({
    storage: {
      from: () => ({
        download: state.download,
        createSignedUrl: state.createSignedUrl,
      }),
    },
  }),
}));

import { readObject, signedDownloadFor } from '@/server/esh/evidence';

const AN_OBJECT = 'findings/f0c05200-0000-4000-a000-000000000001/evidence.jpg';

/** Storage's answer when the object is genuinely not there. */
const ABSENT = {
  data: null,
  error: { message: 'Object not found', status: 404, statusCode: '404' },
};

/** Storage answering, but not about this object: the gateway failed. */
const STORAGE_502 = {
  data: null,
  error: { message: 'Bad Gateway', status: 502, statusCode: '502' },
};

/**
 * The worst of the three, and the reason status alone is not enough: a request
 * that never arrived carries no status at all. Treating "no status" as absent
 * would reintroduce the whole defect for exactly the failure most likely to
 * happen — the network one.
 */
const NEVER_ARRIVED = {
  data: null,
  error: { message: 'fetch failed', status: undefined, statusCode: undefined },
};

beforeEach(() => {
  state.download.mockReset();
  state.createSignedUrl.mockReset();
  // The console.error is the production behaviour under test, not noise to fix.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v285 readObject', () => {
  it('reports a failure when Storage answers with a gateway error', async () => {
    state.download.mockResolvedValue(STORAGE_502);

    await expect(readObject(AN_OBJECT)).resolves.toEqual({ bytes: null, failed: true });
  });

  it('reports a failure when the request never reached Storage', async () => {
    state.download.mockResolvedValue(NEVER_ARRIVED);

    const read = await readObject(AN_OBJECT);

    expect(read.failed, 'an error with no status was taken for a missing object').toBe(true);
  });

  /*
   * The companion, and the half that keeps "no longer in the store. Upload it
   * again." available for the case where it is true.
   */
  it('does not report a failure for an object that genuinely is not there', async () => {
    state.download.mockResolvedValue(ABSENT);

    await expect(readObject(AN_OBJECT)).resolves.toEqual({ bytes: null, failed: false });
  });

  it('returns the bytes when Storage answers with the object', async () => {
    state.download.mockResolvedValue({
      data: { arrayBuffer: async () => new TextEncoder().encode('a,b\n1,2\n').buffer },
      error: null,
    });

    const read = await readObject(AN_OBJECT);

    expect(read.failed).toBe(false);
    expect(read.bytes?.toString('utf8')).toBe('a,b\n1,2\n');
  });
});

describe('v285 signedDownloadFor', () => {
  it('reports a failure when signing fails for any reason but absence', async () => {
    state.createSignedUrl.mockResolvedValue(STORAGE_502);

    await expect(signedDownloadFor(AN_OBJECT, 'evidence.jpg', 'image/jpeg')).resolves.toEqual({
      url: null,
      failed: true,
    });
  });

  it('reports a failure when the request never reached Storage', async () => {
    state.createSignedUrl.mockResolvedValue(NEVER_ARRIVED);

    const signed = await signedDownloadFor(AN_OBJECT, 'evidence.jpg', 'image/jpeg');

    expect(signed.failed, 'an error with no status was taken for a missing object').toBe(true);
  });

  /*
   * Both file routes keep a 404 for this, and should: the asset row exists but
   * its object does not, which is a 404 to the reader whatever it says about
   * our data.
   */
  it('does not report a failure for an object that genuinely is not there', async () => {
    state.createSignedUrl.mockResolvedValue(ABSENT);

    await expect(signedDownloadFor(AN_OBJECT, 'evidence.jpg', 'image/jpeg')).resolves.toEqual({
      url: null,
      failed: false,
    });
  });

  /*
   * Without this, every case above would pass on a function that reported a
   * failure for everything — so every evidence file in the product would serve
   * a 503 instead of itself.
   */
  it('returns the signed link when Storage signs one', async () => {
    state.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'http://127.0.0.1:54321/storage/v1/object/sign/x?token=y' },
      error: null,
    });

    const signed = await signedDownloadFor(AN_OBJECT, 'evidence.jpg', 'image/jpeg');

    expect(signed.failed).toBe(false);
    expect(signed.url).toContain('token=y');
  });

  /*
   * §23, carried through unchanged: a photograph or PDF opens in place, and
   * everything else is forced to download, so nothing active is rendered from
   * our own origin. It travels in the same call as the failure reporting, so
   * it is asserted in the same file.
   */
  it('still asks for a download for a type that must not render in place', async () => {
    state.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'http://127.0.0.1:54321/x' },
      error: null,
    });

    await signedDownloadFor(AN_OBJECT, 'register.xlsx', 'application/octet-stream');

    expect(state.createSignedUrl).toHaveBeenCalledWith(AN_OBJECT, 300, {
      download: 'register.xlsx',
    });
  });

  it('still lets a photograph open in place', async () => {
    state.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'http://127.0.0.1:54321/x' },
      error: null,
    });

    await signedDownloadFor(AN_OBJECT, 'evidence.jpg', 'image/jpeg');

    expect(state.createSignedUrl).toHaveBeenCalledWith(AN_OBJECT, 300, { download: false });
  });
});

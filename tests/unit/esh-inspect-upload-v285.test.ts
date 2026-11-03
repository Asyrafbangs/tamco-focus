import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v285 — the pixel check at its call site, and the removal that goes with it.
 *
 * `esh-image-pixels-v285` proves `pixelProblem` on crafted headers. Nothing
 * there proves `inspectUpload` asks it, or that a refused image is deleted
 * from the bucket rather than left behind as an orphan nobody can see. This is
 * the same gap v284 closed for the access and finding reads, and it is
 * testable for the same reason: `vitest.config.ts` resolves `server-only` to a
 * no-op, so a module that begins `import 'server-only'` can be imported here.
 */

const state = vi.hoisted(() => ({
  body: new Uint8Array(0) as Uint8Array<ArrayBufferLike>,
  removed: [] as string[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceRoleClient: () => ({
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([state.body as BlobPart]), error: null }),
        remove: async (keys: string[]) => {
          state.removed.push(...keys);
          return { error: null };
        },
      }),
    },
  }),
}));

import { inspectUpload } from '@/server/esh/evidence';

/** A PNG header with the dimensions written into IHDR, then some body bytes. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(1024);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

beforeEach(() => {
  state.removed = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v285 inspectUpload', () => {
  it('refuses an image whose header claims more pixels than anything should decode', async () => {
    state.body = png(30_000, 30_000);

    const inspection = await inspectUpload('finding/action/bomb.png', 'bomb.png');

    expect(inspection.ok).toBe(false);
    expect(inspection.ok === false && inspection.reason).toBe('image_too_large');
  });

  it('deletes it, so a refused file is not left in the bucket', async () => {
    state.body = png(30_000, 30_000);

    await inspectUpload('finding/action/bomb.png', 'bomb.png');

    expect(state.removed).toEqual(['finding/action/bomb.png']);
  });

  /*
   * The half that stops the check being a blanket refusal. A real photograph
   * passes, keeps its sniffed type, and nothing is removed.
   */
  it('accepts a real photograph and leaves it alone', async () => {
    state.body = png(4032, 3024);

    const inspection = await inspectUpload('finding/action/walkway.png', 'walkway.png');

    expect(inspection.ok).toBe(true);
    expect(inspection.ok && inspection.type).toBe('image/png');
    expect(state.removed).toEqual([]);
  });

  it('still refuses a file that is not what its name says', async () => {
    state.body = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]); // a Windows executable

    const inspection = await inspectUpload('finding/action/photo.png', 'photo.png');

    expect(inspection.ok === false && inspection.reason).toBe('type_mismatch');
    expect(state.removed).toEqual(['finding/action/photo.png']);
  });

  it('still refuses an empty upload', async () => {
    state.body = new Uint8Array(0);

    const inspection = await inspectUpload('finding/action/nothing.png', 'nothing.png');

    expect(inspection.ok === false && inspection.reason).toBe('missing');
  });
});

import { describe, expect, it } from 'vitest';

import { COMPRESS_OVER_BYTES, shouldCompress } from '@/domain/esh-evidence';

/**
 * v270 — which files are worth re-encoding before they are sent.
 *
 * Re-encoding costs the EXIF block, so the rule has to earn that: only images,
 * and only ones big enough that a plant worker on one bar of signal actually
 * benefits.
 */
describe('v270 deciding what to compress', () => {
  it('shrinks a phone photograph', () => {
    expect(shouldCompress('image/jpeg', 9_000_000)).toBe(true);
  });

  it('shrinks a multi-megabyte screenshot, which is how permits arrive', () => {
    expect(shouldCompress('image/png', 4_000_000)).toBe(true);
  });

  it('leaves a small photograph alone rather than costing EXIF for nothing', () => {
    expect(shouldCompress('image/jpeg', 400_000)).toBe(false);
  });

  it('never touches a document', () => {
    expect(shouldCompress('application/pdf', 9_000_000)).toBe(false);
    expect(shouldCompress('application/vnd.ms-excel', 9_000_000)).toBe(false);
  });

  it('never touches a file whose type nobody declared', () => {
    expect(shouldCompress(null, 9_000_000)).toBe(false);
    expect(shouldCompress(undefined, 9_000_000)).toBe(false);
  });

  it('is decided on the threshold, not near it', () => {
    expect(shouldCompress('image/jpeg', COMPRESS_OVER_BYTES)).toBe(false);
    expect(shouldCompress('image/jpeg', COMPRESS_OVER_BYTES + 1)).toBe(true);
  });

  it('ignores the casing a browser happens to report', () => {
    expect(shouldCompress('IMAGE/JPEG', 9_000_000)).toBe(true);
  });
});

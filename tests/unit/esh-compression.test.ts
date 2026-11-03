import { describe, expect, it } from 'vitest';

import { COMPRESS_OVER_BYTES, preferPng, scaledTo, shouldCompress } from '@/domain/esh-evidence';

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

/**
 * v285 — the two decisions inside the re-encode, which used to live in the
 * canvas where only a browser test could reach them.
 */
describe('v285 the size to draw at', () => {
  it('caps the long edge and keeps the shape', () => {
    expect(scaledTo(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(scaledTo(3024, 4032, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it('leaves an image that already fits exactly as it is', () => {
    expect(scaledTo(1600, 1200, 2000)).toEqual({ width: 1600, height: 1200 });
    // On the cap, not past it.
    expect(scaledTo(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000 });
  });

  it('never rounds a thin strip away to nothing', () => {
    expect(scaledTo(8000, 3, 2000)).toEqual({ width: 2000, height: 1 });
  });

  it('takes a longer edge when it is given one', () => {
    expect(scaledTo(8160, 6120, 2560)).toEqual({ width: 2560, height: 1920 });
  });
});

describe('v285 whether a PNG should stay a PNG', () => {
  // A photograph: JPEG is several times smaller and loses nothing anybody is
  // looking for in a picture of a blocked walkway.
  it('converts a photograph', () => {
    expect(preferPng(3_000_000, 400_000)).toBe(false);
  });

  /*
   * A screenshot of a permit: flat colour and thin dark text. JPEG saves
   * almost nothing here and puts a coloured halo on every character, which is
   * the detail somebody is reading.
   */
  it('keeps a screenshot as a PNG', () => {
    expect(preferPng(800_000, 700_000)).toBe(true);
  });

  it('is decided on the ratio, not near it', () => {
    expect(preferPng(1_000_000, 700_000)).toBe(false);
    expect(preferPng(1_000_000, 700_001)).toBe(true);
  });

  it('says nothing about a PNG encode that failed', () => {
    expect(preferPng(0, 400_000)).toBe(false);
  });
});

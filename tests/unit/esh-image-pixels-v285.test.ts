import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_MAX_EDGE,
  EVIDENCE_MAX_PIXELS,
  imageDimensions,
  pixelProblem,
} from '@/domain/esh-evidence';

/**
 * v285 — an image's pixels, which its byte count does not describe.
 *
 * `sniffEvidenceType` establishes that a file really is a PNG; nothing
 * established how big it claims to be. A 30000 x 30000 PNG of one flat colour
 * is a few hundred kilobytes — comfortably inside the 25 MB limit — and asks
 * every browser that opens the finding for 3.6 billion pixels.
 *
 * The headers below are built byte by byte rather than loaded from fixtures,
 * so each assertion names the exact bytes it depends on and a reader can see
 * what a parser is being asked to survive.
 */

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

/**
 * A JPEG with `metadataBytes` of APP1 in front of the frame header, which is
 * what a phone's own file looks like: the dimensions are not near the start.
 */
function jpeg(width: number, height: number, metadataBytes = 0): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (metadataBytes > 0) {
    const length = metadataBytes + 2;
    parts.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff);
    for (let index = 0; index < metadataBytes; index += 1) parts.push(0x00);
  }
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  parts.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff);
  parts.push(0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  return new Uint8Array(parts);
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
  bytes[6] = width & 0xff;
  bytes[7] = (width >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (height >> 8) & 0xff;
  return bytes;
}

/** The extended WEBP header, where the canvas size is stored one short. */
function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
}

describe('v285 reading an image header', () => {
  it('reads a PNG', () => {
    expect(imageDimensions(png(4032, 3024), 'image/png')).toEqual({ width: 4032, height: 3024 });
  });

  it('reads a JPEG', () => {
    expect(imageDimensions(jpeg(4032, 3024), 'image/jpeg')).toEqual({ width: 4032, height: 3024 });
  });

  // The case a naive parser gets wrong: a phone puts kilobytes of EXIF, and
  // often a thumbnail, in front of the frame header.
  it('walks past 6 KB of metadata to reach a JPEG frame header', () => {
    expect(imageDimensions(jpeg(4032, 3024, 6144), 'image/jpeg')).toEqual({
      width: 4032,
      height: 3024,
    });
  });

  it('reads a GIF, which is the one little-endian header of the set', () => {
    expect(imageDimensions(gif(800, 600), 'image/gif')).toEqual({ width: 800, height: 600 });
  });

  it('reads an extended WEBP, where the canvas size is stored one short', () => {
    expect(imageDimensions(webp(1600, 1200), 'image/webp')).toEqual({ width: 1600, height: 1200 });
  });

  it('gives up rather than guessing', () => {
    // Truncated, and a type nothing here parses.
    expect(imageDimensions(png(100, 100).subarray(0, 20), 'image/png')).toBeNull();
    expect(imageDimensions(jpeg(100, 100), 'application/pdf')).toBeNull();
    // Compressed data begins and no frame header was ever found.
    expect(
      imageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0]), 'image/jpeg'),
    ).toBeNull();
  });
});

describe('v285 refusing an image by its pixels', () => {
  it('refuses the flat PNG that fits inside every byte limit', () => {
    expect(pixelProblem(png(30_000, 30_000), 'image/png')).toBe('image_too_large');
  });

  it('refuses a long thin image that stays under the pixel budget', () => {
    const edge = EVIDENCE_MAX_EDGE + 1;
    expect(edge * 10).toBeLessThan(EVIDENCE_MAX_PIXELS);
    expect(pixelProblem(png(edge, 10), 'image/png')).toBe('image_too_large');
  });

  it('refuses a shape that is within both edges and still too many pixels', () => {
    const side = EVIDENCE_MAX_EDGE - 1;
    expect(side * side).toBeGreaterThan(EVIDENCE_MAX_PIXELS);
    expect(pixelProblem(png(side, side), 'image/png')).toBe('image_too_large');
  });

  it('refuses a header claiming no pixels at all', () => {
    expect(pixelProblem(png(0, 0), 'image/png')).toBe('image_too_large');
  });

  /*
   * The other direction, and the one that matters more day to day: a real
   * photograph must get through, including from the largest phone sensors sold
   * and from a 61-megapixel full-frame camera.
   */
  it('accepts the photographs people actually upload', () => {
    expect(pixelProblem(jpeg(4032, 3024), 'image/jpeg')).toBeNull();
    expect(pixelProblem(jpeg(8160, 6120), 'image/jpeg')).toBeNull();
    expect(pixelProblem(jpeg(9504, 6336), 'image/jpeg')).toBeNull();
    expect(pixelProblem(png(3840, 2160), 'image/png')).toBeNull();
  });

  // Unknown is not acceptable, but it is not a refusal either: the byte-size
  // and signature checks still ran, and losing somebody's evidence to a
  // parser's blind spot is the worse failure.
  it('lets an unreadable header through', () => {
    expect(pixelProblem(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg')).toBeNull();
    expect(pixelProblem(new Uint8Array(0), 'image/png')).toBeNull();
  });

  it('says nothing about a file that is not an image', () => {
    expect(pixelProblem(png(30_000, 30_000), 'application/pdf')).toBeNull();
  });
});

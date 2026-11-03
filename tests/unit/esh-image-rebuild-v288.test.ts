import { describe, expect, it } from 'vitest';

import { sniffEvidenceType } from '@/domain/esh-evidence';
import { rebuildImage, rebuildJpeg, rebuildPng } from '@/domain/esh-image-rebuild';

/**
 * v288 — a public photograph, rebuilt from the parts an image needs.
 *
 * Two things arrive with a photograph that nobody asked for: the EXIF block,
 * which carries the GPS co-ordinates of whoever was standing there — fatal to
 * an anonymous report — and whatever else was appended to the file, which the
 * signature check cannot see because the signature is still a photograph's.
 *
 * Every file here is built byte by byte, so each assertion names the bytes it
 * depends on. The compressed data is checked to survive untouched, because
 * this is a rebuild and not a re-encode: a rebuild that loses a pixel is a
 * defect, and one that keeps the metadata is pointless.
 */

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

/** Entropy data with an escaped 0xFF and a restart marker inside it. */
const SCAN_DATA = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78];

const SOF0 = segment(
  0xc0,
  [0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
);
const SOS_HEADER = segment(0xda, [0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);

interface JpegParts {
  exif?: boolean;
  comment?: boolean;
  jfif?: boolean;
  icc?: boolean;
  trailing?: number[];
}

function jpeg(parts: JpegParts = {}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  if (parts.jfif) bytes.push(...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (parts.exif) {
    // "Exif\0\0" and then something that must not survive.
    bytes.push(...segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('GPSLatitude=3.1390N')]));
  }
  if (parts.icc) bytes.push(...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 0x00, 0x01]));
  if (parts.comment) bytes.push(...segment(0xfe, ascii('taken on a phone by somebody')));
  bytes.push(...segment(0xdb, [0x00, ...new Array(64).fill(0x10)]));
  bytes.push(...SOF0, ...SOS_HEADER, ...SCAN_DATA, 0xff, 0xd9);
  if (parts.trailing) bytes.push(...parts.trailing);
  return new Uint8Array(bytes);
}

function chunk(name: string, payload: number[]): number[] {
  const length = payload.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...ascii(name),
    ...payload,
    0xde,
    0xad,
    0xbe,
    0xef, // the chunk's CRC, copied with it rather than recomputed
  ];
}

interface PngParts {
  exif?: boolean;
  text?: boolean;
  srgb?: boolean;
  trailing?: number[];
}

function png(parts: PngParts = {}): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  bytes.push(...chunk('IHDR', [0, 0, 0x01, 0x90, 0, 0, 0x01, 0x2c, 0x08, 0x06, 0x00, 0x00, 0x00]));
  if (parts.srgb) bytes.push(...chunk('sRGB', [0x00]));
  if (parts.exif) bytes.push(...chunk('eXIf', ascii('GPSLatitude=3.1390N')));
  if (parts.text) bytes.push(...chunk('tEXt', ascii('Software\0a phone')));
  bytes.push(...chunk('IDAT', [0x78, 0x9c, 0x01, 0x02, 0x03, 0x04]));
  bytes.push(...chunk('IEND', []));
  if (parts.trailing) bytes.push(...parts.trailing);
  return new Uint8Array(bytes);
}

const contains = (haystack: Uint8Array, needle: string) =>
  Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));

describe('v288 rebuilding a JPEG', () => {
  it('removes the EXIF block, co-ordinates and all', () => {
    const original = jpeg({ exif: true });
    expect(contains(original, 'GPSLatitude')).toBe(true);

    const rebuilt = rebuildJpeg(original)!;

    expect(rebuilt).not.toBeNull();
    expect(contains(rebuilt, 'GPSLatitude')).toBe(false);
    expect(contains(rebuilt, 'Exif')).toBe(false);
    expect(rebuilt.byteLength).toBeLessThan(original.byteLength);
  });

  it('removes a comment segment, which is a place to hide anything', () => {
    const rebuilt = rebuildJpeg(jpeg({ comment: true }))!;
    expect(contains(rebuilt, 'taken on a phone')).toBe(false);
  });

  /*
   * The appended-payload case. The file is a valid JPEG and also carries
   * something after its end marker; a signature check sees only the JPEG.
   */
  it('drops everything after the end marker', () => {
    const payload = ascii('<?php system($_GET["c"]); ?>');
    const original = jpeg({ trailing: payload });
    expect(contains(original, 'php')).toBe(true);

    const rebuilt = rebuildJpeg(original)!;

    expect(contains(rebuilt, 'php')).toBe(false);
    expect(rebuilt[rebuilt.byteLength - 2]).toBe(0xff);
    expect(rebuilt[rebuilt.byteLength - 1]).toBe(0xd9);
  });

  it('keeps the segments a decoder reads: JFIF, the colour profile, the frame', () => {
    const rebuilt = rebuildJpeg(jpeg({ jfif: true, icc: true, exif: true }))!;
    expect(contains(rebuilt, 'JFIF')).toBe(true);
    expect(contains(rebuilt, 'ICC_PROFILE')).toBe(true);
    expect(contains(rebuilt, 'Exif')).toBe(false);
  });

  // A rebuild is not a re-encode: the pixels are copied, including the escaped
  // 0xFF bytes and restart markers inside the compressed data.
  it('copies the compressed data byte for byte', () => {
    const rebuilt = rebuildJpeg(jpeg({ exif: true, comment: true }))!;
    const scan = Buffer.from(Uint8Array.from(SCAN_DATA));
    expect(Buffer.from(rebuilt).includes(scan)).toBe(true);
  });

  it('is still a JPEG afterwards, by its own first bytes', () => {
    const rebuilt = rebuildJpeg(jpeg({ exif: true }))!;
    expect(sniffEvidenceType(rebuilt, 'report.jpg')).toBe('image/jpeg');
  });

  it('refuses a file it cannot account for rather than storing it', () => {
    expect(rebuildJpeg(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    // No end marker at all.
    expect(
      rebuildJpeg(new Uint8Array([0xff, 0xd8, ...SOF0, ...SOS_HEADER, 0x01, 0x02])),
    ).toBeNull();
    // A length that runs past the end of the file.
    expect(rebuildJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, 0x00]))).toBeNull();
    // Compressed data and an end marker, but no frame header before them.
    expect(
      rebuildJpeg(new Uint8Array([0xff, 0xd8, ...SOS_HEADER, ...SCAN_DATA, 0xff, 0xd9])),
    ).toBeNull();
  });
});

describe('v288 rebuilding a PNG', () => {
  it('removes the EXIF chunk a phone writes', () => {
    const original = png({ exif: true });
    expect(contains(original, 'GPSLatitude')).toBe(true);

    const rebuilt = rebuildPng(original)!;

    expect(contains(rebuilt, 'eXIf')).toBe(false);
    expect(contains(rebuilt, 'GPSLatitude')).toBe(false);
  });

  it('removes text chunks, which are a place to hide anything', () => {
    const rebuilt = rebuildPng(png({ text: true }))!;
    expect(contains(rebuilt, 'tEXt')).toBe(false);
    expect(contains(rebuilt, 'a phone')).toBe(false);
  });

  it('drops everything after IEND', () => {
    const rebuilt = rebuildPng(png({ trailing: ascii('appended') }))!;
    expect(contains(rebuilt, 'appended')).toBe(false);
    expect(contains(rebuilt, 'IEND')).toBe(true);
  });

  it('keeps the chunks a decoder needs, and the colour ones', () => {
    const rebuilt = rebuildPng(png({ srgb: true, exif: true }))!;
    expect(contains(rebuilt, 'IHDR')).toBe(true);
    expect(contains(rebuilt, 'IDAT')).toBe(true);
    expect(contains(rebuilt, 'sRGB')).toBe(true);
    expect(sniffEvidenceType(rebuilt, 'permit.png')).toBe('image/png');
  });

  it('refuses a file it cannot account for', () => {
    // A chunk whose length overruns the file.
    const overrun = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0xff,
      0x00,
      ...ascii('IHDR'),
      0x00,
    ]);
    expect(rebuildPng(overrun)).toBeNull();
    // Header and end, but no pixels.
    const empty = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 0x08, 0x06, 0, 0, 0]),
      ...chunk('IEND', []),
    ]);
    expect(rebuildPng(empty)).toBeNull();
    expect(rebuildPng(new Uint8Array(8))).toBeNull();
  });
});

describe('v288 what may be rebuilt at all', () => {
  it('handles the two formats public reporting accepts', () => {
    expect(rebuildImage(jpeg({ exif: true }), 'image/jpeg')).not.toBeNull();
    expect(rebuildImage(png({ exif: true }), 'image/png')).not.toBeNull();
  });

  // Anything else is refused rather than stored unrebuilt: a public photo that
  // could not be stripped is a photo that keeps its co-ordinates.
  it('refuses every other type', () => {
    expect(rebuildImage(jpeg(), 'image/webp')).toBeNull();
    expect(rebuildImage(jpeg(), 'application/pdf')).toBeNull();
    expect(rebuildImage(png(), 'image/heic')).toBeNull();
  });
});

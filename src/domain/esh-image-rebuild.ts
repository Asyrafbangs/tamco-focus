/**
 * v288 — a public photograph, rebuilt from the parts an image needs.
 *
 * A photograph from the factory floor arrives from a phone, through a browser,
 * from somebody who is not signed in to anything. Two things come with it that
 * nobody asked for:
 *
 *   * **Metadata.** EXIF carries the GPS co-ordinates of whoever was standing
 *     there, the camera's serial number, the exact second, and often a
 *     thumbnail of the original frame. A safety report does not need any of
 *     it, and an anonymous safety report must not carry it: the whole promise
 *     of anonymity is undone by a latitude.
 *   * **Whatever else was appended.** A file can be a valid JPEG and also
 *     carry a payload after its end marker, or inside a comment segment. The
 *     signature check says it is an image; it does not say it is *only* an
 *     image.
 *
 * Rebuilding answers both at once. The file is parsed into its segments, the
 * ones an image needs to decode are written out in order, and everything else
 * is dropped — including anything past the end marker, which by definition
 * nothing needs. What comes back is a smaller file that decodes identically.
 *
 * This is not a re-encode. Nothing is decompressed, so there is no quality
 * loss and no dependency on an image library: the compressed data is copied
 * byte for byte. What is lost is metadata, and that is the point.
 *
 * Orientation is the one piece of EXIF that matters to how a picture looks, and
 * it is already gone by the time a public photo reaches here: the browser draws
 * every one through a canvas first, which applies the orientation and writes
 * upright pixels. Staff evidence is not rebuilt for exactly this reason — see
 * `stageA-existing-system-hardening.md`.
 */

/** Segments a JPEG needs, plus the two that only describe colour. */
const JPEG_KEEP_APP = new Set([
  0xe0, // APP0, JFIF: density and thumbnail flags a decoder may read
  0xe2, // APP2, ICC colour profile: dropping it can visibly shift colour
]);

/**
 * PNG chunks a decoder needs or that describe colour.
 *
 * Everything else — `eXIf`, `tEXt`, `iTXt`, `zTXt`, `tIME`, and any private
 * chunk — is dropped. `IDAT` carries the pixels and is copied untouched.
 */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function be32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) + ((bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!)) >>> 0
  );
}

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

/**
 * A JPEG with its metadata segments removed and nothing after its end marker.
 *
 * Returns null when the file is not a JPEG this can account for — a truncated
 * one, a marker chain that does not add up, no end marker at all. Null means
 * refuse the upload: the alternative is storing bytes we could not explain.
 */
export function rebuildJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const parts: Array<[number, number]> = [[0, 2]]; // SOI
  let at = 2;
  let sawFrame = false;

  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let marker = bytes[at + 1]!;
    // Fill bytes: any number of 0xFF may precede a marker.
    let cursor = at + 1;
    while (marker === 0xff && cursor + 1 < bytes.length) {
      cursor += 1;
      marker = bytes[cursor]!;
    }

    if (marker === 0xd9) {
      // End of image. Anything after this is not part of the picture.
      parts.push([cursor - 1, cursor + 1]);
      return join(bytes, parts, sawFrame);
    }

    if (marker === 0xda) {
      /*
       * Start of scan: the compressed data runs to the end marker, and it may
       * contain 0xFF bytes of its own (escaped as 0xFF 0x00, and restart
       * markers 0xFFD0-7). Scanning for the real end marker is the only way
       * through, and a file with none is one we cannot account for.
       */
      let end = cursor + 1;
      while (end + 1 < bytes.length) {
        if (bytes[end] === 0xff) {
          const next = bytes[end + 1]!;
          if (next === 0xd9) break;
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        }
        end += 1;
      }
      if (end + 1 >= bytes.length || bytes[end + 1] !== 0xd9) return null;
      parts.push([cursor - 1, end]);
      parts.push([end, end + 2]);
      return join(bytes, parts, sawFrame);
    }

    // Everything else carries a two-byte length that includes itself.
    if (cursor + 3 >= bytes.length) return null;
    const length = (bytes[cursor + 1]! << 8) | bytes[cursor + 2]!;
    if (length < 2) return null;
    const segmentEnd = cursor + 1 + length;
    if (segmentEnd > bytes.length) return null;

    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) sawFrame = true;
    if (!isComment && (!isApp || JPEG_KEEP_APP.has(marker))) {
      parts.push([cursor - 1, segmentEnd]);
    }
    at = segmentEnd;
  }
  return null;
}

function join(bytes: Uint8Array, parts: Array<[number, number]>, sawFrame: boolean) {
  if (!sawFrame) return null;
  const size = parts.reduce((total, [from, to]) => total + (to - from), 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const [from, to] of parts) {
    out.set(bytes.subarray(from, to), at);
    at += to - from;
  }
  return out;
}

/**
 * A PNG with its ancillary metadata chunks removed and nothing after `IEND`.
 *
 * Chunk CRCs are copied with their chunks rather than recomputed, because
 * nothing about a chunk changes; a chunk whose length runs past the end of the
 * file makes the whole thing unaccountable, and that returns null.
 */
export function rebuildPng(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 8 + 12) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  }

  const parts: Array<[number, number]> = [[0, 8]];
  let at = 8;
  let sawHeader = false;
  let sawData = false;

  while (at + 8 <= bytes.length) {
    const length = be32(bytes, at);
    const name = tag(bytes, at + 4);
    const end = at + 12 + length;
    // 12 = length + type + CRC. A chunk that overruns the file is a file we
    // cannot account for.
    if (length > 0x7fffffff || end > bytes.length) return null;

    if (name === 'IHDR') sawHeader = true;
    if (name === 'IDAT') sawData = true;
    if (PNG_KEEP.has(name)) parts.push([at, end]);

    if (name === 'IEND') {
      // Anything after IEND is not part of the picture.
      if (!sawHeader || !sawData) return null;
      const size = parts.reduce((total, [from, to]) => total + (to - from), 0);
      const out = new Uint8Array(size);
      let cursor = 0;
      for (const [from, to] of parts) {
        out.set(bytes.subarray(from, to), cursor);
        cursor += to - from;
      }
      return out;
    }
    at = end;
  }
  return null;
}

/**
 * The photograph as it will be stored: metadata gone, trailing bytes gone.
 *
 * Only the two formats public reporting accepts. Anything else returns null,
 * and the caller refuses it rather than storing something it could not
 * rebuild.
 */
export function rebuildImage(bytes: Uint8Array, type: string): Uint8Array | null {
  if (type === 'image/jpeg') return rebuildJpeg(bytes);
  if (type === 'image/png') return rebuildPng(bytes);
  return null;
}

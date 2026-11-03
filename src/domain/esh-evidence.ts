/**
 * ESH Finding Management — evidence files (v199, §12, §23).
 *
 * Files are conversation attachments and the proof a submission rests on. The
 * browser uploads straight to private storage through a one-time signed URL
 * (Vercel refuses request bodies over 4.5 MB, so files never pass through a
 * Server Action); the server then reads the bytes back and decides what the
 * file really is. Nothing is trusted from the browser: not the name, not the
 * type it claims.
 *
 * There is no malware scanner in this deployment (docs/esh-finding-management-
 * impact-map.md §4). Every file says so — "Not scanned" — and none is ever
 * described as clean.
 */

import { DEFAULT_ALLOWED_MIME_TYPES, REFUSED_EXTENSIONS } from '@/domain/attachment-policy';

/**
 * Per file, per message, and how many (§23's defaults).
 *
 * v226 — 25 MB, which is what the specification asks for and what a photograph
 * from a current phone actually needs. These three numbers are also written into
 * the evidence bucket and two CHECK constraints; all five move together, and
 * every message a person reads about a size is built from the constants below
 * rather than spelling a number out again.
 */
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;
export const EVIDENCE_MAX_MESSAGE_BYTES = 100 * 1024 * 1024;
export const EVIDENCE_MAX_FILES_PER_MESSAGE = 10;

/** "25 MB", for a sentence. Whole megabytes, because the limits are whole. */
export function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export const EVIDENCE_MAX_LABEL = megabytes(EVIDENCE_MAX_BYTES);
export const EVIDENCE_MAX_MESSAGE_LABEL = megabytes(EVIDENCE_MAX_MESSAGE_BYTES);

export type EvidenceType = (typeof DEFAULT_ALLOWED_MIME_TYPES)[number];

/**
 * Image types worth showing as a picture rather than a filename (v229).
 *
 * A safety finding is mostly a photograph. Listing it as "Fences
 * Unauthorized.jpeg · 271 KB" tells an Action Owner nothing about the thing
 * they are being asked to put right, and tells ESH nothing when they verify it.
 * Narrower than INLINE_TYPES below, which also passes PDFs straight through:
 * a PDF cannot be an <img>.
 */
export const EVIDENCE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

/** Types a browser may show in place; everything else is a download (§23). */
export const INLINE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const EXTENSION_TYPES: Record<string, EvidenceType[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  heic: ['image/heic', 'image/heif'],
  heif: ['image/heif', 'image/heic'],
  pdf: ['application/pdf'],
  txt: ['text/plain'],
  csv: ['text/csv'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
};

export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

/**
 * The type to upload a file as, from its name. A browser often reports none
 * (Windows gives HEIC and some Office files no type at all), and the bucket
 * refuses an upload without an allowed one; the server checks the real bytes
 * afterwards either way.
 */
export function uploadContentType(name: string): string {
  return EXTENSION_TYPES[extensionOf(name)]?.[0] ?? 'application/octet-stream';
}

/** What a file chooser offers: the same extensions, so nothing refused is offered. */
export const EVIDENCE_ACCEPT = Object.keys(EXTENSION_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');

/** A name safe to store and to offer back: no path, no control characters. */
export function safeEvidenceName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'evidence';
}

/**
 * Whether a file may be tried at all, before any bytes move: the name's
 * extension must be one we accept and none we refuse, and the size within
 * the limit. Returns a sentence for the person, or null.
 */
export function evidenceProblem(name: string, size: number): string | null {
  const extension = extensionOf(name);
  if ((REFUSED_EXTENSIONS as readonly string[]).includes(extension)) {
    return 'This kind of file cannot be attached.';
  }
  if (!EXTENSION_TYPES[extension]) {
    return 'Attach a photo, PDF, Word, Excel, PowerPoint, CSV or text file.';
  }
  if (size <= 0) return 'This file is empty.';
  if (size > EVIDENCE_MAX_BYTES) return `Files can be up to ${EVIDENCE_MAX_LABEL} each.`;
  return null;
}

/**
 * Whether one more file can join what is already staged, before any of its
 * bytes move (§23).
 *
 * The database refuses the same two limits when the message is sent, and that
 * is the check that counts. This one exists so that nobody is told about it
 * only after uploading a hundred megabytes from a phone on a plant floor — and
 * so that the file which does not fit is named, rather than the whole selection
 * being thrown away.
 */
export function evidenceAdditionProblem(
  staged: { files: number; bytes: number },
  size: number,
): string | null {
  if (staged.files >= EVIDENCE_MAX_FILES_PER_MESSAGE) {
    return `Up to ${EVIDENCE_MAX_FILES_PER_MESSAGE} files can go with one update. Send these first.`;
  }
  if (staged.bytes + size > EVIDENCE_MAX_MESSAGE_BYTES) {
    return `This would take the update past ${EVIDENCE_MAX_MESSAGE_LABEL}. Send what is here first.`;
  }
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...bytes.slice(from, to));
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(
      sample.length === bytes.length ? sample : sample.slice(0, sample.length - 4),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * What a file really is, from its first bytes, checked against its name.
 *
 * Returns the type to store, or null when the content does not match the
 * extension — a renamed executable, a script calling itself a PDF, a text
 * file calling itself a photo. The first 8 KB are enough for every type we
 * accept.
 */
export function sniffEvidenceType(bytes: Uint8Array, name: string): EvidenceType | null {
  const extension = extensionOf(name);
  const allowed = EXTENSION_TYPES[extension];
  if (!allowed) return null;

  let detected: EvidenceType | null = null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) detected = 'image/jpeg';
  else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    detected = 'image/png';
  else if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')
    detected = 'image/gif';
  else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') detected = 'image/webp';
  else if (
    ascii(bytes, 4, 8) === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(ascii(bytes, 8, 12))
  ) {
    detected = extension === 'heif' ? 'image/heif' : 'image/heic';
  } else if (ascii(bytes, 0, 5) === '%PDF-') detected = 'application/pdf';
  else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // A zip: only an Office Open XML document is acceptable, and the name
    // says which one. Anything else zipped (an archive, an app) is refused.
    const ooxml = ['docx', 'xlsx', 'pptx'];
    detected = ooxml.includes(extension) ? (allowed[0] ?? null) : null;
  } else if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // The legacy Office container.
    detected = ['doc', 'xls', 'ppt'].includes(extension) ? (allowed[0] ?? null) : null;
  } else if ((extension === 'txt' || extension === 'csv') && looksLikeText(bytes)) {
    detected = allowed[0] ?? null;
  }

  return detected && allowed.includes(detected) ? detected : null;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What a scan state is called in front of somebody (v271).
 *
 * v270 made these states real, so the label can no longer be the constant
 * "Not scanned" v199 wrote when there was no scanner. `clean` is called
 * "Scanned" rather than "Clean": a scanner finding nothing is not a promise,
 * and the stronger word would be read as one.
 */
export const SCAN_LABELS: Record<string, string> = {
  not_scanned: 'Not scanned',
  pending: 'Being scanned',
  clean: 'Scanned',
  infected: 'Quarantined',
  unavailable: 'Scan unavailable',
};

/**
 * The short label under a file: "JPG · 1.2 MB · Not scanned".
 *
 * The scan state is said only where it is actually known. v199 appended a
 * constant "Not scanned" because nothing could scan; now that something can,
 * a page without the scan state to hand says nothing about scanning rather
 * than repeating a word that has stopped being true. The owner's pages are
 * served by a procedure that does not return it, so that is where this
 * matters -- and an unrecognised state reads as "Not scanned", which is the
 * one wrong answer that cannot mislead.
 */
export function evidenceLabel(name: string, size: number, scan?: string | null): string {
  const extension = extensionOf(name).toUpperCase() || 'FILE';
  const head = `${extension} · ${formatBytes(size)}`;
  if (scan === undefined || scan === null) return head;
  return `${head} · ${SCAN_LABELS[scan] ?? SCAN_LABELS.not_scanned}`;
}

/**
 * Whether the file somebody is looking at is the file that was taken (v271).
 *
 * Only shown to ESH, and only worth a sentence when a photograph was shrunk
 * to send it. `none` is silence on purpose: the stored object *is* what was
 * chosen, and saying "original kept" about a file nobody compressed would
 * train people to read the phrase as decoration.
 */
export function sourceNote(state: string | null | undefined, bytes?: number | null): string | null {
  if (state === 'kept') {
    return bytes ? `Full-size original kept · ${formatBytes(bytes)}` : 'Full-size original kept';
  }
  if (state === 'pending') return 'Full-size original still arriving';
  if (state === 'unavailable') return 'Compressed copy only — the original never arrived';
  return null;
}

/**
 * v266 — what ESH will accept as proof, said before the owner goes and takes
 * the wrong photograph.
 */
export const EVIDENCE_KIND_LABELS: Record<string, string> = {
  photograph: 'A photograph',
  inspection: 'An inspection record',
  functional_test: 'A functional test result',
  measurement: 'A measurement',
  procedure: 'The revised procedure',
  other: 'Something else ESH has described',
};

/**
 * v270 — when a photograph is worth shrinking before it is sent.
 *
 * Only images, and only ones big enough that the saving is worth the loss of
 * the EXIF block (see `compress-image.ts`). A 400KB photograph is already fine
 * on a weak signal, and re-encoding it would cost provenance for nothing.
 *
 * PNG is included because phone screenshots of permits and labels arrive as
 * PNG and are frequently several megabytes.
 */
export const COMPRESS_OVER_BYTES = 1_500_000;
export const COMPRESS_MAX_EDGE = 2000;
export const COMPRESS_QUALITY = 0.82;

const COMPRESSIBLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export function shouldCompress(type: string | null | undefined, size: number): boolean {
  if (!type || !COMPRESSIBLE.has(type.toLowerCase())) return false;
  return size > COMPRESS_OVER_BYTES;
}

/**
 * v285 — how many pixels an image may claim, which is not the same question
 * as how many bytes it takes.
 *
 * `sniffEvidenceType` establishes that a file is really a PNG or a JPEG. It
 * says nothing about size, and an image's byte count is a poor guide to the
 * work of decoding it: a 30000 x 30000 PNG of one flat colour compresses to a
 * few hundred kilobytes and still asks a decoder for 3.6 billion pixels. Ours
 * is not the decoder that suffers — nothing on the server decodes evidence —
 * but every browser that later opens the finding is, and so is the phone of
 * whoever uploaded it.
 *
 * 80 megapixels is roughly twice the largest sensor sold in a phone today, so
 * a real photograph has room, and 20000 on a side catches the long thin shapes
 * that stay under a pixel budget while still being unreasonable.
 */
export const EVIDENCE_MAX_PIXELS = 80_000_000;
export const EVIDENCE_MAX_EDGE = 20_000;

/** Big-endian, because every image header here is. */
function be(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + (bytes[at + index] ?? 0);
  return value;
}

/**
 * What an image says its dimensions are, read from its header.
 *
 * Returns null when they cannot be read — a format not covered, a header
 * split across more bytes than were handed in, a JPEG whose frame marker sits
 * behind a large thumbnail. Null means *unknown*, never *acceptable*: the
 * caller decides, and `pixelProblem` deliberately lets an unreadable header
 * through rather than refusing real photographs on a parser's limits.
 */
export function imageDimensions(
  bytes: Uint8Array,
  type: string,
): { width: number; height: number } | null {
  if (type === 'image/png') {
    // 8-byte signature, then the IHDR length and tag, then the two dimensions.
    if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') return null;
    return { width: be(bytes, 16, 4), height: be(bytes, 20, 4) };
  }

  if (type === 'image/gif') {
    if (bytes.length < 10) return null;
    // The only little-endian header of the set.
    return { width: bytes[6]! + bytes[7]! * 256, height: bytes[8]! + bytes[9]! * 256 };
  }

  if (type === 'image/webp') {
    if (bytes.length < 30 || ascii(bytes, 8, 12) !== 'WEBP') return null;
    const chunk = ascii(bytes, 12, 16);
    if (chunk === 'VP8X') {
      // Three bytes each, little-endian, and one less than the real size.
      const width = 1 + (bytes[24]! + bytes[25]! * 256 + bytes[26]! * 65536);
      const height = 1 + (bytes[27]! + bytes[28]! * 256 + bytes[29]! * 65536);
      return { width, height };
    }
    if (chunk === 'VP8 ') {
      const width = (bytes[26]! + bytes[27]! * 256) & 0x3fff;
      const height = (bytes[28]! + bytes[29]! * 256) & 0x3fff;
      return width && height ? { width, height } : null;
    }
    return null;
  }

  if (type !== 'image/jpeg') return null;

  /*
   * Walk the segment chain to the frame header. Everything before it is
   * metadata of some kind, and a photograph from a phone usually carries
   * several kilobytes of it, so the frame can be a long way in.
   */
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1]!;
    // Padding, and the markers that carry no length of their own.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return { height: be(bytes, at + 5, 2), width: be(bytes, at + 7, 2) };
    // Start of scan: the compressed data begins, and no frame header follows.
    if (marker === 0xda) return null;
    const length = be(bytes, at + 2, 2);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * Whether an image's own header puts it beyond what anything should be asked
 * to decode. Null for every file whose dimensions cannot be read, which is the
 * safe answer here: refusing a real photograph because a parser did not
 * recognise its header would cost somebody their evidence, and the byte-size
 * and type checks still apply either way.
 */
export function pixelProblem(bytes: Uint8Array, type: string): 'image_too_large' | null {
  const size = imageDimensions(bytes, type);
  if (!size) return null;
  if (size.width <= 0 || size.height <= 0) return 'image_too_large';
  if (size.width > EVIDENCE_MAX_EDGE || size.height > EVIDENCE_MAX_EDGE) return 'image_too_large';
  if (size.width * size.height > EVIDENCE_MAX_PIXELS) return 'image_too_large';
  return null;
}

/**
 * v285 — the two decisions inside a re-encode, lifted out of the canvas.
 *
 * `compress-image.ts` can only run in a browser, so neither of these was
 * covered by anything but a browser test. They are arithmetic and a judgement
 * call, and both have an answer that is wrong in a way a screenshot would not
 * show.
 */

/** The size to draw at: the long edge capped, the shape kept. */
export function scaledTo(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0) return { width, height };
  const scale = maxEdge / longest;
  // At least one pixel each way: a 4000 x 3 strip must not round to nothing.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether a PNG should stay a PNG rather than become a JPEG.
 *
 * A photograph is far smaller as a JPEG and loses nothing anybody is looking
 * for. A screenshot of a permit is the opposite case: the text is thin, dark
 * on white, and JPEG's chroma subsampling puts a coloured halo around every
 * character — while barely saving anything, because flat colour is what PNG is
 * already good at. The size ratio tells the two apart without having to guess
 * what the picture is of: when JPEG cannot beat PNG by a clear margin, the
 * image is flat-toned and JPEG is the wrong format for it.
 */
export const PNG_TO_JPEG_RATIO = 0.7;

export function preferPng(pngBytes: number, jpegBytes: number): boolean {
  if (pngBytes <= 0) return false;
  return jpegBytes > pngBytes * PNG_TO_JPEG_RATIO;
}

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

/** Per file, and per message (§23 defaults, within this deployment's limits). */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MAX_FILES_PER_MESSAGE = 10;

export type EvidenceType = (typeof DEFAULT_ALLOWED_MIME_TYPES)[number];

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
  if (size > EVIDENCE_MAX_BYTES) return 'Files can be up to 10 MB each.';
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

/** The short label under a file: "JPG · 1.2 MB · Not scanned". */
export function evidenceLabel(name: string, size: number): string {
  const extension = extensionOf(name).toUpperCase() || 'FILE';
  return `${extension} · ${formatBytes(size)} · Not scanned`;
}

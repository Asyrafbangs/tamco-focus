/**
 * What may be stored as evidence, decided without touching the server.
 *
 * Kept out of `src/server/attachments.ts` so the rules can be exercised
 * directly. The server module is `server-only`, which is right for the code
 * that reaches storage and wrong for a list of refused extensions: a rule
 * nothing can test is a rule nobody can change safely.
 */

/**
 * The formats this organisation files as proof of work.
 *
 * Manager and Employee Change Specification §19 names them: "JPG/JPEG, PNG,
 * HEIC, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, CSV and TXT, subject to actual safe
 * processing capabilities. Do not advertise formats the pipeline rejects."
 *
 * One list, because there were four and they disagreed. The storage bucket
 * refused HEIC, both legacy Office formats and every PowerPoint file; the task
 * drawer's picker offered a narrower set than the completion panel; and the
 * completion panel offered formats no part of the pipeline would store. Each
 * copy was correct on the day it was written and none of them moved together.
 * `env.ts` takes its default from here, both file choosers take their `accept`
 * from here, and `20260909010000_v152_storage_mime_types.sql` sets the bucket
 * to the same list with a test that fails if the two ever part company.
 *
 * Executables and scripts are not on it and must not be added: this is the
 * allow-list, so anything unnamed is already refused.
 */
export const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

/**
 * What a file chooser offers, which is the same list plus extension hints.
 *
 * The hints are not decoration. `accept` filters what the operating system's
 * dialogue will show, and Windows reports no MIME type at all for some legacy
 * Office documents — a chooser keyed on types alone greys out the very file
 * somebody was told to attach, with no explanation and nothing to click.
 */
export const ATTACHMENT_ACCEPT = [
  ...DEFAULT_ALLOWED_MIME_TYPES,
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.heic',
  '.heif',
].join(',');

/**
 * Extensions that must never be stored, whatever the browser called them.
 *
 * The MIME allow-list is the primary control and it is strict, but a browser
 * reports the type it infers and an attacker chooses the name. `payload.exe`
 * renamed `report.pdf` arrives claiming `application/pdf`, passes an
 * allow-list keyed on type alone, and sits in storage with an extension some
 * other system downstream may one day honour.
 *
 * A refusal rather than a second allow-list: the point is to make a dangerous
 * name impossible to store, not to hold a second opinion about which documents
 * are acceptable evidence.
 */
export const REFUSED_EXTENSIONS = [
  'exe',
  'com',
  'scr',
  'pif',
  'bat',
  'cmd',
  'msi',
  'msp',
  'dll',
  'sys',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'jar',
  'sh',
  'bash',
  'zsh',
  'app',
  'apk',
  'deb',
  'rpm',
  'reg',
  'lnk',
  'hta',
  'chm',
  'wsf',
  // Macro-enabled Office documents. Ordinary evidence never needs one, and a
  // spreadsheet that runs code when opened is exactly what an allow-list of
  // types waves through.
  'docm',
  'xlsm',
  'xlsb',
  'pptm',
];

export interface AttachmentLimits {
  maxBytes: number;
  maxFilesPerUpload: number;
  maxBatchBytes: number;
  allowedMimeTypes: readonly string[];
}

/** Just enough of a `File` to judge it, so this needs no DOM to test. */
export interface CandidateFile {
  name: string;
  type: string;
  size: number;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

const megabytes = (bytes: number) => Math.floor(bytes / 1_048_576);

/** The first reason these files cannot be stored, in words for the person. */
export function refuseAttachments(
  files: readonly CandidateFile[],
  limits: AttachmentLimits,
): string | null {
  /*
   * The batch, not only each file. Ten files inside the per-file limit are
   * still ten files, and a completion that quietly accepts a hundred megabytes
   * of photographs is a storage bill nobody chose to pay.
   */
  if (files.length > limits.maxFilesPerUpload) {
    return `Attach at most ${limits.maxFilesPerUpload} files at a time.`;
  }

  let total = 0;
  for (const file of files) {
    if (file.size > limits.maxBytes) {
      return `${file.name} is larger than the ${megabytes(limits.maxBytes)} MB limit.`;
    }
    if (!limits.allowedMimeTypes.includes(file.type)) {
      return `${file.name} is not an allowed file type.`;
    }
    if (REFUSED_EXTENSIONS.includes(extensionOf(file.name))) {
      // Named plainly: somebody attaching a macro-enabled spreadsheet should
      // learn why rather than conclude the upload is broken.
      return `${file.name} cannot be stored. Programs, scripts and macro-enabled documents are not accepted as evidence.`;
    }
    total += file.size;
  }

  if (total > limits.maxBatchBytes) {
    return `That is more than the ${megabytes(limits.maxBatchBytes)} MB this can take at once. Attach fewer files.`;
  }

  return null;
}

/**
 * What may be stored as evidence, decided without touching the server.
 *
 * Kept out of `src/server/attachments.ts` so the rules can be exercised
 * directly. The server module is `server-only`, which is right for the code
 * that reaches storage and wrong for a list of refused extensions: a rule
 * nothing can test is a rule nobody can change safely.
 */

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

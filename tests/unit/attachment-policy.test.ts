import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_ACCEPT,
  DEFAULT_ALLOWED_MIME_TYPES,
  extensionOf,
  REFUSED_EXTENSIONS,
  refuseAttachments,
  type CandidateFile,
} from '@/domain/attachment-policy';

/**
 * What may be stored as evidence.
 *
 * The MIME allow-list is the primary control, and on its own it is not enough:
 * a browser reports the type it infers and whoever uploads chooses the name.
 * These cases are the ones where the two disagree.
 */

const LIMITS = {
  maxBytes: 10_485_760,
  maxFilesPerUpload: 10,
  maxBatchBytes: 41_943_040,
  allowedMimeTypes: [
    'image/jpeg',
    'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

const file = (over: Partial<CandidateFile> = {}): CandidateFile => ({
  name: 'report.pdf',
  type: 'application/pdf',
  size: 1024,
  ...over,
});

describe('refuseAttachments', () => {
  it('accepts the documents an organisation actually files', () => {
    expect(refuseAttachments([file()], LIMITS)).toBeNull();
    expect(refuseAttachments([file({ name: 'walk.jpg', type: 'image/jpeg' })], LIMITS)).toBeNull();
    expect(
      refuseAttachments(
        [
          file({
            name: 'readings.xlsx',
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
        ],
        LIMITS,
      ),
    ).toBeNull();
  });

  it('refuses a type that is not on the list', () => {
    const refused = refuseAttachments(
      [file({ name: 'thing.zip', type: 'application/zip' })],
      LIMITS,
    );
    expect(refused).toContain('not an allowed file type');
  });

  it('refuses a program whatever the browser claims it is', () => {
    /*
     * The case the MIME list alone cannot catch: the name is chosen by whoever
     * uploads, and the type is inferred. `payload.exe` announcing itself as a
     * PDF passes an allow-list keyed on type and lands in storage with an
     * extension something downstream may one day honour.
     */
    const refused = refuseAttachments(
      [file({ name: 'payload.exe', type: 'application/pdf' })],
      LIMITS,
    );
    expect(refused).toContain('cannot be stored');
    expect(refused).toContain('Programs, scripts');
  });

  it('refuses a macro-enabled workbook, which a type list waves through', () => {
    // `.xlsm` carries the spreadsheet MIME type. Ordinary evidence never needs
    // a document that runs code when it is opened.
    const refused = refuseAttachments(
      [
        file({
          name: 'readings.xlsm',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ],
      LIMITS,
    );
    expect(refused).toContain('cannot be stored');
  });

  it('is not fooled by capitals or a double extension', () => {
    expect(refuseAttachments([file({ name: 'Setup.EXE' })], LIMITS)).toContain('cannot be stored');
    expect(refuseAttachments([file({ name: 'report.pdf.bat' })], LIMITS)).toContain(
      'cannot be stored',
    );
  });

  it('caps the batch as well as each file', () => {
    // Ten files inside the per-file limit are still ten files.
    const many = Array.from({ length: 11 }, () => file());
    expect(refuseAttachments(many, LIMITS)).toContain('at most 10 files');

    const heavy = Array.from({ length: 5 }, () => file({ size: 9_000_000 }));
    expect(refuseAttachments(heavy, LIMITS)).toContain('more than the 40 MB');

    expect(refuseAttachments([file({ size: 11_000_000 })], LIMITS)).toContain('larger than the');
  });

  it('reads an extension the way a filesystem would', () => {
    expect(extensionOf('report.pdf')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('no-extension')).toBe('');
    expect(extensionOf('.hidden')).toBe('hidden');
  });
});

/**
 * v152 §19 — "Do not advertise formats the pipeline rejects."
 *
 * There were four lists of acceptable formats: the storage bucket's, the
 * server allow-list, the completion panel's chooser and the task drawer's
 * picker. They disagreed in both directions. The bucket refused HEIC, legacy
 * .doc and .xls, and every PowerPoint file, so a panel reading "Photos · PDF ·
 * Word · Excel · PowerPoint" could not store a deck at all — and the drawer's
 * picker offered a narrower set again, so the same photograph was acceptable
 * on one screen and not on the next.
 *
 * These assertions are cheap and they are the reason the lists cannot drift
 * apart silently again. The bucket is held to the same list from
 * `tests/integration/storage-object-access-v152.test.ts`, which is the only
 * place that can actually try an upload.
 */
describe('the advertised formats', () => {
  it('offers every type the server will accept', () => {
    const offered = ATTACHMENT_ACCEPT.split(',');
    for (const type of DEFAULT_ALLOWED_MIME_TYPES) {
      expect(offered, `the chooser hides ${type}, which the server accepts`).toContain(type);
    }
  });

  it('names no type the server will refuse', () => {
    const types = ATTACHMENT_ACCEPT.split(',').filter((entry) => !entry.startsWith('.'));
    for (const type of types) {
      expect(
        DEFAULT_ALLOWED_MIME_TYPES as readonly string[],
        `the chooser offers ${type}, which the server refuses`,
      ).toContain(type);
    }
  });

  it('hints the extensions of the formats an operating system types poorly', () => {
    /*
     * Windows reports no MIME type for some legacy Office documents, and
     * `accept` filters what the file dialogue will show: without these, the
     * document somebody was told to attach is greyed out with no explanation.
     */
    const hints = ATTACHMENT_ACCEPT.split(',').filter((entry) => entry.startsWith('.'));
    for (const extension of ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.heic']) {
      expect(hints).toContain(extension);
    }
  });

  it('offers nothing that is refused by name', () => {
    // An allow-list that named a macro-enabled document would be two rules
    // contradicting each other, and the more permissive one would be the one
    // people noticed.
    const hints = ATTACHMENT_ACCEPT.split(',')
      .filter((entry) => entry.startsWith('.'))
      .map((entry) => entry.slice(1));
    for (const extension of hints) {
      expect(REFUSED_EXTENSIONS).not.toContain(extension);
    }
  });
});

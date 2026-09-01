import { describe, expect, it } from 'vitest';

import { extensionOf, refuseAttachments, type CandidateFile } from '@/domain/attachment-policy';

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

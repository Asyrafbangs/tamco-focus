import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_ACCEPT,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MAX_MESSAGE_BYTES,
  evidenceAdditionProblem,
  evidenceLabel,
  evidenceProblem,
  safeEvidenceName,
  sniffEvidenceType,
  uploadContentType,
} from '@/domain/esh-evidence';
import { submitProblems } from '@/domain/esh-guest';

/**
 * v199 — what an evidence file really is.
 *
 * The browser's word is not taken for a file's type or name: the server
 * reads the first bytes back from storage and they must agree with the name.
 * These are the rules it applies.
 */

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(32).fill(0x20)]);
const text = (value: string) => new TextEncoder().encode(value);

describe('v199 — evidence files', () => {
  it('recognises every accepted type by its content', () => {
    expect(sniffEvidenceType(bytes(0xff, 0xd8, 0xff, 0xe0), 'after.JPG')).toBe('image/jpeg');
    expect(sniffEvidenceType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'a.png')).toBe(
      'image/png',
    );
    expect(sniffEvidenceType(text('GIF89a......'), 'a.gif')).toBe('image/gif');
    expect(sniffEvidenceType(text('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '), 'a.webp')).toBe(
      'image/webp',
    );
    expect(sniffEvidenceType(text('\u0000\u0000\u0000\u0018ftypheic\u0000\u0000'), 'a.heic')).toBe(
      'image/heic',
    );
    expect(sniffEvidenceType(text('%PDF-1.7\n'), 'report.pdf')).toBe('application/pdf');
    expect(sniffEvidenceType(bytes(0x50, 0x4b, 0x03, 0x04), 'checklist.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(
      sniffEvidenceType(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), 'old.doc'),
    ).toBe('application/msword');
    expect(sniffEvidenceType(text('area,done\nBR2,yes\n'), 'log.csv')).toBe('text/csv');
  });

  it('refuses a file that is not what its name says', () => {
    // An executable renamed to look like a document or a photo.
    expect(sniffEvidenceType(text('MZ\u0090\u0000'), 'report.pdf')).toBeNull();
    expect(sniffEvidenceType(text('MZ\u0090\u0000'), 'photo.jpg')).toBeNull();
    // A zip that is not an Office document.
    expect(sniffEvidenceType(bytes(0x50, 0x4b, 0x03, 0x04), 'photos.zip')).toBeNull();
    expect(sniffEvidenceType(bytes(0x50, 0x4b, 0x03, 0x04), 'photo.jpg')).toBeNull();
    // A PDF calling itself a photo, and binary content calling itself text.
    expect(sniffEvidenceType(text('%PDF-1.7'), 'photo.png')).toBeNull();
    expect(sniffEvidenceType(bytes(0x00, 0x01, 0x02), 'notes.txt')).toBeNull();
    // Script content in a text file is still refused by name before it gets here.
    expect(evidenceProblem('run.ps1', 10)).toBe('This kind of file cannot be attached.');
  });

  it('checks the name and size before any bytes move', () => {
    expect(evidenceProblem('setup.exe', 10)).toBe('This kind of file cannot be attached.');
    expect(evidenceProblem('archive.zip', 10)).toBe(
      'Attach a photo, PDF, Word, Excel, PowerPoint, CSV or text file.',
    );
    expect(evidenceProblem('photo.jpg', 0)).toBe('This file is empty.');
    // v226 — 25 MB, which is what §23 asks for and what a phone photograph of a
    // dark plant room actually weighs.
    expect(EVIDENCE_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(evidenceProblem('photo.jpg', EVIDENCE_MAX_BYTES + 1)).toBe(
      'Files can be up to 25 MB each.',
    );
    expect(evidenceProblem('photo.jpg', EVIDENCE_MAX_BYTES)).toBeNull();
  });

  it('v226 stops an update going over the total before anything is uploaded', () => {
    const megabyte = 1024 * 1024;
    expect(EVIDENCE_MAX_MESSAGE_BYTES).toBe(100 * megabyte);

    // Room for it: nothing to say.
    expect(evidenceAdditionProblem({ files: 3, bytes: 60 * megabyte }, 20 * megabyte)).toBeNull();
    // Exactly the limit is inside it.
    expect(evidenceAdditionProblem({ files: 3, bytes: 80 * megabyte }, 20 * megabyte)).toBeNull();
    // One byte over is not.
    expect(evidenceAdditionProblem({ files: 3, bytes: 80 * megabyte }, 20 * megabyte + 1)).toBe(
      'This would take the update past 100 MB. Send what is here first.',
    );
    // The count is its own limit, whatever the sizes.
    expect(evidenceAdditionProblem({ files: 10, bytes: 1 }, 1)).toBe(
      'Up to 10 files can go with one update. Send these first.',
    );
  });

  it('keeps a display name safe: no path, no control characters', () => {
    expect(safeEvidenceName('C:\\Users\\me\\Walkway after.jpg')).toBe('Walkway after.jpg');
    expect(safeEvidenceName('../../etc/passwd')).toBe('passwd');
    expect(safeEvidenceName('a<b>c.pdf')).toBe('abc.pdf');
    expect(safeEvidenceName('   ')).toBe('evidence');
  });

  it('uploads as the type the name implies, since browsers often report none', () => {
    expect(uploadContentType('IMG_0001.HEIC')).toBe('image/heic');
    expect(uploadContentType('plan.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(EVIDENCE_ACCEPT.split(',')).toContain('.heic');
    expect(EVIDENCE_ACCEPT).not.toContain('.exe');
  });

  it('never calls a file clean', () => {
    expect(evidenceLabel('after.jpg', 1_258_291)).toBe('JPG · 1.2 MB · Not scanned');
  });

  it('says what a submission is missing, in one sentence', () => {
    expect(submitProblems('evidence_incomplete', ['result_required', 'file_required'])).toBe(
      'To submit for review, write a short result and attach at least one file showing the correction.',
    );
    expect(submitProblems('evidence_incomplete', ['file_required'])).toBe(
      'To submit for review, attach at least one file showing the correction.',
    );
    expect(submitProblems('already_submitted')).toBe('Your work is already with ESH for review.');
  });
});

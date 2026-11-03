import { describe, expect, it } from 'vitest';

import {
  PUBLIC_PHOTO_MAX,
  PUBLIC_PHOTO_MAX_INPUT_BYTES,
  PUBLIC_REPORT_COPY,
  photoAdditionProblem,
  photoProblem,
  reportTextProblem,
} from '@/domain/esh-public-report';

/**
 * v288 — what the public form accepts, and what it promises.
 *
 * The person using this is not signed in to anything and may never use it
 * again, so every refusal has to be a sentence they can act on. The copy is
 * asserted as well as the validation: each line of it is a promise the
 * application has to keep, and a promise that drifts is worse than one that
 * was never made.
 */
describe('v288 which photographs the form takes', () => {
  it('takes a JPG and a PNG', () => {
    expect(photoProblem('walkway.jpg', 'image/jpeg', 800_000)).toBeNull();
    expect(photoProblem('permit.png', 'image/png', 800_000)).toBeNull();
  });

  /*
   * The case that would otherwise be a silent failure. An iPhone saves HEIC by
   * default; nothing on the server can decode it, so it could be neither
   * stripped of its co-ordinates nor rebuilt — and storing it as it arrived
   * would quietly break the anonymity this form promises.
   */
  it('refuses HEIC with a way out rather than a shrug', () => {
    const said = photoProblem('IMG_0421.HEIC', '', 3_000_000);
    expect(said).toMatch(/HEIC/);
    expect(said).toMatch(/Most Compatible/);
    expect(photoProblem('IMG_0421.heic', 'image/heic', 3_000_000)).toMatch(/HEIC/);
  });

  it('refuses anything else in words a plant worker would use', () => {
    expect(photoProblem('report.pdf', 'application/pdf', 100)).toBe('Send a JPG or PNG photo.');
    expect(photoProblem('clip.mp4', 'video/mp4', 100)).toMatch(/JPG or PNG/);
  });

  it('refuses an empty file and one over the input limit', () => {
    expect(photoProblem('walkway.jpg', 'image/jpeg', 0)).toMatch(/empty/);
    expect(photoProblem('walkway.jpg', 'image/jpeg', PUBLIC_PHOTO_MAX_INPUT_BYTES + 1)).toMatch(
      /too large/,
    );
    // On the limit, not past it: a 12 MB frame from a current phone goes.
    expect(photoProblem('walkway.jpg', 'image/jpeg', PUBLIC_PHOTO_MAX_INPUT_BYTES)).toBeNull();
  });

  it('stops at three, and says how to add another', () => {
    expect(photoAdditionProblem(0)).toBeNull();
    expect(photoAdditionProblem(PUBLIC_PHOTO_MAX - 1)).toBeNull();
    expect(photoAdditionProblem(PUBLIC_PHOTO_MAX)).toMatch(/Remove one/);
  });
});

describe('v288 the one field that is required', () => {
  it('asks for the observation in four words', () => {
    expect(reportTextProblem('')).toBe('Say what you saw.');
    expect(reportTextProblem('   \n  ')).toBe('Say what you saw.');
  });

  it('takes a real observation', () => {
    expect(
      reportTextProblem('The guard is off the bench grinder and it is still in use.'),
    ).toBeNull();
  });

  it('refuses an essay rather than truncating one', () => {
    expect(reportTextProblem('x'.repeat(4001))).toMatch(/longer than this form/);
  });
});

describe('v288 the promises on the page', () => {
  /*
   * §6: this is not an emergency channel. The line has to say so without
   * naming a number the application cannot know, and without implying that
   * somebody is watching the form.
   */
  it('says plainly that nobody is watching', () => {
    expect(PUBLIC_REPORT_COPY.emergency).toMatch(/emergency procedure/i);
    expect(PUBLIC_REPORT_COPY.emergency).toMatch(/does not raise an alarm/i);
    expect(PUBLIC_REPORT_COPY.emergency).not.toMatch(/\d{3,}/);
  });

  it('says what anonymous means, in terms of what is not kept', () => {
    const privacy = PUBLIC_REPORT_COPY.privacy.join(' ');
    expect(privacy).toMatch(/no account, no device, no location data/i);
    expect(privacy).toMatch(/where it was taken — is removed/i);
    expect(privacy).toMatch(/never published/i);
  });

  it('tells the reporter they do not have to classify anything', () => {
    expect(PUBLIC_REPORT_COPY.privacy.join(' ')).toMatch(/ESH decides what kind of hazard/i);
  });

  // The contact field is optional and has to read as optional, or people who
  // would rather stay anonymous will fill it in anyway.
  it('offers the contact line as optional, both in the label and the hint', () => {
    expect(PUBLIC_REPORT_COPY.contact).toMatch(/optional/i);
    expect(PUBLIC_REPORT_COPY.contactHint).toMatch(/anonymously/i);
  });
});

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

  /*
   * v293 — the same subject, held to what the code can actually do.
   *
   * This used to require the page to say "no account, no device, no location
   * data". The first two are true; the third is not, because the sticker
   * records which location the report came from, and neither covers the
   * description naming its writer or a photograph showing a face. A promise
   * the implementation cannot keep is worse than no promise, because somebody
   * writes something they believe is untraceable. So the absolute claims are
   * now refused, and what replaced them is required.
   */
  it('does not promise an anonymity the implementation cannot keep', () => {
    const privacy = PUBLIC_REPORT_COPY.privacy.join(' ');
    expect(privacy).not.toMatch(/no account, no device, no location data/i);
    expect(privacy).not.toMatch(/nobody else sees it/i);
    expect(privacy).not.toMatch(/nothing in the report identifies you/i);
  });

  it('says what is true: what is removed, what is kept, and what to leave out', () => {
    const privacy = PUBLIC_REPORT_COPY.privacy.join(' ');
    expect(privacy).toMatch(/where it was taken, is removed/i);
    expect(privacy).toMatch(/never published/i);
    // The one thing the reader controls.
    expect(privacy).toMatch(/avoid putting names, faces or badges/i);
    // And the one thing the sticker settles for them.
    expect(privacy).toMatch(/which location the report came from/i);
  });

  it('tells the reporter they do not have to classify anything', () => {
    expect(PUBLIC_REPORT_COPY.privacy.join(' ')).toMatch(/ESH decides what kind of hazard/i);
  });

  // The contact field is optional and has to read as optional, or people who
  // would rather not be named will fill it in anyway.
  it('offers the contact line as optional, both in the label and the hint', () => {
    expect(PUBLIC_REPORT_COPY.contact).toMatch(/optional/i);
    expect(PUBLIC_REPORT_COPY.contactHint).toMatch(/leave blank/i);
    /*
     * v293 — and the hint no longer says leaving it blank reports
     * "anonymously", which was the same promise in a shorter sentence. It
     * says what the reader decides: whether to give contact details.
     */
    expect(PUBLIC_REPORT_COPY.contactHint).not.toMatch(/anonymous/i);
  });

  // v293 — an extension is a way to be reached. The placeholder has to say so,
  // because a field that looks like an email field is one people skip.
  it('names the kinds of contact it will take', () => {
    expect(PUBLIC_REPORT_COPY.contactPlaceholder).toMatch(/email/i);
    expect(PUBLIC_REPORT_COPY.contactPlaceholder).toMatch(/extension/i);
  });
});

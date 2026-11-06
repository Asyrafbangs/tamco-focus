/**
 * Public safety reporting — the numbers and the words (v288, §2, §3, §6).
 *
 * One screen, for somebody standing on a plant floor who may be wearing
 * gloves, may not have an account, and may never use this again. Everything
 * here follows from that: four things to do, no decisions to make, and no
 * vocabulary they would have to learn.
 *
 * The form deliberately does **not** ask for a hazard category, a severity, a
 * responsible person or a department. ESH decides all four during review, and
 * asking an employee to guess any of them is how a reporting channel becomes
 * something people avoid.
 */

/** Up to three. A fourth photograph of the same hazard tells nobody more. */
export const PUBLIC_PHOTO_MAX = 3;

/**
 * What a phone may hand over, and what may be sent after the browser has
 * shrunk it.
 *
 * 12 MB in covers a current phone's full-size frame. 2 MB out is generous
 * for a 2560px JPEG at this quality — a typical one lands between 200 and
 * 800 KB — and it exists so that a browser which cannot re-encode (an
 * unsupported format, a canvas that failed) is refused with a sentence rather
 * than filling a server action's body limit.
 */
export const PUBLIC_PHOTO_MAX_INPUT_BYTES = 12 * 1024 * 1024;
export const PUBLIC_PHOTO_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * The longest edge, and the quality.
 *
 * 2560 rather than staff evidence's 2000: a hazard photographed from across a
 * bay needs the extra detail, and a label or a gauge reading has to survive.
 * Legibility beats the file size — the package says so, and a photograph
 * nobody can read is not evidence of anything.
 */
export const PUBLIC_PHOTO_MAX_EDGE = 2560;
export const PUBLIC_PHOTO_QUALITY = 0.8;

/**
 * JPEG and PNG only.
 *
 * Not HEIC, which is what an iPhone saves by default: nothing on the server
 * can decode it, so it could be neither stripped of its GPS co-ordinates nor
 * rebuilt — and storing a photograph that still carries where it was taken
 * would quietly break the anonymity this form promises. The browser converts
 * HEIC to JPEG as it draws it, which is why this is almost never seen; when it
 * is, `photoProblem` says what to do rather than failing silently.
 */
export const PUBLIC_PHOTO_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

export const PUBLIC_REPORT_MAX_TEXT = 4000;
export const PUBLIC_REPORT_MAX_CONTACT = 160;

/** What a file chooser offers, so nothing refused is offered. */
export const PUBLIC_PHOTO_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';

/**
 * Whether a chosen file can be used at all, said as a sentence for somebody
 * who is not a computer person.
 */
export function photoProblem(name: string, type: string, size: number): string | null {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())?.[1]?.toLowerCase() ?? '';
  if (
    extension === 'heic' ||
    extension === 'heif' ||
    type === 'image/heic' ||
    type === 'image/heif'
  ) {
    return 'This photo is in Apple’s HEIC format. In Settings › Camera › Formats choose "Most Compatible", or take a screenshot of the photo and send that.';
  }
  if (!PUBLIC_PHOTO_TYPES.has(type.toLowerCase())) {
    return 'Send a JPG or PNG photo.';
  }
  if (size <= 0) return 'That file is empty.';
  if (size > PUBLIC_PHOTO_MAX_INPUT_BYTES) {
    return 'That photo is too large. Take it again at a lower resolution.';
  }
  return null;
}

/** Whether one more photograph can join the ones already chosen. */
export function photoAdditionProblem(chosen: number): string | null {
  if (chosen >= PUBLIC_PHOTO_MAX) {
    return `Up to ${PUBLIC_PHOTO_MAX} photos. Remove one to add another.`;
  }
  return null;
}

export function reportTextProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'Say what you saw.';
  if (trimmed.length > PUBLIC_REPORT_MAX_TEXT) {
    return 'That is longer than this form can take. Keep it to the essentials.';
  }
  return null;
}

/**
 * The words on the page.
 *
 * Kept here rather than in the markup because every one of them is a promise
 * the application has to keep, and a promise worth keeping is worth being able
 * to find. The retention line says what happens to a photograph; the
 * emergency line says what this form is not.
 */
export const PUBLIC_REPORT_COPY = {
  heading: 'Report a safety concern',
  lead: 'Tell ESH what you saw. No account or name required.',
  /*
   * v293 - the sticker answers "where", so the page says so rather than
   * asking. An employee who has just scanned a code should not have to
   * recognise their own location in a list of departments.
   */
  locationHint: 'Location identified from QR code',
  /*
   * §6: this is not an emergency channel, and saying so once, plainly, at the
   * top is worth more than a paragraph nobody reads. The site's own procedure
   * is the authority; this form does not name a number, because inventing one
   * would be worse than naming none.
   */
  emergency:
    'If somebody is in immediate danger, stop and follow your site’s emergency procedure. This form does not raise an alarm and nobody is watching it at the moment you send it.',
  observation: 'What did you see?',
  observationMissing: 'Say what you saw before sending.',
  locationLabel: 'Where exactly? (Optional)',
  locationPlaceholder: 'Near the staircase or machine',
  photos: 'Add photos (Optional)',
  photosHint: `Up to ${PUBLIC_PHOTO_MAX}. Taken on this phone is fine — they are made smaller before they are sent.`,
  contact: 'Contact for follow-up (Optional)',
  contactPlaceholder: 'Email, phone or extension',
  contactHint: 'Leave blank if you prefer not to provide contact details.',
  privacyHeading: 'Privacy & what happens next',
  /*
   * v293 - what the system can actually keep.
   *
   * The previous wording promised more than the implementation can deliver:
   * "Nobody else sees it", "nothing in the report identifies you", "no device
   * or location data". A description can name the writer, a photograph can
   * show a face or a badge, and the sticker itself records where the report
   * came from. Saying otherwise invites somebody to write something they
   * believe is untraceable, which is the one mistake this page must not help
   * anybody make. What is said here is what the code enforces.
   */
  privacySummary:
    'ESH reviews your report and decides what action is required. Contact details are optional.',
  privacy: [
    'It goes to the ESH team responsible for this area, and stays in the Finding Management system for as long as the record is kept.',
    'If you would rather not be identified, leave the contact line blank and avoid putting names, faces or badges in the description or the photos — the report itself cannot tell what is in them.',
    'Photos are stored privately and are never published. What the camera records inside the file, including where it was taken, is removed before the photo is stored.',
    'The sticker you scanned tells ESH which location the report came from.',
    'ESH decides what kind of hazard it is and who fixes it. You do not have to.',
  ],
  submit: 'Send report',
  sending: 'Sending…',
  thanks: 'Thank you — ESH has your report',
  thanksDetail:
    'Keep this reference in case you want to ask about it. Nobody will contact you unless you left your name.',
  another: 'Report something else',
} as const;

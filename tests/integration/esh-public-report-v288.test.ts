import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachPublicPhoto, submitPublicReport } from '@/server/esh/public-report';

import { serviceClient } from './setup';

/**
 * v288 — a public report and its photographs, against the real local stack.
 *
 * The pgTAP test holds the procedures' own rules. What only this can establish
 * is the part that spans the application and storage: that the bytes written
 * into the private bucket are the **rebuilt** ones, with the EXIF block and
 * the co-ordinates in it gone. That is the promise the form makes to somebody
 * reporting anonymously, and it is the one that cannot be checked by reading
 * SQL.
 */

const BUCKET = 'finding-evidence';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';
const CODE = `BR2-TEST-${Date.now().toString(36).toUpperCase()}`;

/** A JPEG that decodes, with GPS co-ordinates sitting in an APP1 segment. */
function jpegWithExif(): Uint8Array {
  const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
  const segment = (marker: number, payload: number[]) => {
    const length = payload.length + 2;
    return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
  };
  return new Uint8Array([
    0xff,
    0xd8,
    ...segment(0xe1, [
      ...ascii('Exif'),
      0,
      0,
      ...ascii('GPSLatitude=3.1390N GPSLongitude=101.6869E'),
    ]),
    ...segment(0xfe, ascii('taken by somebody on the night shift')),
    ...segment(0xdb, [0x00, ...new Array(64).fill(0x10)]),
    ...segment(
      0xc0,
      [0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
    ),
    ...segment(0xda, [0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]),
    0x12,
    0xff,
    0x00,
    0x34,
    0x56,
    0xff,
    0xd9,
  ]);
}

const PHOTO = jpegWithExif();
const service = serviceClient();

beforeAll(async () => {
  // The switch is an administrator's act and is proven as one in pgTAP. Here
  // it is only a precondition, so it is set directly and put back afterwards.
  await service
    .from('esh_qr_intake_settings')
    .update({ enabled: true })
    .eq('organization_id', ORGANIZATION);
  const { data: departments } = await service.from('departments').select('id').eq('code', 'OPS');
  await service.from('esh_qr_locations').insert({
    organization_id: ORGANIZATION,
    public_code: CODE,
    display_label: 'BR2 Integration bay',
    department_id: departments?.[0]?.id ?? null,
    active: true,
  });
});

afterAll(async () => {
  /*
   * Closed again, and said rather than assumed: a shared local database with
   * public reporting left open would change what every other spec sees at
   * `/report`.
   */
  await service
    .from('esh_qr_intake_settings')
    .update({ enabled: false })
    .eq('organization_id', ORGANIZATION);
  await service.from('esh_qr_locations').delete().eq('public_code', CODE);
});

describe('v288 a public report', () => {
  it('stores the photograph rebuilt, with the EXIF block gone', async () => {
    const submitted = await submitPublicReport({
      code: CODE,
      text: 'Oil across the walkway by the press, about two metres of it.',
      reportedLocation: null,
      contact: null,
      bucket: null,
      withPhotos: true,
    });
    expect(submitted.ok, JSON.stringify(submitted)).toBe(true);
    if (!submitted.ok) return;

    const attached = await attachPublicPhoto({
      reference: submitted.report.reference,
      tokenHash: submitted.report.photoTokenHash,
      name: 'walkway.jpg',
      bytes: PHOTO,
    });
    expect(attached, JSON.stringify(attached)).toEqual({ ok: true });

    const { data: photos } = await service
      .from('esh_report_intake_photos')
      .select('object_key, state, content_type, size_bytes, scan_state')
      .eq('intake_id', submitted.report.intakeId);
    expect(photos).toHaveLength(1);
    const photo = photos![0]!;
    expect(photo.state).toBe('ready');
    expect(photo.content_type).toBe('image/jpeg');
    // Nothing is ever called clean, here as anywhere else.
    expect(photo.scan_state).toBe('not_scanned');

    const stored = await service.storage.from(BUCKET).download(String(photo.object_key));
    expect(stored.error).toBeNull();
    const bytes = Buffer.from(await stored.data!.arrayBuffer());

    // The assertion the whole rebuild exists for.
    expect(bytes.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
    expect(bytes.includes(Buffer.from('night shift'))).toBe(false);
    expect(bytes.byteLength).toBeLessThan(PHOTO.byteLength);
    expect(Number(photo.size_bytes)).toBe(bytes.byteLength);
    // Still a JPEG: rebuilt, not re-encoded.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it('refuses a fourth photograph, and a token that is not the one it issued', async () => {
    const submitted = await submitPublicReport({
      code: CODE,
      text: 'Three photos of the same spill, and then a fourth.',
      reportedLocation: null,
      contact: null,
      bucket: null,
      withPhotos: true,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    for (let index = 0; index < 3; index += 1) {
      const answer = await attachPublicPhoto({
        reference: submitted.report.reference,
        tokenHash: submitted.report.photoTokenHash,
        name: `spill-${index}.jpg`,
        bytes: PHOTO,
      });
      expect(answer, `photograph ${index + 1}`).toEqual({ ok: true });
    }

    const fourth = await attachPublicPhoto({
      reference: submitted.report.reference,
      tokenHash: submitted.report.photoTokenHash,
      name: 'spill-4.jpg',
      bytes: PHOTO,
    });
    expect(fourth).toEqual({ ok: false, code: 'too_many_photos' });

    // Knowing the reference is not enough: the token is the authorisation.
    const guessed = await attachPublicPhoto({
      reference: submitted.report.reference,
      tokenHash: 'f'.repeat(64),
      name: 'someone-elses.jpg',
      bytes: PHOTO,
    });
    expect(guessed).toEqual({ ok: false, code: 'not_permitted' });
  });

  it('refuses a file that is not the photograph it claims, and stores nothing', async () => {
    const submitted = await submitPublicReport({
      code: CODE,
      text: 'A renamed file, which is not a photograph of anything.',
      reportedLocation: null,
      contact: null,
      bucket: null,
      withPhotos: true,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const answer = await attachPublicPhoto({
      reference: submitted.report.reference,
      tokenHash: submitted.report.photoTokenHash,
      name: 'walkway.jpg',
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
    });
    expect(answer).toEqual({ ok: false, code: 'type_mismatch' });

    const { data: photos } = await service
      .from('esh_report_intake_photos')
      .select('state, rejected_reason')
      .eq('intake_id', submitted.report.intakeId);
    expect(photos).toHaveLength(1);
    expect(photos![0]).toMatchObject({ state: 'rejected', rejected_reason: 'type_mismatch' });
  });

  it('is refused outright once the channel is closed', async () => {
    await service
      .from('esh_qr_intake_settings')
      .update({ enabled: false })
      .eq('organization_id', ORGANIZATION);

    const submitted = await submitPublicReport({
      code: CODE,
      text: 'Sent a moment after the channel closed.',
      reportedLocation: null,
      contact: null,
      bucket: null,
      withPhotos: false,
    });
    expect(submitted).toEqual({ ok: false, code: 'not_enabled' });

    await service
      .from('esh_qr_intake_settings')
      .update({ enabled: true })
      .eq('organization_id', ORGANIZATION);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v285 — the two routes that answered a failed read with "Not found".
 *
 * This is the surface where the lie was actually told, so it is asserted here
 * rather than only on the reads beneath it. Both routes serve one evidence
 * file, both had a single `notFound()` for every way of not producing one, and
 * both had already read the asset row and found `state = 'ready'` before
 * asking Storage for a link. They knew the file existed and then told the
 * reader it did not.
 *
 * A 404 on an evidence file is a statement that the finding has no such file,
 * and somebody told that does not try again — so a Storage blink became, to
 * the reader, a photograph that had gone missing from a finding. 503 says the
 * opposite: it is there, ask again.
 *
 * The 404 still has to mean what it meant, which is what the companion cases
 * hold in place. On the owner's route it carries a second job: it must stay
 * uninformative, because an owner must not learn from it whether a file
 * exists, only that they cannot have this one. That rule is about what the
 * ANSWER discloses and is untouched by this change — a 503 reveals nothing
 * about any asset, and it is the only way an owner can tell "try again" from
 * "not yours".
 */

const state = vi.hoisted(() => ({
  assetRead: vi.fn(),
  photoRead: vi.fn(),
  guestFile: vi.fn(),
  guestSecret: vi.fn(),
  signed: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const answer = table === 'esh_report_intake_photos' ? state.photoRead : state.assetRead;
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => answer(),
      };
      return builder;
    },
  }),
}));

vi.mock('@/server/esh/evidence', () => ({ signedDownloadFor: state.signed }));

vi.mock('@/server/esh/guest', () => ({
  guestClient: () => ({ rpc: state.guestFile }),
  guestSecret: state.guestSecret,
}));

import { GET as staffFile } from '@/app/(esh)/findings/files/[assetId]/route';
import { GET as intakePhoto } from '@/app/(esh)/findings/intake/photos/[photoId]/route';
import { GET as ownerFile } from '@/app/respond/files/[assetId]/route';

const AN_ASSET = 'f0c05600-0000-4000-a000-000000000001';

/** An asset row that exists and is ready — so the file is known to be there. */
const A_READY_ASSET = {
  data: {
    object_key: `findings/${AN_ASSET}/evidence.jpg`,
    original_name: 'evidence.jpg',
    content_type: 'image/jpeg',
    state: 'ready',
    source_object_key: null,
    source_file_name: null,
    source_state: null,
  },
  error: null,
};

/** What PostgREST hands back when the gateway, not the query, is the problem. */
const UPSTREAM_502 = {
  data: null,
  error: { code: 'PGRST000', message: 'An invalid response was received from the upstream server' },
};

const A_LINK = { url: 'http://127.0.0.1:54321/storage/v1/object/sign/x?token=y', failed: false };
const SIGNING_FAILED = { url: null, failed: true };
const OBJECT_ABSENT = { url: null, failed: false };

const staffRequest = () => new Request(`http://127.0.0.1/findings/files/${AN_ASSET}`);
const params = { params: Promise.resolve({ assetId: AN_ASSET }) };

beforeEach(() => {
  state.assetRead.mockReset();
  state.photoRead.mockReset();
  state.guestFile.mockReset();
  state.guestSecret.mockReset();
  state.signed.mockReset();
  state.guestSecret.mockResolvedValue('a-guest-session-secret');
  // The console.error is the production behaviour under test, not noise to fix.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe("v285 the staff evidence route, when a read doesn't answer", () => {
  it('does not report a file that exists as not found when signing fails', async () => {
    state.assetRead.mockResolvedValue(A_READY_ASSET);
    state.signed.mockResolvedValue(SIGNING_FAILED);

    const response = await staffFile(staffRequest(), params);

    expect(response.status, 'a failed signing was reported as a missing file').not.toBe(404);
    expect(response.status).toBe(503);
  });

  /*
   * This read's error was discarded entirely, so a failed asset read fell
   * through to the same 404 as an asset that is not there.
   */
  it('does not report a 404 when the asset row cannot be read', async () => {
    state.assetRead.mockResolvedValue(UPSTREAM_502);

    const response = await staffFile(staffRequest(), params);

    expect(response.status).toBe(503);
    expect(
      state.signed,
      'a failed asset read went on to ask Storage for a link',
    ).not.toHaveBeenCalled();
  });

  it('says the file is there and can be asked for again', async () => {
    state.assetRead.mockResolvedValue(UPSTREAM_502);

    const response = await staffFile(staffRequest(), params);

    await expect(response.text()).resolves.toMatch(/could not be fetched/i);
  });
});

describe('v285 the staff evidence route, when the reads answer', () => {
  /*
   * Without these, the cases above would pass on a route that answered 503 to
   * everything — including to every evidence file in the product.
   */
  it('redirects to the signed link', async () => {
    state.assetRead.mockResolvedValue(A_READY_ASSET);
    state.signed.mockResolvedValue(A_LINK);

    const response = await staffFile(staffRequest(), params);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(A_LINK.url);
  });

  it('still answers 404 for an asset that is genuinely not there', async () => {
    state.assetRead.mockResolvedValue({ data: null, error: null });

    const response = await staffFile(staffRequest(), params);

    expect(response.status).toBe(404);
  });

  /*
   * An asset row whose object is gone is a 404 to the reader whatever it says
   * about our data, and Storage reports that as an error like any other — so
   * the distinction has to survive all the way out here.
   */
  it('still answers 404 when the object itself is gone', async () => {
    state.assetRead.mockResolvedValue(A_READY_ASSET);
    state.signed.mockResolvedValue(OBJECT_ABSENT);

    const response = await staffFile(staffRequest(), params);

    expect(response.status).toBe(404);
  });
});

describe("v285 the owner's evidence route", () => {
  const A_PERMITTED_FILE = {
    data: { ok: true, object_key: 'x/evidence.jpg', name: 'evidence.jpg', type: 'image/jpeg' },
    error: null,
  };

  it('does not report a 404 when the guest procedure cannot be reached', async () => {
    state.guestFile.mockResolvedValue(UPSTREAM_502);

    const response = await ownerFile(new Request('http://127.0.0.1/x'), params);

    expect(response.status, 'a procedure that did not answer was read as a refusal').toBe(503);
  });

  it('does not report a 404 when signing fails', async () => {
    state.guestFile.mockResolvedValue(A_PERMITTED_FILE);
    state.signed.mockResolvedValue(SIGNING_FAILED);

    const response = await ownerFile(new Request('http://127.0.0.1/x'), params);

    expect(response.status).toBe(503);
  });

  /*
   * The non-disclosure rule, which the change must not weaken: a refusal is
   * still a bare 404, and it must stay indistinguishable from an asset that
   * does not exist. Only an outage is now told apart.
   */
  it('still answers a bare 404 when the procedure refuses', async () => {
    state.guestFile.mockResolvedValue({ data: { ok: false }, error: null });

    const response = await ownerFile(new Request('http://127.0.0.1/x'), params);

    expect(response.status).toBe(404);
    // Bare, and saying nothing about whether the asset exists.
    await expect(response.text()).resolves.toBe('Not found');
    expect(state.signed, 'a refused file was still signed').not.toHaveBeenCalled();
  });

  it('keeps the referrer policy off the failure answer as well', async () => {
    state.guestFile.mockResolvedValue(UPSTREAM_502);

    const response = await ownerFile(new Request('http://127.0.0.1/x'), params);

    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('redirects to the signed link when everything answers', async () => {
    state.guestFile.mockResolvedValue(A_PERMITTED_FILE);
    state.signed.mockResolvedValue(A_LINK);

    const response = await ownerFile(new Request('http://127.0.0.1/x'), params);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(A_LINK.url);
  });

  it('answers 404 without a session', async () => {
    state.guestSecret.mockResolvedValue(null);

    const response = await ownerFile(new Request('http://127.0.0.1/x'), params);

    expect(response.status).toBe(404);
    expect(state.guestFile, 'a sessionless request reached the procedure').not.toHaveBeenCalled();
  });
});

/*
 * The v288 intake photograph route, which did not exist when the other two
 * were corrected and arrived with the same defect: both its row read and its
 * signing left by `notFound()`, so a database or Storage blink told ESH that
 * a public report has no such photograph. Changing `signedDownloadFor` made
 * this caller ours; leaving it on 404 would have re-introduced the lie on a
 * third route while the other two were fixed.
 */
describe('v285 the intake photograph route', () => {
  const A_READY_PHOTO = {
    data: {
      object_key: 'intake/f0c05800-0000-4000-a000-000000000001/photo.jpg',
      original_name: 'photo.jpg',
      content_type: 'image/jpeg',
    },
    error: null,
  };
  const photoParams = { params: Promise.resolve({ photoId: AN_ASSET }) };
  const request = () => new Request('http://127.0.0.1/x');

  it('does not report a 404 when the photograph row cannot be read', async () => {
    state.photoRead.mockResolvedValue(UPSTREAM_502);

    const response = await intakePhoto(request(), photoParams);

    expect(response.status, 'a failed row read was reported as a missing photograph').toBe(503);
    expect(state.signed, 'a failed row read went on to ask Storage').not.toHaveBeenCalled();
  });

  it('does not report a 404 when signing fails', async () => {
    state.photoRead.mockResolvedValue(A_READY_PHOTO);
    state.signed.mockResolvedValue(SIGNING_FAILED);

    const response = await intakePhoto(request(), photoParams);

    expect(response.status).toBe(503);
  });

  /*
   * Without these the cases above would pass on a route that answered 503 to
   * everything, including to every photograph on every public report.
   */
  it('redirects to the signed link', async () => {
    state.photoRead.mockResolvedValue(A_READY_PHOTO);
    state.signed.mockResolvedValue(A_LINK);

    const response = await intakePhoto(request(), photoParams);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(A_LINK.url);
  });

  // A photograph that never finished uploading is not a picture of anything.
  it('still answers 404 for a photograph that is genuinely not there', async () => {
    state.photoRead.mockResolvedValue({ data: null, error: null });

    const response = await intakePhoto(request(), photoParams);

    expect(response.status).toBe(404);
  });

  it('still answers 404 when the object itself is gone', async () => {
    state.photoRead.mockResolvedValue(A_READY_PHOTO);
    state.signed.mockResolvedValue(OBJECT_ABSENT);

    const response = await intakePhoto(request(), photoParams);

    expect(response.status).toBe(404);
  });
});

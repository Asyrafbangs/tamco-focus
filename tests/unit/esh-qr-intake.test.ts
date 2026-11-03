import { describe, expect, it } from 'vitest';

import { publicQrIntakeNoCode, publicQrIntakeUnavailable } from '@/domain/esh-qr-intake';

/**
 * v288 — the words a QR code shows when it cannot report anything.
 *
 * The `publicQrIntakeEnabled` constant this file used to assert is gone: the
 * channel is now opened by an administrator-only procedure that demands a
 * reason, and `esh_public_qr_reporting_v288.test.sql` holds that gate against
 * a real database — including that a report submitted while it is closed is
 * refused outright rather than queued.
 *
 * What is left here is the promise the copy makes. A page that says a link
 * does not report anything must not also imply somebody has been notified,
 * and it must still tell the reader what to do instead.
 */
describe('v288 what a closed link says', () => {
  it('does not claim anybody was told', () => {
    expect(publicQrIntakeUnavailable.detail).toContain('does not submit');
    expect(publicQrIntakeUnavailable.detail).not.toMatch(/received|logged|recorded/i);
    expect(publicQrIntakeUnavailable.immediateDanger).not.toContain('notify');
  });

  it('still points the reader somewhere that works', () => {
    expect(publicQrIntakeUnavailable.detail).toMatch(/supervisor/i);
    expect(publicQrIntakeUnavailable.immediateDanger).toMatch(/emergency procedure/i);
  });

  it('tells a visitor without a code where the code is', () => {
    expect(publicQrIntakeNoCode.detail).toMatch(/sticker/i);
  });
});

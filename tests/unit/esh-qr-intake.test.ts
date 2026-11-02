import { describe, expect, it } from 'vitest';

import { publicQrIntakeEnabled, publicQrIntakeUnavailable } from '@/domain/esh-qr-intake';

describe('public QR intake gate', () => {
  it('is closed until the operational release decision is implemented', () => {
    expect(publicQrIntakeEnabled).toBe(false);
    expect(publicQrIntakeUnavailable.detail).toContain('does not submit');
    expect(publicQrIntakeUnavailable.immediateDanger).not.toContain('notify');
  });
});

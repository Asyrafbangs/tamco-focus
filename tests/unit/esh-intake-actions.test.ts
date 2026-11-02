import { describe, expect, it } from 'vitest';

import { claimReportIntake } from '@/server/esh/intake-actions';

describe('intake claim action', () => {
  it('rejects an invalid intake identifier before any database call', async () => {
    await expect(claimReportIntake({ intakeId: 'not-a-uuid' })).resolves.toEqual({
      ok: false,
      message: 'That report is no longer available.',
    });
  });
});

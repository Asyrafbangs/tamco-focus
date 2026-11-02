import { describe, expect, it } from 'vitest';

import { parseReportIntakeId } from '@/domain/esh-intake';

describe('intake identifier', () => {
  it('refuses malformed input before a server action reaches the database', () => {
    expect(parseReportIntakeId('not-a-uuid')).toBeNull();
    expect(parseReportIntakeId('00000000-0000-4000-8000-000000000000')).toBe(
      '00000000-0000-4000-8000-000000000000',
    );
  });
});

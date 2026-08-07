import { describe, expect, it } from 'vitest';

import { weeklyWindow } from '@/domain/weekly-schedule';

describe('weekly summary schedule', () => {
  it('uses the previous Monday-to-Monday reporting week in organisation time', () => {
    const window = weeklyWindow(
      new Date('2026-08-06T02:00:00.000Z'),
      'Asia/Kuala_Lumpur',
      'monday',
      8,
    );
    expect(window.due).toBe(true);
    expect(window.reportingStart.toISOString()).toBe('2026-07-26T16:00:00.000Z');
    expect(window.reportingEnd.toISOString()).toBe('2026-08-02T16:00:00.000Z');
    expect(window.planningEnd.toISOString()).toBe('2026-08-09T16:00:00.000Z');
  });

  it('does not run before the configured local hour', () => {
    const before = weeklyWindow(
      new Date('2026-08-02T23:30:00.000Z'),
      'Asia/Kuala_Lumpur',
      'monday',
      8,
    );
    const after = weeklyWindow(
      new Date('2026-08-03T00:00:00.000Z'),
      'Asia/Kuala_Lumpur',
      'monday',
      8,
    );
    expect(before.due).toBe(false);
    expect(after.due).toBe(true);
  });
});

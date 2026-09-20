import { describe, expect, it } from 'vitest';

import {
  closurePeriodParams,
  csvDocument,
  spreadsheetSafe,
  totalOverview,
} from '@/domain/esh-overview';
import { resolvePeriod } from '@/domain/period';

describe('v202 ESH overview and export', () => {
  it('totals each deliberately different unit without combining them', () => {
    expect(
      totalOverview([
        {
          departmentId: 'one',
          departmentName: 'Operations',
          openFindings: 2,
          overdueActions: 3,
          awaitingReviewActions: 1,
          reviewOverdueActions: 1,
          closedFindings: 4,
        },
        {
          departmentId: null,
          departmentName: 'Unassigned',
          openFindings: 1,
          overdueActions: 0,
          awaitingReviewActions: 0,
          reviewOverdueActions: 0,
          closedFindings: 0,
        },
      ]),
    ).toEqual({
      openFindings: 3,
      overdueActions: 3,
      awaitingReviewActions: 1,
      reviewOverdueActions: 1,
      closedFindings: 4,
    });
  });

  it('carries a custom closure range into register drill-downs', () => {
    const period = resolvePeriod(
      'custom',
      '2026-08-01',
      '2026-08-31',
      new Date('2026-09-20T00:00:00Z'),
      '30',
      'Asia/Kuala_Lumpur',
    );
    expect(closurePeriodParams(period)).toEqual({
      period: 'custom',
      period_from: '2026-08-01',
      period_to: '2026-08-31',
    });
  });

  it.each(['=SUM(A1:A2)', '+cmd', '-1+2', '@link', '\tformula', '\rformula'])(
    'neutralizes spreadsheet-active text: %s',
    (value) => expect(spreadsheetSafe(value)).toBe(`'${value}`),
  );

  it('quotes CSV delimiters and leaves ordinary text readable', () => {
    expect(csvDocument(['A', 'B'], [['plain', 'quote " and, comma']])).toBe(
      'A,B\r\nplain,"quote "" and, comma"\r\n',
    );
  });
});

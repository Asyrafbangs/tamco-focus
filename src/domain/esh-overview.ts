import type { ResolvedPeriod } from '@/domain/period';

export const ESH_CLOSURE_PERIODS = ['30', '60', '90', 'this-year'] as const;

export interface EshOverviewRow {
  departmentId: string | null;
  departmentName: string;
  openFindings: number;
  overdueActions: number;
  awaitingReviewActions: number;
  reviewOverdueActions: number;
  closedFindings: number;
}

export interface EshOverviewSignals {
  openFindings: number;
  overdueActions: number;
  awaitingReviewActions: number;
  reviewOverdueActions: number;
  closedFindings: number;
}

export function totalOverview(rows: readonly EshOverviewRow[]): EshOverviewSignals {
  return rows.reduce<EshOverviewSignals>(
    (total, row) => ({
      openFindings: total.openFindings + row.openFindings,
      overdueActions: total.overdueActions + row.overdueActions,
      awaitingReviewActions: total.awaitingReviewActions + row.awaitingReviewActions,
      reviewOverdueActions: total.reviewOverdueActions + row.reviewOverdueActions,
      closedFindings: total.closedFindings + row.closedFindings,
    }),
    {
      openFindings: 0,
      overdueActions: 0,
      awaitingReviewActions: 0,
      reviewOverdueActions: 0,
      closedFindings: 0,
    },
  );
}

/** Parameters carried from Overview to a closed Register drill-down. */
export function closurePeriodParams(period: ResolvedPeriod): Record<string, string> {
  if (period.key === '30') return {};
  if (period.key === 'custom') {
    return {
      period: 'custom',
      ...(period.from ? { period_from: period.from } : {}),
      ...(period.to ? { period_to: period.to } : {}),
    };
  }
  return { period: period.key };
}

/**
 * A spreadsheet treats leading =, +, -, @, tab and carriage-return as active
 * formula syntax. Prefixing an apostrophe keeps the content visible as text.
 */
export function spreadsheetSafe(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown): string {
  const text = spreadsheetSafe(value).replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${text}"` : text;
}

export function csvDocument(headers: readonly string[], rows: readonly (readonly unknown[])[]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

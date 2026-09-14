/**
 * Reading the reporting history back (v176).
 *
 * Every move has been written, effective-dated, since v169 — so that "who was
 * this person's manager in March?" could be answered without guessing — but
 * nothing read it. This answers that question from the record, and says what
 * the answer rests on, because a history that began in September cannot vouch
 * for March.
 */

export interface ReportingChange {
  relationship: 'primary' | 'functional';
  previousManagerId: string | null;
  newManagerId: string | null;
  /** YYYY-MM-DD, in the organisation's calendar. */
  effectiveDate: string;
  /** When it was entered; orders two changes effective the same day. */
  changedAt: string;
}

export type ManagerOnDate =
  /** A recorded change had taken effect by the date. */
  | { basis: 'recorded'; managerId: string | null; since: string }
  /** The date is before the first recorded change: the line it replaced. */
  | { basis: 'before_record'; managerId: string | null; recordStarts: string }
  /** Nothing has ever been recorded: only the line as it stands today. */
  | { basis: 'no_record'; managerId: string | null };

function chronological(left: ReportingChange, right: ReportingChange): number {
  if (left.effectiveDate !== right.effectiveDate) {
    return left.effectiveDate < right.effectiveDate ? -1 : 1;
  }
  return left.changedAt < right.changedAt ? -1 : left.changedAt > right.changedAt ? 1 : 0;
}

export function managerOnDate(
  history: ReportingChange[],
  currentManagerId: string | null,
  date: string,
  relationship: ReportingChange['relationship'] = 'primary',
): ManagerOnDate {
  const changes = history
    .filter((change) => change.relationship === relationship)
    .sort(chronological);

  const first = changes[0];
  if (!first) return { basis: 'no_record', managerId: currentManagerId };

  const inEffect = changes.filter((change) => change.effectiveDate <= date).at(-1);
  if (inEffect) {
    return { basis: 'recorded', managerId: inEffect.newManagerId, since: inEffect.effectiveDate };
  }
  return {
    basis: 'before_record',
    managerId: first.previousManagerId,
    recordStarts: first.effectiveDate,
  };
}

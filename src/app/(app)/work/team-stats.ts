import type { TeamAttentionRow, TeamMemberDetail } from '@/server/queries';

/**
 * The six figures a manager reads a person by (v323, shared from v324).
 *
 * One definition, used by the panel's summary strip and by the comparison
 * table, because two people being compared cell for cell must be counted the
 * same way — and because a figure defined twice is a figure that will one day
 * disagree with itself.
 *
 * Every value is a count the product already keeps. None of them is combined,
 * weighted or normalised into a score: there is no single number that can say
 * how one person's Major Project compares with another's PPE round, and any
 * attempt would reward whoever does the smallest work.
 */
export interface TeamStatCell {
  key: string;
  label: string;
  value: number;
  /** Colour carries urgency, and only where the figure is not zero. */
  tone: 'alert' | 'soon' | null;
}

export function teamStatCells(
  detail: TeamMemberDetail,
  row: TeamAttentionRow,
  windowDays: number,
): TeamStatCell[] {
  return [
    {
      key: 'overdue',
      label: 'Overdue',
      value: detail.signals.openOverdue,
      tone: detail.signals.openOverdue > 0 ? 'alert' : null,
    },
    {
      key: 'soon',
      label: `Due in ${windowDays}d`,
      value: row.dueSoonCount,
      tone: row.dueSoonCount > 0 ? 'soon' : null,
    },
    { key: 'active', label: 'Active', value: detail.activeWork.length, tone: null },
    { key: 'shared', label: 'Shared steps', value: detail.contributions.length, tone: null },
    { key: 'waiting', label: 'Waiting', value: detail.signals.availableCount, tone: null },
    {
      key: 'completed',
      /*
       * The only cell with a window, because it is the only one that is not
       * "now". A bare "Completed 7" beside "Active 4" invites the two to be
       * read as the same kind of fact.
       */
      label: `Done, ${detail.recentDelivery.windowLabel.toLowerCase()}`,
      value: detail.recentDelivery.total,
      tone: null,
    },
  ];
}

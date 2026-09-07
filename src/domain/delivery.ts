/**
 * A date so far out it is almost certainly a typo.
 *
 * "15 Sep 2926" reached a manager's backlog because nothing questioned it: a
 * year is four characters and one of them was wrong. Work genuinely planned
 * more than a decade out does not exist in this product — a Major Project runs
 * to a target date inside a performance period — so the cost of asking is a
 * confirmation, and the cost of not asking is a commitment nobody can act on
 * sitting in a list forever.
 *
 * Ten years rather than two, because the point is to catch a slipped digit,
 * not to have an opinion about long-range planning.
 */
export const IMPLAUSIBLE_YEARS_AHEAD = 10;

/**
 * The last instant a date is still credible: the end of the tenth year ahead.
 *
 * A whole year rather than a rolling ten years to the day, so the browser's
 * `max` and this check agree exactly. A boundary that drifted by a day would
 * let a date through the form and then have the server refuse it, which is
 * the worst of both: the person has already typed it and nothing told them
 * until they pressed the button.
 */
function credibleUntil(now: Date): number {
  return Date.UTC(now.getUTCFullYear() + IMPLAUSIBLE_YEARS_AHEAD, 11, 31, 23, 59, 59, 999);
}

export function isImplausibleDate(value: string | null | undefined, now: Date = new Date()) {
  if (!value) return false;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() > credibleUntil(now);
}

/** The latest date a form should accept, as `yyyy-mm-dd` for an input's `max`. */
export function latestPlausibleDate(now: Date = new Date()): string {
  return `${now.getUTCFullYear() + IMPLAUSIBLE_YEARS_AHEAD}-12-31`;
}

/**
 * What kind of record a completion is, in the manager's words.
 *
 * Shared between the team-wide Completed list and one person's drawer, which
 * show the same records at two altitudes. Kept here because the distinction is
 * the point: a routine occurrence closes every week and a Major Project once a
 * quarter, so a list that does not name which is which reads as a ranking.
 */
export const DELIVERY_KIND_WORD: Record<'owned' | 'shared' | 'routine', string> = {
  owned: 'Owned work',
  shared: 'Contribution',
  routine: 'Routine',
};

/**
 * The rolling window My Team reads delivery over.
 *
 * Never "all time". A manager judging whether somebody is moving needs what
 * closed recently, and lifetime history answers a different question badly:
 * it grows without limit, it flatters whoever has been here longest, and it
 * buries this month under three years of everything.
 *
 * Deliberately small — four choices, one of them the default. A date-range
 * picker here would be a second Records screen, and Records is where an
 * arbitrary range belongs.
 */
export const DELIVERY_WINDOWS = [
  { key: '30', label: 'Last 30 days', short: '30 days', days: 30 },
  { key: '60', label: 'Last 60 days', short: '60 days', days: 60 },
  { key: '90', label: 'Last 90 days', short: '90 days', days: 90 },
  { key: 'year', label: 'This year', short: 'this year', days: null },
] as const;

export type DeliveryWindowKey = (typeof DELIVERY_WINDOWS)[number]['key'];

export const DEFAULT_DELIVERY_WINDOW: DeliveryWindowKey = '30';

/** The chosen window, or the default when the parameter is absent or junk. */
export function deliveryWindow(key: string | undefined) {
  return (
    DELIVERY_WINDOWS.find((window) => window.key === key) ??
    DELIVERY_WINDOWS.find((window) => window.key === DEFAULT_DELIVERY_WINDOW)!
  );
}

/**
 * The instant the window opens.
 *
 * Day counts roll back from now rather than snapping to midnight, so a list
 * is never nearly empty because the day has only just started. "This year" is
 * calendar-bounded, because that is what the words mean.
 */
export function deliveryWindowSince(key: string | undefined, now: Date = new Date()): string {
  const window = deliveryWindow(key);
  if (window.days === null) return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  return new Date(now.getTime() - window.days * 86_400_000).toISOString();
}

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

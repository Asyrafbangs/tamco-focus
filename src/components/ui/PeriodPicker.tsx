import Link from 'next/link';

import { MenuDropdown } from '@/components/ui/MenuDropdown';
import {
  PERIOD_FROM_PARAM,
  PERIOD_PARAM,
  PERIOD_PRESETS,
  PERIOD_TO_PARAM,
  STANDARD_PERIODS,
  periodParams,
  todayIso,
  type PeriodPresetKey,
  type ResolvedPeriod,
} from '@/domain/period';

/**
 * The one control for choosing a reporting period.
 *
 * Presets are links, so a period is a place you can bookmark and send to
 * somebody; the custom range is a GET form for the same reason. Both are the
 * same shape everywhere they appear, because the question is the same
 * question — a manager who has learned it on My Work has learned it on My
 * Team, Routine and Records.
 *
 * It replaced a segmented strip on My Team, which could show four presets and
 * had nowhere to put a date range, and two bare date boxes on Records, which
 * had the range and none of the presets.
 */
export function PeriodPicker({
  action,
  hidden = {},
  presets = STANDARD_PERIODS,
  period,
  ariaLabel = 'Change the period',
  className,
  now,
}: {
  /** Where the links and the form point: the page this control belongs to. */
  action: string;
  /** Everything else in the URL, so choosing a period changes only the period. */
  hidden?: Record<string, string>;
  presets?: readonly PeriodPresetKey[];
  period: ResolvedPeriod;
  ariaLabel?: string;
  className?: string;
  /**
   * Passed in rather than read here, so a server render and the value the page
   * resolved cannot disagree about what "today" is.
   */
  now?: Date;
}) {
  const href = (params: Record<string, string>) => {
    const query = new URLSearchParams({ ...hidden, ...params });
    const search = query.toString();
    return search ? `${action}?${search}` : action;
  };

  return (
    <MenuDropdown
      ariaLabel={ariaLabel}
      className={['period-picker', className].filter(Boolean).join(' ')}
      panelClassName="period-picker-panel"
      minWidth={220}
      label={period.label}
    >
      {presets.map((key) => {
        const entry = PERIOD_PRESETS.find((candidate) => candidate.key === key)!;
        return (
          <Link
            key={entry.key}
            href={href(periodParams({ ...period, key: entry.key }))}
            className={period.key === entry.key ? 'active' : undefined}
            aria-current={period.key === entry.key ? 'page' : undefined}
          >
            {entry.label}
          </Link>
        );
      })}

      {/*
        A GET form, so a custom range is a link like every other choice here and
        survives being bookmarked or shared.

        `max` is today on both boxes: this asks what has already happened, and a
        range ending next March is a typo every time.

        Neither box is required. "From" used to be, so filling only "To" was
        refused by the browser — and the menu closed on the click, taking the
        message explaining it with it. One date is a real question either way:
        everything since a day, or everything up to one.
      */}
      <form className="period-picker-custom" action={action}>
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name={PERIOD_PARAM} value="custom" />
        <label>
          <span>From</span>
          <input
            type="date"
            name={PERIOD_FROM_PARAM}
            defaultValue={period.from ?? undefined}
            max={todayIso(now)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            name={PERIOD_TO_PARAM}
            defaultValue={period.to ?? undefined}
            max={todayIso(now)}
          />
        </label>
        <button className="btn small" type="submit">
          Apply
        </button>
      </form>
    </MenuDropdown>
  );
}

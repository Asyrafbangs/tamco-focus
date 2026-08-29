import Link from 'next/link';

import { EmptyState } from '@/components/ui/ParityPrimitives';
import type {
  RoutineComplianceRow,
  RoutineOutcome,
  RoutinePersonStanding,
  RoutineTally,
  TeamRoutineRow,
} from '@/server/queries';

/**
 * A manager's routine view: people first, exceptions first.
 *
 * A manager does not review every routine completion - that would be an
 * administration job created by the software rather than by the work. What
 * they need is who is not on top of it, and the ability to open anybody when
 * they want to look. So this is a list of people carrying the four counts that
 * decide whether somebody has to be opened at all, with problems sorted to the
 * top rather than left to be found alphabetically.
 *
 * Only problems get weight. A person who completed everything is one quiet
 * line; with forty people and three problems, those three are at the top.
 */

const REASON_WORDS = {
  no_applicable_work: 'No applicable site or work',
  activity_cancelled: 'Activity cancelled',
  other: 'Other',
} as const;

function reasonText(row: RoutineOutcome) {
  if (!row.reasonCode) return '';
  return row.reasonCode === 'other' ? (row.reasonNote ?? 'Other') : REASON_WORDS[row.reasonCode];
}

function periodHref(base: Record<string, string>, changes: Record<string, string | null>) {
  const query = new URLSearchParams(base);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) query.delete(key);
    else query.set(key, value);
  }
  return `/work/routine?${query.toString()}`;
}

export const ROUTINE_PERIODS = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: '90', label: 'Last 90 days' },
  { key: 'this-year', label: 'This year' },
  { key: 'last-year', label: 'Last year' },
] as const;

export type RoutinePeriodKey = (typeof ROUTINE_PERIODS)[number]['key'];

export function TeamRoutineList({
  rows,
  failed,
  query,
  period,
  attentionOnly,
}: {
  rows: TeamRoutineRow[];
  failed: boolean;
  query: string;
  period: RoutinePeriodKey;
  attentionOnly: boolean;
}) {
  const base = { panel: 'manager', period };

  if (failed) {
    return (
      <EmptyState title="Team routine could not be read">
        <p>Try again in a moment.</p>
      </EmptyState>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      (!needle || row.fullName.toLowerCase().includes(needle)) &&
      (!attentionOnly || row.needsAttention),
  );
  const attention = shown.filter((row) => row.needsAttention);
  const steady = shown.filter((row) => !row.needsAttention);

  return (
    <div className="team-routine">
      <div className="team-routine-controls">
        {/* A GET form, so a search is a link like every other choice here and
            survives being bookmarked or reloaded. */}
        <form className="team-routine-search" action="/work/routine">
          <input type="hidden" name="panel" value="manager" />
          <input type="hidden" name="period" value={period} />
          {attentionOnly && <input type="hidden" name="filter" value="attention" />}
          <label className="visually-hidden" htmlFor="team-routine-q">
            Search employee
          </label>
          <input id="team-routine-q" name="q" defaultValue={query} placeholder="Search employee…" />
          <button className="btn small" type="submit">
            Search
          </button>
        </form>

        <div className="segmented" role="group" aria-label="Period">
          {ROUTINE_PERIODS.map((entry) => (
            <Link
              key={entry.key}
              href={periodHref(base, {
                period: entry.key,
                q: needle || null,
                filter: attentionOnly ? 'attention' : null,
              })}
              className={period === entry.key ? 'active' : undefined}
              aria-current={period === entry.key ? 'true' : undefined}
            >
              {entry.label}
            </Link>
          ))}
        </div>

        <div className="segmented" role="group" aria-label="Which people">
          <Link
            href={periodHref(base, { filter: null, q: needle || null })}
            className={attentionOnly ? undefined : 'active'}
          >
            All
          </Link>
          <Link
            href={periodHref(base, { filter: 'attention', q: needle || null })}
            className={attentionOnly ? 'active' : undefined}
          >
            Needs attention
          </Link>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Nobody to show" compact>
          <p>
            {attentionOnly
              ? 'Nobody on your team has an overdue occurrence or a decision waiting.'
              : 'No routine work has been scheduled for your team in this period.'}
          </p>
        </EmptyState>
      ) : (
        <>
          {attention.length > 0 && (
            <section className="team-routine-group" aria-label="Needs attention">
              <h3>Needs attention</h3>
              {attention.map((row) => (
                <PersonRow key={row.userId} row={row} base={base} needle={needle} />
              ))}
            </section>
          )}
          {steady.length > 0 && (
            <section className="team-routine-group" aria-label="Team routine status">
              <h3>Team routine status</h3>
              {steady.map((row) => (
                <PersonRow key={row.userId} row={row} base={base} needle={needle} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PersonRow({
  row,
  base,
  needle,
}: {
  row: TeamRoutineRow;
  base: Record<string, string>;
  needle: string;
}) {
  return (
    <Link
      href={periodHref(base, { person: row.userId, q: needle || null })}
      className="team-routine-row"
    >
      <span className="team-routine-copy">
        <strong>{row.fullName}</strong>
        <span>
          {row.completed} completed · {row.notRequired} not required · {row.overdue} overdue
          {row.awaitingReview > 0 ? ` · ${row.awaitingReview} awaiting your decision` : ''}
        </span>
      </span>
      <span className="team-routine-chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

export function PersonRoutineProfile({
  name,
  tally,
  outcomes,
  period,
  backHref,
  taskHref,
}: {
  name: string;
  tally: RoutineTally | null;
  outcomes: RoutineOutcome[];
  period: RoutinePeriodKey;
  backHref: string;
  taskHref: (taskId: string) => string;
}) {
  const awaiting = outcomes.filter((row) => row.outcome === 'awaiting_decision');
  const today = new Date().toISOString().slice(0, 10);
  const overdue = outcomes.filter(
    (row) => row.outcome === 'open' && (row.occurrenceDate ?? '') < today,
  );
  const settled = outcomes.filter(
    (row) => row.outcome === 'done' || row.outcome === 'not_required',
  );
  const periodLabel = ROUTINE_PERIODS.find((entry) => entry.key === period)?.label ?? 'This month';

  return (
    <div className="team-routine">
      <Link href={backHref} className="team-routine-back">
        ← Team routine
      </Link>
      <div className="section-heading">
        <div>
          <h2>{name}</h2>
          <p>Routine history and current exceptions · {periodLabel.toLowerCase()}</p>
        </div>
      </div>

      <div className="routine-tally">
        <div>
          <strong>{tally?.scheduled ?? 0}</strong>
          <span>Scheduled</span>
        </div>
        <div>
          <strong>{tally?.done ?? 0}</strong>
          <span>Completed</span>
        </div>
        <div>
          <strong>{tally?.notRequired ?? 0}</strong>
          <span>Not required</span>
        </div>
        <div>
          <strong>{overdue.length}</strong>
          <span>Overdue</span>
        </div>
        <p className="routine-tally-note">
          {tally?.attachments ?? 0} file{(tally?.attachments ?? 0) === 1 ? '' : 's'} attached across{' '}
          {tally?.stepsCompleted ?? 0} completed step
          {(tally?.stepsCompleted ?? 0) === 1 ? '' : 's'}. Counted from the occurrence records —
          nobody enters these.
        </p>
      </div>

      {awaiting.length > 0 && (
        <section className="team-routine-group needs-review" aria-label="Needs review">
          <h3>Needs review</h3>
          {awaiting.map((row) => (
            <Link key={row.taskId} href={taskHref(row.taskId)} className="team-routine-row">
              <span className="team-routine-copy">
                <strong>{row.title}</strong>
                <span>Not required requested · {reasonText(row)}</span>
              </span>
              <span className="team-routine-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </section>
      )}

      {overdue.length > 0 && (
        <section className="team-routine-group" aria-label="Overdue">
          <h3>Overdue</h3>
          {overdue.map((row) => (
            <Link key={row.taskId} href={taskHref(row.taskId)} className="team-routine-row">
              <span className="team-routine-copy">
                <strong>{row.title}</strong>
                <span>Due {row.occurrenceDate}</span>
              </span>
              <span className="team-routine-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </section>
      )}

      <section className="team-routine-group" aria-label="Completed">
        <h3>Completed</h3>
        {settled.length === 0 ? (
          <p className="muted">Nothing settled in this period.</p>
        ) : (
          settled.map((row) => (
            <Link key={row.taskId} href={taskHref(row.taskId)} className="team-routine-row">
              <span className="team-routine-copy">
                <strong>
                  {row.outcome === 'done' ? '✓ ' : '— '}
                  {row.title}
                </strong>
                <span>
                  {row.outcome === 'done'
                    ? `Completed ${row.occurrenceDate}`
                    : `Not required · ${reasonText(row)}${
                        row.decidedByName ? ` · accepted by ${row.decidedByName}` : ''
                      }`}
                </span>
              </span>
              <span className="team-routine-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}

const OUTCOME_WORDS = {
  done: '✓ Completed',
  not_required: '— Not required',
  awaiting_decision: '⚠ Awaiting your decision',
  open: '⚠ Not done',
} as const;

/**
 * The team read down the other axis: one row per schedule.
 *
 * Secondary on purpose. People is how a team is managed, and stays the
 * default; this answers a compliance question - "how is Gemba Walk doing
 * across everybody" - which is asked far less often and would crowd the view
 * that gets asked daily.
 */
export function RoutineComplianceList({
  rows,
  failed,
  period,
  hrefFor,
}: {
  rows: RoutineComplianceRow[];
  failed: boolean;
  period: RoutinePeriodKey;
  hrefFor: (templateId: string) => string;
}) {
  if (failed) {
    return (
      <EmptyState title="Routine compliance could not be read">
        <p>Try again in a moment.</p>
      </EmptyState>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState title="No routine work in this period" compact>
        <p>Nothing your team is scheduled for falls inside it. Widen the period.</p>
      </EmptyState>
    );
  }

  return (
    <section className="team-routine-group" aria-label="Routines">
      <h3>Routines · {ROUTINE_PERIODS.find((entry) => entry.key === period)?.label}</h3>
      {rows.map((row) => (
        <Link key={row.templateId} href={hrefFor(row.templateId)} className="team-routine-row">
          <span className="team-routine-copy">
            <strong>{row.title}</strong>
            <span>
              {row.completed} completed · {row.notRequired} not required · {row.overdue} overdue
              {row.awaitingReview > 0 ? ` · ${row.awaitingReview} awaiting your decision` : ''}
            </span>
          </span>
          <span className="team-routine-chevron" aria-hidden="true">
            ›
          </span>
        </Link>
      ))}
    </section>
  );
}

/** One schedule, everybody on it. */
export function RoutineStandingList({
  title,
  people,
  period,
  backHref,
  taskHref,
  personHref,
}: {
  title: string;
  people: RoutinePersonStanding[];
  period: RoutinePeriodKey;
  backHref: string;
  taskHref: (taskId: string) => string;
  personHref: (userId: string) => string;
}) {
  const periodLabel = ROUTINE_PERIODS.find((entry) => entry.key === period)?.label ?? 'This month';

  return (
    <div className="team-routine">
      <Link href={backHref} className="team-routine-back">
        ← Routines
      </Link>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>Everybody on this schedule · {periodLabel.toLowerCase()}</p>
        </div>
      </div>

      <section className="team-routine-group" aria-label="People on this routine">
        {people.length === 0 ? (
          <p className="muted">Nobody was scheduled for this in the period.</p>
        ) : (
          people.map((person) => (
            <Link
              key={person.userId}
              /*
               * A single occurrence opens itself; several open the person,
               * because there is no one occurrence for the row to mean.
               */
              href={person.singleTaskId ? taskHref(person.singleTaskId) : personHref(person.userId)}
              className="team-routine-row"
            >
              <span className="team-routine-copy">
                <strong>{person.fullName}</strong>
                <span>
                  {person.singleOutcome
                    ? OUTCOME_WORDS[person.singleOutcome]
                    : `${person.completed} completed · ${person.notRequired} not required · ${person.overdue} overdue`}
                </span>
              </span>
              <span className="team-routine-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}

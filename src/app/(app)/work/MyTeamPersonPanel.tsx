import Link from 'next/link';

import { formatDue, ROUTINE_OCCURRENCE_LABELS, routineOccurrenceState } from '@/domain/duration';
import { DeadlineLabel } from '@/components/ui/DeadlineLabel';
import { compareDeadlines, deadlineFor } from '@/domain/deadline';
import { DELIVERY_KIND_WORD } from '@/domain/delivery';
import { GOAL_HEALTH_LABELS, GOAL_STATUS_LABELS } from '@/domain/goals';
import { WORK_PURPOSE_SHORT_LABELS } from '@/domain/purpose';
import { FOCUS_BUCKET_WORD, WORK_CLASS_LABELS } from '@/domain/types';
import type { TeamAttentionRow, TeamMemberDetail } from '@/server/queries';

import { WeeklyPriorities } from './WeeklyPriorities';

/**
 * One team member, opened in place (§6).
 *
 * This was a drawer until v143. A drawer answers "show me this record"; a
 * manager reading My Team is asking "who needs me", which is a question about
 * the list. Covering the list to answer it meant the comparison the manager
 * came for could only be done from memory, one person at a time.
 *
 * The order of the sections is the order of the questions, and §6 fixes it:
 * what do I owe this person a decision on, what did we agree for this week,
 * what else are they carrying, what have they not begun, what is their routine
 * doing, what actually closed — and then, quietly, the running commentary.
 *
 * Everything below priorities that is not itself a decision starts collapsed.
 * Six open sections per person is a page, and a manager comparing two people
 * would be scrolling past four sections of neither.
 *
 * It is not an employee dashboard. There is no score, and there deliberately
 * is not one: any single number would have to decide how a Major Project
 * compares with a PPE check, and every answer it could give would reward
 * whoever does the smallest work.
 */

/** How many active rows are shown before the rest go behind a disclosure. */
const ACTIVE_PAGE_SIZE = 5;
/** §6 — "expand to latest 3–5 records". */
const DELIVERY_RECORD_LIMIT = 5;

/**
 * v157 - why a contribution has not moved, when the reason is not the person
 * who owes it. Worded as the assignee's own Shared list words it.
 */
function contributionHold(step: TeamMemberDetail['contributions'][number]): string | null {
  switch (step.readiness) {
    case 'waiting_for_owner':
      return `Waiting for ${step.ownerName.split(' ')[0] ?? step.ownerName} to start the work`;
    case 'waiting_parent_paused':
      return 'The work is paused';
    case 'waiting_prerequisite':
      return step.prerequisiteTitle
        ? `Waiting for: ${step.prerequisiteTitle}`
        : 'Waiting for an earlier step';
    case 'waiting':
      return 'Not startable yet';
    default:
      return null;
  }
}

function agoWords(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function MyTeamPersonPanel({
  detail,
  panelId,
  /**
   * The URL of this layer, which a task is opened on top of. A string rather
   * than a builder function: this is rendered from a server component, and a
   * function cannot cross that boundary.
   */
  taskHrefBase,
  /** Toggles this person between "closes when another opens" and "stays". */
  keepHref,
  kept,
  timeZone,
  now,
  attentionWindowDays,
  row,
}: {
  detail: TeamMemberDetail;
  panelId: string;
  taskHrefBase: string;
  keepHref: string;
  kept: boolean;
  timeZone: string;
  now: Date;
  /** v187 — the organisation's attention window, in days. */
  attentionWindowDays?: number;
  /**
   * v236 — the row this panel hangs under.
   *
   * What somebody said they are working on, and what they agreed to deliver,
   * are already on the row. Reading them from there rather than querying again
   * means the overview and the row cannot state different things.
   */
  row: TeamAttentionRow;
}) {
  /* v187 — every date in the panel in the words the lists use. */
  const deadline = (dueAt: string | null, dueIsDateOnly: boolean) =>
    deadlineFor(dueAt, { dueIsDateOnly, timeZone, now, windowDays: attentionWindowDays });
  const windowDays = attentionWindowDays ?? 5;
  const completedOn = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone });

  const taskHref = (taskId: string) =>
    `${taskHrefBase}${taskHrefBase.includes('?') ? '&' : '?'}task=${taskId}`;
  const goalHref = (goalId: string) => {
    const query = new URLSearchParams({
      view: 'team',
      person: detail.person.id,
      goal: goalId,
      from: taskHrefBase,
    });
    return `/goals?${query.toString()}`;
  };

  const id = (suffix: string) => `${panelId}-${suffix}`;

  /*
   * §6 — a decision, not a status.
   *
   * `exception` rows are things that are true about the work (overdue,
   * stalled); they belong to the person to catch up on and are already summed
   * up in the row above. What is left is what a manager is actually being
   * asked to answer, and where there is none of it there is no block — rather
   * than a panel on every person saying nothing is needed.
   */
  const decisions = detail.attention.filter((item) => item?.kind === 'action_required');

  /*
   * §6 — work put forward as this week's result is not also an independent
   * commitment further down the panel.
   *
   * A step is the exception: the priority is one part of the parent, so the
   * parent stays reachable and says which part is spoken for. Hiding it would
   * make the rest of that task unreachable from here; repeating it plainly
   * would count the same work twice.
   */
  const committedTaskIds = new Set(
    detail.commitments.filter((c) => !c.isStep).map((c) => c.taskId),
  );
  const stepCommitmentTitles = new Map<string, string>();
  for (const commitment of detail.commitments) {
    if (commitment.isStep) stepCommitmentTitles.set(commitment.taskId, commitment.expectedResult);
  }

  /*
   * v185 — late work first, earliest due first, then the rest as they were.
   *
   * The list is paged at five and was ordered by last update, so the section
   * could say "5 overdue" above five rows that were all on time, with the late
   * ones behind "Show 7 more". Rescheduling a task counts as an update, which
   * put the work just pushed back at the top and the work still late below it.
   */
  const otherActive = detail.activeWork
    .filter((task) => !committedTaskIds.has(task.id))
    .map((task, index) => ({ task, index, deadline: deadline(task.dueAt, task.dueIsDateOnly) }))
    .sort((left, right) => {
      // v187 — and work due soon next, nearest first, before the rest.
      const leftUrgent = Boolean(left.deadline?.needsAttention);
      const rightUrgent = Boolean(right.deadline?.needsAttention);
      if (leftUrgent !== rightUrgent) return leftUrgent ? -1 : 1;
      if (leftUrgent) {
        return compareDeadlines(
          { deadline: left.deadline, dueAt: left.task.dueAt },
          { deadline: right.deadline, dueAt: right.task.dueAt },
        );
      }
      return left.index - right.index;
    })
    .map(({ task }) => task);
  const activeHead = otherActive.slice(0, ACTIVE_PAGE_SIZE);
  const activeRest = otherActive.slice(ACTIVE_PAGE_SIZE);
  const overdueActive = otherActive.filter((task) => task.isOverdue).length;
  const contributionsOverdue = detail.contributions.filter((step) => step.isOverdue).length;
  const availableOverdue = detail.otherWorkload.available.filter((task) => task.isOverdue).length;

  /* v189 — the person's deadlines inside the attention window, one list. */
  const attentionItems = [
    ...detail.activeWork.map((task) => ({
      key: `task:${task.id}`,
      kind: task.isPaused ? 'Paused task' : 'Task',
      title: task.title,
      href: taskHref(task.id),
      parentTitle: null as string | null,
      dueAt: task.dueAt,
      deadline: deadline(task.dueAt, task.dueIsDateOnly),
    })),
    ...detail.otherWorkload.available.map((task) => ({
      key: `task:${task.id}`,
      kind: 'Not started',
      title: task.title,
      href: taskHref(task.id),
      parentTitle: null as string | null,
      dueAt: task.dueAt,
      deadline: deadline(task.dueAt, task.dueIsDateOnly),
    })),
    // Late routine occurrences, which the row's overdue count includes.
    ...detail.otherWorkload.routines
      .filter((task) => task.isOverdue)
      .map((task) => ({
        key: `routine:${task.id}`,
        kind: 'Routine',
        title: task.title,
        href: taskHref(task.id),
        parentTitle: null as string | null,
        dueAt: task.dueAt,
        deadline: deadline(task.dueAt, task.dueIsDateOnly),
      })),
    ...detail.contributions.map((step) => ({
      key: `step:${step.checklistItemId}`,
      kind: 'Shared step',
      title: step.title,
      href: `${taskHref(step.taskId)}&step=${step.checklistItemId}`,
      parentTitle: step.parentTitle as string | null,
      dueAt: step.dueAt,
      deadline: deadline(step.dueAt, step.dueIsDateOnly),
    })),
  ]
    .filter((item): item is typeof item & { deadline: NonNullable<typeof item.deadline> } =>
      Boolean(item.deadline?.needsAttention),
    )
    .sort((left, right) => compareDeadlines(left, right));
  const attentionOverdue = attentionItems.filter((item) => item.deadline.tone === 'overdue');
  const attentionSoon = attentionItems.filter((item) => item.deadline.tone !== 'overdue');

  const activeRow = (task: TeamMemberDetail['activeWork'][number]) => {
    const inWeek = stepCommitmentTitles.get(task.id);
    return (
      <Link key={task.id} href={taskHref(task.id)} scroll={false} className="member-work-row">
        <strong>{task.title}</strong>
        <span>
          {/* §11 — why it is being done, where the capacity bucket used to be. */}
          {task.workPurpose
            ? `${WORK_PURPOSE_SHORT_LABELS[task.workPurpose]} · `
            : task.bucket
              ? `${FOCUS_BUCKET_WORD[task.bucket]} · `
              : ''}
          {task.isPaused ? 'Paused · ' : ''}
          {task.progressPercent}%{task.isMandatory ? ' · Mandatory' : ''}
          {/* Short, like every other date since v130: the year is the same on
              every row and the eye has to step over it. */}
          {task.dueAt ? (
            <>
              {' · '}
              <DeadlineLabel deadline={deadline(task.dueAt, task.dueIsDateOnly)!} />
            </>
          ) : null}
        </span>
        {/* v159 — a step on it past its own date, whoever owes it. The work's
            own lateness already says so when the work itself is overdue. */}
        {task.stepsOverdue > 0 && !task.isOverdue && (
          <span className="member-step-late">
            ⚠ {task.stepsOverdue} step{task.stepsOverdue === 1 ? '' : 's'} overdue
          </span>
        )}
        {inWeek && <span className="member-work-note">This week&rsquo;s priority: {inWeek}</span>}
      </Link>
    );
  };

  const routineSummary =
    [
      detail.otherWorkload.routines.length > 0
        ? `${detail.otherWorkload.routines.length} overdue`
        : null,
      detail.signals.routine.completed > 0 ? `${detail.signals.routine.completed} completed` : null,
      detail.signals.routine.notRequired > 0
        ? `${detail.signals.routine.notRequired} not required`
        : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'nothing due';

  /*
   * The figures a manager opens somebody to see, in the order they ask.
   *
   * Overdue first because it decides whether to read on; waiting last because
   * it is a planning figure rather than a problem. Zeroes are left out — a line
   * of "0 overdue · 0 due soon" is nothing happening, said at length.
   */
  const overview =
    [
      detail.signals.openOverdue > 0 ? `${detail.signals.openOverdue} overdue` : null,
      row.dueSoonCount > 0
        ? `${row.dueSoonCount} due within ${windowDays} day${windowDays === 1 ? '' : 's'}`
        : null,
      detail.activeWork.length > 0 ? `${detail.activeWork.length} active` : null,
      detail.contributions.length > 0
        ? `${detail.contributions.length} shared ${detail.contributions.length === 1 ? 'step' : 'steps'}`
        : null,
      detail.signals.availableCount > 0 ? `${detail.signals.availableCount} waiting` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing outstanding';

  const deliveryCounts = [
    detail.recentDelivery.owned > 0 ? `${detail.recentDelivery.owned} owned work` : null,
    detail.recentDelivery.shared > 0 ? `${detail.recentDelivery.shared} shared contribution` : null,
    detail.recentDelivery.routine > 0 ? `${detail.recentDelivery.routine} routine` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="team-person-panel" id={panelId} data-testid="my-team-person-panel">
      <div className="team-person-panel-bar">
        {/*
          §6's implementation default, and a link rather than a toolbar
          control: it is a property of this expansion, it lives inside it, and
          it survives a reload because it is in the address bar.

          The state is in the label rather than in `aria-pressed`, which is not
          allowed on a link — axe rates that critical, and it was: a screen
          reader would have announced a pressed state on something with no
          pressed state to announce.
        */}
        <Link href={keepHref} scroll={false} className="btn small">
          {kept ? 'Stop keeping open' : 'Keep open'}
        </Link>
      </div>

      {/*
        v236 — the figures first, then what they are on.

        The panel opened straight into eight sections, which is most of an
        application inside one row: a manager comparing two people was reading
        a page each. The questions a manager actually opens somebody for are
        how much is wrong, what they are on, and whether they have moved — and
        each of those is one line. Everything else is still here, one click
        down, in the order it was.
      */}
      <header className="team-person-overview">
        <h4 className="team-person-name">{detail.person.fullName}</h4>
        <p className="team-person-figures">{overview}</p>
      </header>

      <section className="team-person-section" aria-labelledby={id('focus')}>
        <h4 id={id('focus')}>Current focus</h4>
        {row.workingOn ? (
          <p className="member-focus">
            <strong>{row.workingOn.title}</strong>
            <span className="muted">Set {agoWords(row.workingOn.confirmedAt, now)}</span>
          </p>
        ) : (
          /*
           * Not set is a real answer, and a different one from "nothing
           * active": the product asks the person to say what they are on, and
           * nobody has. Guessing from their most recently touched task would
           * answer a question they were never asked.
           */
          <p className="muted member-other-empty">
            Not set. This is their own selection, not a guess from their work.
          </p>
        )}
        {row.nextAgreedResult && (
          <p className="member-focus">
            <strong>Agreed: {row.nextAgreedResult.expectedResult}</strong>
            {row.nextAgreedResult.outcome === 'missed' && <span className="tone-red">Missed</span>}
          </p>
        )}
      </section>

      {/*
        v189 — what is late and what is about to be, before anything else the
        manager reads about this person: their own work, Active, Paused or not
        started, and the steps they owe on other people's. The lists below stay
        the full reference; this is where to step in before it is late.
      */}
      {(attentionOverdue.length > 0 || attentionSoon.length > 0) && (
        <section className="team-person-section" aria-labelledby={id('deadlines')}>
          <h4 id={id('deadlines')}>Needs attention</h4>
          {(
            [
              ['Overdue', attentionOverdue],
              [`Due within ${windowDays} day${windowDays === 1 ? '' : 's'}`, attentionSoon],
            ] as const
          ).map(([label, items]) =>
            items.length > 0 ? (
              <div key={label} className="member-deadline-group">
                <p className="member-deadline-heading">{label}</p>
                <div className="member-work-list">
                  {items.map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      scroll={false}
                      className="member-work-row"
                    >
                      <strong>{item.title}</strong>
                      <span>
                        {item.kind} · <DeadlineLabel deadline={item.deadline} />
                        {item.parentTitle ? ` · For ${item.parentTitle}` : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </section>
      )}

      {decisions.length > 0 && (
        <section className="team-person-section" aria-labelledby={id('decisions')}>
          <h4 id={id('decisions')}>Needs your decision</h4>
          {decisions.map((item, index) =>
            item ? (
              <article key={index} className="member-attention-row">
                <div>
                  <strong className={item.severity === 'critical' ? 'tone-red' : 'tone-amber'}>
                    {item.headline}
                  </strong>
                  <p>{item.reason}</p>
                </div>
                {/* §6 — each request opens the associated work at the relevant
                    request, not a summary of it. */}
                <Link href={item.href} scroll={false} className="btn small primary">
                  {item.requiredAction}
                </Link>
              </article>
            ) : null,
          )}
        </section>
      )}

      {/*
        Folded from v236. Agreeing a priority is a real thing a manager does
        here, and it is still one click away — but it is an action taken after
        reading, not part of the reading.
      */}
      <details className="team-person-section" data-section="week">
        <summary>
          This week&rsquo;s priorities{' '}
          <span className="team-person-count">{detail.commitments.length}</span>
        </summary>
        <WeeklyPriorities
          commitments={detail.commitments}
          timeZone={timeZone}
          canAgree
          labelled={false}
          emptyHint="Nothing put forward for this week yet."
        />
      </details>

      <details className="team-person-section" data-section="active">
        <summary>
          Other active work <span className="team-person-count">{otherActive.length}</span>
        </summary>
        {/*
          The load signals, in one line and without a verdict.

          Overdue is a fact. Work that has not moved in a month is a question,
          not a failure. Shown together they suggest a pattern; shown as a
          percentage they would suggest a judgement the product is not entitled
          to make.

          Counted from the rows underneath rather than from `signals.openOverdue`,
          which is overdue work of every kind. That figure put "4 overdue" above
          a list of none — the other three were routine occurrences, which have
          had a section of their own since §6 and say it there.
        */}
        {(overdueActive > 0 || detail.signals.agingActive > 0) && (
          <p className="member-signals">
            {overdueActive > 0 && <span className="tone-red">{overdueActive} overdue</span>}
            {detail.signals.agingActive > 0 && (
              <span>
                {detail.signals.agingActive} active &gt; {detail.signals.agingActiveDays} days
              </span>
            )}
          </p>
        )}
        {otherActive.length === 0 ? (
          /*
           * No Active focus is a fact, not a fault. Somebody may legitimately
           * be carrying routines, or have finished what they had. Colouring
           * this red would invent a problem and teach the manager to distrust
           * the colours that mean something.
           */
          <p className="muted">
            {detail.activeWork.length > 0
              ? 'Everything active is in this week’s priorities.'
              : 'No Active focus.'}
          </p>
        ) : (
          <div className="member-work-list">
            {activeHead.map(activeRow)}
            {activeRest.length > 0 && (
              /* Paginated within the section, per §6 — one person carrying
                 twenty items should not push the next person off the screen. */
              <details className="team-person-more">
                <summary>Show {activeRest.length} more</summary>
                <div className="member-work-list">{activeRest.map(activeRow)}</div>
              </details>
            )}
          </div>
        )}
      </details>

      {/*
        v157 - what they owe on somebody else's work.

        None of it is in the list above, because the work belongs to its owner;
        before this, somebody carrying three colleagues' steps looked, from
        here, as though they were carrying nothing more. Collapsed like every
        section that is not a decision, but the count says whether any is late.
      */}
      <details className="team-person-section" data-section="contributions">
        <summary>
          Contributions to others{' '}
          <span className="team-person-count">
            {detail.contributions.length}
            {contributionsOverdue > 0 ? ` · ${contributionsOverdue} overdue` : ''}
          </span>
        </summary>
        {detail.contributions.length === 0 ? (
          <p className="muted member-other-empty">No steps on other people&rsquo;s work.</p>
        ) : (
          <div className="member-other-list">
            {detail.contributions.map((step) => {
              const hold = contributionHold(step);
              return (
                <Link
                  key={step.checklistItemId}
                  href={`${taskHref(step.taskId)}&step=${step.checklistItemId}`}
                  scroll={false}
                  className="member-other-row"
                >
                  <span className="member-other-copy">
                    <strong>{step.title}</strong>
                    <span>
                      For {step.ownerName} · {step.parentTitle}
                    </span>
                    <span>
                      {step.dueAt ? (
                        <DeadlineLabel deadline={deadline(step.dueAt, step.dueIsDateOnly)!} />
                      ) : (
                        'No due date'
                      )}
                      {hold ? ` · ${hold}` : ''}
                    </span>
                  </span>
                  <span className="member-other-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </details>

      {/*
        "Waiting" since v236, which is what the tab above has been called since
        v233. The same work under two names in two places is two things to a
        reader who has not read the code.
      */}
      <details className="team-person-section" data-section="waiting">
        <summary>
          Waiting{' '}
          <span className="team-person-count">
            {detail.otherWorkload.available.length}
            {/* v185 — folded away, so the summary says when something in it is late. */}
            {availableOverdue > 0 ? ` · ${availableOverdue} overdue` : ''}
          </span>
        </summary>
        {detail.otherWorkload.available.length === 0 ? (
          <p className="muted member-other-empty">No Available work.</p>
        ) : (
          <div className="member-other-list">
            {detail.otherWorkload.available.map((task) => (
              <Link
                key={task.id}
                href={taskHref(task.id)}
                scroll={false}
                className="member-other-row"
              >
                <span className="member-other-copy">
                  <strong>{task.title}</strong>
                  <span>
                    {WORK_CLASS_LABELS[task.workClass]}
                    {task.dueAt ? (
                      <>
                        {' · '}
                        <DeadlineLabel deadline={deadline(task.dueAt, task.dueIsDateOnly)!} />
                      </>
                    ) : (
                      ' · No due date'
                    )}
                  </span>
                </span>
                <span className="member-other-chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            ))}
          </div>
        )}
      </details>

      <details className="team-person-section" data-section="routines">
        <summary>
          Routines <span className="team-person-count">{routineSummary}</span>
        </summary>
        {detail.otherWorkload.routines.length === 0 ? (
          <p className="muted member-other-empty">No overdue routine occurrences.</p>
        ) : (
          <div className="member-other-list">
            {detail.otherWorkload.routines.map((routine) => {
              const state = routineOccurrenceState(routine, timeZone, now);
              const occurrence = formatDue(
                routine.dueAt ?? routine.occurrenceDate,
                routine.dueAt ? routine.dueIsDateOnly : true,
                timeZone,
              );
              return (
                <Link
                  key={routine.id}
                  href={taskHref(routine.id)}
                  scroll={false}
                  className="member-other-row"
                >
                  <span className="member-other-copy">
                    {/* §6 — a weekly check carries the same title every week,
                        so the occurrence date is part of which one this is,
                        and §14 adds where it was recorded: two halls produce
                        two identical rows on the same date otherwise. */}
                    <strong>
                      {routine.title} · {occurrence}
                      {routine.area ? ` · ${routine.area}` : ''}
                    </strong>
                    <span>
                      {ROUTINE_OCCURRENCE_LABELS[state]}
                      {' · '}
                      {routine.checklistTotal > 0
                        ? `${routine.checklistCompleted}/${routine.checklistTotal} checklist`
                        : `${routine.progressPercent}% complete`}
                    </span>
                  </span>
                  <span className="member-other-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </details>

      {/*
        What actually closed, split by what kind of work it was.

        One number would be misleading on its own: ten routine occurrences are
        generated by a schedule and closed every week, while one Major Project
        closes once a quarter, and a contribution to somebody else's work does
        not appear in a completion count at all because the task belongs to
        them.
      */}
      <details className="team-person-section" data-section="completed">
        <summary>
          Completed{' '}
          <span className="team-person-count">
            {detail.recentDelivery.total} · {detail.recentDelivery.windowLabel.toLowerCase()}
          </span>
        </summary>
        {detail.recentDelivery.total === 0 ? (
          <p className="muted member-other-empty">Nothing completed in this period.</p>
        ) : (
          <>
            {deliveryCounts && <p className="member-signals-plain">{deliveryCounts}</p>}
            <div className="member-other-list">
              {detail.recentDelivery.records.slice(0, DELIVERY_RECORD_LIMIT).map((record) => (
                <Link
                  key={`${record.kind}-${record.id}`}
                  href={taskHref(record.taskId)}
                  scroll={false}
                  className="member-other-row"
                >
                  <span className="member-other-copy">
                    <strong>{record.title}</strong>
                    <span>
                      {DELIVERY_KIND_WORD[record.kind]}
                      {record.parentTitle ? ` on ${record.parentTitle}` : ''}
                      {record.at ? ` · ${completedOn(record.at)}` : ''}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
            {detail.recentDelivery.total > DELIVERY_RECORD_LIMIT && (
              <Link
                className="member-delivery-more"
                href={`/more/records?owner=${detail.person.id}`}
              >
                View all {detail.recentDelivery.total} completed ›
              </Link>
            )}
          </>
        )}
      </details>

      <details className="team-person-section" data-section="activity">
        <summary>
          Recent activity{' '}
          <span className="team-person-count">
            {detail.recentUpdates.length} · {detail.otherWorkload.goals.length} goals
          </span>
        </summary>

        {detail.recentUpdates.length === 0 ? (
          <p className="muted member-other-empty">No recent updates.</p>
        ) : (
          <div className="member-update-list">
            {detail.recentUpdates.map((update) => (
              <p key={update.id} className="member-update">
                <span className="muted">
                  {agoWords(update.at, now)} — {update.taskTitle}
                </span>
                <br />
                {update.summary}
              </p>
            ))}
          </div>
        )}

        {detail.otherWorkload.goals.length > 0 && (
          <div className="member-other-list">
            {detail.otherWorkload.goals.map((goal) => (
              <Link key={goal.id} href={goalHref(goal.id)} className="member-other-row">
                <span className="member-other-copy">
                  <strong>{goal.title}</strong>
                  <span>
                    {GOAL_STATUS_LABELS[goal.status]}
                    {goal.status === 'active' ? ` · ${GOAL_HEALTH_LABELS[goal.health]}` : ''}
                    {' · '}Target {formatDue(goal.targetDate, true, timeZone)} ·{' '}
                    {goal.weightPercent}% formal weight
                  </span>
                  {goal.currentMilestoneTitle && (
                    <span>Current milestone: {goal.currentMilestoneTitle}</span>
                  )}
                </span>
                <span className="member-other-chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            ))}
          </div>
        )}
      </details>

      {/*
        Where the rest of it is.

        This panel is a reading of one person, bounded on purpose. Everything
        they have ever owned belongs in Records, which can filter, sort and go
        back further than any expansion should try to.
      */}
      <p className="team-person-exit">
        <Link href={`/more/records?owner=${detail.person.id}`}>View full work →</Link>
      </p>
    </div>
  );
}

'use client';

import Link from 'next/link';

import { SideDrawer } from '@/components/ui/SideDrawer';
import {
  formatDue,
  formatDueShort,
  ROUTINE_OCCURRENCE_LABELS,
  routineOccurrenceState,
} from '@/domain/duration';
import { DELIVERY_KIND_WORD } from '@/domain/delivery';
import { GOAL_HEALTH_LABELS, GOAL_STATUS_LABELS } from '@/domain/goals';
import { FOCUS_BUCKET_WORD, WORK_CLASS_LABELS } from '@/domain/types';
import type { TeamMemberDetail } from '@/server/queries';

/** What a delivered record was, in one word. */
function agoWords(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * One team member, over My Team (v48 sections 35-44).
 *
 * A drawer rather than a page, because the manager is working through a list
 * and going back to it should not cost a navigation. My Team stays underneath,
 * with its filter and its scroll position, and the task drawer opens on top of
 * this one.
 *
 * The order of the sections is the order of the questions: does this person
 * need me, what are they carrying, what have they actually delivered, what
 * changed, and then — quietly — the rest.
 *
 * Delivery moved above the update feed because it answers the question a
 * manager actually has. A chronological list of edits says somebody has been
 * busy; what closed says what came of it.
 *
 * It is not an employee dashboard. There is no score, and there deliberately
 * is not one: any single number would have to decide how a Major Project
 * compares with a PPE check, and every answer it could give would reward
 * whoever does the smallest work. What is here are observations — what closed,
 * what is late, what has stopped moving, what is queued — which a manager
 * reads together and draws their own conclusion from.
 */
export function TeamMemberDrawer({
  detail,
  closeHref,
  taskHrefBase,
  timeZone,
  now,
}: {
  detail: TeamMemberDetail;
  closeHref: string;
  /**
   * The URL of this layer, which a task is opened on top of. A string rather
   * than a builder function: this is rendered from a server component, and a
   * function cannot cross that boundary.
   */
  taskHrefBase: string;
  timeZone: string;
  now: Date;
}) {
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
  const focusSummary = detail.focus
    .map((bucket) => {
      const word = FOCUS_BUCKET_WORD[bucket.bucket] ?? bucket.bucket;
      return `${word} ${bucket.activeCount}/${bucket.recommendedTarget}`;
    })
    .join(' · ');

  return (
    <SideDrawer
      closeHref={closeHref}
      closeLabel="Close team member detail"
      className="team-member-drawer"
      eyebrow="Team member"
      title={detail.person.fullName}
      titleId="team-member-title"
    >
      <div className="task-detail-scroll">
        {/* §39 — the same capacity numbers the rest of the product uses. */}
        {focusSummary && <p className="team-member-focus">{focusSummary}</p>}

        <section className="detail-section" aria-labelledby="member-attention-heading">
          <h3 id="member-attention-heading">Needs your attention</h3>
          {detail.attention.length === 0 ? (
            /* §41, §49 — one line. An empty state does not need a panel. */
            <p className="muted">Nothing needs your action right now.</p>
          ) : (
            detail.attention.map((item, index) =>
              item ? (
                <article key={index} className="member-attention-row">
                  <div>
                    <strong className={item.severity === 'critical' ? 'tone-red' : 'tone-amber'}>
                      {item.headline}
                    </strong>
                    <p>{item.reason}</p>
                  </div>
                  <Link href={item.href} className="btn small primary">
                    {item.requiredAction}
                  </Link>
                </article>
              ) : null,
            )
          )}
        </section>

        <section className="detail-section" aria-labelledby="member-active-heading">
          {/* "Working on now" named one moment; this names the commitment. */}
          <h3 id="member-active-heading">Current commitments</h3>
          {/*
            The load signals, in one line and without a verdict.

            Overdue is a fact. Work that has not moved in a month is a question,
            not a failure. Available is a plan, not a backlog of shame - a
            person with seven items waiting and four active may be pacing
            themselves correctly. Shown together they suggest a pattern; shown
            as a percentage they would suggest a judgement the product is not
            entitled to make.
          */}
          {(detail.signals.openOverdue > 0 ||
            detail.signals.agingActive > 0 ||
            detail.signals.availableCount > 0) && (
            <p className="member-signals">
              {detail.signals.openOverdue > 0 && (
                <span className="tone-red">{detail.signals.openOverdue} overdue</span>
              )}
              {detail.signals.agingActive > 0 && (
                <span>
                  {detail.signals.agingActive} active &gt; {detail.signals.agingActiveDays} days
                </span>
              )}
              {detail.signals.availableCount > 0 && (
                <span>{detail.signals.availableCount} available</span>
              )}
            </p>
          )}
          {detail.activeWork.length === 0 ? (
            /*
             * §45, §47 — no Active focus is a fact, not a fault. Somebody may
             * legitimately be carrying routines, or have finished what they
             * had. Colouring this red would invent a problem and teach the
             * manager to distrust the colours that mean something.
             */
            <p className="muted">No Active focus.</p>
          ) : (
            <div className="member-work-list">
              {detail.activeWork.map((task) => (
                <Link key={task.id} href={taskHref(task.id)} className="member-work-row">
                  <strong>{task.title}</strong>
                  <span>
                    {task.bucket ? `${FOCUS_BUCKET_WORD[task.bucket]} · ` : ''}
                    {task.progressPercent}%{task.isMandatory ? ' · Mandatory' : ''}
                    {/* Short, like every other date since v130: the year is
                        the same on every row and the eye has to step over it. */}
                    {task.dueAt
                      ? ` · ${task.isOverdue ? 'Overdue' : 'Due'} ${formatDueShort(task.dueAt, task.dueIsDateOnly, timeZone, now)}`
                      : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/*
          What actually closed, split by what kind of work it was.

          One number would be misleading on its own: ten routine occurrences
          are generated by a schedule and closed every week, while one Major
          Project closes once a quarter, and a contribution to somebody else's
          work does not appear in a completion count at all because the task
          belongs to them.
        */}
        <section className="detail-section" aria-labelledby="member-delivery-heading">
          <h3 id="member-delivery-heading">
            Recent delivery{' '}
            <span className="member-window">{detail.recentDelivery.windowLabel}</span>
          </h3>
          {detail.recentDelivery.total === 0 ? (
            <p className="muted">Nothing completed in this period.</p>
          ) : (
            <>
              <p className="member-delivery-total">
                <strong>{detail.recentDelivery.total}</strong> completed
              </p>
              <p className="member-signals">
                {detail.recentDelivery.owned > 0 && (
                  <span>{detail.recentDelivery.owned} owned work</span>
                )}
                {detail.recentDelivery.shared > 0 && (
                  <span>{detail.recentDelivery.shared} shared contribution</span>
                )}
                {detail.recentDelivery.routine > 0 && (
                  <span>{detail.recentDelivery.routine} routine</span>
                )}
              </p>
              <div className="member-other-list">
                {detail.recentDelivery.records.map((record) => (
                  <Link
                    key={`${record.kind}-${record.id}`}
                    href={taskHref(record.taskId)}
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
              {detail.recentDelivery.total > detail.recentDelivery.records.length && (
                <Link
                  className="member-delivery-more"
                  href={`/more/records?owner=${detail.person.id}`}
                >
                  View all {detail.recentDelivery.total} completed ›
                </Link>
              )}
            </>
          )}
          {/*
            Routine runs on its own rhythm, so it gets its own three numbers.
            An accepted "not required" is neither a completion nor a miss - it
            is a decision that the occurrence did not apply, and folding it
            into either column misrepresents the person and the schedule.
          */}
          {(detail.signals.routine.completed > 0 ||
            detail.signals.routine.overdue > 0 ||
            detail.signals.routine.notRequired > 0) && (
            <p className="member-signals member-routine-signals">
              <span className="member-signals-label">Routine</span>
              {detail.signals.routine.completed > 0 && (
                <span>{detail.signals.routine.completed} completed</span>
              )}
              {detail.signals.routine.overdue > 0 && (
                <span className="tone-red">{detail.signals.routine.overdue} overdue</span>
              )}
              {detail.signals.routine.notRequired > 0 && (
                <span>{detail.signals.routine.notRequired} not required</span>
              )}
            </p>
          )}
        </section>

        <section className="detail-section" aria-labelledby="member-updates-heading">
          {/* Every row here is already a meaningful change; saying so on the
              heading spent a word on the filter rather than the content. */}
          <h3 id="member-updates-heading">Recent updates</h3>
          {detail.recentUpdates.length === 0 ? (
            <p className="muted">No recent updates.</p>
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
        </section>

        <details className="detail-section member-other-workload">
          <summary>
            Other workload · Available {detail.otherWorkload.available.length} · Overdue routines{' '}
            {detail.otherWorkload.routines.length} · Goals {detail.otherWorkload.goals.length}
          </summary>

          <div className="member-other-sections">
            <section aria-labelledby="member-available-heading">
              <header className="member-other-heading">
                <h4 id="member-available-heading">Available work</h4>
                <span>{detail.otherWorkload.available.length}</span>
              </header>
              {detail.otherWorkload.available.length === 0 ? (
                <p className="muted member-other-empty">No Available work.</p>
              ) : (
                <div className="member-other-list">
                  {detail.otherWorkload.available.map((task) => (
                    <Link key={task.id} href={taskHref(task.id)} className="member-other-row">
                      <span className="member-other-copy">
                        <strong>{task.title}</strong>
                        <span>
                          {WORK_CLASS_LABELS[task.workClass]}
                          {task.dueAt
                            ? ` · ${task.isOverdue ? 'Overdue' : 'Due'} ${formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}`
                            : ' · No due date'}
                        </span>
                      </span>
                      <span className="member-other-chevron" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="member-routines-heading">
              <header className="member-other-heading">
                <h4 id="member-routines-heading">Overdue routine occurrences</h4>
                <span>{detail.otherWorkload.routines.length}</span>
              </header>
              {detail.otherWorkload.routines.length === 0 ? (
                <p className="muted member-other-empty">No overdue routine occurrences.</p>
              ) : (
                <div className="member-other-list">
                  {detail.otherWorkload.routines.map((routine) => {
                    const state = routineOccurrenceState(routine, timeZone, now);
                    return (
                      <Link
                        key={routine.id}
                        href={taskHref(routine.id)}
                        className="member-other-row"
                      >
                        <span className="member-other-copy">
                          <strong>{routine.title}</strong>
                          <span>
                            {ROUTINE_OCCURRENCE_LABELS[state]}{' '}
                            {formatDue(
                              routine.dueAt ?? routine.occurrenceDate,
                              routine.dueAt ? routine.dueIsDateOnly : true,
                              timeZone,
                            )}
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
            </section>

            <section aria-labelledby="member-goals-heading">
              <header className="member-other-heading">
                <h4 id="member-goals-heading">Goals</h4>
                <span>{detail.otherWorkload.goals.length}</span>
              </header>
              {detail.otherWorkload.goals.length === 0 ? (
                <p className="muted member-other-empty">No current goals.</p>
              ) : (
                <div className="member-other-list">
                  {detail.otherWorkload.goals.map((goal) => (
                    <Link key={goal.id} href={goalHref(goal.id)} className="member-other-row">
                      <span className="member-other-copy">
                        <strong>{goal.title}</strong>
                        <span>
                          {GOAL_STATUS_LABELS[goal.status]}
                          {goal.status === 'active' ? ` · ${GOAL_HEALTH_LABELS[goal.health]}` : ''}
                          {' · '}Target {formatDue(goal.targetDate, true, timeZone)} ·{' '}
                          {goal.weightPercent}% formal weight · {goal.successMeasureCount} success{' '}
                          measure{goal.successMeasureCount === 1 ? '' : 's'}
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
            </section>
          </div>
        </details>
      </div>
    </SideDrawer>
  );
}

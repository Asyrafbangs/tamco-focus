'use client';

import Link from 'next/link';

import { SideDrawer } from '@/components/ui/SideDrawer';
import { formatDue, ROUTINE_OCCURRENCE_LABELS, routineOccurrenceState } from '@/domain/duration';
import { GOAL_HEALTH_LABELS, GOAL_STATUS_LABELS } from '@/domain/goals';
import { FOCUS_BUCKET_WORD, WORK_CLASS_LABELS } from '@/domain/types';
import type { TeamMemberDetail } from '@/server/queries';

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
 * need me, what are they doing, what changed, and then — quietly — how much
 * else they are carrying. It is not an employee dashboard, and deliberately has
 * no charts, no productivity scoring and no metric that nobody would act on.
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
          <h3 id="member-active-heading">Working on now</h3>
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
                    {task.dueAt
                      ? ` · ${task.isOverdue ? 'Overdue' : 'Due'} ${formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}`
                      : ''}
                  </span>
                  {task.nextAction && (
                    <span className="member-work-next">Next: {task.nextAction}</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="detail-section" aria-labelledby="member-updates-heading">
          <h3 id="member-updates-heading">Recent meaningful updates</h3>
          {detail.recentUpdates.length === 0 ? (
            <p className="muted">No recent meaningful updates.</p>
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

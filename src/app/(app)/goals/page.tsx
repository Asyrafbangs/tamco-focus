import Link from 'next/link';

import { GoalDetailDrawer } from '@/components/goals/GoalDetailDrawer';
import { GoalRow } from '@/components/goals/GoalRow';
import { GoalSetupDialog } from '@/components/goals/GoalSetupDialog';
import { EmptyState, StatusBadge, WorkspaceTabs } from '@/components/ui/ParityPrimitives';
import {
  GOAL_LIFECYCLE_LABELS,
  GOAL_LIFECYCLE_VIEWS,
  formalGoalWeightSummary,
  matchesGoalLifecycle,
  type GoalLifecycleView,
  type GoalOverview,
} from '@/domain/goals';
import { requireProfile } from '@/lib/supabase/server';
import {
  getGoalActiveWeights,
  getGoalDetail,
  getGoalEmployeeOptions,
  getGoalsForOwner,
  getMyGoals,
  getTeamGoalSummary,
} from '@/server/goal-queries';
import { getWorkableTasks } from '@/server/queries';

import styles from './goals.module.css';

const LIFECYCLE_EMPTY: Record<GoalLifecycleView, string> = {
  active:
    'No goal has been agreed and activated yet. Goals saved for discussion are under For discussion.',
  discussion:
    'Nothing is awaiting agreement. Goals saved for discussion appear here until they are agreed and activated.',
  completed: 'No goal has been completed or closed yet.',
  all: 'No goals exist in any state.',
};

function weightedDerivedProgress(goals: readonly GoalOverview[]): number {
  const active = goals.filter((goal) => goal.status === 'active');
  const totalWeight = active.reduce((total, goal) => total + goal.weightPercent, 0);
  if (totalWeight === 0) return 0;
  return Math.round(
    active.reduce((total, goal) => total + goal.derivedProgress * goal.weightPercent, 0) /
      totalWeight,
  );
}

function FormalWeight({ goals }: { goals: readonly GoalOverview[] }) {
  const summary = formalGoalWeightSummary(goals);
  return (
    <div
      className={`${styles.formalWeight} ${styles[summary.state]}`}
      role="status"
      aria-label={`Active Goal weight ${summary.allocated} percent`}
    >
      <strong>Active Goal weight {summary.allocated}%</strong>
      <span>
        {summary.state === 'complete'
          ? 'Formal weighting is aligned to 100%.'
          : summary.state === 'over'
            ? `${summary.over}% over the formal limit.`
            : `${summary.remaining}% remains to allocate.`}
      </span>
    </div>
  );
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    person?: string;
    goal?: string;
    action?: string;
    lifecycle?: string;
  }>;
}) {
  const profile = await requireProfile();
  const renderTime = new Date();
  const params = await searchParams;
  const canManage = profile.role === 'manager' || profile.role === 'administrator';

  const [myGoals, teamSummary, employees, activeWeights, visibleWork] = await Promise.all([
    getMyGoals(profile.id),
    canManage ? getTeamGoalSummary(profile.id) : Promise.resolve([]),
    canManage ? getGoalEmployeeOptions(profile.id) : Promise.resolve([]),
    canManage ? getGoalActiveWeights() : Promise.resolve<Record<string, number>>({}),
    getWorkableTasks(),
  ]);

  const teamPeople = employees.map((employee) => {
    const summary = teamSummary.find((item) => item.userId === employee.id);
    return (
      summary ?? {
        userId: employee.id,
        fullName: employee.fullName,
        employeeId: employee.employeeId,
        activeGoalCount: 0,
        attentionCount: 0,
        supportRequestCount: 0,
        checkinDueCount: 0,
        weightedProgress: 0,
        lastGoalUpdateAt: null,
      }
    );
  });
  const view = canManage && params.view === 'team' ? 'team' : 'my';
  const selectedPersonId =
    view === 'team' && teamPeople.some((person) => person.userId === params.person)
      ? params.person!
      : (teamPeople.find((person) => person.supportRequestCount > 0 || person.attentionCount > 0)
          ?.userId ??
        teamPeople.find((person) => person.activeGoalCount > 0)?.userId ??
        teamPeople[0]?.userId);
  const teamGoals = selectedPersonId ? await getGoalsForOwner(selectedPersonId) : [];
  const selectedPerson = teamPeople.find((person) => person.userId === selectedPersonId);
  const goalDetail = params.goal ? await getGoalDetail(params.goal) : null;
  const rows = view === 'team' ? teamGoals : myGoals;

  const lifecycle: GoalLifecycleView = GOAL_LIFECYCLE_VIEWS.includes(
    params.lifecycle as GoalLifecycleView,
  )
    ? (params.lifecycle as GoalLifecycleView)
    : 'active';

  const visibleRows = rows.filter((goal) => matchesGoalLifecycle(goal.status, lifecycle));

  const lifecycleCount = (wanted: GoalLifecycleView) =>
    rows.filter((goal) => matchesGoalLifecycle(goal.status, wanted)).length;

  // Switching lifecycle must keep the person and workspace context.
  const lifecycleHref = (wanted: GoalLifecycleView) => {
    const query = new URLSearchParams();
    if (view === 'team') query.set('view', 'team');
    if (view === 'team' && selectedPersonId) query.set('person', selectedPersonId);
    if (wanted !== 'active') query.set('lifecycle', wanted);
    const search = query.toString();
    return search ? `/goals?${search}` : '/goals';
  };
  const activeRows = rows.filter((goal) => goal.status === 'active');
  const weightedProgress = weightedDerivedProgress(rows);
  const attentionCount = activeRows.filter(
    (goal) => goal.health === 'need_attention' || goal.health === 'support_requested',
  ).length;
  const closeHref = lifecycleHref(lifecycle);
  const goalHref = (goalId: string) => {
    const query = new URLSearchParams(closeHref.split('?')[1] ?? '');
    query.set('goal', goalId);
    return `/goals?${query.toString()}`;
  };
  const personHref = (personId: string) => {
    const query = new URLSearchParams({ view: 'team', person: personId });
    if (lifecycle !== 'active') query.set('lifecycle', lifecycle);
    return `/goals?${query.toString()}`;
  };

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Performance and development</p>
          <h1>Goals</h1>
          <p>Keep agreed outcomes visible, update progress, and surface support early.</p>
        </div>
        <div className="actions">
          {canManage && (
            <GoalSetupDialog
              employees={employees.map((employee) => ({
                ...employee,
                activeWeight: activeWeights[employee.id] ?? 0,
              }))}
            />
          )}
        </div>
      </div>

      <section className="goals-page-intro">
        <div>
          <strong>Goals stay visible without becoming another daily task list.</strong>
          <span>
            Use Goals for agreed outcomes, progress and support—not as a second task backlog.
          </span>
        </div>
        <details>
          <summary className="btn small">How it works</summary>
          <p>
            Agree the outcome and milestones together, post concise updates, and connect delivery
            work only when it helps explain progress.
          </p>
        </details>
      </section>

      {canManage && (
        <WorkspaceTabs
          label="Goal workspace"
          items={[
            { href: '/goals', label: 'My Goals', active: view === 'my', count: myGoals.length },
            {
              href: '/goals?view=team',
              label: 'Team Goals',
              active: view === 'team',
              count: teamPeople.reduce((total, person) => total + person.activeGoalCount, 0),
              attention: teamPeople.some(
                (person) => person.attentionCount > 0 || person.supportRequestCount > 0,
              ),
            },
          ]}
        />
      )}

      {view === 'my' ? (
        <section className="goal-list-panel" aria-labelledby="my-goal-list">
          <div className="sectionhead">
            <div>
              <h2 id="my-goal-list">Agreed outcomes</h2>
              <p>Open a goal for context or use Update for a concise check-in.</p>
            </div>
            <div className="goal-summary-inline" aria-label="Goal summary">
              <div>
                <b>{activeRows.length}</b>Active
              </div>
              <div>
                <b>{weightedProgress}%</b>Weighted progress
              </div>
              <div className={attentionCount > 0 ? 'attention' : undefined}>
                <b>{attentionCount}</b>Need attention
              </div>
            </div>
          </div>
          <FormalWeight goals={rows} />
          <WorkspaceTabs
            label="Goal lifecycle"
            items={[
              {
                href: lifecycleHref('active'),
                label: 'Active',
                active: lifecycle === 'active',
                count: lifecycleCount('active'),
              },
              {
                href: lifecycleHref('discussion'),
                label: 'For discussion',
                active: lifecycle === 'discussion',
                count: lifecycleCount('discussion'),
              },
              {
                href: lifecycleHref('completed'),
                label: 'Completed',
                active: lifecycle === 'completed',
                count: lifecycleCount('completed'),
              },
              {
                href: lifecycleHref('all'),
                label: 'All',
                active: lifecycle === 'all',
                count: rows.length,
              },
            ]}
          />

          {visibleRows.length ? (
            <div className="goal-list">
              {visibleRows.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  href={goalHref(goal.id)}
                  timeZone={profile.timezone}
                  now={renderTime}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title={
                rows.length === 0
                  ? 'No Goals have been agreed yet'
                  : `Nothing in ${GOAL_LIFECYCLE_LABELS[lifecycle]}`
              }
              action={
                /* Section 27.2 — when a filter is hiding the goals rather than
                   there being none, the next useful action is to widen it. */
                rows.length > 0 ? (
                  <Link href={lifecycleHref('all')} className="btn">
                    Show all Goals
                  </Link>
                ) : canManage ? undefined : (
                  <Link href="/today" className="btn">
                    Return to My Day
                  </Link>
                )
              }
            >
              <p>
                {rows.length === 0
                  ? 'Goals appear here after a manager and employee align the result and milestones.'
                  : LIFECYCLE_EMPTY[lifecycle]}
              </p>
            </EmptyState>
          )}
        </section>
      ) : (
        <div className="team-goals-layout">
          <aside className="team-goal-people" aria-label="People with visible Goals">
            <div className="team-goal-people-head">
              <strong>People</strong>
              <span>{teamPeople.length}</span>
            </div>
            {teamPeople.map((person) => {
              const active = person.userId === selectedPersonId;
              return (
                <Link
                  key={person.userId}
                  href={personHref(person.userId)}
                  className={`team-goal-person interactive-row${active ? ' active' : ''}`}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="team-goal-avatar" aria-hidden="true">
                    {person.fullName
                      .split(' ')
                      .slice(0, 2)
                      .map((part: string) => part[0])
                      .join('')}
                  </span>
                  <span>
                    <strong>{person.fullName}</strong>
                    <small>
                      {person.employeeId} · {person.activeGoalCount} active
                    </small>
                  </span>
                  {(person.supportRequestCount > 0 || person.attentionCount > 0) && (
                    <StatusBadge tone={person.supportRequestCount > 0 ? 'red' : 'amber'}>
                      {person.supportRequestCount > 0 ? 'Support' : 'Attention'}
                    </StatusBadge>
                  )}
                </Link>
              );
            })}
            {teamPeople.length === 0 && (
              <p className="sub">No people are currently visible under your policy.</p>
            )}
          </aside>

          <section className="team-goal-detail" aria-labelledby="team-person-goals">
            {selectedPerson ? (
              <>
                <header className="team-goal-detail-head">
                  <div>
                    <p className="eyebrow">Employee goals</p>
                    <h2 id="team-person-goals">{selectedPerson.fullName}</h2>
                    <p>{selectedPerson.employeeId} · Coaching and alignment</p>
                  </div>
                  <div className="team-goal-summary">
                    <div>
                      <strong>{selectedPerson.activeGoalCount}</strong>
                      <span>Active</span>
                    </div>
                    <div>
                      <strong>{weightedProgress}%</strong>
                      <span>Weighted progress</span>
                    </div>
                    <div>
                      <strong>{selectedPerson.attentionCount}</strong>
                      <span>Need attention</span>
                    </div>
                  </div>
                </header>
                <FormalWeight goals={teamGoals} />
                <WorkspaceTabs
                  label="Goal lifecycle"
                  items={GOAL_LIFECYCLE_VIEWS.map((item) => ({
                    href: lifecycleHref(item),
                    label: GOAL_LIFECYCLE_LABELS[item],
                    active: lifecycle === item,
                    count: item === 'all' ? rows.length : lifecycleCount(item),
                  }))}
                />
                {visibleRows.length ? (
                  <div className="goal-list">
                    {visibleRows.map((goal) => (
                      <GoalRow
                        key={goal.id}
                        goal={goal}
                        href={goalHref(goal.id)}
                        timeZone={profile.timezone}
                        now={renderTime}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={
                      teamGoals.length === 0
                        ? 'No Goals for this employee'
                        : `Nothing in ${GOAL_LIFECYCLE_LABELS[lifecycle]}`
                    }
                  >
                    <p>
                      {teamGoals.length === 0
                        ? 'Use Set a Goal to begin the manager-led alignment conversation.'
                        : LIFECYCLE_EMPTY[lifecycle]}
                    </p>
                  </EmptyState>
                )}
              </>
            ) : (
              <EmptyState title="No visible team members">
                <p>Visibility and reporting-line policy determine who appears here.</p>
              </EmptyState>
            )}
          </section>
        </div>
      )}

      {goalDetail && (
        <GoalDetailDrawer
          detail={goalDetail}
          closeHref={closeHref}
          timeZone={profile.timezone}
          initialAction={params.action}
          workOptions={visibleWork.map((task) => ({ id: task.id, title: task.title }))}
        />
      )}
    </>
  );
}

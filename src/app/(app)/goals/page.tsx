import Link from 'next/link';

import { GoalDetailDrawer } from '@/components/goals/GoalDetailDrawer';
import { GoalRow } from '@/components/goals/GoalRow';
import { GoalSetupDialog } from '@/components/goals/GoalSetupDialog';
import {
  EmptyState,
  ProgressIndicator,
  StatusBadge,
  WorkspaceTabs,
} from '@/components/ui/ParityPrimitives';
import { requireProfile } from '@/lib/supabase/server';
import {
  getGoalDetail,
  getGoalEmployeeOptions,
  getGoalsForOwner,
  getMyGoals,
  getTeamGoalSummary,
} from '@/server/goal-queries';
import { getWorkableTasks } from '@/server/queries';

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

  const [myGoals, teamSummary, employees, visibleWork] = await Promise.all([
    getMyGoals(profile.id),
    canManage ? getTeamGoalSummary(profile.id) : Promise.resolve([]),
    canManage ? getGoalEmployeeOptions(profile.id) : Promise.resolve([]),
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

  /*
   * v34: the workspace separates Active, For discussion, Completed, and All,
   * defaulting to Active. Draft or discussion goals must never be presented as
   * agreed outcomes (MASTER_PRODUCT_SPEC.md, "V34 — Goal workspace focus and
   * formal weighting").
   */
  const LIFECYCLE_VIEWS = ['active', 'discussion', 'completed', 'all'] as const;
  type LifecycleView = (typeof LIFECYCLE_VIEWS)[number];

  const LIFECYCLE_LABELS: Record<LifecycleView, string> = {
    active: 'Active',
    discussion: 'For discussion',
    completed: 'Completed',
    all: 'All',
  };

  const LIFECYCLE_EMPTY: Record<LifecycleView, string> = {
    active:
      'No goal has been agreed and activated yet. Goals saved for discussion are under For discussion.',
    discussion:
      'Nothing is awaiting agreement. Goals saved for discussion appear here until they are agreed and activated.',
    completed: 'No goal has been completed or closed yet.',
    all: 'No goals exist in any state.',
  };

  const lifecycle: LifecycleView = LIFECYCLE_VIEWS.includes(params.lifecycle as LifecycleView)
    ? (params.lifecycle as LifecycleView)
    : 'active';

  const matchesLifecycle = (status: string, wanted: LifecycleView) => {
    if (wanted === 'all') return true;
    if (wanted === 'active') return status === 'active';
    // "Save for discussion" leaves the goal unagreed, which is `draft`.
    if (wanted === 'discussion') return status === 'draft';
    return status === 'completed' || status === 'closed';
  };

  const visibleRows = rows.filter((goal) => matchesLifecycle(goal.status, lifecycle));

  const lifecycleCount = (wanted: LifecycleView) =>
    rows.filter((goal) => matchesLifecycle(goal.status, wanted)).length;

  // Switching lifecycle must keep the person and workspace context.
  const lifecycleHref = (wanted: LifecycleView) => {
    const query = new URLSearchParams();
    if (view === 'team') query.set('view', 'team');
    if (view === 'team' && selectedPersonId) query.set('person', selectedPersonId);
    if (wanted !== 'active') query.set('lifecycle', wanted);
    const search = query.toString();
    return search ? `/goals?${search}` : '/goals';
  };
  const totalWeight = rows
    .filter((goal) => goal.status === 'active')
    .reduce((total, goal) => total + goal.weightPercent, 0);
  const activeRows = rows.filter((goal) => goal.status === 'active');
  const weightedProgress = Math.round(
    activeRows.reduce((total, goal) => total + goal.reportedProgress * goal.weightPercent, 0) /
      Math.max(
        1,
        activeRows.reduce((total, goal) => total + goal.weightPercent, 0),
      ),
  );
  const attentionCount = rows.filter(
    (goal) => goal.health === 'need_attention' || goal.health === 'support_requested',
  ).length;
  const closeHref =
    view === 'team' && selectedPersonId ? `/goals?view=team&person=${selectedPersonId}` : '/goals';

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Performance and development</p>
          <h1>Goals</h1>
          <p>Keep agreed outcomes visible, update progress, and surface support early.</p>
        </div>
        <div className="actions">{canManage && <GoalSetupDialog employees={employees} />}</div>
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
                <b>{rows.length}</b>Goals
              </div>
              <div>
                <b>{weightedProgress}%</b>Weighted progress
              </div>
              <div className={attentionCount > 0 ? 'attention' : undefined}>
                <b>{attentionCount}</b>Need attention
              </div>
            </div>
          </div>
          {totalWeight > 0 && totalWeight !== 100 && (
            <div className="goal-weight-context" role="status">
              <strong>Goal weights total {totalWeight}%</strong>
              <span>Align them to 100% when this becomes the formal set.</span>
            </div>
          )}
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
                  href={`/goals?goal=${goal.id}`}
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
                  : `Nothing in ${LIFECYCLE_LABELS[lifecycle]}`
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
                  href={`/goals?view=team&person=${person.userId}`}
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
                      <strong>{selectedPerson.weightedProgress}%</strong>
                      <span>Weighted progress</span>
                    </div>
                    <div>
                      <strong>{selectedPerson.attentionCount}</strong>
                      <span>Need attention</span>
                    </div>
                  </div>
                </header>
                {teamGoals.length ? (
                  <div className="goal-list">
                    {teamGoals.map((goal) => (
                      <GoalRow
                        key={goal.id}
                        goal={goal}
                        href={`/goals?view=team&person=${selectedPerson.userId}&goal=${goal.id}`}
                        timeZone={profile.timezone}
                        now={renderTime}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No Goals for this employee">
                    <p>Use Set a Goal to begin the manager-led alignment conversation.</p>
                  </EmptyState>
                )}
                {teamGoals.length > 0 && (
                  <div className="team-goal-derived-summary">
                    <span>Milestone-derived context</span>
                    <ProgressIndicator
                      value={Math.round(
                        teamGoals.reduce(
                          (total, goal) => total + goal.derivedProgress * goal.weightPercent,
                          0,
                        ) /
                          Math.max(
                            1,
                            teamGoals.reduce((total, goal) => total + goal.weightPercent, 0),
                          ),
                      )}
                    />
                  </div>
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

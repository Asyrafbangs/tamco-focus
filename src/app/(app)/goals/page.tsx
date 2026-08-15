import Link from 'next/link';

import { GoalDetailDrawer } from '@/components/goals/GoalDetailDrawer';
import { GoalRow } from '@/components/goals/GoalRow';
import { GoalSetupDialog } from '@/components/goals/GoalSetupDialog';
import { GoalSessionPanel } from '@/components/goals/GoalSessionPanel';
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
  getCurrentGoalPlan,
  getGoalDetail,
  getGoalEmployeeOptions,
  getGoalSessions,
  getGoalSupportPeople,
  getGoalsForOwner,
  getMyGoals,
  getTeamGoalSummary,
  type GoalPlanOverview,
} from '@/server/goal-queries';
import { getWorkableTasks } from '@/server/queries';

import styles from './goals.module.css';

const LIFECYCLE_EMPTY: Record<GoalLifecycleView, string> = {
  active:
    'No goal has been agreed and activated yet. Goals saved for discussion are under For discussion.',
  draft: 'No Draft or For Discussion Goal is waiting. Start a Goal and save it before activation.',
  completed: 'No goal has been completed or closed yet.',
};

function FormalWeight({
  goals,
  plan,
}: {
  goals: readonly GoalOverview[];
  plan?: GoalPlanOverview | null;
}) {
  const summary = plan
    ? {
        allocated: plan.formalWeight,
        remaining: Math.max(0, 100 - plan.formalWeight),
        over: Math.max(0, plan.formalWeight - 100),
        state:
          plan.formalWeight === 100
            ? ('complete' as const)
            : plan.formalWeight > 100
              ? ('over' as const)
              : ('under' as const),
      }
    : formalGoalWeightSummary(goals);
  return (
    <div
      className={`${styles.formalWeight} ${styles[summary.state]}`}
      role="status"
      aria-label={`${summary.allocated} percent formal Active weight`}
    >
      <strong>{summary.allocated}% formal Active weight</strong>
      <span>
        {summary.state === 'complete'
          ? 'Formal Active set aligned to 100%. Draft and discussion goals do not count.'
          : summary.state === 'over'
            ? `Reduce Active goal weight by ${summary.over}% before agreeing another goal.`
            : `${summary.remaining}% remains available for the formal Active set.`}
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

  const [myGoals, teamSummary, employees, activeWeights, visibleWork, myPlan, supportPeople] =
    await Promise.all([
      getMyGoals(profile.id),
      canManage ? getTeamGoalSummary(profile.id) : Promise.resolve([]),
      canManage ? getGoalEmployeeOptions(profile.id) : Promise.resolve([]),
      canManage ? getGoalActiveWeights() : Promise.resolve<Record<string, number>>({}),
      getWorkableTasks(),
      getCurrentGoalPlan(profile.id),
      getGoalSupportPeople(profile.id),
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
        quarterlyActionCount: 0,
        quarterlyDueCount: 0,
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
  const [teamGoals, teamPlan] = selectedPersonId
    ? await Promise.all([getGoalsForOwner(selectedPersonId), getCurrentGoalPlan(selectedPersonId)])
    : [[], null];
  const selectedPerson = teamPeople.find((person) => person.userId === selectedPersonId);
  const goalDetail = params.goal ? await getGoalDetail(params.goal) : null;
  const rows = view === 'team' ? teamGoals : myGoals;
  const currentPlan = view === 'team' ? teamPlan : myPlan;
  const goalSessions = await getGoalSessions(
    view === 'team' ? (selectedPersonId ?? profile.id) : profile.id,
    currentPlan?.performancePeriodId ?? null,
  );

  const requestedLifecycle = params.lifecycle === 'discussion' ? 'draft' : params.lifecycle;
  const lifecycle: GoalLifecycleView = GOAL_LIFECYCLE_VIEWS.includes(
    requestedLifecycle as GoalLifecycleView,
  )
    ? (requestedLifecycle as GoalLifecycleView)
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
  const planActiveRows = currentPlan
    ? activeRows.filter(
        (goal) => goal.targetDate >= currentPlan.startsOn && goal.targetDate <= currentPlan.endsOn,
      )
    : activeRows;
  const attentionCount = activeRows.filter(
    (goal) =>
      goal.health === 'need_attention' ||
      goal.health === 'support_requested' ||
      goal.health === 'at_risk' ||
      goal.health === 'off_track',
  ).length;
  const updateDueCount = activeRows.filter(
    (goal) => goal.isCheckinDue || goal.isUpdateRequested,
  ).length;
  const formalWeight = currentPlan?.formalWeight ?? formalGoalWeightSummary(rows).allocated;
  const selfOwner = {
    id: profile.id,
    fullName: profile.full_name,
    employeeId: profile.employee_id,
    activeWeight: myPlan?.formalWeight ?? formalGoalWeightSummary(myGoals).allocated,
  };
  const ownerInitials = profile.full_name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
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
          <p>
            Agreed outcomes, visible progress, actionable milestones and evidence&mdash;separate
            from the Calendar.
          </p>
        </div>
        <div className="actions">
          {view === 'my' && <GoalSetupDialog owner={selfOwner} triggerLabel="+ New goal" />}
        </div>
      </div>

      {/*
        The guidance moved inside the disclosure that already existed to hold
        it. As a permanent banner it cost about 55px at the top of every visit,
        and combined with the summary, the session panel and two rows of tabs it
        pushed the first goal to roughly 690px down a 768px laptop screen — so
        the page about goals showed almost no goals, and reading the list meant
        zooming out. It is the same words, read once rather than every time.
      */}
      <section className="goals-page-intro">
        <details>
          <summary className="btn small">How goals work</summary>
          <p>
            <strong>Goals stay visible without becoming another daily task list.</strong> Use
            monthly check-ins to update success measures, and milestones only for meaningful
            checkpoints. Agree the outcome in natural language. Monthly check-ins stay informational
            unless risk or support needs manager attention.
          </p>
        </details>
      </section>

      {/*
        Only shown when there is somewhere else to go. Somebody with no reports
        has one tab, "My Goals", which selects the page they are already on —
        a whole row of vertical space spent restating the heading above it.
      */}
      {canManage && (
        <WorkspaceTabs
          label="Goal workspace"
          items={[
            { href: '/goals', label: 'My Goals', active: view === 'my' },
            {
              href: '/goals?view=team',
              label: 'My Team',
              active: view === 'team',
              attention: teamPeople.some(
                (person) => person.attentionCount > 0 || person.supportRequestCount > 0,
              ),
            },
          ]}
        />
      )}

      {view === 'my' ? (
        <section className={styles.personalWorkspace} aria-labelledby="my-goal-list">
          <header className={styles.ownerSummary}>
            <div className={styles.ownerIdentity}>
              <span className={styles.ownerAvatar} aria-hidden="true">
                {ownerInitials}
              </span>
              <div>
                {/*
                  Deliberately not "{name}'s goals": that name matched the page's
                  own <h1>Goals</h1>, so two headings answered to the same query
                  and a screen-reader user heard "Goals" twice in a row. The
                  owner is already named in the surrounding context.
                */}
                <h2 id="my-goal-list">Agreed outcomes</h2>
                <p>
                  {activeRows.length} Active goals &middot; {formalWeight}% formal weight
                </p>
              </div>
            </div>
            <div className="goal-summary-inline" aria-label="Goal summary">
              <div>
                <b>{formalWeight}%</b>Formal weight
              </div>
              <div className={attentionCount > 0 ? 'attention' : undefined}>
                <b>{attentionCount}</b>Need attention
              </div>
              <div className={updateDueCount > 0 ? 'attention' : undefined}>
                <b>{updateDueCount}</b>Update due
              </div>
            </div>
          </header>
          <div className={`goal-list-panel ${styles.goalListPanel}`}>
            {/*
              The weight bar sits with the tabs rather than on its own band.
              "30% formal weight" was being stated four times before the first
              goal — in this heading, in the summary chips, in the session
              panel's allocation line, and again here on a full-width strip of
              its own. One statement, kept where the list it governs begins.
            */}
            <FormalWeight goals={rows} plan={myPlan} />
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
                  href: lifecycleHref('draft'),
                  label: 'Draft',
                  active: lifecycle === 'draft',
                  count: lifecycleCount('draft'),
                },
                {
                  href: lifecycleHref('completed'),
                  label: 'Completed',
                  active: lifecycle === 'completed',
                  count: lifecycleCount('completed'),
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
                    <Link href={lifecycleHref('active')} className="btn">
                      Show Active Goals
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
          </div>

          {/*
            The performance period and the monthly check-in, folded away unless
            something is actually due.

            It is a once-a-month action that occupied about 180px ABOVE the
            list on every visit. Together with the intro banner, the summary and
            two rows of tabs it pushed the first goal to roughly 690px down a
            768px laptop screen: a page called Goals that showed almost no
            goals, and could only be read by zooming out.

            So it moved below the list and stays shut. The summary line carries
            the position — allocation, and whether a check-in is due — so
            nothing is hidden, only made proportionate to how often it is used.
          */}
          <details className="goal-session-disclosure">
            <summary>
              <span>Performance period and monthly check-in</span>
              <small>
                {formalWeight}% formal weight allocated
                {updateDueCount > 0
                  ? ` · ${updateDueCount} check-in${updateDueCount === 1 ? '' : 's'} due`
                  : ' · nothing due'}
              </small>
            </summary>
            <GoalSessionPanel
              ownerId={profile.id}
              activeGoals={planActiveRows}
              plan={myPlan}
              sessions={goalSessions}
              supportPeople={supportPeople}
              canSubmitMonthly
              canReviewQuarterly={canManage}
              canFinalizePlan={canManage}
              now={renderTime.toISOString()}
            />
          </details>
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
                  <GoalSetupDialog
                    owner={{
                      id: selectedPerson.userId,
                      fullName: selectedPerson.fullName,
                      employeeId: selectedPerson.employeeId,
                      activeWeight: activeWeights[selectedPerson.userId] ?? 0,
                    }}
                    canActivate
                    triggerLabel="+ Add goal"
                    returnView="team"
                  />
                  <div className="team-goal-summary">
                    <div>
                      <strong>{selectedPerson.activeGoalCount}</strong>
                      <span>Active</span>
                    </div>
                    <div>
                      <strong>{formalWeight}%</strong>
                      <span>Formal weight</span>
                    </div>
                    <div>
                      <strong>{selectedPerson.attentionCount}</strong>
                      <span>Need attention</span>
                    </div>
                  </div>
                </header>
                <GoalSessionPanel
                  ownerId={selectedPerson.userId}
                  activeGoals={planActiveRows}
                  plan={teamPlan}
                  sessions={goalSessions}
                  supportPeople={supportPeople}
                  canSubmitMonthly={false}
                  canReviewQuarterly={canManage}
                  canFinalizePlan={canManage}
                  now={renderTime.toISOString()}
                />
                <FormalWeight goals={teamGoals} plan={teamPlan} />
                <WorkspaceTabs
                  label="Goal lifecycle"
                  items={GOAL_LIFECYCLE_VIEWS.map((item) => ({
                    href: lifecycleHref(item),
                    label: GOAL_LIFECYCLE_LABELS[item],
                    active: lifecycle === item,
                    count: lifecycleCount(item),
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

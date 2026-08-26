import Link from 'next/link';

import { AgeChips } from '@/components/AgeChips';
import {
  FocusTabs,
  ProgressIndicator,
  RowPrimaryLink,
  TaskRow,
  WorkspaceTabs,
  type TabItem,
} from '@/components/ui/ParityPrimitives';
import {
  closeLayerHref,
  PERSON_LAYER_PARAMS,
  safeReturnPath,
  TASK_LAYER_PARAMS,
} from '@/domain/navigation';
import { formatDue } from '@/domain/duration';
import { availableOrder } from '@/domain/prioritisation';
import {
  FOCUS_BUCKET_LABELS,
  TASK_STATUS_LABELS,
  WORK_CLASS_LABELS,
  type FocusBucket,
  type FocusSummary,
  type TaskOverview,
} from '@/domain/types';
import { requireProfile } from '@/lib/supabase/server';
import { getTeamAttention } from '@/server/queries';
import {
  getDisplaySettings,
  getFocusSummary,
  getMyTasks,
  getRoutineOccurrences,
  getAssignablePeople,
  getSharedContributions,
  getBinnedTaskCount,
  getTeamAvailableWork,
  getTeamAvailableCount,
  getBinnedTasks,
  getTaskDetail,
  getMyAttention,
  getVisiblePeopleCount,
  getMajorProjectProposalDetail,
  getMajorProjectProposals,
  getTeamMemberDetail,
  type SharedContribution,
} from '@/server/queries';

import { BinList } from './BinList';
import { AttentionListView } from './AttentionListView';
import { MyTeamListHeader, MyTeamPersonRow } from './MyTeamPersonRow';
import { TaskActionFeedbackProvider } from './TaskActionFeedback';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { TeamMemberDrawer } from './TeamMemberDrawer';
import { WorkloadReviewPanel } from './WorkloadReviewPanel';
import { WorkProposalDrawer } from './WorkProposalDrawer';
import { TaskRowActions } from './TaskRowActions';

/**
 * Work → Focus (sections 4.4, 10; rebuilt for v40 sections 1, 9, 14, 15).
 *
 * The tabs are STATES, not work classes. Major Project, Operational Action and
 * Self-Development still exist — they are what the work *is*, and they are what
 * the 1 / 5 / 1 capacity model counts — but they were never navigation. Asking
 * someone to pick "Operational Actions" to find the thing they are carrying
 * makes them navigate the data model instead of their day.
 *
 * What a person actually asks:
 *
 *   Active     What am I carrying right now?
 *   Available  What is waiting for me to pick up?
 *   Shared     What do I owe somebody else?
 *   Routine    What repeats, and is any of it due?
 *
 * Capacity moves to a quiet strip above the tabs, where it reports the same
 * 1 / 5 / 1 figures without being a place to click.
 */

type TabKey = 'active' | 'available' | 'shared' | 'bin';

const SHORT_BUCKET_LABEL: Record<FocusBucket, string> = {
  major: 'Major',
  operational: 'Operational',
  self_development: 'Development',
};

const TAB_MEANING: Record<TabKey, string> = {
  active: 'Work you are currently carrying.',
  available: 'Valid work waiting for you to activate.',
  shared: "Work where you owe a contribution to somebody else's task.",
  bin: 'Deleted work. Nothing here counts towards anything; restore it if it was a mistake.',
};

function tasksForTab(
  tasks: readonly TaskOverview[],
  tab: TabKey,
  viewerId: string,
): TaskOverview[] {
  if (tab === 'available') {
    // Section 5 — `backlog` is presented to people as Available. The ordering is
    // the product's, not the database's: criticality first, and never "a manager
    // sent it" (v40 section 4).
    return availableOrder(tasks.filter((task) => task.status === 'backlog' && !isRoutine(task)));
  }

  return tasks.filter(
    (task) =>
      task.primaryOwnerId === viewerId &&
      (task.status === 'active' || task.status === 'paused') &&
      !isRoutine(task),
  );
}

/**
 * v41 section 10 — why a contribution is or is not startable, in the words the
 * contributor needs. The condition is decided in SQL; this only phrases it.
 */
/**
 * v45 §6 — deterministic readiness wording that names the person.
 *
 * "Waiting" alone made a contributor guess whether the hold-up was somebody
 * else, a prerequisite, or their own inaction. Naming the owner turns the
 * status into an answer: you are not blocked, Izzah has not started yet.
 */
function readinessCopy(item: SharedContribution): { label: string; note: string } {
  const ownerFirstName = item.primaryOwnerName.split(' ')[0] ?? item.primaryOwnerName;

  switch (item.readiness) {
    case 'ready':
      return { label: 'Ready', note: 'Nothing is blocking this. You can begin.' };
    case 'completed':
      return { label: 'Completed', note: 'You have finished this contribution.' };
    case 'waiting_for_owner':
      return {
        label: 'Waiting',
        note: `Waiting for ${ownerFirstName} to start this work`,
      };
    case 'waiting_parent_paused':
      return { label: 'Waiting', note: 'Waiting — the parent work is paused' };
    case 'waiting_prerequisite':
      return {
        label: 'Waiting',
        note: item.prerequisiteTitle
          ? `Waiting for: ${item.prerequisiteTitle}`
          : 'Waiting for an earlier step to finish',
      };
    default:
      return { label: 'Waiting', note: 'Not startable yet.' };
  }
}
function isRoutine(task: TaskOverview): boolean {
  return task.workClass === 'routine_occurrence';
}

/** "Major 1/1 · Operational 4/5 · Development 1/1" — reported, never a control. */
function CapacityStrip({ focus }: { focus: readonly FocusSummary[] }) {
  const order: FocusBucket[] = ['major', 'operational', 'self_development'];
  const buckets = order
    .map((bucket) => focus.find((entry) => entry.bucket === bucket))
    .filter((entry): entry is FocusSummary => Boolean(entry));

  if (buckets.length === 0) return null;

  return (
    <p className="capacity-strip" role="status">
      <span className="visually-hidden">Focus capacity: </span>
      {buckets.map((bucket, index) => (
        <span key={bucket.bucket} className={bucket.isOverTarget ? 'over' : undefined}>
          {index > 0 && <span aria-hidden="true"> · </span>}
          {SHORT_BUCKET_LABEL[bucket.bucket]}{' '}
          <b>
            {bucket.activeCount}/{bucket.recommendedTarget}
          </b>
          {bucket.isOverTarget && (
            <span className="visually-hidden">
              {' '}
              — over the recommended target, which is allowed
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    task?: string;
    /** v49 §11, §13 — full-list filtering and sorting. */
    type?: string;
    sort?: string;
    scope?: string;
    filter?: string;
    /** v46 §44 — "I was sent here to act", plus which request. */
    attention?: string;
    barrier?: string;
    /** v48 §6 — the Team Member Detail layer, and its workload review. */
    person?: string;
    review?: string;
    item?: string;
    /** v48 §8 — the screen this task was opened from. */
    from?: string;
    proposal?: string;
  }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;

  /*
   * v42 sections A and B — My Team is a view inside Work, not a separate
   * application.
   *
   * A manager's day is not divided into "my work" and "somewhere else I go to
   * manage". Team Focus keeps all of its logic; only where it is presented
   * changes, so the header, Capture and notifications stay put and switching
   * views changes the content area alone.
   */
  const isManager = profile.role === 'manager' || profile.role === 'administrator';

  /*
   * Holding the manager role is permission; having reports is a reason. A
   * manager with nobody reporting to them was being offered a My Team
   * workspace that could only ever be empty, which is one more thing to read
   * and dismiss on every visit.
   *
   * The role check stays in front of the count so that no non-manager causes
   * the extra query.
   */
  const visiblePeople = await getVisiblePeopleCount(
    profile.id,
    profile.reporting_manager_id ?? null,
  );
  /*
   * My Team exists when there is somebody else to look at, which is what
   * visibility decides — not the job title and not the reporting tree. Gated
   * on `isManager && directReports > 0`, an explicit grant gave the recipient
   * no screen to use it on.
   */
  const hasTeam = visiblePeople > 0;

  /*
   * v43 sections 2 and 3 — two different dimensions, two different controls.
   *
   * My Work / My Team is a SCOPE: whose work am I looking at. Active /
   * Available / Shared is a STATE: what is my relationship to this work.
   *
   * v42 put My Team beside Active/Available/Shared, which read as though "my
   * team" were a state my own work could be in. It sat one level too deep.
   * Scope is now chosen first, and the state tabs belong to My Work alone.
   */
  const scope: 'mine' | 'team' = params.scope === 'team' && hasTeam ? 'team' : 'mine';
  const teamFilter: 'everyone' | 'attention' | 'available' =
    params.filter === 'attention'
      ? 'attention'
      : params.filter === 'available'
        ? 'available'
        : 'everyone';

  // `?filter=attention` outside team scope means "my own full list".
  const personalAttentionView = params.filter === 'attention' && params.scope !== 'team';

  const requested = params.tab;
  const activeTab: TabKey =
    requested === 'available' ||
    requested === 'shared' ||
    requested === 'active' ||
    requested === 'bin'
      ? requested
      : 'active';

  const [
    tasks,
    focus,
    settings,
    sharedContributions,
    binnedTasks,
    binnedCount,
    routineOccurrences,
    taskDetail,
    memberDetail,
    myAttention,
    assignablePeople,
    team,
    proposals,
    proposalDetail,
    teamAvailable,
    teamAvailableCount,
  ] = await Promise.all([
    getMyTasks(profile.id),
    getFocusSummary(profile.id),
    getDisplaySettings(),
    // Shared reads the ORIGINAL checklist items, not copies of them
    // (v41 section 23).
    getSharedContributions(profile.id),
    // Only when the Bin is open: deleted work is not part of anybody's day.
    params.tab === 'bin'
      ? getBinnedTasks(profile.id)
      : Promise.resolve({ tasks: [], failed: false }),
    // The count, always. It used to come from the list above, which is fetched
    // only when the Bin is already open — so the badge read 0 on every other
    // tab and became correct only once you had clicked it. A badge that is
    // right only after you look is worse than none at all.
    getBinnedTaskCount(profile.id),
    getRoutineOccurrences(profile.id),
    params.task ? getTaskDetail(params.task, profile.id) : Promise.resolve(null),
    // §60 — the id in the URL is a request, not an authorisation. The query is
    // bounded by the same visibility rules the list is, and returns nothing for
    // somebody outside this manager's scope.
    params.person && hasTeam
      ? getTeamMemberDetail(profile.id, params.person)
      : Promise.resolve(null),
    personalAttentionView ? getMyAttention(profile.id) : Promise.resolve([]),
    // Scoped by the viewer's own visibility, not the whole organisation
    // (v42 sections G, S).
    params.task ? getAssignablePeople(params.task) : Promise.resolve([]),
    // Reused wholesale from Team Focus. Nothing about who needs attention
    // changes — only where a manager reads it.
    // One query answering all three manager questions. It aggregates the
    // authoritative records — tasks, barriers, routines, focus counts — and
    // copies none of them (v44 sections 18, 32).
    hasTeam ? getTeamAttention(profile.id) : Promise.resolve([]),
    getMajorProjectProposals(),
    params.proposal ? getMajorProjectProposalDetail(params.proposal) : Promise.resolve(null),
    // What everybody the viewer can see already has waiting. Only when asked
    // for: it is a manager's planning view, not part of anybody's own day.
    scope === 'team' && teamFilter === 'available'
      ? getTeamAvailableWork(profile.id)
      : Promise.resolve({ groups: [], failed: false }),
    // This badge only exists inside Team scope. Loading it in My Work added a
    // count request whose result was never rendered.
    scope === 'team' ? getTeamAvailableCount(profile.id) : Promise.resolve(0),
  ]);

  const visible =
    activeTab === 'shared' || activeTab === 'bin' ? [] : tasksForTab(tasks, activeTab, profile.id);
  const overTarget = focus.filter((bucket) => bucket.isOverTarget);

  // Section 9 of v40 — a bare number tells nobody what it counts. Routine is
  // badged by what needs doing, not by how many occurrences exist.
  const routineDue = routineOccurrences.filter(
    (task) => task.status !== 'completed' && (task.isOverdue || isDueToday(task, profile.timezone)),
  );
  const routineOverdue = routineDue.filter((task) => task.isOverdue);

  const openContributions = sharedContributions.filter((item) => item.state !== 'completed');

  // The query decides who needs attention, because only it can also say why
  // and where. A row that cannot answer those does not appear as actionable
  // (v44 section 19).
  const teamNeedingAttention = team.filter((person) => person.attention !== null);
  const pendingManagerProposals = proposals.filter(
    (proposal) =>
      isManager && proposal.proposedById !== profile.id && proposal.status === 'pending',
  );
  const myOpenProposals = proposals.filter(
    (proposal) =>
      proposal.proposedById === profile.id &&
      (proposal.status === 'pending' || proposal.status === 'changes_requested'),
  );
  const teamAttentionCount = teamNeedingAttention.length + pendingManagerProposals.length;

  const counts: Record<TabKey, number> = {
    active: tasksForTab(tasks, 'active', profile.id).length,
    available: tasksForTab(tasks, 'available', profile.id).length,
    shared: openContributions.length,
    bin: binnedCount,
  };

  // Section 35 — Everyone by default, but people who need something first.
  // A manager should see normal activity AND exceptions, not have to choose.
  const now = new Date();

  const teamRows = (teamFilter === 'attention' ? teamNeedingAttention : team)
    .slice()
    .sort((left, right) => {
      // Section 35 — Everyone by default, but people who need something first.
      const leftNeeds = left.attention ? 0 : 1;
      const rightNeeds = right.attention ? 0 : 1;
      if (leftNeeds !== rightNeeds) return leftNeeds - rightNeeds;
      return left.fullName.localeCompare(right.fullName);
    });

  /*
   * v46 §9, §45 — resolve what the person was sent here to do.
   *
   * A current notification names its barrier. Older ones recorded only the
   * task, and those links still exist in inboxes, so fall back to the
   * recipient's own outstanding request on this task — but only when there is
   * exactly one. Guessing between two would put the wrong decision form in
   * front of somebody, which is worse than opening the task normally.
   */
  const attentionBarrierId =
    params.attention === 'barrier' && taskDetail
      ? (params.barrier ??
        (() => {
          const mine = taskDetail.barriers.filter(
            (barrier) =>
              barrier.status === 'open' &&
              barrier.actionPending &&
              barrier.actionRequiredFromViewer,
          );
          return mine.length === 1 ? mine[0]!.id : null;
        })())
      : null;

  return (
    <TaskActionFeedbackProvider>
      <div className="pagehead" data-task-feedback-page-anchor tabIndex={-1}>
        <div>
          <p className="eyebrow">Work</p>
          {/* One Work shell; the heading follows the view rather than the view
              becoming another page (v42 section A). */}
          <h1>{scope === 'team' ? 'My Team' : 'My Work'}</h1>
          <p>
            {scope === 'team'
              ? 'What your people are working on, where they need you, and what changed.'
              : 'One workspace for focused commitments and repeating responsibilities.'}
          </p>
        </div>
        <div className="actions">
          <Link href="/capture" className="btn primary">
            New Work
          </Link>
        </div>
      </div>

      {hasTeam && (
        <WorkspaceTabs
          label="Work scope"
          items={[
            { href: '/work', label: 'My Work', active: scope === 'mine' },
            {
              href: '/work?scope=team',
              label: 'My Team',
              active: scope === 'team',
              count: teamAttentionCount,
              attention: teamAttentionCount > 0,
            },
          ]}
        />
      )}

      {scope === 'mine' && (
        <WorkspaceTabs
          items={[
            {
              href: '/work',
              label: 'Focus',
              active: true,
              count: `${counts.active} active`,
            },
            {
              href: '/work/routine',
              label: 'Routine',
              count:
                routineOverdue.length > 0
                  ? `${routineOverdue.length} overdue`
                  : routineDue.length > 0
                    ? `${routineDue.length} due`
                    : 'none due',
              attention: routineOverdue.length > 0,
            },
          ]}
        />
      )}

      {/* Capacity is reported here rather than being something to navigate. The
          work classes it counts are unchanged; only their role in the interface
          is (v40 section 1). */}
      {scope === 'mine' && <CapacityStrip focus={focus} />}

      {scope === 'team' && pendingManagerProposals.length > 0 && (
        <section className="proposal-inbox" aria-labelledby="proposal-inbox-heading">
          <header>
            <div>
              <p className="eyebrow">Decisions</p>
              <h2 id="proposal-inbox-heading">Major Projects for discussion</h2>
              <p>Agree, request changes or decline. Agreed work starts in Available.</p>
            </div>
            <span className="count-badge">{pendingManagerProposals.length}</span>
          </header>
          <div className="proposal-list">
            {pendingManagerProposals.map((proposal) => (
              <article key={proposal.id} className="proposal-row interactive-row">
                <div>
                  <RowPrimaryLink
                    href={`/work?scope=team&proposal=${proposal.id}`}
                    ariaLabel={`Review Major Project proposal ${proposal.title}`}
                  >
                    <strong>{proposal.title}</strong>
                  </RowPrimaryLink>
                  <span className="sub">
                    Proposed by {proposal.proposedByName} &middot; Needs your decision
                  </span>
                </div>
                <Link
                  href={`/work?scope=team&proposal=${proposal.id}`}
                  className="btn small primary"
                >
                  Review
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {scope === 'mine' && myOpenProposals.length > 0 && (
        <section className="proposal-inbox compact" aria-labelledby="my-proposals-heading">
          <header>
            <div>
              <p className="eyebrow">Major Project proposals</p>
              <h2 id="my-proposals-heading">Discussion status</h2>
            </div>
          </header>
          <div className="proposal-list">
            {myOpenProposals.map((proposal) => (
              <article key={proposal.id} className="proposal-row interactive-row">
                <div>
                  <RowPrimaryLink
                    href={`/work?proposal=${proposal.id}`}
                    ariaLabel={`Open Major Project proposal ${proposal.title}`}
                  >
                    <strong>{proposal.title}</strong>
                  </RowPrimaryLink>
                  <span className="sub">
                    {proposal.status === 'changes_requested'
                      ? 'Changes requested — revise and send again'
                      : 'Waiting for manager discussion'}
                  </span>
                </div>
                <Link href={`/work?proposal=${proposal.id}`} className="btn small">
                  {proposal.status === 'changes_requested' ? 'Revise' : 'Open'}
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {/*
        v49 §9-13 — the full personal attention list.

        The summary on My Day answers "what first"; this answers "show me
        everything", which is a different question and belongs where lists
        live. Reusing the Work shell rather than adding a module keeps the
        backlog one navigation step from the summary and none from the work it
        concerns.
      */}
      {scope === 'mine' && personalAttentionView ? (
        <AttentionListView
          items={myAttention}
          activeType={params.type ?? 'all'}
          sort={
            params.sort === 'newest' ? 'newest' : params.sort === 'priority' ? 'priority' : 'oldest'
          }
          timeZone={profile.timezone}
          now={now}
        />
      ) : scope === 'mine' ? (
        <>
          <FocusTabs
            label="Focus states"
            items={(['active', 'available', 'shared', 'bin'] as TabKey[]).map(
              (key) =>
                ({
                  href: key === 'active' ? '/work' : `/work?tab=${key}`,
                  label:
                    key === 'active'
                      ? 'Active'
                      : key === 'available'
                        ? 'Available'
                        : key === 'shared'
                          ? 'Shared'
                          : 'Bin',
                  active: key === activeTab,
                  count: counts[key],
                }) satisfies TabItem,
            )}
          />
          <p className="focus-tab-meaning">{TAB_MEANING[activeTab]}</p>
        </>
      ) : (
        <FocusTabs
          label="Team filter"
          items={[
            {
              href: '/work?scope=team',
              label: 'Everyone',
              active: teamFilter === 'everyone',
              count: team.length,
            },
            {
              href: '/work?scope=team&filter=attention',
              label: 'Needs attention',
              active: teamFilter === 'attention',
              count: teamNeedingAttention.length,
              attention: teamNeedingAttention.length > 0,
            },
            {
              // What is already waiting on each person. A manager could see
              // that somebody had five Available items and not what any of
              // them were, so the question asked before handing out more work
              // had no answer in the product.
              href: '/work?scope=team&filter=available',
              label: 'Available work',
              active: teamFilter === 'available',
              count: teamAvailableCount,
            },
          ]}
        />
      )}

      {/* Section 7.4 — over target is shown in red AND in words, and is never a
          block. It belongs to the whole page now that no tab is a bucket. */}
      {overTarget.map((bucket) => (
        <div key={bucket.bucket} className="notice error" role="status" style={{ marginTop: 14 }}>
          <strong>
            Over focus target on {FOCUS_BUCKET_LABELS[bucket.bucket]} — {bucket.activeCount} /{' '}
            {bucket.recommendedTarget}
          </strong>
          <p>
            You are carrying more than the recommended target. This is allowed. Your manager can see
            the reason you recorded.
          </p>
        </div>
      ))}

      {scope === 'team' && teamFilter === 'available' && (
        <div className="focus-panel">
          <p className="focus-tab-meaning">
            Work waiting to be picked up, grouped by the person who owns it. Your own Available work
            stays under My Work.
          </p>
          {teamAvailable.failed ? (
            <div className="notice error" role="alert">
              <strong>Team Available work could not be loaded</strong>
              <p>
                Refresh the page, and tell an administrator if it persists. This is not a statement
                that nobody has anything waiting.
              </p>
            </div>
          ) : teamAvailable.groups.length === 0 ? (
            <div className="empty-state">
              <h3>Nobody has Available work waiting</h3>
              <p>Everything visible to you has been activated, completed or not yet created.</p>
            </div>
          ) : (
            teamAvailable.groups.map((group) => (
              <section key={group.ownerId} className="team-available-group">
                <header>
                  <strong>{group.ownerName}</strong>
                  <span className="muted">{group.tasks.length} waiting</span>
                  <Link href={`/work?scope=team&filter=available&person=${group.ownerId}`}>
                    Open person
                  </Link>
                </header>
                <ul className="team-available-list">
                  {group.tasks.map((task) => (
                    <li key={task.id} className="team-available-row">
                      <RowPrimaryLink href={`/work?scope=team&filter=available&task=${task.id}`}>
                        {task.title}
                      </RowPrimaryLink>
                      <span className="muted">
                        {WORK_CLASS_LABELS[task.workClass]}
                        {task.dueAt ? ` · ${formatDue(task.dueAt, task.dueIsDateOnly)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}

      {scope === 'team' && teamFilter !== 'available' && (
        <div className="focus-panel">
          {teamRows.length > 0 ? (
            <>
              <MyTeamListHeader />
              {teamRows.map((person) => (
                <MyTeamPersonRow
                  key={person.userId}
                  person={person}
                  filter={teamFilter}
                  nowIso={now.toISOString()}
                />
              ))}
            </>
          ) : (
            <div className="empty-state">
              <h3>No team items currently need your attention</h3>
              <p>
                No barriers addressed to you, overdue work, pending decisions or stalled items.
                Normal work stays quiet here on purpose.
              </p>
              <Link href="/work?scope=team" className="btn">
                See everyone
              </Link>
            </div>
          )}
        </div>
      )}

      {scope === 'mine' && (
        <div className="focus-panel">
          {activeTab === 'bin' ? (
            <BinList tasks={binnedTasks.tasks} failed={binnedTasks.failed} />
          ) : activeTab === 'shared' ? (
            openContributions.length > 0 ? (
              openContributions.map((item) => {
                const copy = readinessCopy(item);
                return (
                  <TaskRow key={item.checklistItemId}>
                    <div>
                      <RowPrimaryLink
                        href={`/work?tab=shared&task=${item.taskId}`}
                        className="title-link"
                        ariaLabel={`Open ${item.parentTitle}, which contains your step ${item.title}`}
                      >
                        <strong>{item.title}</strong>
                      </RowPrimaryLink>
                      <span className="sub">
                        Your step on <b>{item.parentTitle}</b> · Owned by {item.primaryOwnerName}
                      </span>
                      <span className="sub">
                        {copy.note}
                        {item.readiness === 'waiting_prerequisite' &&
                          item.prerequisiteTitle &&
                          ` (${item.prerequisiteTitle})`}
                        {item.evidenceRule === 'required' && ' · Evidence required'}
                      </span>
                    </div>

                    <div className="hide-mobile">
                      <span
                        className={`status ${item.readiness === 'ready' ? 'active' : 'backlog'}`}
                      >
                        {copy.label}
                      </span>
                      <div className="sub" style={{ marginTop: 4 }}>
                        {formatDue(
                          item.itemDueAt ?? item.parentDueAt,
                          item.itemDueAt ? true : item.parentDueIsDateOnly,
                          profile.timezone,
                        )}
                      </div>
                    </div>

                    <div className="hide-narrow" />

                    <div className="row-action">
                      <Link
                        href={`/work?tab=shared&task=${item.taskId}`}
                        className={`btn small${item.readiness === 'ready' ? ' primary' : ''}`}
                      >
                        Open
                      </Link>
                    </div>
                  </TaskRow>
                );
              })
            ) : (
              <div className="empty-state">
                <h3>Nothing is shared with you</h3>
                <p>
                  Shared holds checklist steps on other people&rsquo;s work that have been assigned
                  to you. They appear here as soon as somebody assigns you one — you never create
                  them yourself.
                </p>
              </div>
            )
          ) : visible.length > 0 ? (
            visible.map((task) => (
              <TaskRow key={task.id}>
                <div>
                  <RowPrimaryLink
                    href={`/work?tab=${activeTab}&task=${task.id}`}
                    className="title-link"
                    returnFocusId={`task-${task.id}`}
                    ariaLabel={`Open ${task.title}`}
                  >
                    <strong>{task.title}</strong>
                  </RowPrimaryLink>
                  <span className="sub">
                    {/* The work class stays visible on the row — it is what the
                      work IS. It just is not how you got here. */}
                    {WORK_CLASS_LABELS[task.workClass]}
                    {task.assignedByName && ` · Assigned by ${task.assignedByName.split(' ')[0]}`}
                    {task.urgency === 'high' && ' · High'}
                    {task.urgency === 'critical' && ' · Critical'}
                    {task.reviewAt &&
                      ` · Review by ${formatDue(task.reviewAt, true, profile.timezone)}`}
                    {task.openBarrierCount > 0 && ' · Barrier open'}
                    {task.isMandatory && ' · Mandatory'}
                  </span>
                  {/*
                  v41 sections 11 and 12. Active work answers "what do I do
                  next?", so it shows the Next action. Available answers "should
                  I start carrying this?", which no sentence can answer for you —
                  so it states what Available means and offers Activate instead
                  of an invented instruction.
                */}
                  {task.status === 'backlog' ? (
                    <span className="sub available-note">
                      Valid work that is not yet part of your Active focus.
                    </span>
                  ) : task.nextAction ? (
                    <span className="sub">Next action: {task.nextAction}</span>
                  ) : (
                    <span className="sub muted">No next action recorded</span>
                  )}
                  <div style={{ marginTop: 6 }}>
                    <AgeChips task={task} staleThresholdDays={settings.staleThresholdDays} />
                  </div>
                </div>

                <div className="hide-mobile">
                  <span className={`status ${task.status}`}>{TASK_STATUS_LABELS[task.status]}</span>
                  <div className="sub" style={{ marginTop: 4 }}>
                    {formatDue(task.dueAt, task.dueIsDateOnly, profile.timezone)}
                  </div>
                </div>

                <div className="hide-narrow">
                  <ProgressIndicator
                    value={task.progressPercent}
                    label={
                      task.checklistTotal > 0
                        ? `${task.checklistCompleted} of ${task.checklistTotal} steps`
                        : `${task.progressPercent}% complete`
                    }
                  />
                </div>

                <TaskRowActions
                  taskId={task.id}
                  title={task.title}
                  status={task.status}
                  version={task.version}
                  bucket={task.focusBucket}
                  isMandatory={task.isMandatory}
                  openHref={`/work?tab=${activeTab}&task=${task.id}`}
                />
              </TaskRow>
            ))
          ) : (
            /* Section 27.2 — what is empty, why, and the next useful action. */
            <div className="empty-state">
              <h3>Nothing here yet</h3>
              <p>
                {/* Shared has its own empty state above, because it is a
                  projection rather than a task list. */}
                {activeTab === 'available'
                  ? 'Available is valid work you have not started yet. Capture something, or ask your manager what is waiting.'
                  : 'You are not carrying anything right now. Activate something from Available when you are ready.'}
              </p>
              <Link
                href={activeTab === 'available' ? '/capture' : '/work?tab=available'}
                className="btn"
              >
                {activeTab === 'available' ? 'New Work' : 'View Available'}
              </Link>
            </div>
          )}
        </div>
      )}

      {/*
        §35 — the person drawer sits under the task drawer, so closing the task
        reveals the person again rather than the list.
      */}
      {/*
        §21-22 — the destination the "Review workload" CTA promises. Opened by
        `review=workload` on top of the person it concerns, so closing it
        reveals them rather than dropping the manager back to the list.
      */}
      {memberDetail && params.review === 'workload' && (
        <WorkloadReviewPanel
          detail={memberDetail}
          closeHref={closeLayerHref('/work', params, ['review'])}
        />
      )}

      {memberDetail && (
        <TeamMemberDrawer
          detail={memberDetail}
          closeHref={closeLayerHref('/work', params, [
            ...PERSON_LAYER_PARAMS,
            ...TASK_LAYER_PARAMS,
          ])}
          taskHrefBase={closeLayerHref('/work', params, [...TASK_LAYER_PARAMS])}
          timeZone={profile.timezone}
          now={now}
        />
      )}

      {taskDetail && (
        <TaskDetailDrawer
          detail={taskDetail}
          /*
           * v48 §2, §4 — close returns one layer, to wherever this was opened
           * from. This used to be a hardcoded `/work`, so a manager who opened
           * a team member's task from My Team was returned to My Work — a
           * different person's workspace, with the filter and the person they
           * had selected both gone.
           */
          /*
           * §8 — a task opened from Plan, Routine, the audit log or My Day
           * closes back to that screen. Without the origin the drawer can only
           * fall back to My Work, which moved people to a different workspace
           * for the crime of opening one record.
           */
          closeHref={safeReturnPath(
            params.from,
            closeLayerHref('/work', params, [...TASK_LAYER_PARAMS, 'from']),
          )}
          timeZone={profile.timezone}
          staleThresholdDays={settings.staleThresholdDays}
          assignablePeople={assignablePeople}
          viewerId={profile.id}
          attentionBarrierId={attentionBarrierId}
        />
      )}

      {proposalDetail && (
        <WorkProposalDrawer
          proposal={proposalDetail}
          closeHref={scope === 'team' ? '/work?scope=team' : '/work'}
        />
      )}
    </TaskActionFeedbackProvider>
  );
}

/** Whether a routine occurrence falls on the viewer's local today. */
function isDueToday(task: TaskOverview, timeZone: string): boolean {
  if (!task.occurrenceDate) return false;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return task.occurrenceDate === today;
}

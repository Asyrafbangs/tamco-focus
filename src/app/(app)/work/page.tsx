import type { ReactNode } from 'react';

import Link from 'next/link';

import { MenuDropdown } from '@/components/ui/MenuDropdown';
import { PeriodPicker } from '@/components/ui/PeriodPicker';
import {
  EmptyState,
  FocusTabs,
  RowPrimaryLink,
  TaskRow,
  WorkspaceTabs,
  type TabItem,
} from '@/components/ui/ParityPrimitives';
import { closeLayerHref, safeReturnPath, TASK_LAYER_PARAMS } from '@/domain/navigation';
import { formatDue, formatDueShort, localDateString, overdueAgeMs } from '@/domain/duration';
import { DELIVERY_KIND_WORD } from '@/domain/delivery';
import {
  DEFAULT_PERIOD,
  periodParams,
  resolvePeriod,
  STANDARD_PERIODS,
  type ResolvedPeriod,
} from '@/domain/period';
import { activeOrder, availableOrder, teamRowOrder } from '@/domain/prioritisation';
import { WORK_PURPOSE_SHORT_LABELS } from '@/domain/purpose';
import { WORK_CLASS_LABELS, WORK_CLASS_SHORT_LABELS, type TaskOverview } from '@/domain/types';
import { requireProfile } from '@/lib/supabase/server';
import { getTeamAttention } from '@/server/queries';
import {
  getDisplaySettings,
  getMyCompletedWork,
  getMyTasks,
  getRoutineOccurrences,
  getAssignablePeople,
  getSharedContributions,
  getBinnedTaskCount,
  getCurrentFocus,
  getCurrentWeekStart,
  getWeeklyCommitments,
  getTeamAvailableWork,
  getTeamAvailableCount,
  getBinnedTasks,
  getTaskDetail,
  getMyAttention,
  getVisiblePeopleCount,
  getMajorProjectProposalDetail,
  getMajorProjectProposals,
  getTeamDeliveredWork,
  getTeamDeliveryCount,
  getTeamMemberDetail,
  type CompletedRecord,
  type SharedContribution,
} from '@/server/queries';

import { BinList } from './BinList';
import { AttentionListView } from './AttentionListView';
import { MyTeamListHeader, MyTeamPersonRow } from './MyTeamPersonRow';
import { MyTeamPersonPanel } from './MyTeamPersonPanel';
import { WeeklyPriorities } from './WeeklyPriorities';
import { TaskActionFeedbackProvider } from './TaskActionFeedback';
import { TaskDetailDrawer } from './TaskDetailDrawer';
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

type TabKey = 'active' | 'available' | 'shared' | 'completed' | 'bin';

/*
 * Four working states and one utility.
 *
 * Active, Available, Shared and Completed all answer "where is my work?".
 * The Bin answers "where did a deleted record go?", which is administration,
 * not a state work is in - so it sits under More rather than taking a fifth
 * place in the row and giving deletion the same weight as delivery.
 */
const WORK_STATE_TABS: TabKey[] = ['active', 'available', 'shared', 'completed'];

const TAB_LABEL: Record<TabKey, string> = {
  active: 'Active',
  available: 'Available',
  shared: 'Shared',
  completed: 'Completed',
  bin: 'Bin',
};

/**
 * Names in a sentence: "Amer Hakim, Lim Wei Sheng and Temporary Tester".
 *
 * `Intl.ListFormat` rather than `join(', ')`, so the last name is joined the
 * way the line is read aloud and a list of one is simply the name.
 */
/** A plain day, in the reader's zone: "Set 4 Sep", never "Set 3 hours ago". */
function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(iso),
  );
}

/*
  §6 — how many people can be held open at once.

  Three pinned plus the current one. Comparison is the reason Keep open exists,
  and comparison is between two or three people; past that a manager is reading
  a page rather than comparing, and the page is paying for four more detail
  queries to do it.
*/
const MAX_KEPT_PEOPLE = 3;

/** Anything arriving in `?person=` or `?kept=` that is not this is not asked about. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NAME_LIST = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });
const nameList = (names: string[]) => NAME_LIST.format(names);

const TAB_MEANING: Record<TabKey, string> = {
  active: 'Work you are currently carrying.',
  available: 'Valid work waiting for you to start.',
  shared: "Work where you owe a contribution to somebody else's task.",
  completed: 'Your finished work and contributions.',
  bin: 'Deleted work. Nothing here counts towards anything; restore it if it was a mistake.',
};

/**
 * The only things worth shouting about on a row.
 *
 * Every row used to carry its status, two ages and a progress bar, so nothing
 * stood out and the late work looked exactly like the rest. A flag appears
 * only when the work is not proceeding normally; quiet rows are what make a
 * loud one mean something.
 */
/**
 * The date, in the words this row should say.
 *
 * One slot, three states. Ordinary work states when it is due; work that is
 * late or due today says that instead, in the same position, so the eye lands
 * on the same spot in every row and only the tone changes.
 *
 * It used to be two things at once: a date on the left and a coloured chip on
 * the far right. An overdue row therefore announced the fact twice, in two
 * places, in two vocabularies — "27 Aug 2026" and "Overdue 4 days" — and the
 * reader had to put them together themselves.
 */
function dueSignal(
  task: TaskOverview,
  timeZone: string,
  now: Date,
): { label: string; tone: 'late' | 'today' | 'plain' } | null {
  if (task.isOverdue) {
    const days = Math.floor(overdueAgeMs(task, now) / 86_400_000);
    return {
      label: days >= 1 ? `Overdue ${days} day${days === 1 ? '' : 's'}` : 'Overdue',
      tone: 'late',
    };
  }
  if (isDueToday(task, timeZone)) return { label: 'Due today', tone: 'today' };
  if (!task.dueAt) return null;
  return {
    label: `Due ${formatDueShort(task.dueAt, task.dueIsDateOnly, timeZone, now)}`,
    tone: 'plain',
  };
}

/**
 * What is abnormal about this work, beyond its date.
 *
 * Deliberately not "what is true about this work". A row that reports Active
 * on the Active tab, or On track on everything that is fine, teaches people to
 * stop reading rows — and then the one that says something real is skipped
 * with the rest.
 */
function exceptionFlags(task: TaskOverview, timeZone: string): { label: string; tone: string }[] {
  const flags: { label: string; tone: string }[] = [];

  if (task.isMandatory) flags.push({ label: 'Mandatory', tone: 'red' });
  if (task.openBarrierCount > 0) flags.push({ label: 'Waiting on a decision', tone: 'amber' });
  if (task.urgency === 'critical') flags.push({ label: 'Critical', tone: 'red' });
  else if (task.urgency === 'high') flags.push({ label: 'High', tone: 'amber' });
  if (task.reviewAt) {
    // Short, like every other date on the row. "Review by 10 Sept 2026" was
    // the widest thing in a chip meant to be glanced at.
    flags.push({
      label: `Review by ${formatDueShort(task.reviewAt, true, timeZone)}`,
      tone: 'amber',
    });
  }

  return flags;
}

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

  /*
   * Active had no order of its own, so it arrived however the query returned
   * it and the late work could be anywhere in the list. Overdue first, then
   * due today, then nearest — automatically, because nobody should have to
   * configure a sort to find what has slipped.
   */
  return activeOrder(
    tasks.filter(
      (task) =>
        task.primaryOwnerId === viewerId &&
        (task.status === 'active' || task.status === 'paused') &&
        !isRoutine(task),
    ),
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
/**
 * "Other active work", collapsed (§9).
 *
 * §9 puts the current focus and the week's agreed results above this list and
 * says the list itself starts collapsed with an accurate count. The reasoning
 * is that a list of everything running is a reference, and the two things
 * above it are the answer — a page that opens with fourteen rows makes the
 * reader find the answer rather than read it.
 *
 * The count and the overdue figure live on the summary so a collapsed section
 * is never silent about something late, which §9 asks for by name.
 *
 * It opens by default only when there is nothing above it. An employee with no
 * current focus and no agreed priorities would otherwise land on a page of
 * three empty statements and a closed disclosure, and A04 requires that work
 * can continue.
 */
function WorkListShell({
  collapsible,
  count,
  overdue,
  openByDefault,
  children,
}: {
  collapsible: boolean;
  count: number;
  overdue: number;
  openByDefault: boolean;
  children: ReactNode;
}) {
  if (!collapsible) return <>{children}</>;

  return (
    <details className="other-active" open={openByDefault} data-testid="other-active-work">
      <summary>
        <span>Other active work</span>
        <span className="other-active-count">{count}</span>
        {overdue > 0 && <span className="other-active-overdue tone-red">{overdue} overdue</span>}
      </summary>
      {children}
    </details>
  );
}

function isRoutine(task: TaskOverview): boolean {
  return task.workClass === 'routine_occurrence';
}

/**
 * One person's finished work, owned and contributed, newest first.
 *
 * Two controls and no more. Everything here is completed, so there is nothing
 * to filter by status; everything is sorted newest first, so there is nothing
 * to sort by. What is left is the only two questions somebody actually asks of
 * their own history: whose work was it, and how far back am I looking.
 *
 * The count belongs here rather than on the tab. "Completed 846" is furniture;
 * "12 items" answers what the filter just did.
 */
/** §10 — whose delivery is being listed. `received` is context, not credit. */
type CompletedScope = 'all' | 'owned' | 'routine' | 'contribution' | 'received';

function CompletedHistory({
  records,
  failed,
  scope,
  period,
  timeZone,
  now,
}: {
  records: CompletedRecord[];
  failed: boolean;
  scope: CompletedScope;
  period: ResolvedPeriod;
  timeZone: string;
  now: Date;
}) {
  if (failed) {
    return (
      <EmptyState title="Completed work is unavailable">
        <p>The history could not be read just now. Try again in a moment.</p>
      </EmptyState>
    );
  }

  /*
   * §10 — "All" is this person's own delivery.
   *
   * What a colleague finished on their task is context, and it is reachable
   * under its own heading; folding it into All would put somebody else's work
   * in the middle of a list read as "what I got done", which is the exact
   * mis-crediting §10 forbids.
   */
  const shown = records.filter((record) =>
    scope === 'all' ? record.kind !== 'received' : record.kind === scope,
  );
  const scopeHref = (next: CompletedScope) => {
    const query = new URLSearchParams({ tab: 'completed', ...periodParams(period) });
    if (next !== 'all') query.set('show', next);
    return `/work?${query.toString()}`;
  };
  const formatDay = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone,
        }).format(new Date(iso))
      : 'date not recorded';

  return (
    <div className="completed-history">
      <div className="completed-controls">
        <div className="segmented" role="group" aria-label="Whose work">
          {(
            [
              ['all', 'All'],
              ['owned', 'My work'],
              // §20 counts three delivery types and this is one of them: ten
              // scheduled checks and one Major Project are not the same thing.
              ['routine', 'Routine'],
              ['contribution', 'My contributions'],
              // Not "my" anything: this is what other people finished.
              ['received', 'On my work'],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={scopeHref(key)}
              className={scope === key ? 'active' : undefined}
              aria-current={scope === key ? 'true' : undefined}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* The same control My Team, Routine and Records use. It was written
            here first and stayed here, which is how the other three ended up
            with three different answers to one question. */}
        <PeriodPicker
          action="/work"
          hidden={{ tab: 'completed', ...(scope !== 'all' ? { show: scope } : {}) }}
          presets={STANDARD_PERIODS}
          period={period}
          now={now}
        />
      </div>

      <p className="completed-count" role="status">
        {shown.length} {shown.length === 1 ? 'item' : 'items'}
      </p>

      {shown.length === 0 ? (
        <EmptyState title="Nothing completed in this period" compact>
          <p>Widen the period, or change whose work you are looking at.</p>
        </EmptyState>
      ) : (
        <div className="completed-list">
          {shown.map((record) => (
            <Link
              key={record.key}
              href={`/work?tab=completed&task=${record.taskId}`}
              className="completed-row"
            >
              <span className="completed-tick" aria-hidden="true">
                ✓
              </span>
              <span className="completed-copy">
                <strong>{record.title}</strong>
                {record.kind === 'routine' ? (
                  /*
                    §20 — a repeated occurrence is identified by its date and
                    the area it was recorded in. "Weekly workplace safety walk"
                    on its own names fifty-two different events.
                  */
                  <span>
                    Routine
                    {record.occurrenceDate
                      ? ` · ${formatDue(record.occurrenceDate, true, timeZone)}`
                      : ''}
                    {record.area ? ` · ${record.area}` : ''}
                  </span>
                ) : record.kind === 'owned' ? (
                  <span>
                    My work
                    {record.workClass ? ` · ${WORK_CLASS_LABELS[record.workClass]}` : ''}
                  </span>
                ) : record.kind === 'contribution' ? (
                  <span>
                    My contribution
                    {record.parentTitle ? ` · in ${record.parentTitle}` : ''}
                    {record.parentOwnerName ? ` · owned by ${record.parentOwnerName}` : ''}
                  </span>
                ) : (
                  /*
                    §10 — named, and named as theirs. "Completed on my work"
                    without a person would read as something the owner did.
                  */
                  <span>
                    {record.contributorName
                      ? `Completed by ${record.contributorName}`
                      : 'Completed by a colleague'}
                    {record.parentTitle ? ` · in ${record.parentTitle}` : ''}
                  </span>
                )}
                <span className="completed-when">
                  Completed {formatDay(record.completedAt)}
                  {/* §20 — each record says how much proof it carries, so a
                      manager reading a year-end review can see there is
                      something to open before opening it. */}
                  {record.evidenceCount > 0
                    ? ` · ${record.evidenceCount} attachment${record.evidenceCount === 1 ? '' : 's'}`
                    : ''}
                </span>
              </span>
              <span className="completed-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
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
    /** v156 — the step to open the task at, from the Monthly Plan. */
    step?: string;
    /**
     * §6 — who is expanded in My Team.
     *
     * `person` is the current expansion and is replaced when another is
     * opened; `kept` is the comma-separated list a manager has pinned through
     * "Keep open" so two people can be compared. Both are in the URL so an
     * expansion survives opening a task, a reload and a shared link.
     */
    person?: string;
    kept?: string;
    item?: string;
    /** v48 §8 — the screen this task was opened from. */
    from?: string;
    proposal?: string;
    /** Completed only: whose work is being listed. */
    show?: string;
    /**
     * The reporting period, shared by Completed and My Team.
     *
     * One name because it is one question. My Team used to call it `delivery`
     * and Completed called its dates `from_date` / `to_date`, so the two
     * halves of this page disagreed about how to say the same thing. The dates
     * are `period_*` because `from` above already means something else here.
     */
    period?: string;
    period_from?: string;
    period_to?: string;
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
  /*
   * A link that names a person is a team link.
   *
   * `person` used to open a drawer over whatever was underneath, so the scope
   * it arrived with did not matter. §6 makes it an expansion inside the list,
   * which only exists on Team — so an older link, a notification or a bookmark
   * carrying `?person=` has to land on the view that can show it, and on a
   * filter that renders the people rather than their queued or closed work.
   */
  const namesPerson = Boolean(params.person) && hasTeam;
  const scope: 'mine' | 'team' =
    (params.scope === 'team' || namesPerson) && hasTeam ? 'team' : 'mine';
  const teamFilter: 'everyone' | 'attention' | 'available' | 'delivered' =
    params.filter === 'attention'
      ? 'attention'
      : namesPerson
        ? 'everyone'
        : params.filter === 'available'
          ? 'available'
          : params.filter === 'delivered'
            ? 'delivered'
            : 'everyone';

  // `?filter=attention` outside team scope means "my own full list".
  const personalAttentionView = params.filter === 'attention' && params.scope !== 'team';

  /*
   * §6 — who is expanded, and how many people that is allowed to be.
   *
   * One person at a time by default; `kept` holds the ones pinned for
   * comparison. The cap is on the URL rather than on the control, because the
   * list is what bounds the work: every expanded person costs a detail query,
   * and `?kept=` arrives from the address bar where nobody clicked anything.
   * Anything that is not a uuid is dropped rather than sent to the database.
   */
  const keptIds = (params.kept ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => UUID_PATTERN.test(id))
    .slice(0, MAX_KEPT_PEOPLE);
  const expandedIds = hasTeam
    ? Array.from(
        new Set([
          ...keptIds,
          ...(params.person && UUID_PATTERN.test(params.person) ? [params.person] : []),
        ]),
      )
    : [];

  /*
   * One period for the whole page, resolved before the queries run because
   * several of them are bounded by it.
   *
   * Completed and My Team used to resolve their own, from different parameters
   * and with different options, so the same page held two answers to "over what
   * period". Default: the last 30 days - what somebody checking recent work
   * most often wants.
   */
  const now = new Date();
  const period = resolvePeriod(
    params.period,
    params.period_from,
    params.period_to,
    now,
    DEFAULT_PERIOD,
    // The reader's zone, not the server's: "this year" and a date range mean
    // the calendar on their wall.
    profile.timezone,
  );
  const completedScope: CompletedScope =
    params.show === 'owned'
      ? 'owned'
      : params.show === 'routine'
        ? 'routine'
        : params.show === 'contribution'
          ? 'contribution'
          : params.show === 'received'
            ? 'received'
            : 'all';

  const requested = params.tab;
  const activeTab: TabKey =
    requested === 'available' ||
    requested === 'shared' ||
    requested === 'active' ||
    requested === 'completed' ||
    requested === 'bin'
      ? requested
      : 'active';

  const [
    tasks,
    settings,
    sharedContributions,
    binnedTasks,
    binnedCount,
    routineOccurrences,
    taskDetail,
    expandedPeople,
    myAttention,
    assignablePeople,
    team,
    proposals,
    proposalDetail,
    teamAvailable,
    teamAvailableCount,
    teamDelivered,
    teamDeliveredWork,
    completedWork,
    currentFocus,
    weekStart,
  ] = await Promise.all([
    getMyTasks(profile.id),
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
    // §60 — an id in the URL is a request, not an authorisation. Each query is
    // bounded by the same visibility rules the list is, and returns nothing for
    // somebody outside this manager's scope. Bounded in number too: `expandedIds`
    // is capped, so a hand-written `?kept=` cannot turn one page into forty.
    Promise.all(expandedIds.map((id) => getTeamMemberDetail(profile.id, id, period))),
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
    // The one number in the team snapshot that is not already on this page.
    scope === 'team' ? getTeamDeliveryCount(profile.id, period) : Promise.resolve(0),
    // And what that number is made of, when the manager asks to see it. Two
    // table reads over the window, so it stays behind the click rather than
    // being paid for on every load of My Team.
    scope === 'team' && teamFilter === 'delivered'
      ? getTeamDeliveredWork(profile.id, period)
      : Promise.resolve({ groups: [], failed: false }),
    // Only when Completed is open. Finished work is history, and history is
    // not part of anybody's day.
    activeTab === 'completed'
      ? getMyCompletedWork(profile.id, period.since, period.until)
      : Promise.resolve({ records: [], failed: false }),
    // What the viewer says they are on. Read on every load of this page: it
    // heads the Active list and the task drawer offers to become it.
    getCurrentFocus(profile.id),
    // Asked of the database so the screen and the procedures agree on which
    // Monday "this week" is.
    getCurrentWeekStart(),
  ]);

  // Only on Active, which is the list they describe.
  /*
   * Also when a task drawer is open, not only on the Active list.
   *
   * §12 asks the drawer to show this work's weekly context, and the drawer can
   * be opened from Available, Shared, Completed, the Bin or a notification —
   * every one of which would otherwise say "Add to this week" about work
   * already in it.
   */
  const myCommitments =
    scope === 'mine' && (activeTab === 'active' || Boolean(params.task))
      ? await getWeeklyCommitments(profile.id, weekStart)
      : [];

  const visible =
    activeTab === 'shared' || activeTab === 'bin' || activeTab === 'completed'
      ? []
      : tasksForTab(tasks, activeTab, profile.id);

  /*
   * §9 — "Other active work", and it means other.
   *
   * Work already named as this week's result is read above; repeating it in
   * the list underneath would show the same commitment twice and make the
   * section's count disagree with what is on screen. A step commitment is the
   * exception, as it is for a manager reading somebody's expansion (§6): the
   * priority is one part of the parent, so the parent stays in the list.
   */
  const weeklyTaskIds = new Set(
    myCommitments.filter((commitment) => !commitment.isStep).map((commitment) => commitment.taskId),
  );
  const otherActive =
    activeTab === 'active' ? visible.filter((task) => !weeklyTaskIds.has(task.id)) : visible;
  const otherActiveOverdue = otherActive.filter((task) => task.isOverdue).length;

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

  /*
   * Completed carries no badge on purpose. After two years it would read
   * "Completed 846", and a number that large is not an attention signal - it
   * is furniture. The count that means something is the one inside, after the
   * period filter has been applied, and that is rendered there.
   */
  const counts: Record<TabKey, number> = {
    active: tasksForTab(tasks, 'active', profile.id).length,
    available: tasksForTab(tasks, 'available', profile.id).length,
    shared: openContributions.length,
    completed: 0,
    bin: binnedCount,
  };

  // Section 35 — Everyone by default, but people who need something first.
  // A manager should see normal activity AND exceptions, not have to choose.

  /*
   * Who a manager reads first, without filtering to find out. The rule lives in
   * the domain because the seed cannot distinguish it from an alphabetical
   * list — every person who needs something also happens to sort early — so an
   * end-to-end check of it could not fail. `tests/unit/team-order.test.ts` uses
   * data where the two orders disagree.
   */
  const teamRows = teamRowOrder(teamFilter === 'attention' ? teamNeedingAttention : team);

  /*
   * The window everything on My Team is counted over, and links that keep it.
   *
   * A manager who widens to ninety days and then opens somebody expects the
   * drawer to still be showing ninety days. Dropping the parameter on every
   * navigation would silently reset the question they just asked.
   */
  const teamHref = (filter?: 'attention' | 'available' | 'delivered') => {
    const query = new URLSearchParams({ scope: 'team', ...periodParams(period) });
    if (filter) query.set('filter', filter);
    return `/work?${query.toString()}`;
  };

  /*
   * §6 — the expansions, by whose they are.
   *
   * A person the viewer may not see comes back null and simply does not
   * expand; the row is not there to click in the first place.
   */
  const detailByPerson = new Map(
    expandedPeople.filter((detail) => detail !== null).map((detail) => [detail.person.id, detail]),
  );
  /*
   * The same page with one person's expansion turned on or off.
   *
   * Built from the parameters already in the address bar rather than from a
   * fresh set, so the period, the filter and everybody else's expansion all
   * survive the click - which is most of what A02 asks for. The task layer is
   * dropped, because expanding a person is not the same as having a task open.
   */
  const teamUrl = (overrides: Record<string, string | null>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key in overrides) continue;
      if (value === undefined || value === null || String(value).length === 0) continue;
      search.set(key, String(value));
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value) search.set(key, value);
    }
    const query = search.toString();
    return query ? `/work?${query}` : '/work';
  };

  /*
   * §12 — where the open task sits in this person's week.
   *
   * Only a whole-task reference counts. A commitment on one STEP of this task
   * is a statement about that step, and saying "this week's priority" over the
   * parent would claim the whole thing was agreed.
   */
  const weeklyReferenceForTask = taskDetail
    ? (myCommitments.find(
        (commitment) => commitment.taskId === taskDetail.task.id && !commitment.isStep,
      ) ?? null)
    : null;

  const withoutTask = { task: null, attention: null, barrier: null, item: null, from: null };

  /*
   * A01 — one control, so one URL: the header toggles, and it toggles whether
   * this person was opened as the current one or pinned through Keep open.
   * Opening somebody else replaces `person` and leaves `kept` alone, which is
   * A03's "default opening otherwise closes the previous person".
   */
  const personToggleHref = (personId: string) => {
    const remaining = keptIds.filter((id) => id !== personId);
    return expandedIds.includes(personId)
      ? teamUrl({ ...withoutTask, person: null, kept: remaining.join(',') || null })
      : teamUrl({ ...withoutTask, person: personId, kept: keptIds.join(',') || null });
  };

  /*
   * Keep open, and stop keeping open.
   *
   * Un-pinning does not force a person closed and does not force them open: it
   * removes the pin, and whether they stay is then the ordinary rule - the
   * current person stays, anybody else closes when the next one opens.
   */
  const personKeepHref = (personId: string) => {
    const kept = keptIds.includes(personId)
      ? keptIds.filter((id) => id !== personId)
      : [...keptIds, personId].slice(0, MAX_KEPT_PEOPLE);
    return teamUrl({ ...withoutTask, kept: kept.join(',') || null });
  };

  /*
   * The people each grouped view has something to show for, and the rest.
   *
   * Both lists cover the whole roster now, so that the reader can tell "this
   * person has nothing" from "this person is missing" — but the people with
   * nothing are a footnote, not five cards of white space.
   */
  const availableWithWork = teamAvailable.groups.filter((group) => group.tasks.length > 0);
  const availableWithNone = teamAvailable.groups.filter((group) => group.tasks.length === 0);
  const deliveredWithWork = teamDeliveredWork.groups.filter((group) => group.records.length > 0);
  const deliveredWithNone = teamDeliveredWork.groups.filter((group) => group.records.length === 0);

  /* Day and month only. Every row in the delivered list falls inside the
     window named above it, so the year is the same on all of them. */
  const completedDay = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: profile.timezone,
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
  /*
   * v156 — "clicking it opens the Step inside the parent context". Only an id
   * that is one of this task's own steps is honoured; anything else opens the
   * task as it would have opened anyway.
   */
  const focusStepId =
    params.step && taskDetail?.checklist.some((item) => item.id === params.step)
      ? params.step
      : null;

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
          {/* The sentence follows the mode, because the mode is what the reader
              has just chosen. "One workspace for focused commitments and
              repeating responsibilities" described the shell; this describes
              the list actually on screen. */}
          <p>
            {scope === 'team'
              ? 'What your people are working on, where they need you, and what changed.'
              : 'Work you are carrying, waiting to start, or contributing to.'}
          </p>
        </div>
        {/*
          The primary action belongs to the mode you are in.

          Focus and Routine create different things: a task that enters the
          Active/Available workflow, and a schedule that generates occurrences
          by itself. One global New Work button was therefore right here and
          wrong on Routine, where pressing it made a task and no routine ever
          appeared. The Focus/Routine selector switches this button with the
          view, so nobody has to work out which of the two they are creating.
        */}
        <div className="actions">
          {/*
            The same flow, in the manager's word for it. From My Team the thing
            being created is work for somebody else, and "New Work" names the
            record rather than the act.

            "Assign" only for somebody who can actually assign. A person who
            can see colleagues through a visibility grant sees the same team
            screens, but the grant is sight of their work and nothing else — no
            editing, no activation, no reassignment. Offering them "Assign
            work" promised authority they do not have.
          */}
          <Link href="/capture" className="btn primary">
            {scope === 'team' && isManager ? '＋ Assign work' : '＋ New Work'}
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
          label="Work type"
          tone="mode"
          items={[
            {
              href: '/work',
              label: 'Focus',
              active: true,
              count: counts.active > 0 ? `${counts.active} active` : undefined,
            },
            {
              href: '/work/routine',
              label: 'Routine',
              // "none due" is a label reporting the absence of news. Silence
              // says the same thing and takes no room.
              count:
                routineOverdue.length > 0
                  ? `${routineOverdue.length} overdue`
                  : routineDue.length > 0
                    ? `${routineDue.length} due`
                    : undefined,
              attention: routineOverdue.length > 0,
            },
          ]}
        />
      )}

      {/* Capacity is reported here rather than being something to navigate. The
          work classes it counts are unchanged; only their role in the interface
          is (v40 section 1). */}

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
          <div className="work-tab-row">
            <FocusTabs
              label="Focus states"
              items={WORK_STATE_TABS.map(
                (key) =>
                  ({
                    href: key === 'active' ? '/work' : `/work?tab=${key}`,
                    label: TAB_LABEL[key],
                    active: key === activeTab,
                    /*
                      Completed is history; a running total of it signals
                      nothing anybody needs to act on. A zero is worse than
                      nothing on the others too — six counters all reading 0
                      make an empty workspace look like a broken dashboard.
                    */
                    count: key === 'completed' || counts[key] === 0 ? undefined : counts[key],
                  }) satisfies TabItem,
              )}
            />
            <MenuDropdown label="More" ariaLabel="More work views" className="work-more-menu">
              <Link href="/work?tab=bin" className={activeTab === 'bin' ? 'active' : undefined}>
                Bin{binnedCount > 0 ? ` · ${binnedCount}` : ''}
              </Link>
            </MenuDropdown>
          </div>
          <p className="focus-tab-meaning">{TAB_MEANING[activeTab]}</p>
          {/*
            v140 §8 — the answer at the top of the list it is about.

            Only on Active, because that is the list this describes. When it is
            not set the line says so and offers nothing: a prompt on every visit
            would turn a statement into a chore, and §8 is explicit that there
            are no recurring mandatory confirmations.
          */}
          {activeTab === 'active' && (
            <div className="working-on-summary">
              {currentFocus ? (
                <>
                  <p className="eyebrow">Working on</p>
                  <RowPrimaryLink
                    href={`/work?task=${currentFocus.taskId}`}
                    ariaLabel={`Open ${currentFocus.title}, the work you are on`}
                  >
                    <strong>{currentFocus.title}</strong>
                  </RowPrimaryLink>
                  <span className="muted">
                    {currentFocus.isStep ? `Step of ${currentFocus.taskTitle} · ` : ''}
                    Set {formatDay(currentFocus.confirmedAt, profile.timezone)}
                  </span>
                </>
              ) : (
                <>
                  <p className="eyebrow">Working on</p>
                  <span className="muted">
                    Not set. Open the work you are on and choose <strong>Set as working on</strong>.
                  </span>
                </>
              )}
            </div>
          )}
          {/*
            §9 fixes this order: what I am on now, what we agreed for the week,
            then everything else.

            It used to be the other way round. The week is an agreement between
            two people and the current focus is one sentence about right now —
            both belong above a list, but the sentence answers "where was I"
            and has to be the first thing read.
          */}
          {activeTab === 'active' && (
            <WeeklyPriorities
              commitments={myCommitments}
              timeZone={profile.timezone}
              viewerId={profile.id}
              emptyHint="No agreed priorities for this week. Open a task and choose Add to this week."
            />
          )}
        </>
      ) : (
        <>
          {/*
            Three views of the team, and no card row above them.

            The four-figure strip that stood here was the shape v132 asked for,
            and section 3 of the change specification supersedes it: People /
            Needs attention / Available / Completed became the central
            navigation, which put a dashboard in front of the list a manager
            came to read. What replaces it is the same three questions as
            destinations — who is on the team, what has not been started, what
            was finished — with attention as a filter inside the first rather
            than a headline above all of them.

            The period control stays, because Completed is read over one. It
            sits with the tabs rather than above the workload, which is where
            section 5 puts it.
          */}
          <div className="team-views">
            <FocusTabs
              label="Team views"
              variant="underline"
              items={[
                {
                  href: teamHref(),
                  label: 'Team',
                  active: teamFilter === 'everyone' || teamFilter === 'attention',
                  count: team.length,
                },
                {
                  href: teamHref('available'),
                  label: 'Not started',
                  active: teamFilter === 'available',
                  count: teamAvailableCount,
                },
                {
                  href: teamHref('delivered'),
                  label: 'Completed',
                  active: teamFilter === 'delivered',
                  count: teamDelivered,
                },
              ]}
            />

            <PeriodPicker
              action="/work"
              hidden={{
                scope: 'team',
                ...(teamFilter !== 'everyone' ? { filter: teamFilter } : {}),
              }}
              presets={STANDARD_PERIODS}
              period={period}
              ariaLabel="Change the reporting period"
              now={now}
            />
          </div>

          {/*
            Attention is a filter within Team, not a view beside it.

            Its scope is stated rather than assumed: "needs you" means a request
            addressed to this manager or an exception on somebody's work, which
            is a narrower thing than "everything that looks wrong".
          */}
          {(teamFilter === 'everyone' || teamFilter === 'attention') && (
            <div className="team-attention-filter">
              <FocusTabs
                label="Team filter"
                variant="underline"
                items={[
                  {
                    href: teamHref(),
                    label: 'Everyone',
                    active: teamFilter === 'everyone',
                    count: team.length,
                  },
                  {
                    href: teamHref('attention'),
                    label: 'Needs attention',
                    active: teamFilter === 'attention',
                    count: teamNeedingAttention.length,
                    attention: teamNeedingAttention.length > 0,
                  },
                ]}
              />
            </div>
          )}
        </>
      )}

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
          ) : (
            <>
              {availableWithWork.map((group) => (
                <section key={group.ownerId} className="team-available-group">
                  <header>
                    <strong>{group.ownerName}</strong>
                    <span className="muted">{group.tasks.length} waiting</span>
                    <Link href={`/work?scope=team&person=${group.ownerId}`}>Open person</Link>
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
              ))}

              {availableWithWork.length === 0 && (
                <div className="empty-state">
                  <h3>Nobody has Available work waiting</h3>
                  <p>Everything visible to you has been activated, completed or not yet created.</p>
                </div>
              )}

              {/*
                One line, not a card each.

                The grouping was built from the task rows, so somebody with an
                empty backlog had no group and simply was not on a page headed
                "Available work" — and a manager reading five people on My Team
                and four here cannot tell "nothing waiting" from "the page did
                not show them". Nothing waiting is also the answer to who gets
                the next thing, so it has to be said. Saying it in an empty card
                per person rebuilds the wall of "No action needed from you" that
                v130 took out: five names cost five words here instead.
              */}
              {availableWithNone.length > 0 && availableWithWork.length > 0 && (
                <p className="team-group-none" data-testid="team-available-none">
                  Nothing waiting for {nameList(availableWithNone.map((g) => g.ownerName))}.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {scope === 'team' && teamFilter === 'delivered' && (
        <div className="focus-panel">
          <p className="focus-tab-meaning">
            What your team closed {period.phrase}, grouped by who delivered it. Owned work,
            contributions to somebody else&rsquo;s task, and routine occurrences — the three things
            the figure above counts.
          </p>
          {teamDeliveredWork.failed ? (
            <div className="notice error" role="alert">
              <strong>Team delivery could not be loaded</strong>
              <p>
                Refresh the page, and tell an administrator if it persists. This is not a statement
                that your team has delivered nothing.
              </p>
            </div>
          ) : (
            <>
              {deliveredWithWork.map((group) => (
                <section key={group.ownerId} className="team-available-group">
                  <header>
                    <strong>{group.ownerName}</strong>
                    <span className="muted">{group.records.length} completed</span>
                    <Link href={`/work?scope=team&person=${group.ownerId}`}>Open person</Link>
                  </header>
                  <ul className="team-available-list">
                    {group.records.map((record) => (
                      <li key={`${record.kind}-${record.id}`} className="team-available-row">
                        <RowPrimaryLink
                          href={`/work?scope=team&filter=delivered&task=${record.taskId}`}
                        >
                          {record.title}
                        </RowPrimaryLink>
                        <span className="muted">
                          {DELIVERY_KIND_WORD[record.kind]}
                          {record.parentTitle ? ` on ${record.parentTitle}` : ''}
                          {record.at ? ` · ${completedDay(record.at)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {deliveredWithWork.length === 0 && (
                <div className="empty-state">
                  <h3>Nothing closed in this window</h3>
                  <p>
                    Try a wider window before reading anything into it — a team working on Major
                    Projects can go a month without closing one.
                  </p>
                </div>
              )}

              {/*
                A period with nothing closed is as often a fact about the period
                — a fortnight of holiday, one long Major Project still running —
                as about the person. Dropping the name shows neither, and giving
                each of them a card of their own makes the absence the loudest
                thing on the page.
              */}
              {deliveredWithNone.length > 0 && deliveredWithWork.length > 0 && (
                <p className="team-group-none" data-testid="team-delivered-none">
                  Nothing closed {period.phrase} by{' '}
                  {nameList(deliveredWithNone.map((g) => g.ownerName))}.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {scope === 'team' && teamFilter !== 'available' && teamFilter !== 'delivered' && (
        <div className="focus-panel">
          {teamRows.length > 0 ? (
            <>
              <MyTeamListHeader />
              {teamRows.map((person) => {
                const detail = detailByPerson.get(person.userId) ?? null;
                const panelId = `team-person-${person.userId}`;
                return (
                  <MyTeamPersonRow
                    key={person.userId}
                    person={person}
                    nowIso={now.toISOString()}
                    expanded={detail !== null}
                    toggleHref={personToggleHref(person.userId)}
                    panelId={panelId}
                  >
                    {detail && (
                      <MyTeamPersonPanel
                        detail={detail}
                        panelId={panelId}
                        taskHrefBase={closeLayerHref('/work', params, [...TASK_LAYER_PARAMS])}
                        keepHref={personKeepHref(person.userId)}
                        kept={keptIds.includes(person.userId)}
                        timeZone={profile.timezone}
                        now={now}
                      />
                    )}
                  </MyTeamPersonRow>
                );
              })}
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
          ) : activeTab === 'completed' ? (
            <CompletedHistory
              records={completedWork.records}
              failed={completedWork.failed}
              scope={completedScope}
              period={period}
              timeZone={profile.timezone}
              now={now}
            />
          ) : activeTab === 'shared' ? (
            openContributions.length > 0 ? (
              openContributions.map((item) => {
                const copy = readinessCopy(item);
                return (
                  /*
                    The contribution leads, not the task it belongs to.

                    Somebody reading Shared needs to know what THEY owe; whose
                    work it is part of is the context for that, not the
                    headline. The readiness label is a flag rather than a
                    permanent status column, so a step that is genuinely
                    waiting stands out from the ones that are simply ready.
                  */
                  <TaskRow key={item.checklistItemId} className="task-row-lean">
                    <div>
                      <RowPrimaryLink
                        href={`/work?tab=shared&task=${item.taskId}`}
                        className="title-link"
                        ariaLabel={`Open ${item.parentTitle}, which contains your step ${item.title}`}
                      >
                        <strong>{item.title}</strong>
                      </RowPrimaryLink>
                      <span className="sub">
                        {/* Short, like every other date on this page since
                            v130: "25 Sept 2026" prints a year every row on
                            screen already shares. */}
                        Shared contribution ·{' '}
                        {formatDueShort(
                          item.itemDueAt ?? item.parentDueAt,
                          item.itemDueAt ? true : item.parentDueIsDateOnly,
                          profile.timezone,
                          now,
                        )}
                      </span>
                      <span className="sub">
                        Part of <b>{item.parentTitle}</b> · Owned by {item.primaryOwnerName}
                        {/*
                          §10 — who asked for it. A step that arrives with no
                          name reads as something the system decided was
                          yours, and the person who can withdraw or re-aim a
                          request is the one who made it.

                          Omitted rather than guessed where it is not known:
                          steps assigned before v146 carry no assigner.
                        */}
                        {item.assignedByName ? ` · Assigned by ${item.assignedByName}` : ''}
                      </span>
                    </div>

                    {item.readiness !== 'ready' || item.evidenceRule === 'required' ? (
                      <div className="row-flags">
                        {item.readiness !== 'ready' && (
                          <span className="row-flag amber">
                            {copy.label}
                            {item.readiness === 'waiting_prerequisite' && item.prerequisiteTitle
                              ? `: ${item.prerequisiteTitle}`
                              : ''}
                          </span>
                        )}
                        {item.evidenceRule === 'required' && (
                          <span className="row-flag amber">Evidence required</span>
                        )}
                      </div>
                    ) : null}

                    <span className="row-chevron" aria-hidden="true">
                      ›
                    </span>
                  </TaskRow>
                );
              })
            ) : (
              <div className="empty-state">
                <h3>Nothing is shared with you</h3>
                <p>
                  Shared holds steps on other people&rsquo;s work that have been assigned to you.
                  They appear here as soon as somebody assigns you one — you never create them
                  yourself.
                </p>
              </div>
            )
          ) : otherActive.length > 0 ? (
            <WorkListShell
              collapsible={activeTab === 'active'}
              count={otherActive.length}
              overdue={otherActiveOverdue}
              openByDefault={!currentFocus && myCommitments.length === 0}
            >
              {otherActive.map((task) => {
                /*
                Enough to decide which row to open, and nothing else.

                The row used to carry the title, the work class, a steps
                sentence, an open age, an in-state age, a status label, a due
                date, a progress bar, the same step count again as its label,
                an Open button and Move out. Inside the Active tab every row
                also announced "Active", and the step count appeared twice in
                two formats. None of it helped anybody choose a row, and the
                two ages were actively confusing: "Open 12h" sat next to a
                button labelled Open.

                What is left is the title, what the work is, when it is due,
                how far through its steps it is — and, only when something is
                genuinely exceptional, a flag. Normal work is quiet, so the
                exceptions are the thing your eye lands on.
              */
                const flags = exceptionFlags(task, profile.timezone);
                const due = dueSignal(task, profile.timezone, now);
                return (
                  <TaskRow key={task.id} className="task-row-lean">
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
                        {/*
                        One word, because every row on this page is work: the
                        "Action" in "Operational Action" and the "Project" in
                        "Major Project" are the same on every row and tell
                        nobody anything.

                        Since v145 §11 the word is the PURPOSE — why this work
                        exists — rather than what shape it is. Work registered
                        before purposes existed still shows its class, because
                        that is what is actually known about it; the drawer is
                        where the gap is offered to be filled.
                      */}
                        {task.workPurpose
                          ? WORK_PURPOSE_SHORT_LABELS[task.workPurpose]
                          : WORK_CLASS_SHORT_LABELS[task.workClass]}
                        {due ? (
                          <>
                            {' · '}
                            <span className={`row-due ${due.tone}`}>{due.label}</span>
                          </>
                        ) : null}
                        {/* Who sent it is context on work you have not taken on
                          yet, and provenance once you have. Available only. */}
                        {task.status === 'backlog' && task.assignedByName
                          ? ` · Assigned by ${task.assignedByName.split(' ')[0]}`
                          : ''}
                      </span>
                      {task.checklistTotal > 0 ? (
                        <span className="sub">
                          {task.checklistCompleted}/{task.checklistTotal}{' '}
                          {task.checklistTotal === 1 ? 'step' : 'steps'}
                          {/*
                            v155 — whose steps they are. "1/3 steps" said how far
                            through the work was and nothing about who owed the
                            rest, so the owner had to open every task to learn
                            whether it was waiting on somebody.
                          */}
                          {task.delegatedOverdueCount > 0 ? (
                            <>
                              {' · '}
                              <span className="row-due late">
                                <span aria-hidden="true">⚠ </span>
                                {task.delegatedOverdueCount} delegated step
                                {task.delegatedOverdueCount === 1 ? '' : 's'} overdue
                              </span>
                            </>
                          ) : task.delegatedOpenCount > 0 ? (
                            ` · ${task.delegatedOpenCount} with others`
                          ) : null}
                        </span>
                      ) : null}
                      {/*
                        Only a contribution needed back before the work itself
                        is worth a line: one that simply shares the task's date
                        would repeat the date already on the row.
                      */}
                      {task.delegatedOverdueCount === 0 &&
                      task.nextDelegatedDueAt &&
                      (!task.dueAt ||
                        localDateString(new Date(task.nextDelegatedDueAt), profile.timezone) <
                          localDateString(new Date(task.dueAt), profile.timezone)) ? (
                        <span className="sub">
                          Next contribution due{' '}
                          {formatDueShort(task.nextDelegatedDueAt, true, profile.timezone)}
                        </span>
                      ) : null}
                    </div>

                    {flags.length > 0 && (
                      <div className="row-flags">
                        {flags.map((flag: { label: string; tone: string }) => (
                          <span key={flag.label} className={`row-flag ${flag.tone}`}>
                            {flag.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/*
                    Activating is a real decision, so Available keeps an
                    explicit button. Active does not: moving work out is
                    administration and lives in the task's ••• menu, where it
                    reads Move to Available.
                  */}
                    {task.status === 'backlog' ? (
                      <TaskRowActions
                        taskId={task.id}
                        title={task.title}
                        status={task.status}
                        version={task.version}
                        bucket={task.focusBucket}
                        isMandatory={task.isMandatory}
                        workClass={task.workClass}
                      />
                    ) : (
                      <span className="row-chevron" aria-hidden="true">
                        ›
                      </span>
                    )}
                  </TaskRow>
                );
              })}
            </WorkListShell>
          ) : (
            /* Section 27.2 — what is empty, why, and the next useful action. */
            /*
              An empty state that answers the situation, not the tab.

              "Activate something from Available" with a View Available button
              was printed whether or not Available held anything, so on an
              empty workspace it sent people from one empty page to another —
              past a tab already reading Available 0. What to suggest depends
              on whether there is anything there.
            */
            <div className="empty-state">
              <h3>
                {activeTab === 'available' ? 'Nothing waiting yet' : 'No active work right now'}
              </h3>
              <p>
                {activeTab === 'available'
                  ? 'Available is valid work you have not started yet. Capture something, or ask your manager what is waiting.'
                  : counts.available > 0
                    ? `You have ${counts.available} item${counts.available === 1 ? '' : 's'} waiting for you in Available.`
                    : 'You have nothing waiting in Available either. Add something when there is work that needs following through.'}
              </p>
              <Link
                href={
                  activeTab === 'available' || counts.available === 0
                    ? '/capture'
                    : '/work?tab=available'
                }
                className="btn"
              >
                {activeTab === 'available' || counts.available === 0
                  ? '＋ New Work'
                  : 'View Available'}
              </Link>
            </div>
          )}
        </div>
      )}

      {taskDetail && (
        <TaskDetailDrawer
          detail={taskDetail}
          currentFocus={currentFocus}
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
          weeklyReference={weeklyReferenceForTask}
          attentionBarrierId={attentionBarrierId}
          focusStepId={focusStepId}
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

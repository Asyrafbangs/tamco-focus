/**
 * My Day prioritisation and the "Why this?" explanation.
 *
 * Implements MASTER_PRODUCT_SPEC.md section 9.
 *
 * My Day is a decision page, not a system summary. It answers three questions:
 * what requires attention, what should I do next, and what is coming soon.
 * The recommendation guides; it never forces (section 9.4).
 */

import { localDateString, overdueDays, DEFAULT_ORG_TIMEZONE } from './duration';
import type { TaskOverview } from './types';

/**
 * The ranked reasons a task can be the recommendation, in the exact order of
 * section 9.4. Lower `rank` wins.
 */
export const PRIORITY_BANDS = [
  'immediate_mandatory',
  'overdue_or_blocked',
  'due_today',
  'deadline_today',
  'handoff_ready',
  'active_work',
  'due_soon',
] as const;

export type PriorityBand = (typeof PRIORITY_BANDS)[number];

export interface RankedTask {
  task: TaskOverview;
  band: PriorityBand;
  rank: number;
  /** Plain-language sentence for the "Why this?" control (section 9.5). */
  why: string;
}

export interface PrioritisationContext {
  /** The person the page is for. Used to tell "assigned to me" from "mine to watch". */
  viewerId: string;
  now?: Date;
  /** Section 22.3 — how far ahead "due soon" looks. */
  upcomingWindowDays?: number;
  timeZone?: string;
  /**
   * Task IDs that have a checklist step ready and assigned to the viewer
   * (section 13.3). Supplied by the caller because it needs a checklist query.
   */
  handoffReadyTaskIds?: ReadonlySet<string>;
  /** How many other tasks each task blocks, for tie-break 3. */
  blockingCounts?: ReadonlyMap<string, number>;
  /** The oldest open barrier per task, for tie-break 4. */
  oldestBarrierAt?: ReadonlyMap<string, string>;
  /**
   * Tasks whose open barrier names somebody else as the person to act.
   *
   * A blocked task ranks highly because a blockage is urgent — but only when
   * the viewer is the one who can clear it. Where they are not, the blockage
   * is a reason they cannot proceed, not a reason to start.
   */
  awaitingOthersTaskIds?: ReadonlySet<string>;
}

const BAND_RANK: Record<PriorityBand, number> = Object.fromEntries(
  PRIORITY_BANDS.map((band, index) => [band, index]),
) as Record<PriorityBand, number>;

const URGENCY_RANK = { critical: 0, high: 1, normal: 2 } as const;

function isWorkable(task: TaskOverview): boolean {
  return task.status === 'backlog' || task.status === 'active' || task.status === 'paused';
}

/** Classifies one task into its highest-priority band, or null if it does not
 * belong on My Day at all. */
function bandFor(task: TaskOverview, context: PrioritisationContext): PriorityBand | null {
  const now = context.now ?? new Date();
  const timeZone = context.timeZone ?? DEFAULT_ORG_TIMEZONE;
  const windowDays = context.upcomingWindowDays ?? 7;

  if (!isWorkable(task)) return null;

  // 1. Immediate safety, legal, or compliance action.
  if (task.isMandatory) return 'immediate_mandatory';

  // 2. Overdue, or blocked and needing this person.
  if (task.isOverdue) return 'overdue_or_blocked';
  /*
   * "and needing this person" is the operative half. A barrier waiting on
   * somebody else's decision does not promote the task: the viewer cannot
   * clear it, so ranking it above work they could actually do puts the one
   * thing they are powerless over at the top of their day.
   */
  if (task.openBarrierCount > 0 && !context.awaitingOthersTaskIds?.has(task.id)) {
    return 'overdue_or_blocked';
  }

  const today = localDateString(now, timeZone);

  // 3. Work due today.
  if (task.dueAt && localDateString(new Date(task.dueAt), timeZone) === today) {
    return 'due_today';
  }

  // 4. A review or selection deadline falling today.
  if (task.reviewAt && localDateString(new Date(task.reviewAt), timeZone) === today) {
    return 'deadline_today';
  }

  // 5. A collaborative handoff that just became ready for this person.
  if (context.handoffReadyTaskIds?.has(task.id)) return 'handoff_ready';

  // 6. Work the person has already committed to carrying.
  if (task.status === 'active') return 'active_work';

  // 7. Due within the configured upcoming window.
  if (task.dueAt) {
    const dueInMs = new Date(task.dueAt).getTime() - now.getTime();
    if (dueInMs > 0 && dueInMs <= windowDays * 86_400_000) return 'due_soon';
  }

  return null;
}

/** The plain-language explanation shown behind "Why this?" (section 9.5). */
function explain(task: TaskOverview, band: PriorityBand, context: PrioritisationContext): string {
  const now = context.now ?? new Date();

  switch (band) {
    case 'immediate_mandatory':
      return 'Selected because this is mandatory safety, legal, or compliance work that needs controlled action.';

    case 'overdue_or_blocked': {
      if (task.isOverdue) {
        const days = overdueDays(task, context.timeZone ?? DEFAULT_ORG_TIMEZONE, now);
        return days >= 1
          ? `Selected because this is overdue by ${days} day${days === 1 ? '' : 's'}.`
          : 'Selected because this passed its due time today.';
      }
      return 'Selected because a barrier is open and this work needs a decision before it can move.';
    }

    case 'due_today':
      return 'Selected because this is due today before your other commitments.';

    case 'deadline_today':
      return 'Selected because a review or selection deadline falls today.';

    case 'handoff_ready':
      return 'Selected because a step was handed to you and is now ready to start.';

    case 'active_work':
      return 'Selected because it is the next step on work you already have active.';

    case 'due_soon':
      return 'Selected because it is coming up soon and nothing more urgent needs you first.';
  }
}

/**
 * Compares two tasks already known to be in the same band, applying the
 * tie-breaking order of section 9.4.
 */
function compareWithinBand(
  a: TaskOverview,
  b: TaskOverview,
  context: PrioritisationContext,
): number {
  // 1. Earliest exact due time.
  const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (dueA !== dueB) return dueA - dueB;

  // 2. Critical before High before Normal.
  const urgencyDelta = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (urgencyDelta !== 0) return urgencyDelta;

  // 3. Work blocking the most other work.
  const blockingA = context.blockingCounts?.get(a.id) ?? 0;
  const blockingB = context.blockingCounts?.get(b.id) ?? 0;
  if (blockingA !== blockingB) return blockingB - blockingA;

  // 4. Oldest unresolved barrier.
  const barrierA = context.oldestBarrierAt?.get(a.id);
  const barrierB = context.oldestBarrierAt?.get(b.id);
  if (barrierA && barrierB) {
    const delta = new Date(barrierA).getTime() - new Date(barrierB).getTime();
    if (delta !== 0) return delta;
  } else if (barrierA !== barrierB) {
    return barrierA ? -1 : 1;
  }

  // 5. Least recently updated.
  const updatedA = new Date(a.lastMeaningfulUpdateAt).getTime();
  const updatedB = new Date(b.lastMeaningfulUpdateAt).getTime();
  if (updatedA !== updatedB) return updatedA - updatedB;

  // 6. Manager-set review deadline.
  const reviewA = a.reviewAt ? new Date(a.reviewAt).getTime() : Number.POSITIVE_INFINITY;
  const reviewB = b.reviewAt ? new Date(b.reviewAt).getTime() : Number.POSITIVE_INFINITY;
  if (reviewA !== reviewB) return reviewA - reviewB;

  // Stable, deterministic last resort so the order never flickers between loads.
  return a.id.localeCompare(b.id);
}

/** Ranks every candidate task for My Day, most important first. */
export function rankTasks(
  tasks: readonly TaskOverview[],
  context: PrioritisationContext,
): RankedTask[] {
  const ranked: RankedTask[] = [];

  for (const task of tasks) {
    const band = bandFor(task, context);
    if (!band) continue;

    ranked.push({ task, band, rank: BAND_RANK[band], why: explain(task, band, context) });
  }

  return ranked.sort((a, b) => a.rank - b.rank || compareWithinBand(a.task, b.task, context));
}

/** The single Start Here recommendation (section 9.2). */
export function startHere(
  tasks: readonly TaskOverview[],
  context: PrioritisationContext,
): RankedTask | null {
  /*
   * The first thing the viewer can actually move.
   *
   * Work waiting on somebody else's answer can still be overdue, and overdue
   * work still ranks first — so without this the recommendation could be a
   * task whose only honest next step is to wait. It stays visible further down
   * the page, where it reads as information rather than as an instruction.
   */
  const ranked = rankTasks(tasks, context);
  return (
    ranked.find((entry) => !context.awaitingOthersTaskIds?.has(entry.task.id)) ?? ranked[0] ?? null
  );
}

/** The short Today list (section 9.6), which is capped at three to five items. */
export function todayList(
  tasks: readonly TaskOverview[],
  context: PrioritisationContext,
  maxItems = 5,
): RankedTask[] {
  return rankTasks(tasks, context).slice(0, Math.max(1, maxItems));
}

// ---------------------------------------------------------------------------
// Needs Attention (section 9.3)
// ---------------------------------------------------------------------------

export type AttentionKind =
  | 'urgent_mandatory'
  | 'overdue'
  | 'open_barrier'
  | 'missing_evidence'
  | 'paused_review_passed'
  | 'overdue_routine'
  | 'completion_review_overdue'
  /**
   * v155 — the work is not late, but a step somebody else owes on it is. The
   * owner's own dates are all fine and the task is at risk anyway, which is
   * exactly the case nothing else on My Day would catch.
   */
  | 'waiting_on_others'
  /**
   * v160 — a step of the owner's own is past its date, on work that is not
   * late itself. v155 caught the same thing for a step somebody else owes.
   */
  | 'step_overdue'
  /**
   * v160 — a step the viewer owes on somebody else's work is past its date.
   * That work is not on their list at all, so nothing else here would say so.
   */
  | 'contribution_overdue'
  /**
   * v40 section 5 — Available work that genuinely needs a decision today.
   * Nobody should have to open Available every morning to discover that their
   * manager asked for something reviewable this afternoon. This is exception
   * visibility, not a mirror of the list: ordinary Available work never
   * qualifies, and My Day stays silent about it.
   */
  | 'available_needs_decision';

export interface AttentionItem {
  kind: AttentionKind;
  taskId: string;
  title: string;
  /** Written explanation. Section 23.4 — every red indicator carries one. */
  message: string;
}

/**
 * Genuine exceptions only.
 *
 * Section 9.3 is explicit that this must not be used as a general notification
 * count, so nothing here fires for ordinary work that simply exists.
 */
export function needsAttention(
  tasks: readonly TaskOverview[],
  context: PrioritisationContext & { completionReviewOverdueTaskIds?: ReadonlySet<string> },
): AttentionItem[] {
  const now = context.now ?? new Date();
  const items: AttentionItem[] = [];

  for (const task of tasks) {
    if (task.isMandatory && isWorkable(task)) {
      items.push({
        kind: 'urgent_mandatory',
        taskId: task.id,
        title: task.title,
        message: 'Mandatory action needs controlled attention.',
      });
    }

    if (task.isOverdue) {
      const days = overdueDays(task, context.timeZone ?? DEFAULT_ORG_TIMEZONE, now);
      items.push({
        kind: task.workClass === 'routine_occurrence' ? 'overdue_routine' : 'overdue',
        taskId: task.id,
        title: task.title,
        message:
          days >= 1
            ? `Overdue by ${days} day${days === 1 ? '' : 's'}.`
            : 'Past its due time today.',
      });
    }

    // Available work only surfaces here when something about it is exceptional.
    // Being manager-assigned is NOT one of those things (v40 section 4): the
    // manager expresses importance through urgency, due date and review-by, and
    // those are what this tests.
    if (task.status === 'backlog' && !task.isOverdue) {
      const reviewDue =
        task.reviewAt !== null && new Date(task.reviewAt).getTime() <= now.getTime();
      const dueSoon =
        task.dueAt !== null &&
        new Date(task.dueAt).getTime() - now.getTime() <= 2 * 86_400_000 &&
        new Date(task.dueAt).getTime() >= now.getTime();
      const pressing =
        task.isMandatory || task.urgency === 'critical' || task.urgency === 'high' || reviewDue;

      if (pressing || dueSoon) {
        const because = task.isMandatory
          ? 'Mandatory work waiting to start.'
          : reviewDue
            ? 'Review date has arrived and it has not been started.'
            : task.urgency === 'critical' || task.urgency === 'high'
              ? `Marked ${task.urgency} urgency and not started.`
              : 'Due within two days and not started.';

        items.push({
          kind: 'available_needs_decision',
          taskId: task.id,
          title: task.title,
          message: task.assignedByName
            ? `${because} Assigned by ${task.assignedByName.split(' ')[0]}.`
            : because,
        });
      }
    }

    if (task.openBarrierCount > 0) {
      items.push({
        kind: 'open_barrier',
        taskId: task.id,
        title: task.title,
        message: 'A barrier is open and waiting for support or a decision.',
      });
    }

    if (task.delegatedOverdueCount > 0 && isWorkable(task)) {
      const count = task.delegatedOverdueCount;
      items.push({
        kind: 'waiting_on_others',
        taskId: task.id,
        title: task.title,
        message: `${count} delegated step${count === 1 ? ' is' : 's are'} past due.`,
      });
    }

    /*
     * v160 — and a step of the owner's own. A late step somebody else owes was
     * caught above; a late one of theirs, on work not yet late itself, was
     * caught by nothing. Not said when the work is overdue: that item says it.
     */
    if (task.ownStepOverdueCount > 0 && !task.isOverdue && isWorkable(task)) {
      const count = task.ownStepOverdueCount;
      items.push({
        kind: 'step_overdue',
        taskId: task.id,
        title: task.title,
        message:
          count === 1
            ? 'A step of yours is past its date.'
            : `${count} steps of yours are past their dates.`,
      });
    }

    // Only worth surfacing once the work is otherwise finished — before that it
    // is ordinary outstanding work, not an exception.
    if (task.missingEvidenceCount > 0 && task.checklistCompleted === task.checklistTotal - 1) {
      items.push({
        kind: 'missing_evidence',
        taskId: task.id,
        title: task.title,
        message: `${task.missingEvidenceCount} step${task.missingEvidenceCount === 1 ? '' : 's'} still need evidence before this can be completed.`,
      });
    }

    if (task.status === 'paused' && task.reviewAt && new Date(task.reviewAt) < now) {
      items.push({
        kind: 'paused_review_passed',
        taskId: task.id,
        title: task.title,
        message: 'This has been paused past its review date.',
      });
    }

    if (context.completionReviewOverdueTaskIds?.has(task.id)) {
      items.push({
        kind: 'completion_review_overdue',
        taskId: task.id,
        title: task.title,
        message: 'A completion review has been waiting longer than the review target.',
      });
    }
  }

  return items;
}

/** Section 9.7 — the nearest two or three commitments, and nothing more. */
export function comingUp(
  tasks: readonly TaskOverview[],
  context: PrioritisationContext,
  maxItems = 3,
): TaskOverview[] {
  const now = context.now ?? new Date();
  const windowMs = (context.upcomingWindowDays ?? 7) * 86_400_000;

  return tasks
    .filter((task) => {
      if (!isWorkable(task) || !task.dueAt) return false;
      const dueIn = new Date(task.dueAt).getTime() - now.getTime();
      return dueIn > 0 && dueIn <= windowMs;
    })
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())
    .slice(0, maxItems);
}

/**
 * v160 — a step the viewer owes, from the calendar's step rows: one of their
 * own dated steps on their own work, or a contribution on somebody else's.
 */
export interface OwedStep {
  stepId: string;
  taskId: string;
  title: string;
  parentTitle: string;
  /** Its own date, or its work's when it has none (v154). */
  dueAt: string;
  dueIsDateOnly: boolean;
  /** Whether the work it belongs to is the viewer's own. */
  ownWork: boolean;
  stepHasOwnDate: boolean;
  parentDueAt: string | null;
}

/**
 * v160 — contributions the viewer owes on somebody else's work that are past
 * their date. Their own late steps are counted from their own work instead.
 */
export function overdueContributions(
  steps: readonly OwedStep[],
  context: PrioritisationContext,
): AttentionItem[] {
  const now = context.now ?? new Date();
  return steps
    .filter((step) => !step.ownWork && new Date(step.dueAt).getTime() < now.getTime())
    .map((step) => ({
      kind: 'contribution_overdue' as const,
      taskId: step.taskId,
      title: step.title,
      message: `Your step on "${step.parentTitle}" is past its date.`,
    }));
}

/**
 * v160 — steps the viewer owes that fall due inside the upcoming window, in
 * date order: a contribution on anybody's work, and one of their own only when
 * it is due before its work — one due with the work is the work's own date.
 */
export function stepsComingUp(
  steps: readonly OwedStep[],
  context: PrioritisationContext,
): OwedStep[] {
  const now = context.now ?? new Date();
  const timeZone = context.timeZone ?? DEFAULT_ORG_TIMEZONE;
  const windowMs = (context.upcomingWindowDays ?? 7) * 86_400_000;
  return steps
    .filter((step) => {
      const dueIn = new Date(step.dueAt).getTime() - now.getTime();
      if (dueIn <= 0 || dueIn > windowMs) return false;
      if (!step.ownWork) return true;
      return (
        step.stepHasOwnDate &&
        (step.parentDueAt === null ||
          localDateString(new Date(step.dueAt), timeZone) <
            localDateString(new Date(step.parentDueAt), timeZone))
      );
    })
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
}

/**
 * Ordering for the Available list (v40 section 4).
 *
 * The rule this encodes is as much about what does NOT sort as what does.
 * `assignedById` is absent on purpose: a manager having created the work is
 * provenance, not importance. A manager who needs something treated urgently
 * says so through the controls that already exist — urgency, due date, review
 * by — and those are what rank it. Otherwise "my manager sent it" quietly
 * outranks an overdue safety action, which is precisely backwards.
 *
 * Rank order:
 *   1. Critical or mandatory
 *   2. Overdue
 *   3. Review-by today or passed
 *   4. High urgency
 *   5. Nearest due date
 *   6. Everything else
 */
/**
 * Ordering for the Active list.
 *
 * Active work had no order of its own, so it arrived in whatever sequence the
 * query returned and people had to read every row to find the one that was
 * late. The rule is the obvious one, written down: what has already slipped,
 * then what is due today, then the nearest commitment, then work with no date
 * at all.
 *
 * Deliberately automatic rather than a sort control. Nobody should have to
 * configure a list to find the work that is overdue on it.
 */
export function activeOrder(
  tasks: readonly TaskOverview[],
  now: Date = new Date(),
  timeZone: string = DEFAULT_ORG_TIMEZONE,
): TaskOverview[] {
  const today = localDateString(now, timeZone);
  const rank = (task: TaskOverview): number => {
    if (task.isOverdue) return 0;
    if (task.dueAt && localDateString(new Date(task.dueAt), timeZone) === today) return 1;
    if (task.dueAt) return 2;
    return 3;
  };

  return [...tasks].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;

    // Undated work sorts last rather than as though it were due at the epoch.
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    return left.title.localeCompare(right.title);
  });
}

export function availableOrder(
  tasks: readonly TaskOverview[],
  now: Date = new Date(),
): TaskOverview[] {
  const rank = (task: TaskOverview): number => {
    if (task.isMandatory || task.urgency === 'critical') return 0;
    if (task.isOverdue) return 1;
    if (task.reviewAt && new Date(task.reviewAt).getTime() <= now.getTime()) return 2;
    if (task.urgency === 'high') return 3;
    if (task.dueAt) return 4;
    return 5;
  };

  return [...tasks].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;

    // Within a rank, the nearest commitment first. Undated work sorts last
    // rather than sorting as though it were due at the epoch.
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    return left.title.localeCompare(right.title);
  });
}

/**
 * A team row, as ordering sees it.
 *
 * Structural rather than the query's own type, so the rule can be exercised
 * with three lines of synthetic data instead of a database.
 */
export interface TeamOrderRow {
  fullName: string;
  attention: { reasonCode: string; sourceType: string } | null;
}

/**
 * Who a manager should read first. Lower sorts first.
 *
 * Ranked by what the row asks of the reader, not by severity in the abstract:
 * a workload they have been asked to review, then a decision or barrier owed,
 * then work that has already slipped, then something merely worth knowing,
 * then everybody who is fine.
 *
 * A barrier outranks overdue work because of who is blocked. Overdue work is
 * the person's own to catch up on and will still be there tomorrow; a barrier
 * is somebody stopped, waiting on an answer only the manager can give, and
 * every hour it sits unread is an hour of theirs.
 *
 * The rule this replaced was "anyone with anything, then alphabetically",
 * which put a stalled item somebody might like to know about above a decision
 * holding a person up — both merely had an attention row.
 */
export function teamRowRank(row: TeamOrderRow): number {
  const attention = row.attention;
  if (!attention) return 9;
  /*
   * `workload_review` used to rank above everything, including a barrier.
   * v144 removed it with the focus target (specification §3): the loudest row
   * on a manager's list was being generated from a ratio the product says is
   * not a reliable workload measure, and it outranked a person who was
   * actually stopped and waiting for an answer.
   */
  if (attention.sourceType === 'barrier' || attention.sourceType === 'goal') return 1;
  if (attention.reasonCode === 'overdue') return 2;
  return 3;
}

/**
 * The same people, in the order a manager should meet them.
 *
 * Alphabetical within a rank, so the list is stable from one visit to the next
 * and nobody has to filter to discover a problem.
 */
export function teamRowOrder<T extends TeamOrderRow>(rows: readonly T[]): T[] {
  return rows.slice().sort((left, right) => {
    const rank = teamRowRank(left) - teamRowRank(right);
    if (rank !== 0) return rank;
    return left.fullName.localeCompare(right.fullName);
  });
}

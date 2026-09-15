/**
 * My Day's exceptions and the working lists' orders.
 *
 * Implements MASTER_PRODUCT_SPEC.md section 9.3 and the Active, Available and
 * team orders. The Start here recommendation, its "Why this?" and the Next up
 * and Coming up lists that ranked with it were replaced in v188 by My Day's
 * Overdue and Due soon sections (`src/domain/my-day.ts`).
 */

import { localDateString, overdueDays, DEFAULT_ORG_TIMEZONE } from './duration';
import type { TaskOverview } from './types';

export interface PrioritisationContext {
  /** The person the page is for. Used to tell "assigned to me" from "mine to watch". */
  viewerId: string;
  now?: Date;
  /** Section 22.3 — how far ahead "due soon" looks. */
  upcomingWindowDays?: number;
  timeZone?: string;
}

function isWorkable(task: TaskOverview): boolean {
  return task.status === 'backlog' || task.status === 'active' || task.status === 'paused';
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

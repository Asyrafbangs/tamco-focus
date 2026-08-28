/**
 * My Day prioritisation and the "Why this?" explanation.
 *
 * Implements MASTER_PRODUCT_SPEC.md section 9.
 *
 * My Day is a decision page, not a system summary. It answers three questions:
 * what requires attention, what should I do next, and what is coming soon.
 * The recommendation guides; it never forces (section 9.4).
 */

import { localDateString, overdueAgeMs, DEFAULT_ORG_TIMEZONE } from './duration';
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
  if (task.openBarrierCount > 0) return 'overdue_or_blocked';

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
        const overdueDays = Math.floor(overdueAgeMs(task, now) / 86_400_000);
        return overdueDays >= 1
          ? `Selected because this is overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}.`
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
  return rankTasks(tasks, context)[0] ?? null;
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
      const days = Math.floor(overdueAgeMs(task, now) / 86_400_000);
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

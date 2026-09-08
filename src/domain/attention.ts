import { barrierAction, barrierHref } from './barriers';

/**
 * What the application knows about things waiting on somebody (v49).
 *
 * Two questions had been answered in several places at once, and had drifted:
 * how important an item is, and what pressing its button will do. Both belong
 * to the item rather than to the screen showing it, so both live here. My Day,
 * My Team, Team Member Detail and notifications all read this module; none
 * computes its own ranking or its own destination.
 */

/**
 * The real business object behind an item.
 *
 * Deliberately concrete. A generic `proposal` or `review` source is how an
 * attention item ends up pointing at a page where the promised action does not
 * exist — the manager arrives and has to ask what they are reviewing.
 */
export type AttentionSourceType =
  'barrier' | 'routine_occurrence' | 'completion_review' | 'task' | 'goal';

/**
 * The operation promised by an attention control.
 *
 * Source and operation are deliberately separate fields so an invalid pairing
 * (for example, a routine occurrence with a barrier response button) can be
 * rejected before a dead or misleading CTA reaches the screen.
 */
export type AttentionCtaType =
  'barrier_action' | 'open_routine' | 'open_task' | 'review_evidence' | 'review_goal';

export interface AttentionActionTarget {
  sourceType: AttentionSourceType;
  sourceId: string;
  ctaType: AttentionCtaType;
  reasonCode: string;
  taskId?: string | null;
  /**
   * The Goal a `review_goal` item opens, when that is not the item's own id
   * (v53 §21).
   *
   * A support request raised against a Goal is its own record — two can be open
   * at once — so it keeps its own `sourceId` and names the Goal separately.
   * Where the item *is* the Goal, as in My Team, the id serves both.
   */
  goalId?: string | null;
  actionType?: string | null;
}

export interface AttentionActionContext {
  /** Keep the team attention list underneath the exact action drawer. */
  teamAttention?: boolean;
}

export interface ResolvedAttentionAction {
  badge: string;
  label: string;
  href: string;
}

const SOURCE_CTA: Record<AttentionSourceType, readonly AttentionCtaType[]> = {
  barrier: ['barrier_action'],
  routine_occurrence: ['open_routine'],
  completion_review: ['review_evidence'],
  task: ['open_task'],
  goal: ['review_goal'],
};

function invalidAttentionTarget(target: AttentionActionTarget, problem: string): null {
  if (process.env.NODE_ENV !== 'production') {
    console.error(
      `[resolveAttentionAction] ${problem}: ${JSON.stringify({
        sourceType: target.sourceType,
        sourceId: target.sourceId,
        ctaType: target.ctaType,
      })}`,
    );
  }
  return null;
}

function taskActionHref(taskId: string, context: AttentionActionContext): string {
  const search = new URLSearchParams();
  if (context.teamAttention) {
    search.set('scope', 'team');
    search.set('filter', 'attention');
  }
  search.set('task', taskId);
  return `/work?${search.toString()}`;
}

/**
 * One validated mapping from semantic attention identity to visible CTA.
 *
 * The source id is mandatory even where the task id is also known. Without it,
 * two barriers on one task are indistinguishable and a list can promise an
 * exact response form while opening only the task. Invalid targets are hidden
 * rather than rendered as controls that cannot keep their promise.
 */
export function resolveAttentionAction(
  target: AttentionActionTarget,
  context: AttentionActionContext = {},
): ResolvedAttentionAction | null {
  if (!target.sourceId.trim()) return invalidAttentionTarget(target, 'missing sourceId');

  if (!SOURCE_CTA[target.sourceType]?.includes(target.ctaType)) {
    return invalidAttentionTarget(target, 'sourceType and ctaType do not match');
  }

  const presentation = attentionPresentation(
    target.sourceType,
    target.reasonCode,
    target.actionType,
  );

  switch (target.ctaType) {
    case 'barrier_action': {
      if (!target.taskId?.trim()) return invalidAttentionTarget(target, 'missing barrier taskId');
      const href = context.teamAttention
        ? `${taskActionHref(target.taskId, context)}&attention=barrier&barrier=${encodeURIComponent(target.sourceId)}`
        : barrierHref(target.taskId, target.sourceId);
      return { badge: presentation.badge, label: presentation.cta, href };
    }
    case 'open_routine':
    case 'open_task': {
      const taskId = target.taskId?.trim() || target.sourceId;
      return {
        badge: presentation.badge,
        label: presentation.cta,
        href: taskActionHref(taskId, context),
      };
    }
    case 'review_evidence': {
      const taskId = target.taskId?.trim();
      if (!taskId) return invalidAttentionTarget(target, 'missing completion-review taskId');
      return {
        badge: presentation.badge,
        label: presentation.cta,
        href: taskActionHref(taskId, context),
      };
    }
    case 'review_goal': {
      const goalId = target.goalId?.trim() || target.sourceId;
      if (!goalId) return invalidAttentionTarget(target, 'missing goalId');
      return {
        badge: presentation.badge,
        label: presentation.cta,
        href:
          target.reasonCode === 'goal_support_requested'
            ? `/goals?goal=${encodeURIComponent(goalId)}`
            : `/goals?goal=${encodeURIComponent(goalId)}&action=update`,
      };
    }
    default:
      return invalidAttentionTarget(target, 'unsupported ctaType');
  }
}

/**
 * Whether the viewer owes something, or merely ought to know (v49 §10, §55).
 *
 * An overdue routine is abnormal and worth seeing. It is not a request, and
 * dressing it as one — "Review with them" — invents a manager workflow that
 * does not exist and cannot be completed. Keeping the two apart is what lets
 * "Needs you" continue to mean something.
 */
export type AttentionKind = 'exception' | 'action_required';

export type AttentionSeverity = 'critical' | 'high' | 'normal';

/**
 * Ranking, in the order that costs most to ignore (v49 §7).
 *
 * Deterministic, never inferred: the same inputs always produce the same
 * order, and anybody can predict it from this table. Taking the newest three
 * would bury a week-old blocked decision under three routine questions asked
 * this morning.
 */
const REASON_RANK: Record<string, number> = {
  // Work has stopped and somebody is waiting on this person.
  cannot_continue: 0,
  // Past the moment it was promised.
  overdue: 10,
  decision_required: 20,
  approval_required: 30,
  evidence_review_required: 35,
  escalation_required: 40,
  support_required: 50,
  // A Goal support request is a request. It travels through the same engine as
  // a Barrier (v53 §21), so it ranks with one rather than falling to awareness
  // and sitting at the bottom of a list nobody scrolls.
  goal_support_requested: 50,
  // Everything else is context.
  awareness: 90,
};

export interface RankableAttention {
  reasonCode: string;
  kind: AttentionKind;
  createdAt: string;
  scheduledAt?: string | null;
}

/**
 * Lower sorts first. Age breaks ties, so an old request outranks an identical
 * newer one and nothing can quietly sit at the bottom of the list for ever.
 */
export function attentionPriority(item: RankableAttention, now: Date = new Date()): number {
  const base = REASON_RANK[item.reasonCode] ?? REASON_RANK.awareness!;

  // §15 — something with a discussion booked is being handled. It stays on the
  // list, because the answer is still owed, but it should not outrank a request
  // nobody has picked up.
  const scheduledPenalty = item.scheduledAt ? 5 : 0;

  // Something the viewer merely needs to know never outranks something they owe.
  const kindPenalty = item.kind === 'exception' ? 60 : 0;

  const ageHours = Math.max(
    0,
    (now.getTime() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60),
  );
  // Age only ever breaks ties within a band; it can never promote across one.
  const ageBonus = Math.min(9, ageHours / 24);

  return base + scheduledPenalty + kindPenalty - ageBonus;
}

/** What the control says, per source and reason (v49 §16, §24). */
export interface AttentionPresentation {
  /** The chip: what kind of thing this is. */
  badge: string;
  /** The button: what pressing it does, specifically. */
  cta: string;
}

/**
 * The label has to predict the result (v49 §22).
 *
 * "Review with them", "Review" and a bare "Respond" all failed that test: a
 * person reading them could not say what would appear next. Where the system
 * knows the object, the button names the operation on it.
 */
export function attentionPresentation(
  sourceType: AttentionSourceType,
  reasonCode: string,
  actionType?: string | null,
): AttentionPresentation {
  switch (sourceType) {
    case 'barrier': {
      const action = barrierAction(actionType);
      return { badge: action.title, cta: action.listAction };
    }
    case 'routine_occurrence':
      return { badge: 'Overdue routine', cta: 'Open routine' };
    case 'completion_review':
      return { badge: 'Completion review', cta: 'Review evidence' };
    case 'task':
      return {
        badge:
          reasonCode === 'overdue'
            ? 'Overdue work'
            : reasonCode === 'awareness'
              ? 'No recent update'
              : 'Work',
        cta: 'Open task',
      };
    case 'goal':
      return {
        badge:
          reasonCode === 'goal_support_requested'
            ? 'Goal support needed'
            : reasonCode === 'goal_quarterly_discussion'
              ? 'Quarterly discussion ready'
              : reasonCode === 'goal_off_track'
                ? 'Goal off track'
                : 'Goal at risk',
        cta: reasonCode === 'goal_quarterly_discussion' ? 'Discuss goal' : 'Review goal',
      };
    default:
      return { badge: 'Needs attention', cta: 'Open' };
  }
}

/**
 * Severity drives a dot and a chip tint, nothing louder (v49 §5).
 *
 * A card that is entirely red says nothing about which of its rows is worse,
 * and a list where every row shouts is a list nobody reads twice.
 */
export function attentionSeverity(reasonCode: string, kind: AttentionKind): AttentionSeverity {
  if (kind === 'exception') return 'normal';
  if (reasonCode === 'cannot_continue' || reasonCode === 'overdue') return 'critical';
  if (reasonCode === 'decision_required' || reasonCode === 'workload_review') return 'critical';
  if (reasonCode === 'approval_required' || reasonCode === 'evidence_review_required') {
    return 'high';
  }
  return 'normal';
}

/**
 * The subtitle under the count (v49 §29-30).
 *
 * Says the real numbers. "3 require action now" was hardcoded, so a person with
 * one request was told three things needed them — a small lie that costs the
 * whole panel its credibility.
 */
export function attentionSummaryLine(total: number, shown: number): string {
  if (total === 0) return '';

  const actionable = Math.min(shown, total);
  const waiting = total - actionable;
  const first = `${actionable} require${actionable === 1 ? 's' : ''} action now`;

  return waiting > 0 ? `${first} · ${waiting} more waiting` : first;
}

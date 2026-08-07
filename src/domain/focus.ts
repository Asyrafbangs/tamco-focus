/**
 * Focus targets and activation affordances.
 *
 * Implements MASTER_PRODUCT_SPEC.md section 7 and PRODUCTION_LOGIC.md section 2.
 *
 * A boundary worth being explicit about: the DATABASE decides whether an
 * activation is permitted and what the counts are — `public.activate_task`
 * locks the row, recounts from committed state, and returns `reason_required`
 * when appropriate. Nothing here is trusted for that.
 *
 * What this module does is presentational: render the count badge, decide
 * whether to pre-open the reason dialog so the interface feels immediate, and
 * validate the reason inline before a round trip. The server validates again
 * and its answer wins.
 */

import type { ActivationReason, FocusBucket, FocusSummary, TaskStatus } from './types';
import { ACTIVATION_REASON_LABELS, FOCUS_BUCKET_LABELS } from './types';

/** Approved organisation defaults (section 7.1), used only when no configured
 * target has been loaded yet. The database is authoritative. */
export const DEFAULT_FOCUS_TARGETS: Record<FocusBucket, number> = {
  major: 1,
  operational: 5,
  self_development: 1,
};

/** Section 7.4 — the reason list, in the approved order, for the one question. */
export const ACTIVATION_REASON_OPTIONS: ReadonlyArray<{
  value: ActivationReason;
  label: string;
}> = (
  [
    'urgent_deadline',
    'workload_peak',
    'cannot_move_out',
    'external_request',
    'dependency',
    'other',
  ] as const
).map((value) => ({ value, label: ACTIVATION_REASON_LABELS[value] }));

export interface FocusBadge {
  /** e.g. `6 / 5` */
  text: string;
  /** Section 25.8 / 1.3 item 12 — colour is never the only signal, so an
   * over-target badge always carries this written label too. */
  writtenLabel: string | null;
  tone: 'neutral' | 'red';
  accessibleLabel: string;
}

/**
 * The count badge shown on focus tabs and in Team Focus.
 *
 * Section 7.4 requires the count in red, for example `6 / 5`, accompanied by the
 * written label "Over focus target".
 */
export function focusBadge(summary: FocusSummary): FocusBadge {
  const text = `${summary.activeCount} / ${summary.recommendedTarget}`;
  const bucketLabel = FOCUS_BUCKET_LABELS[summary.bucket];

  if (summary.isOverTarget) {
    return {
      text,
      writtenLabel: 'Over focus target',
      tone: 'red',
      accessibleLabel:
        `${bucketLabel}: ${summary.activeCount} active against a recommended target of ` +
        `${summary.recommendedTarget}. Over focus target.`,
    };
  }

  return {
    text,
    writtenLabel: null,
    tone: 'neutral',
    accessibleLabel:
      `${bucketLabel}: ${summary.activeCount} active against a recommended target of ` +
      `${summary.recommendedTarget}.`,
  };
}

/**
 * Whether activating one more item in this bucket would cross the target.
 *
 * Used to decide whether to ask the reason question up front rather than making
 * the user click Activate twice. It never gates the button: section 7.2 is
 * explicit that the system must never disable activation solely because the
 * target was reached.
 */
export function wouldExceedTarget(
  summary: Pick<FocusSummary, 'activeCount' | 'recommendedTarget'>,
): boolean {
  return summary.activeCount + 1 > summary.recommendedTarget;
}

/**
 * Whether Activate should be offered at all.
 *
 * Only the state matters. Reaching the target is deliberately absent from this
 * condition — that is the whole point of a soft target.
 */
export function canOfferActivate(status: TaskStatus): boolean {
  return status === 'backlog' || status === 'paused';
}

/** Section 7.5 — Active focus tasks offer a quiet secondary move-out action. */
export function canOfferMoveOut(status: TaskStatus): boolean {
  return status === 'active';
}

export type ReasonValidation =
  { valid: true } | { valid: false; field: 'reasonCode' | 'reasonNote'; message: string };

/**
 * Inline validation for the over-target reason (section 7.4).
 *
 * A note is required only when "Other" is selected. This mirrors the database
 * constraint `tasks_activation_note_required_for_other` and the check inside
 * `activate_task`; it exists so the user gets an immediate, specific message
 * (section 27.3) rather than a round trip. The server remains authoritative.
 */
export function validateActivationReason(
  reasonCode: ActivationReason | null,
  reasonNote: string | null,
): ReasonValidation {
  if (!reasonCode) {
    return {
      valid: false,
      field: 'reasonCode',
      message: 'Select a reason for the additional focus.',
    };
  }

  if (reasonCode === 'other' && (reasonNote ?? '').trim().length === 0) {
    return {
      valid: false,
      field: 'reasonNote',
      message: 'Add a short note explaining the reason you selected.',
    };
  }

  return { valid: true };
}

/**
 * The single question asked when activation will cross the target.
 *
 * Section 7.4 requires exactly one question that states the current count and
 * the resulting count. The wording matches PRODUCTION_LOGIC.md section 2.4.
 */
export function overTargetQuestion(
  bucket: FocusBucket,
  countBefore: number,
  target: number,
): string {
  const bucketLabel = FOCUS_BUCKET_LABELS[bucket].toLowerCase();
  return (
    `You already have ${countBefore} active ${bucketLabel}. ` +
    `Activating this will make ${countBefore + 1} active against a target of ${target}. ` +
    'Why is this additional focus needed now?'
  );
}

/**
 * How long a bucket has been over target, for the manager view (section 7.6).
 * Returns null when the bucket is not currently over target.
 */
export function overTargetDurationMs(summary: FocusSummary, now: Date = new Date()): number | null {
  if (!summary.isOverTarget || !summary.overTargetSince) return null;

  const since = new Date(summary.overTargetSince);
  if (Number.isNaN(since.getTime())) return null;

  return Math.max(0, now.getTime() - since.getTime());
}

/**
 * Whether a work class consumes a focus target at all.
 *
 * Section 6.3: Quick Actions and routine work do not. Section 13.2: a small
 * collaborative contribution does not either, unless it is converted into a
 * separately accountable work item.
 */
export function consumesFocusTarget(focusBucket: FocusBucket | null): boolean {
  return focusBucket !== null;
}

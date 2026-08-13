/**
 * Capture Work classification.
 *
 * Implements MASTER_PRODUCT_SPEC.md section 8.
 *
 * Product decision 8 in section 30 — whether classification is rules-based,
 * AI-assisted, or hybrid in the first production release — is unresolved. This
 * implements the DETERMINISTIC RULES-BASED path, which section 8.7 requires to
 * exist in every case as the fallback when AI is unavailable. Choosing it as the
 * local default is reversible: an AI-assisted recommender would call
 * `classifyCapture` when it is unavailable or low-confidence, and would produce
 * the same `CaptureRecommendation` shape.
 *
 * Section 8.7 constraints this satisfies:
 *   * the user sees the recommendation reason
 *   * the user may correct the recommendation
 *   * a deterministic fallback exists
 *   * the final type and origin are audited (by `work_captures` + audit events)
 *   * mandatory classification is NEVER based solely on keywords
 *
 * v40 changes, and why:
 *
 *   Section 13 — safety wording no longer influences classification at all.
 *   It previously diverted "replace PPE signage" into an urgency question on
 *   the strength of the word PPE. Reading a topic out of a title and treating
 *   it as a claim about urgency is exactly the hidden inference the product
 *   must not make. Mandatory work is now reachable only through the explicit
 *   "Report urgent safety or compliance work" path, where a person answers the
 *   question themselves.
 *
 *   Section 12 — every recommendation now carries `ruleCode` and `ruleText`.
 *   Stored on the task, they let the audit trail answer "why was this created
 *   as Operational?" with the rule that fired rather than an implication that
 *   something understood the sentence.
 *
 *   Section 8 — Collaborative Contribution is gone. Contribution is not a kind
 *   of work somebody captures; it arises when a checklist item on an existing
 *   task is assigned to them, and it appears in their Shared view. Asking an
 *   employee to classify work as collaborative exposed an implementation
 *   concept and invited a duplicate parent task for a result somebody else
 *   already owns.
 */

import type { CaptureDestination } from './types';

/**
 * What the person said this is, chosen from a list rather than read out of
 * their sentence.
 *
 * `normal` covers the overwhelming majority of work and splits into a Quick
 * Action or an Operational Action on one explicit question. The other three
 * are deliberate choices somebody makes when they know they are doing
 * something out of the ordinary.
 */
export type CaptureWorkType = 'normal' | 'routine' | 'self_development' | 'major_project';

export interface CaptureInput {
  /** Chosen, never inferred. */
  workType: CaptureWorkType;
  /**
   * Answer to "will this need follow-up after the day you start?".
   *
   * Only meaningful for `normal` work, and only ever a real answer — this is
   * not derived from the due date. A task due a fortnight away can still be a
   * five-minute phone call, and treating a distant date as evidence of a long
   * job is precisely the inference this module exists to avoid.
   */
  requiresFollowUp?: boolean | null;
  /** Answer to the explicit urgency question, when it was asked (section 8.6). */
  needsImmediateControlledAction?: boolean | null;
}

/**
 * Why a destination was chosen, kept for the audit trail.
 *
 * Stable identifiers, stored on the task, so the reason a work class was chosen
 * survives long after the sentence shown at capture time has been reworded
 * (section 12).
 *
 * The old codes described inferences that no longer happen —
 * `recurring_schedule` meant "your title contained the word weekly", and
 * `multi_day_default` meant "your due date was not today". Both are gone, along
 * with the inferences. What remains describes a choice somebody made.
 */
export type ClassificationRuleCode =
  | 'explicit_urgent_confirmed'
  | 'chosen_routine'
  | 'chosen_self_development'
  | 'chosen_major_project'
  | 'normal_no_followup'
  | 'normal_with_followup';

export interface CaptureRecommendation {
  destination: CaptureDestination;
  /** Section 12 — the rule that produced this, for the audit trail. */
  ruleCode: ClassificationRuleCode;
  /** The same rule in plain words, also for the trail. */
  ruleText: string;
  /**
   * The one line the person sees before creating: "Operational Action · starts
   * in Available". Everything else the old result screen showed — capacity
   * effect, manager visibility, the rule code — was the system explaining its
   * own architecture to somebody who only wanted to add a task, and it now
   * lives in the audit trail where it belongs.
   */
  summary: string;
  /**
   * Section 8.6 — the urgency question, reachable only through the explicit
   * "Report urgent issue" route. Never raised by wording.
   */
  urgencyQuestion: string | null;
}

/**
 * The exact question section 8.6 specifies. Safety, PPE, legal, or compliance
 * wording triggers this question and nothing else.
 */
export const URGENCY_QUESTION =
  'Does this need immediate controlled action because of an active safety risk, ' +
  'legal requirement, or compliance deadline?';

/**
 * The one question that splits ordinary work (section 8.5).
 *
 * Asked explicitly, and only for `normal` work. It replaces the old rule that
 * read the due date: a task due in a fortnight was classified as multi-day
 * work and told the person "you said this needs more than a day", which they
 * had not said. "Call the supplier on Friday" is due Friday and is still a
 * five-minute job.
 */
export const FOLLOW_UP_QUESTION = 'Will this need follow-up after the day you start?';

/**
 * The line shown under the form before creating, e.g.
 * "Operational Action · starts in Available".
 *
 * Short on purpose. The person is about to press Create work; they need to
 * know where it lands, not how the capacity model treats it.
 */
const SUMMARY: Record<CaptureDestination, string> = {
  quick_action: 'Quick Action · starts on My Day',
  operational_available_work: 'Operational Action · starts in Available',
  routine_template_request: 'Routine · your manager reviews the schedule',
  self_development_plan: 'Self-Development · starts in Available',
  collaborative_contribution: 'Contribution',
  major_project_request: 'Major Project proposal · your manager reviews it',
  mandatory_operational_action: 'Mandatory · starts immediately',
};

/**
 * Chooses a destination from what the person actually told us.
 *
 * Nothing here reads the title. The previous version matched wording lists to
 * decide that "weekly toolbox talk" was a routine and "roll out the new permit
 * system" was a major programme. That is the same hidden inference the module
 * header already rejects for safety wording, applied to three other kinds of
 * work — and it produced confident rule codes for guesses. Work type is now
 * chosen from a short list, and the only remaining question is asked out loud.
 */
export function classifyCapture(input: CaptureInput): CaptureRecommendation {
  const build = (
    destination: CaptureDestination,
    ruleCode: ClassificationRuleCode,
    ruleText: string,
    urgencyQuestion: string | null = null,
  ): CaptureRecommendation => ({
    destination,
    ruleCode,
    ruleText,
    summary: SUMMARY[destination],
    urgencyQuestion,
  });

  // First, because section 8.6 forbids any other path to a mandatory outcome.
  // Reachable only from "Report urgent issue", where a person answered.
  if (input.needsImmediateControlledAction === true) {
    return build(
      'mandatory_operational_action',
      'explicit_urgent_confirmed',
      'The person confirmed this needs immediate controlled action.',
    );
  }

  if (input.workType === 'routine') {
    return build(
      'routine_template_request',
      'chosen_routine',
      'The person chose Routine as the work type.',
    );
  }

  if (input.workType === 'self_development') {
    return build(
      'self_development_plan',
      'chosen_self_development',
      'The person chose Self-Development as the work type.',
    );
  }

  if (input.workType === 'major_project') {
    return build(
      'major_project_request',
      'chosen_major_project',
      'The person chose Major Project proposal as the work type.',
    );
  }

  // Ordinary work. One answered question decides it; an unanswered one leaves
  // it Operational, which is the safer default because it carries a focus
  // target and stays visible rather than disappearing into a same-day list.
  if (input.requiresFollowUp === false) {
    return build(
      'quick_action',
      'normal_no_followup',
      'The person said this needs no follow-up after the day they start.',
    );
  }

  return build(
    'operational_available_work',
    'normal_with_followup',
    input.requiresFollowUp === true
      ? 'The person said this needs follow-up after the day they start.'
      : 'Ordinary work, with no follow-up answer given.',
  );
}

/**
 * The destinations offered by "Change type" (section 8.4).
 *
 * Two deliberate absences:
 *
 *   Mandatory Operational Action — section 8.6 keeps it out of the ordinary
 *   list; it is reachable only by answering the urgency question.
 *
 *   Collaborative Contribution — v40 section 8 removes it. A contribution is
 *   created by assigning a checklist item on an existing task, which puts it in
 *   that person's Shared view without duplicating the parent or moving primary
 *   ownership.
 */
export const SELECTABLE_DESTINATIONS: readonly CaptureDestination[] = [
  'quick_action',
  'operational_available_work',
  'routine_template_request',
  'self_development_plan',
  'major_project_request',
];

export const DESTINATION_LABELS: Record<CaptureDestination, string> = {
  quick_action: 'Quick Action',
  operational_available_work: 'Operational Available Work',
  routine_template_request: 'Routine Template Request',
  self_development_plan: 'Self-Development Plan',
  collaborative_contribution: 'Collaborative Contribution',
  major_project_request: 'Major Project Request',
  mandatory_operational_action: 'Mandatory Operational Action',
};

/**
 * Section 8.8 — which destinations genuinely need manager or administrator
 * review. Everything else the employee may simply create.
 */
export function requiresGovernanceReview(destination: CaptureDestination): boolean {
  return destination === 'major_project_request' || destination === 'routine_template_request';
}

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

import type { CaptureDestination, CaptureTiming } from './types';

export interface CaptureInput {
  title: string;
  timing: CaptureTiming;
  /** Answer to the one follow-up question, when it was asked (section 8.5). */
  requiresFollowUp?: boolean | null;
  /** Answer to the explicit urgency question, when it was asked (section 8.6). */
  needsImmediateControlledAction?: boolean | null;
}

/**
 * Stable identifiers for the deterministic rules. Stored on the task so the
 * reason a work class was chosen survives long after the wording of the
 * sentence shown at capture time has been reworded (section 12).
 */
export type ClassificationRuleCode =
  | 'explicit_urgent_confirmed'
  | 'recurring_schedule'
  | 'self_development_topic'
  | 'major_programme_scope'
  | 'continued_followup_yes'
  | 'same_day_no_followup'
  | 'same_day_pending_answer'
  | 'multi_day_default';

export interface CaptureRecommendation {
  destination: CaptureDestination;
  /** One sentence, shown on the result screen (section 8.4). */
  reason: string;
  /** Section 12 — the rule that produced this, for the audit trail. */
  ruleCode: ClassificationRuleCode;
  /** The same rule in the words the person saw. */
  ruleText: string;
  /** Section 8.4 — the capacity effect line. */
  capacityEffect: string;
  /** Section 8.4 — the manager visibility effect line. */
  managerVisibility: string;
  /**
   * The single follow-up question to ask, when the rules cannot classify
   * confidently (section 8.5). Null when no question is needed.
   */
  followUpQuestion: string | null;
  /**
   * Section 8.6 — set when potentially urgent wording was detected. The
   * interface must ask this question and must NOT classify as mandatory on the
   * strength of the wording alone.
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

/** The clarifying question from section 8.5. */
export const FOLLOW_UP_QUESTION = 'Will this require continued follow-up after today?';

// ---------------------------------------------------------------------------
// Wording signals
//
// These detect *shape* — does this repeat, is it about my own capability, is it
// a programme — and nothing else. There is deliberately no safety or urgency
// list here (v40 section 13): urgency is a question a person answers, never
// something inferred from a noun in a title.
// ---------------------------------------------------------------------------

const RECURRING = [
  'every day',
  'every week',
  'every month',
  'each week',
  'each month',
  'each day',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'recurring',
  'routine',
  'regular check',
  'periodic',
];

const SELF_DEVELOPMENT = [
  'training course',
  'certification',
  'certificate',
  'e-learning',
  'elearning',
  'self-learning',
  'study',
  'revision',
  'exam',
  'coaching',
  'mentoring',
  'competency',
  'upskill',
  'learn ',
  'course',
];

const MAJOR_PROJECT = [
  'programme',
  'program ',
  'roll out',
  'rollout',
  'implement across',
  'company-wide',
  'site-wide',
  'transformation',
  'strategy',
  'strategic',
  'overhaul',
  'introduce a',
  'new system',
];

function mentions(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

// ---------------------------------------------------------------------------
// Presentation helpers for the result screen (section 8.4)
// ---------------------------------------------------------------------------

const CAPACITY_EFFECT: Record<CaptureDestination, string> = {
  quick_action: 'Does not use a focus target.',
  operational_available_work: 'Uses an Operational Action focus target once you activate it.',
  routine_template_request: 'Routine work does not use a focus target.',
  self_development_plan: 'Uses your Self-Development Plan focus target once activated.',
  collaborative_contribution: 'Does not use a separate focus target.',
  // Retained for records captured before v40 removed this destination. It is
  // no longer reachable from Capture Work.
  major_project_request: 'Uses your Major Project focus target once approved and activated.',
  mandatory_operational_action:
    'Activates immediately and may take you over your focus target, which is allowed.',
};

const MANAGER_VISIBILITY: Record<CaptureDestination, string> = {
  quick_action: 'Appears in your manager’s weekly summary, not as an individual alert.',
  operational_available_work: 'Visible to your manager in Team Focus. No approval needed.',
  routine_template_request: 'Your manager reviews the routine before occurrences are generated.',
  self_development_plan: 'Visible to your manager in Team Focus. No approval needed.',
  collaborative_contribution: 'Visible to the owner of the task you are contributing to.',
  major_project_request: 'Your manager reviews this proposal before it becomes a project.',
  mandatory_operational_action: 'Your manager is notified immediately.',
};

/**
 * Recommends one destination for captured work.
 *
 * Order matters. The urgency question comes first because section 8.6 forbids
 * urgent wording from silently becoming a Mandatory Operational Action; the
 * caller must ask and get an answer before any mandatory outcome is reachable.
 */
export function classifyCapture(input: CaptureInput): CaptureRecommendation {
  const text = input.title.toLowerCase().trim();

  const build = (
    destination: CaptureDestination,
    ruleCode: ClassificationRuleCode,
    reason: string,
    followUpQuestion: string | null = null,
  ): CaptureRecommendation => ({
    destination,
    reason,
    ruleCode,
    // The audit trail keeps the sentence the person actually read, so a later
    // rewording of `reason` cannot retroactively change what they were told.
    ruleText: reason,
    capacityEffect: CAPACITY_EFFECT[destination],
    managerVisibility: MANAGER_VISIBILITY[destination],
    followUpQuestion,
    // v40 section 13 — nothing in a title can raise this question any more. It
    // belongs to the explicit safety path, which sets the answer before calling
    // this function at all.
    urgencyQuestion: null,
  });

  // Section 8.6 — the ANSWER decides, and it decides on its own. This is the
  // only route to mandatory classification: it is reached from the explicit
  // "Report urgent safety or compliance work" action, where the person answered
  // the question themselves. No wording anywhere can set it.
  if (input.needsImmediateControlledAction === true) {
    return build(
      'mandatory_operational_action',
      'explicit_urgent_confirmed',
      'You confirmed this needs immediate controlled action, so it is treated as mandatory work.',
    );
  }

  if (mentions(text, RECURRING)) {
    return build(
      'routine_template_request',
      'recurring_schedule',
      'You described work that repeats on a schedule, so it belongs to a routine rather than a one-off task.',
    );
  }

  if (mentions(text, SELF_DEVELOPMENT)) {
    return build(
      'self_development_plan',
      'self_development_topic',
      'You described building your own capability, which belongs in your Self-Development Plan.',
    );
  }

  if (mentions(text, MAJOR_PROJECT)) {
    return build(
      'major_project_request',
      'major_programme_scope',
      'You described a sustained change programme, which needs to be agreed as a Major Project.',
    );
  }

  // Timing is the strongest ordinary signal. Same-day work with no follow-up is
  // a Quick Action (section 6.3).
  if (input.timing === 'today') {
    if (input.requiresFollowUp === true) {
      return build(
        'operational_available_work',
        'continued_followup_yes',
        'You said continued follow-up is needed, so this is sustained work rather than a Quick Action.',
      );
    }

    if (input.requiresFollowUp === false) {
      return build(
        'quick_action',
        'same_day_no_followup',
        'You said this is due today and needs no follow-up afterwards, so it fits a Quick Action.',
      );
    }

    // Section 8.5 — one relevant follow-up question, not the whole model.
    return build(
      'quick_action',
      'same_day_pending_answer',
      'Due today and small enough to finish in one go.',
      FOLLOW_UP_QUESTION,
    );
  }

  return build(
    'operational_available_work',
    'multi_day_default',
    'You said this needs more than a day, so it becomes Available Work you can activate when ready.',
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

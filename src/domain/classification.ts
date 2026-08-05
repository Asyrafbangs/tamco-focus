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

export interface CaptureRecommendation {
  destination: CaptureDestination;
  /** One sentence, shown on the result screen (section 8.4). */
  reason: string;
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
// These detect *topic*, never authority. A safety keyword decides which
// question to ask, not what the work becomes.
// ---------------------------------------------------------------------------

const SAFETY_SENSITIVE = [
  'safety',
  'ppe',
  'hazard',
  'incident',
  'injury',
  'accident',
  'legal',
  'compliance',
  'regulatory',
  'audit finding',
  'lockout',
  'tagout',
  'spill',
  'fire',
  'emergency',
  'evacuat',
  'toxic',
  'chemical exposure',
];

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

const COLLABORATIVE = [
  'help ',
  'assist ',
  'support ',
  'contribute to',
  'on behalf of',
  'together with',
  'part of the',
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
  major_project_request: 'Uses your Major Project focus target once approved and activated.',
  mandatory_operational_action:
    'Activates immediately and may take you over your focus target, which is allowed.',
};

const MANAGER_VISIBILITY: Record<CaptureDestination, string> = {
  quick_action: 'Appears in your manager’s weekly summary, not as an individual alert.',
  operational_available_work: 'Visible to your manager in Team Load. No approval needed.',
  routine_template_request: 'Your manager reviews the routine before occurrences are generated.',
  self_development_plan: 'Visible to your manager in Team Load. No approval needed.',
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
    reason: string,
    followUpQuestion: string | null = null,
    urgencyQuestion: string | null = null,
  ): CaptureRecommendation => ({
    destination,
    reason,
    capacityEffect: CAPACITY_EFFECT[destination],
    managerVisibility: MANAGER_VISIBILITY[destination],
    followUpQuestion,
    urgencyQuestion,
  });

  // Section 8.6 — the ANSWER decides, and it decides on its own. Wording only
  // determines whether the question gets asked, so this check deliberately sits
  // above the keyword test: an employee who reports urgent safety work through
  // the secondary "Report urgent safety or compliance work" action (section 8.2)
  // must reach mandatory classification even when their wording happens to
  // contain none of the terms below.
  if (input.needsImmediateControlledAction === true) {
    return build(
      'mandatory_operational_action',
      'You confirmed this needs immediate controlled action, so it is treated as mandatory work.',
    );
  }

  const safetySensitive = mentions(text, SAFETY_SENSITIVE);

  // The question has not been answered yet: ask it, and recommend the ordinary
  // destination in the meantime so the screen is never blank.
  if (safetySensitive && input.needsImmediateControlledAction == null) {
    return build(
      'operational_available_work',
      'This mentions safety or compliance, so one question decides how it is handled.',
      null,
      URGENCY_QUESTION,
    );
  }

  if (mentions(text, RECURRING)) {
    return build(
      'routine_template_request',
      'This describes work that repeats on a schedule, so it belongs to a routine rather than a one-off task.',
    );
  }

  if (mentions(text, SELF_DEVELOPMENT)) {
    return build(
      'self_development_plan',
      'This describes building your own capability, which belongs in your Self-Development Plan.',
    );
  }

  if (mentions(text, MAJOR_PROJECT)) {
    return build(
      'major_project_request',
      'This looks like a sustained change programme, which needs to be agreed as a Major Project.',
    );
  }

  if (mentions(text, COLLABORATIVE)) {
    return build(
      'collaborative_contribution',
      'This reads as a contribution to someone else’s work rather than something you would own outright.',
    );
  }

  // Timing is the strongest ordinary signal. Same-day work with no follow-up is
  // a Quick Action (section 6.3).
  if (input.timing === 'today') {
    if (input.requiresFollowUp === true) {
      return build(
        'operational_available_work',
        'You said this needs follow-up after today, so it is sustained work rather than a Quick Action.',
      );
    }

    if (input.requiresFollowUp === false) {
      return build(
        'quick_action',
        'This is due today and needs no follow-up afterwards, so it fits a Quick Action.',
      );
    }

    // Section 8.5 — one relevant follow-up question, not the whole model.
    return build(
      'quick_action',
      'Due today and small enough to finish in one go.',
      FOLLOW_UP_QUESTION,
    );
  }

  return build(
    'operational_available_work',
    'This needs more than a day, so it becomes Operational Available Work you can activate when ready.',
  );
}

/**
 * The destinations offered by "Change type" (section 8.4).
 *
 * Mandatory Operational Action is deliberately absent: section 8.6 states it is
 * not included in the ordinary Change type list and is reachable only by
 * answering the urgency question.
 */
export const SELECTABLE_DESTINATIONS: readonly CaptureDestination[] = [
  'quick_action',
  'operational_available_work',
  'routine_template_request',
  'self_development_plan',
  'collaborative_contribution',
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

/**
 * ESH Finding Management — the vocabulary shared by the screens (v197).
 *
 * The rules themselves live in the database procedures, which apply them
 * atomically (docs/esh-finding-management-impact-map.md). What is here is what
 * the screens need to say about them: labels, the meaning of each problem code
 * a procedure returns, and how the register groups work. Pure, so it can be
 * tested without a server.
 */

export type EshPreset = 'viewer' | 'coordinator' | 'verifier';

/** What the signed-in person may do in Finding Management, as the server says. */
export interface EshAccess {
  enabled: boolean;
  preset: EshPreset | null;
  scopeAll: boolean;
  departmentIds: string[];
  canCoordinate: boolean;
  canVerify: boolean;
  canManageReports: boolean;
  authorizationVersion: number | null;
}

export const NO_ESH_ACCESS: EshAccess = {
  enabled: false,
  preset: null,
  scopeAll: false,
  departmentIds: [],
  canCoordinate: false,
  canVerify: false,
  canManageReports: false,
  authorizationVersion: null,
};

export const ESH_PRESET_LABELS: Record<EshPreset, string> = {
  viewer: 'Viewer',
  coordinator: 'Coordinator',
  verifier: 'Verifier',
};

export const ESH_PRESET_DESCRIPTIONS: Record<EshPreset, string> = {
  viewer: 'Reads findings in scope. Changes nothing.',
  coordinator: 'Creates and assigns findings, and manages their owners and dates.',
  verifier: 'Everything a Coordinator does, and reviews, accepts and closes.',
};

export type FindingStatus =
  'draft' | 'new' | 'open' | 'closed' | 'cancelled' | 'duplicate' | 'withdrawn';

export type ActionState =
  'draft' | 'assigned' | 'in_progress' | 'awaiting_verification' | 'accepted' | 'cancelled';

export type ActionPriority = 'urgent' | 'high' | 'normal';

export type RiskLevel = 'not_assessed' | 'low' | 'medium' | 'high' | 'critical';

export type FindingSource = 'esh_inspection' | 'audit' | 'incident' | 'observation' | 'other';

export const ACTION_STATE_LABELS: Record<ActionState, string> = {
  draft: 'Draft',
  assigned: 'Assigned',
  in_progress: 'In progress',
  awaiting_verification: 'Awaiting ESH review',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
};

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  draft: 'Draft',
  new: 'Not assigned',
  open: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
  duplicate: 'Duplicate',
  withdrawn: 'Withdrawn',
};

export const PRIORITY_LABELS: Record<ActionPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
};

/** v209 — what became of a finding nobody is going to correct (§6). */
export const OUTCOME_LABELS: Record<string, string> = {
  cancelled: 'Cancelled',
  withdrawn: 'Withdrawn',
  duplicate: 'Duplicate',
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  not_assessed: 'Not assessed',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const SOURCE_LABELS: Record<FindingSource, string> = {
  esh_inspection: 'ESH inspection',
  audit: 'Audit',
  incident: 'Incident',
  observation: 'Observation',
  other: 'Other',
};

/**
 * The same shape `focus.esh_email_is_valid` accepts, so the form can refuse an
 * address before sending it. The database check is the one that counts; this
 * only saves a round trip, and an integration test holds the two together.
 */
export const EMAIL_SHAPE =
  /^[^@\s<>(),;:"[\]]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 254 && EMAIL_SHAPE.test(trimmed);
}

/** TAMCO's comparison rule, as `focus.esh_canonical_email` applies it. */
export function canonicalEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Addresses typed into one escalation level: split on commas, semicolons and
 * whitespace, blanks dropped, and a repeat of the same address kept once.
 */
export function splitEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.trim();
    if (!address) continue;
    const key = canonicalEmail(address);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

/** What each problem a save can return means, in the form's own words. */
export const FINDING_PROBLEM_MESSAGES: Record<string, { field: string; message: string }> = {
  title_required: { field: 'title', message: 'Give the finding a title.' },
  description_required: { field: 'description', message: 'Describe what was found.' },
  department_required: {
    field: 'accountable_department_id',
    message: 'Choose the department accountable for putting it right.',
  },
  department_invalid: { field: 'accountable_department_id', message: 'Choose a department.' },
  department_not_found: {
    field: 'accountable_department_id',
    message: 'That department no longer exists.',
  },
  department_out_of_scope: {
    field: 'accountable_department_id',
    message: 'That department is outside your Finding Management scope.',
  },
  reported_on_required: { field: 'reported_on', message: 'Give the date it was reported.' },
  reported_on_invalid: { field: 'reported_on', message: 'That is not a date.' },
  source_invalid: { field: 'source', message: 'Choose where the finding came from.' },
  risk_invalid: { field: 'risk_level', message: 'Choose a risk level, or Not assessed.' },
  required_outcome_required: {
    field: 'required_outcome',
    message: 'Say what the corrected condition must be.',
  },
  priority_required: { field: 'priority', message: 'Choose Urgent, High or Normal.' },
  priority_invalid: { field: 'priority', message: 'Choose Urgent, High or Normal.' },
  owner_email_required: { field: 'owner_email', message: 'Enter the Action Owner’s email.' },
  owner_email_invalid: {
    field: 'owner_email',
    message: 'That is not an email address.',
  },
  due_date_required: { field: 'due_date', message: 'Give a due date.' },
  due_date_invalid: { field: 'due_date', message: 'That is not a date.' },
  due_time_invalid: { field: 'due_time', message: 'That is not a time.' },
  due_before_reported: {
    field: 'due_date',
    message: 'The due date is before the finding was reported.',
  },
  reviewer_invalid: { field: 'reviewer_user_id', message: 'Choose a reviewer.' },
  reviewer_not_verifier: {
    field: 'reviewer_user_id',
    message: 'The reviewer must be an enabled ESH Verifier.',
  },
  reviewer_is_owner: {
    field: 'reviewer_user_id',
    message: 'The Action Owner cannot verify their own correction. Choose another reviewer.',
  },
  escalation_decision_required: {
    field: 'escalation',
    message: 'Add at least one Level 1 address, or record why there is no further escalation.',
  },
  escalation_invalid: { field: 'escalation', message: 'The escalation route could not be read.' },
  escalation_level_invalid: { field: 'escalation', message: 'Escalation levels run from 1 to 9.' },
  escalation_email_invalid: {
    field: 'escalation',
    message: 'One of the escalation addresses is not an email address.',
  },
  escalation_levels_have_gaps: {
    field: 'escalation',
    message: 'Fill the escalation levels in order, starting at Level 1.',
  },
};

export const FINDING_WARNING_MESSAGES: Record<string, string> = {
  owner_is_escalation_recipient:
    'The Action Owner is also an escalation recipient, so an escalation would reach the same person.',
};

export function findingProblem(code: string): { field: string; message: string } {
  return (
    FINDING_PROBLEM_MESSAGES[code] ?? { field: 'form', message: 'Something needs correcting.' }
  );
}

/**
 * Register views (§24). One set of definitions, used for the list and for any
 * count that links to it, so a number and the list behind it never disagree.
 */
export type RegisterFilter = 'attention' | 'open' | 'overdue' | 'closed';

export const REGISTER_FILTERS: Array<{ key: RegisterFilter; label: string }> = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'open', label: 'All open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'closed', label: 'Closed' },
];

export function registerFilterFrom(value: string | undefined): RegisterFilter {
  return REGISTER_FILTERS.some((filter) => filter.key === value)
    ? (value as RegisterFilter)
    : 'attention';
}

/** Whole days overdue, counted in the organisation's calendar. */
export function daysOverdue(dueAt: string, now: Date, timeZone: string): number {
  const day = (instant: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
  const due = new Date(`${day(new Date(dueAt))}T00:00:00Z`).getTime();
  const today = new Date(`${day(now)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((today - due) / 86_400_000));
}

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

/**
 * v305 — the database's own-work test, mirrored where the page can use it.
 *
 * `focus.esh_is_own_work` decides whether somebody may verify a correction,
 * and it matches on two things:
 *
 *     p.canonical_email = focus.esh_canonical_email(u.email)
 *     or p.staff_user_id = p_user_id
 *
 * The finding page was matching on the first alone. The two agree today only
 * by accident of how principals are created: `esh_principal_for` sets
 * `staff_user_id` exactly when the emails already match. Change a staff
 * member's profile email and they part, and then the page offers a Verify
 * panel that `esh_verify_submission` answers with `self_verification` — a
 * button the procedure refuses, which is the one thing the check exists to
 * prevent.
 *
 * Both arms live here so the rule is stated once and can be tested, rather
 * than being an email comparison repeated at each screen that needs it.
 */
export function isOwnWork(input: {
  ownerEmail: string | null;
  ownerStaffUserId: string | null;
  viewerEmail: string;
  viewerUserId: string;
}): boolean {
  if (input.ownerStaffUserId && input.ownerStaffUserId === input.viewerUserId) return true;
  if (!input.ownerEmail) return false;
  return canonicalEmail(input.ownerEmail) === canonicalEmail(input.viewerEmail);
}

/**
 * v305 — what an action's state means to the person reading it.
 *
 * `in_progress` carries two situations that a reader has to tell apart, and
 * the label shows only one of them.
 *
 * It is entered honestly when the owner starts: `esh_guest_send_message` moves
 * `assigned` to `in_progress` the first time the owner writes, and "In
 * progress" is exactly right for that. But `esh_verify_submission` returns an
 * action to the same state when it REJECTS a submission, and so does
 * `esh_guest_withdraw` and `esh_reopen_finding`. A correction ESH has sent
 * back therefore reads identically to one being worked on — momentum, where in
 * fact the work has bounced and the clock is still running against the owner.
 *
 * Only the rejection is reworded, because only the rejection is a decision
 * somebody made that the label hides. A withdrawal or a reopen leaves the work
 * genuinely with the owner, which is what "In progress" already says.
 *
 * The audience matters as much as the state. ESH needs to know the work
 * bounced; the owner needs to know what is being asked, and "Sent back" told
 * to the person who must now act reads as a verdict rather than a request.
 */
export function actionStateWords(
  state: ActionState,
  options: { changesRequested?: boolean; audience?: 'esh' | 'owner' } = {},
): string {
  if (state !== 'in_progress' || !options.changesRequested) return ACTION_STATE_LABELS[state];
  return options.audience === 'owner' ? 'More needed from you' : 'Sent back for more';
}

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
  raised_in_error: 'Raised in error',
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
export type RegisterFilter =
  | 'attention'
  | 'open'
  | 'unprotected'
  | 'overdue'
  | 'verification'
  | 'unassessed'
  | 'closed'
  | 'all';

export const REGISTER_FILTERS: Array<{ key: RegisterFilter; label: string }> = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'open', label: 'All open' },
  /*
   * v4.1 S1 - where the protection figure on Today lands.
   *
   * Today says how many significant risks have no verified protection. That
   * number used to link to every open finding, so a reader who clicked three
   * arrived at forty rows and had no way to tell which three were meant. The
   * view exists so the number has somewhere to go that holds exactly it.
   */
  { key: 'unprotected', label: 'Unprotected risks' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'verification', label: 'Waiting verification' },
  /*
   * v269 - findings nobody has graded yet.
   *
   * A count on the dashboard could be read and not acted on. These are
   * invisible to every risk-based figure in the product, including the one
   * that asks whether anybody is protected, so they need somewhere to go.
   */
  { key: 'unassessed', label: 'Not assessed' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All records' },
];

/**
 * v217 - the views the register offers as chips.
 *
 * Closed is still a register view, and every link to it keeps working; it is
 * simply reached from the module's own navigation now, because two navigation
 * systems on one screen made the reader choose between them. Unprotected
 * risks is the same arrangement in reverse: a counter on Today owns the link,
 * so the chip bar does not grow a seventh entry for it.
 */
const OFF_CHIP: RegisterFilter[] = ['closed', 'unprotected'];

export const REGISTER_VIEWS = REGISTER_FILTERS.filter((filter) => !OFF_CHIP.includes(filter.key));

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

export interface EshAccessAnswer {
  enabled?: boolean;
  preset?: EshPreset;
  scope_all?: boolean;
  department_ids?: string[];
  can_coordinate?: boolean;
  can_verify?: boolean;
  can_manage_reports?: boolean;
  authorization_version?: number;
}

/**
 * The access an answer describes — or an exception, when there was no answer.
 *
 * Both outcomes deny access, so this still fails closed. What changed is what
 * the reader is told. Treating a failed read as `NO_ESH_ACCESS` sent it to
 * `notFound()`, so a coordinator with every permission met "This page could not
 * be found" whenever the database could not be reached — a statement that is
 * simply false, indistinguishable from being disabled, and invisible to anybody
 * not reading server logs. It happened four times in one local gate run, as
 * `An invalid response was received from the upstream server`, and failed an
 * unrelated browser case with a 404 that looked like a product bug.
 *
 * Throwing instead surfaces it as an error, which is what it is. Nothing is
 * disclosed to a disabled person by this: they get a clean answer saying
 * `enabled: false`, and that still returns `NO_ESH_ACCESS` and still 404s.
 */
export function accessFromAnswer(
  answer: EshAccessAnswer | null,
  failure: { code?: string; message: string } | null,
): EshAccess {
  if (failure) {
    throw new Error(
      `Finding Management access could not be read: ${failure.code ?? 'unknown'} ${failure.message}`,
    );
  }
  const raw = answer ?? {};
  if (!raw.enabled || !raw.preset) return NO_ESH_ACCESS;
  return {
    enabled: true,
    preset: raw.preset,
    scopeAll: Boolean(raw.scope_all),
    departmentIds: raw.department_ids ?? [],
    canCoordinate: Boolean(raw.can_coordinate),
    canVerify: Boolean(raw.can_verify),
    canManageReports: Boolean(raw.can_manage_reports),
    authorizationVersion: raw.authorization_version ?? null,
  };
}

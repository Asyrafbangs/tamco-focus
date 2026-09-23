/**
 * ESH Finding Management — verification, closure and changes (v200, §13,
 * §14). The words the screens use for what the procedures decide.
 */

export type VerificationMethod = 'document_review' | 'site_verification' | 'other';

/**
 * How a correction was verified (§13). Evidence is not accepted because a
 * photo exists; the method says what was actually done, and it is recorded.
 */
export const VERIFICATION_METHODS: Array<{ value: VerificationMethod; label: string }> = [
  { value: 'document_review', label: 'Photo / document review' },
  { value: 'site_verification', label: 'Site verification' },
  { value: 'other', label: 'Another documented method' },
];

export const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  document_review: 'Photo / document review',
  site_verification: 'Site verification',
  other: 'Another documented method',
};

const FIELD_PROBLEMS: Record<string, string> = {
  method_required: 'choose how it was verified',
  note_required: 'say what is still needed',
  due_decision_required: 'say whether the due date stays or changes',
  due_required: 'choose the new due date',
  reason_required: 'give a reason',
  decision_required: 'choose accept or request improvement',
  owner_email_invalid: 'enter a valid email address',
};

const CODE_PROBLEMS: Record<string, string> = {
  not_permitted: 'Only an ESH Verifier can decide a submission.',
  not_found: 'This is no longer available to you.',
  stale_submission:
    'This is no longer the version waiting for review — the owner may have withdrawn it. Reload the finding.',
  self_verification:
    'Work submitted from your own address is verified by another ESH Verifier (segregation of duties).',
  not_closed: 'This finding is not closed.',
  action_closed: 'This action is closed, so it cannot be changed.',
  decide_submission_first: 'Decide the submission waiting for review before reassigning.',
  same_owner: 'That address already owns this action.',
  // v208
  not_open: 'Priority can only be changed while the action is still open work.',
  unchanged: 'That is already its priority.',
  reason_required:
    'Say why, in a few words: a priority nobody can account for is how everything becomes Urgent.',
  // v209
  already_resolved: 'This finding already has an outcome recorded.',
  already_closed: 'A closed finding cannot be cancelled; reopen it first if that is what you mean.',
  duplicate_of_required: 'Say which finding this one repeats.',
  duplicate_not_found: 'That reference is not a finding you can see.',
  duplicate_not_live: 'That finding already has an outcome of its own.',
};

const FAILED = 'Something went wrong and nothing was changed. Try again.';

/** One sentence for what a procedure refused, listing the fields it named. */
export function verificationProblem(code: string | undefined, problems?: string[]): string {
  if (problems?.length) {
    const parts = problems.map((problem) => FIELD_PROBLEMS[problem]).filter(Boolean) as string[];
    if (parts.length) {
      const joined =
        parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
      return `Please ${joined}.`;
    }
  }
  return (code ? CODE_PROBLEMS[code] : undefined) ?? FAILED;
}

/** How far back the Closed list reaches (§24, visual reference 14). */
export const CLOSED_PERIODS: Array<{ days: number; label: string }> = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
  { days: 0, label: 'All time' },
];

export function closedPeriodFrom(value: string | undefined): number {
  const days = Number.parseInt(value ?? '', 10);
  return CLOSED_PERIODS.some((period) => period.days === days) ? days : 30;
}

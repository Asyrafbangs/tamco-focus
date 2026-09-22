/**
 * Several actions at once, in the owner's words (v206, §40).
 *
 * The operations are deliberately few, and none of them finishes anything by
 * itself: an update is a message, a request for more time is a request, shared
 * evidence is a file on each action, and a batch submission is a submission
 * each. There is no "mark all done" here because there is no such thing.
 */

export type BulkPurpose = 'update' | 'extension' | 'evidence' | 'submit';

export const BULK_OPERATIONS: Array<{
  key: BulkPurpose;
  label: string;
  lead: string;
  confirm: string;
}> = [
  {
    key: 'update',
    label: 'Send a progress update',
    lead: 'One update, posted to each action you have chosen, in your name. It does not submit anything.',
    confirm: 'Send update',
  },
  {
    key: 'extension',
    label: 'Ask for more time',
    lead: 'One explanation and a date you are asking for. ESH decides each action separately; nothing changes until they do.',
    confirm: 'Send request',
  },
  {
    key: 'submit',
    label: 'Submit for review',
    lead: 'Each action is checked and sent on its own, with its own result and evidence. ESH verifies them one at a time.',
    confirm: 'Submit these',
  },
];

export const BULK_MAX = 25;

const ITEM_CODES: Record<string, string> = {
  not_available: 'No longer yours to change.',
  already_submitted: 'Already with ESH for review.',
  body_required: 'Needs something written.',
  body_too_long: 'Too long to send.',
  file_required: 'Needs a result and at least one file.',
  evidence_incomplete: 'Needs a result and at least one file.',
  result_required: 'Needs a result.',
  slow_down: 'Sent too quickly; try this one again.',
  copy_failed: 'The file did not copy; try again.',
  no_session: 'Your access ended; open your link again.',
};

export function bulkItemProblem(code: string | null | undefined): string {
  if (!code) return 'Done.';
  return ITEM_CODES[code] ?? 'Did not go through; try this one again.';
}

const OPERATION_CODES: Record<string, string> = {
  no_session: 'Your access has ended. Open the link in your email again.',
  not_available: 'This has to be done from your My Actions link.',
  nothing_selected: 'Choose the actions first.',
  too_many: `That is more than ${BULK_MAX} at once.`,
  date_required: 'Choose the date you are asking for.',
  date_too_far: 'That date is too far away to ask for.',
  invalid: 'Something in that was not usable.',
};

export function bulkProblem(code: string | undefined): string {
  if (!code) return 'That did not go through. Try again.';
  return OPERATION_CODES[code] ?? 'That did not go through. Try again.';
}

export interface BulkItemResult {
  actionId: string;
  state: 'succeeded' | 'failed' | 'skipped';
  code: string | null;
}

export interface BulkResult {
  operationId: string;
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  items: BulkItemResult[];
}

/**
 * What to say afterwards.
 *
 * Never "all done": a batch that half worked says so and names what did not,
 * because the owner has to know which ones they still owe (§40).
 */
export function bulkSummary(result: BulkResult, purpose: BulkPurpose): string {
  const count = `${result.succeeded} ${result.succeeded === 1 ? 'action' : 'actions'}`;
  const lead =
    result.succeeded === 0
      ? 'Nothing went through'
      : purpose === 'submit'
        ? `${count} submitted for review`
        : purpose === 'evidence'
          ? `The file is on ${count}`
          : purpose === 'extension'
            ? `More time asked for on ${count}`
            : `Your update is on ${count}`;
  const parts = [lead];
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  if (result.failed > 0) parts.push(`${result.failed} did not go through`);
  return `${parts.join(', ')}.`;
}

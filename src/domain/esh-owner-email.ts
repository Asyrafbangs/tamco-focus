/**
 * Owner email as a mode (v223, §43.4).
 *
 * Test mode holds email to contacts nobody has cleared, which is how the
 * restricted rollout has always behaved. Live clears a contact the moment
 * work is assigned to them and sends at once. Either way, a contact an
 * administrator switched off stays off.
 */

export type OwnerEmailMode = 'held' | 'live';

export interface HeldSummary {
  mode: OwnerEmailMode;
  /** Every held notice. */
  held: number;
  /** Of which, assignment emails and backlog summaries. */
  assignments: number;
  /** Distinct people they are for. */
  recipients: number;
  /** People an administrator switched off, whose email Release all leaves held. */
  switchedOff: number;
}

export const OWNER_EMAIL_MODES: Array<{ key: OwnerEmailMode; label: string; hint: string }> = [
  {
    key: 'held',
    label: 'Test mode — emails held',
    hint: 'Email to a new owner waits until it is released. Nothing reaches anybody by accident.',
  },
  {
    key: 'live',
    label: 'Live — assignment emails send automatically',
    hint: 'Assigning a finding emails its owner at once. Nobody has to release anything.',
  },
];

/** "94 assignment emails are being held", or null when nothing is. */
export function heldSentence(summary: HeldSummary | null): string | null {
  if (!summary || summary.held === 0) return null;
  const count = summary.assignments > 0 ? summary.assignments : summary.held;
  const noun = summary.assignments > 0 ? 'assignment email' : 'email';
  return `${count} ${noun}${count === 1 ? ' is' : 's are'} being held`;
}

const PROBLEMS: Record<string, string> = {
  not_permitted: 'Only an administrator can change owner email.',
  reason_required: 'Say why, in a few words. It is kept with the change.',
  invalid: 'Choose Test mode or Live.',
  rollout_not_configured: 'Finding Management has not been set up yet.',
};

export function ownerEmailProblem(code: string | undefined): string {
  return (
    (code ? PROBLEMS[code] : undefined) ?? 'Something went wrong and nothing changed. Try again.'
  );
}

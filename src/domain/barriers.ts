/**
 * Everything the application knows about how a barrier request presents itself
 * (v47 sections 1-2, 7-8).
 *
 * Two things used to be decided in five or six places at once: what a request
 * type is called, and where a "view this request" control should go. Both had
 * already drifted — one surface said "Provide approval" where another said
 * "Approve", and one link opened the task while another opened the barrier.
 *
 * They live here because they are properties of the request, not of the screen
 * that happens to be showing it. Nothing in this module reaches for a database
 * or a router, so every surface — server component, client component, test —
 * can ask the same question and get the same answer.
 *
 * Explicitly not inferred, ever. The employee chose `requested_action_type`
 * when they asked; reading their prose to guess what they meant would be
 * second-guessing an answer already given (section 7).
 */

export type BarrierActionType = 'decision' | 'approval' | 'support' | 'escalation' | 'other';

export interface BarrierActionConfig {
  /** The heading a person owing this action sees: "Decision needed". */
  title: string;
  /** The noun for the thing being waited on: "Decision". */
  noun: string;
  /** The label above the response box. */
  inputLabel: string;
  /** The button that submits the answer. */
  primaryAction: string;
  /** Present only where the request genuinely has two answers. */
  secondaryAction?: string;
  /** What a list row offers: "Provide decision", never "Open". */
  listAction: string;
  /** What the requester is told once the answer lands. */
  answeredHeadline: string;
}

const CONFIG: Record<BarrierActionType, BarrierActionConfig> = {
  decision: {
    title: 'Decision needed',
    noun: 'Decision',
    inputLabel: 'Your decision',
    primaryAction: 'Send decision',
    listAction: 'Provide decision',
    answeredHeadline: 'Decision received',
  },
  approval: {
    title: 'Approval requested',
    noun: 'Approval',
    inputLabel: 'Your response',
    // The one request with two real answers, so the one with two controls.
    primaryAction: 'Approve',
    secondaryAction: 'Request changes',
    listAction: 'Review approval',
    answeredHeadline: 'Approval answered',
  },
  support: {
    title: 'Support requested',
    noun: 'Support',
    inputLabel: 'Your response',
    primaryAction: 'Send response',
    listAction: 'Respond',
    answeredHeadline: 'Response received',
  },
  escalation: {
    title: 'Escalation requested',
    noun: 'Escalation',
    inputLabel: 'Response / action',
    primaryAction: 'Respond',
    listAction: 'Respond',
    answeredHeadline: 'Response received',
  },
  other: {
    title: 'Response requested',
    noun: 'Response',
    inputLabel: 'Your response',
    primaryAction: 'Respond',
    listAction: 'Respond',
    answeredHeadline: 'Response received',
  },
};

/**
 * Never throws and never returns undefined: an unrecognised type still has to
 * render a usable control, and "Respond" is true of every request.
 */
export function barrierAction(actionType: string | null | undefined): BarrierActionConfig {
  return CONFIG[(actionType ?? 'other') as BarrierActionType] ?? CONFIG.other;
}

/**
 * The one link that opens a barrier ready to act on (v47 sections 1-2).
 *
 * Notification, My Day, My Team, the task banner, the Meeting Queue and the
 * calendar event all build their destination here. When every surface computes
 * its own URL, one of them eventually computes a slightly different one and a
 * button quietly starts opening the wrong screen — or nothing at all.
 */
export function barrierHref(taskId: string, barrierId: string): string {
  return `/work?task=${taskId}&attention=barrier&barrier=${barrierId}`;
}

/**
 * What the control that opens a barrier should say (v47 sections 3-4, 40).
 *
 * Before an answer exists the reader is going to look at a question; after one
 * exists they are going to look at an answer. Calling both "View request"
 * makes the second a small lie, and the person clicks expecting the thing they
 * already read.
 */
export function barrierViewLabel(hasResponse: boolean, actionPending: boolean): string {
  return hasResponse && !actionPending ? 'View response' : 'View request';
}

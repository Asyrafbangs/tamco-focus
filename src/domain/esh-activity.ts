/**
 * What a finding's activity says to a person (v227, §21).
 *
 * The audit trail keeps every event, including the mechanics of getting an
 * email out: released, accepted by the mail server, a link opened. Those are
 * true and kept, but nobody deciding what to do next needs them in the story
 * of the finding. They belong to the delivery log, one press further away.
 */

export const HISTORY_LABELS: Record<string, string> = {
  finding_created: 'Finding recorded',
  action_assigned: 'Action assigned',
  action_started: 'Owner started the work',
  owner_message: 'Owner sent an update',
  esh_message: 'ESH wrote to the owner',
  escalation_message: 'Escalation contact replied',
  submission_created: 'Owner submitted for review',
  submission_accepted: 'ESH accepted the correction',
  changes_requested: 'ESH asked for more',
  finding_closed: 'Finding closed',
  finding_reopened: 'Finding reopened',
  finding_resolved: 'Finding cancelled or marked duplicate',
  finding_edited: 'Finding details corrected',
  risk_changed: 'Risk reassessed',
  priority_changed: 'Priority changed',
  due_changed: 'Due date changed',
  action_reassigned: 'Action given to another owner',
  submission_withdrawn: 'Owner withdrew a submission',
  original_evidence_added: 'Original evidence added',
  original_evidence_removed: 'Original evidence removed',
  escalation_acknowledged: 'Escalation acknowledged',
  import_note: 'Imported from the previous register',
};

/** Mechanics of delivery and access, kept in the record and out of the story. */
const TECHNICAL = new Set([
  'finding_draft_saved',
  'notification_released',
  'notification_sent',
  'notification_delivered',
  'notification_bounced',
  'notification_failed',
  'guest_link_redeemed',
  'guest_link_requested',
  'contact_access_enabled',
  'contact_access_disabled',
]);

export function isTechnicalEvent(eventType: string): boolean {
  return TECHNICAL.has(eventType) || eventType.startsWith('delivery_');
}

export interface ActivityEntry {
  eventType: string;
  occurredAt: string;
  actorName: string;
}

/** The events a person reads, oldest first, as the audit trail gives them. */
export function humanActivity<T extends ActivityEntry>(entries: T[]): T[] {
  return entries.filter((entry) => !isTechnicalEvent(entry.eventType));
}

export function activityLabel(eventType: string): string {
  return HISTORY_LABELS[eventType] ?? eventType.replace(/_/g, ' ');
}

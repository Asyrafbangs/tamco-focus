import { describe, expect, it } from 'vitest';

import { activityLabel, humanActivity, isTechnicalEvent } from '@/domain/esh-activity';
import { importReleaseSummary, type ImportSummaryRow } from '@/domain/esh-import';
import { FINDING_OUTCOMES } from '@/domain/esh-verification';

describe('v227 activity is the story, delivery is the log', () => {
  const history = [
    { eventType: 'finding_created', occurredAt: '2026-09-20T01:00:00Z', actorName: 'Izzul' },
    { eventType: 'notification_sent', occurredAt: '2026-09-20T01:01:00Z', actorName: 'System' },
    { eventType: 'guest_link_redeemed', occurredAt: '2026-09-20T02:00:00Z', actorName: 'Owner' },
    { eventType: 'submission_created', occurredAt: '2026-09-21T07:40:00Z', actorName: 'Owner' },
  ];

  it('keeps email mechanics out of what a person reads', () => {
    expect(isTechnicalEvent('notification_sent')).toBe(true);
    expect(isTechnicalEvent('notification_released')).toBe(true);
    expect(isTechnicalEvent('contact_access_enabled')).toBe(true);
    expect(humanActivity(history).map((entry) => entry.eventType)).toEqual([
      'finding_created',
      'submission_created',
    ]);
  });

  it('says what happened in words', () => {
    expect(activityLabel('submission_created')).toBe('Owner submitted for review');
    expect(activityLabel('risk_changed')).toBe('Risk reassessed');
    expect(activityLabel('something_new')).toBe('something new');
  });
});

describe('v227 cancelling is three honest choices', () => {
  it('offers Cancel, Duplicate and Raised in error, and no Withdraw', () => {
    expect(FINDING_OUTCOMES.map((outcome) => outcome.key)).toEqual([
      'cancelled',
      'duplicate',
      'raised_in_error',
    ]);
  });
});

describe('v227 an import is summarised before anybody is notified', () => {
  const rows: ImportSummaryRow[] = [
    { id: 'a', outcome: 'ready', problems: [], mapped: { owner_email: 'Amer@Tamco.com.my' } },
    { id: 'b', outcome: 'ready', problems: [], mapped: { owner_email: 'amer@tamco.com.my' } },
    { id: 'c', outcome: 'ready', problems: [], mapped: { owner_name: 'Izzah' } },
    { id: 'd', outcome: 'blocked', problems: ['owner_email_missing'], mapped: {} },
    { id: 'e', outcome: 'blocked', problems: ['due_missing'], mapped: {} },
    { id: 'f', outcome: 'duplicate', problems: [], mapped: {} },
  ];
  const owners = [{ sourceName: 'Izzah', email: 'izzah@tamco.com.my' }];

  it('counts owners once however many actions they hold', () => {
    expect(importReleaseSummary(rows, owners, ['a', 'b', 'c'])).toEqual({
      owners: 2,
      actions: 3,
      validEmails: 2,
      missingEmails: 1,
      uncertain: 2,
    });
  });

  it('follows the rows actually chosen', () => {
    expect(importReleaseSummary(rows, owners, ['c']).owners).toBe(1);
  });
});

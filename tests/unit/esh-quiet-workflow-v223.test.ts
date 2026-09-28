import { describe, expect, it } from 'vitest';

import { activityLabel, humanActivity, isTechnicalEvent } from '@/domain/esh-activity';
import { departmentKey, departmentProposal, matchDepartments } from '@/domain/esh-departments';
import { importReleaseSummary, type ImportSummaryRow } from '@/domain/esh-import';
import { heldSentence, ownerEmailProblem } from '@/domain/esh-owner-email';
import { FINDING_OUTCOMES } from '@/domain/esh-verification';

const DEPARTMENTS = [
  { id: 'wh', name: 'Warehouse' },
  { id: 'wl', name: 'Warehouse & Logistics' },
  { id: 'ehs', name: 'Environment, Health & Safety' },
  { id: 'ops', name: 'Operations' },
];

describe('v223 departments are chosen before they are created', () => {
  it('compares names the way the database does', () => {
    expect(departmentKey('Ware House')).toBe(departmentKey('warehouse'));
    expect(departmentKey('Health & Safety')).toBe(departmentKey('Health and Safety'));
    expect(departmentKey(' OPERATIONS. ')).toBe('operations');
  });

  it('searches as it is typed, names that start with it first', () => {
    expect(matchDepartments('Wareh', DEPARTMENTS).map((d) => d.name)).toEqual([
      'Warehouse',
      'Warehouse & Logistics',
    ]);
    expect(matchDepartments('logistics', DEPARTMENTS).map((d) => d.id)).toEqual(['wl']);
    expect(matchDepartments('', DEPARTMENTS)).toHaveLength(4);
  });

  it('recognises an existing department spelled differently', () => {
    expect(departmentProposal('Ware House', DEPARTMENTS)).toEqual({
      kind: 'exists',
      department: DEPARTMENTS[0],
    });
  });

  it('warns about a near miss before adding it', () => {
    const typo = departmentProposal('Warehose', DEPARTMENTS);
    expect(typo?.kind).toBe('similar');
    const longer = departmentProposal('BR2 Warehouse', DEPARTMENTS);
    expect(longer?.kind).toBe('similar');
  });

  it('offers to add a name that is genuinely missing', () => {
    expect(departmentProposal('Quality Lab', DEPARTMENTS)).toEqual({ kind: 'new' });
    expect(departmentProposal('x', DEPARTMENTS)).toBeNull();
  });
});

describe('v223 activity is the story, delivery is the log', () => {
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

describe('v223 owner email is said once', () => {
  const summary = {
    mode: 'held' as const,
    held: 96,
    assignments: 94,
    recipients: 71,
    switchedOff: 0,
  };

  it('counts assignment emails when there are any', () => {
    expect(heldSentence(summary)).toBe('94 assignment emails are being held');
    expect(heldSentence({ ...summary, assignments: 1, held: 1 })).toBe(
      '1 assignment email is being held',
    );
  });

  it('says nothing at all when nothing is held', () => {
    expect(heldSentence({ ...summary, held: 0, assignments: 0 })).toBeNull();
    expect(heldSentence(null)).toBeNull();
  });

  it('explains a refusal', () => {
    expect(ownerEmailProblem('not_permitted')).toContain('administrator');
    expect(ownerEmailProblem('no_such_code')).toContain('nothing changed');
  });
});

describe('v223 cancelling is three honest choices', () => {
  it('offers Cancel, Duplicate and Raised in error, and no Withdraw', () => {
    expect(FINDING_OUTCOMES.map((outcome) => outcome.key)).toEqual([
      'cancelled',
      'duplicate',
      'raised_in_error',
    ]);
  });
});

describe('v223 an import is summarised before anybody is notified', () => {
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

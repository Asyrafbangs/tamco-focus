import { describe, expect, it } from 'vitest';

import {
  calendarLines,
  followupPolicyProblems,
  parseCalendarExceptionLines,
} from '@/domain/esh-followup';
import { renderEshEmail } from '@/server/esh/email';

describe('Finding follow-up policy', () => {
  it('accepts the reviewed example policy', () => {
    expect(
      followupPolicyProblems({
        preDueDays: 2,
        remindOnDue: true,
        overdueEveryDays: 2,
        levelDays: [1, 3, 7],
        reviewReminderDays: 2,
      }),
    ).toEqual([]);
  });

  it('requires escalation levels to advance', () => {
    expect(
      followupPolicyProblems({
        preDueDays: 2,
        remindOnDue: true,
        overdueEveryDays: 2,
        levelDays: [1, 1, 0],
        reviewReminderDays: 2,
      }),
    ).toContain('Level 2 must happen after Level 1.');
  });

  it('parses labelled calendar exceptions without claiming holiday coverage', () => {
    expect(
      parseCalendarExceptionLines(
        '2026-12-25 | Christmas Day\n2026-12-31 | Company shutdown',
        false,
      ),
    ).toEqual({
      problems: [],
      rows: [
        { date: '2026-12-25', isWorkingDay: false, label: 'Christmas Day' },
        { date: '2026-12-31', isWorkingDay: false, label: 'Company shutdown' },
      ],
    });
  });

  it('rejects impossible dates and missing labels', () => {
    const parsed = parseCalendarExceptionLines('2026-02-31 | Impossible\n2026-05-01', false);
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems).toHaveLength(2);
  });

  it('renders each exception group in chronological pasteable form', () => {
    expect(
      calendarLines(
        [
          { date: '2026-05-02', isWorkingDay: true, label: 'Replacement day' },
          { date: '2026-01-01', isWorkingDay: false, label: 'New Year' },
        ],
        true,
      ),
    ).toBe('2026-05-02 | Replacement day');
  });

  it.each([
    ['owner_reply' as const, 'Owner update:'],
    ['escalation_reply' as const, 'Escalation response:'],
  ])('renders %s as a signed-in staff notification', (eventType, subject) => {
    const email = renderEshEmail({
      eventType,
      reference: 'F-201',
      actionTitle: 'Repair the guard',
      location: 'Operations',
      dueLabel: null,
      eshContactName: null,
      eshContactEmail: null,
      actionUrl: null,
      inboxUrl: null,
      findingUrl: 'https://tamco-focus.example/findings/finding-id',
      ownerEmail: 'owner@example.com',
      expiresMinutes: 0,
    });
    expect(email.subject).toContain(subject);
    expect(email.text).toContain('Sign in to TAMCO Focus as usual');
    expect(email.text).toContain('/findings/finding-id');
  });
});

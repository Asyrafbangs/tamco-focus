import { describe, expect, it } from 'vitest';

import {
  CLOSED_PERIODS,
  VERIFICATION_METHODS,
  closedPeriodFrom,
  verificationProblem,
} from '@/domain/esh-verification';
import { renderEshEmail } from '@/server/esh/email';

/**
 * v200 — what ESH decides, in words.
 *
 * The rules are in the procedures and covered by supabase/tests; these hold
 * the sentences the screens and the emails say about them.
 */

describe('v200 — verifying', () => {
  it('offers the methods the record keeps, never a bare tick', () => {
    expect(VERIFICATION_METHODS.map((method) => method.value)).toEqual([
      'document_review',
      'site_verification',
      'other',
    ]);
  });

  it('says what a refused decision was missing', () => {
    expect(verificationProblem('invalid', ['note_required', 'due_decision_required'])).toBe(
      'Please say what is still needed and say whether the due date stays or changes.',
    );
    expect(verificationProblem('invalid', ['method_required'])).toBe(
      'Please choose how it was verified.',
    );
  });

  it('explains a refusal that is not about a field', () => {
    expect(verificationProblem('self_verification')).toBe(
      'Work submitted from your own address is verified by another ESH Verifier (segregation of duties).',
    );
    expect(verificationProblem('stale_submission')).toContain('no longer the version waiting');
    expect(verificationProblem('decide_submission_first')).toBe(
      'Decide the submission waiting for review before reassigning.',
    );
    expect(verificationProblem(undefined)).toBe(
      'Something went wrong and nothing was changed. Try again.',
    );
  });

  it('keeps the closed period to the ones offered', () => {
    expect(CLOSED_PERIODS.map((period) => period.days)).toEqual([30, 90, 365, 0]);
    expect(closedPeriodFrom('90')).toBe(90);
    expect(closedPeriodFrom('0')).toBe(0);
    expect(closedPeriodFrom('7')).toBe(30);
    expect(closedPeriodFrom(undefined)).toBe(30);
  });
});

describe('v200 — what the owner is told', () => {
  const base = {
    reference: 'F-026',
    actionTitle: 'Clear the obstructed walkway',
    location: 'BR2 Warehouse',
    dueLabel: 'Due 18 Sept 2026',
    eshContactName: 'Izzul Asyraf',
    eshContactEmail: 'izzul@tamco.local',
    expiresMinutes: 1440,
    actionUrl: 'https://x/respond/access?for=action#AAA',
    inboxUrl: null,
  };

  it('asks for more with a link to the conversation', () => {
    const email = renderEshEmail({ ...base, eventType: 'changes_requested' });
    expect(email.subject).toBe('More needed: F-026 · Clear the obstructed walkway');
    expect(email.text).toContain('Open the conversation: https://x/respond/access?for=action#AAA');
  });

  it('closes with no link at all, because there is nothing to open', () => {
    const email = renderEshEmail({ ...base, eventType: 'finding_closed', actionUrl: null });
    expect(email.subject).toBe('Closed: F-026 · Clear the obstructed walkway');
    expect(email.text).toContain('ESH verified the correction and closed the finding.');
    expect(email.text).toContain('This is for your records; there is nothing to open.');
    expect(email.html).not.toContain('respond/access');
  });

  it('hands over without implying anything is still owed', () => {
    const email = renderEshEmail({ ...base, eventType: 'reassigned_away', actionUrl: null });
    expect(email.text).toContain('Nothing further is needed from you');
    expect(email.text).not.toMatch(/respond\/access/);
  });

  it('reopens with both links again', () => {
    const email = renderEshEmail({
      ...base,
      eventType: 'finding_reopened',
      inboxUrl: 'https://x/respond/access?for=actions#BBB',
    });
    expect(email.text).toContain('View finding & respond:');
    expect(email.text).toContain('View All My Actions:');
  });

  it('gives a new due date in the subject and the words', () => {
    const email = renderEshEmail({ ...base, eventType: 'due_changed' });
    expect(email.subject).toBe('New due date: F-026 · Clear the obstructed walkway');
    expect(email.text).toContain('Due 18 Sept 2026');
  });
});

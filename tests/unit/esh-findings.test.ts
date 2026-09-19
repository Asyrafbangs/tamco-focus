import { describe, expect, it } from 'vitest';

import {
  canonicalEmail,
  daysOverdue,
  findingProblem,
  looksLikeEmail,
  registerFilterFrom,
  splitEmails,
} from '@/domain/esh-findings';

/**
 * v197 — ESH Finding Management, the screens' shared vocabulary.
 *
 * The rules live in the database procedures; these hold the small amount the
 * screens need to agree with them. `EMAIL_SAMPLES` is repeated verbatim in
 * supabase/tests/esh_foundations_v197.test.sql against
 * `focus.esh_email_is_valid`, so the form cannot drift from the database.
 */

const EMAIL_SAMPLES: Array<[string, boolean]> = [
  ['fadli@tamco.example', true],
  [' Fadli.Owner@Example.COM ', true],
  ['first.last+site@tamco.com.my', true],
  ['a@b.co', true],
  ['not an email', false],
  ['missing-at.example.com', false],
  ['two@@example.com', false],
  ['no-domain@', false],
  ['dot@nodot', false],
  ['comma,in@example.com', false],
  ['space in@example.com', false],
  ['trailing@example.com.', false],
];

describe('v197 — email addresses', () => {
  it.each(EMAIL_SAMPLES)('%s is %s', (address, valid) => {
    expect(looksLikeEmail(address)).toBe(valid);
  });

  it('compares case-insensitively and ignores surrounding space, nothing more', () => {
    expect(canonicalEmail('  Fadli@Tamco.Example ')).toBe('fadli@tamco.example');
    // No alias merging: a plus suffix or a dot is part of the address.
    expect(canonicalEmail('first.last+site@tamco.com.my')).toBe('first.last+site@tamco.com.my');
  });

  it('splits a pasted list, dropping blanks and repeats', () => {
    expect(splitEmails('a@x.com, b@x.com;  A@X.com\nc@x.com ,,')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ]);
    expect(splitEmails('   ')).toEqual([]);
  });
});

describe('v197 — register and form helpers', () => {
  it('falls back to Needs attention for an unknown view', () => {
    expect(registerFilterFrom('closed')).toBe('closed');
    expect(registerFilterFrom('nonsense')).toBe('attention');
    expect(registerFilterFrom(undefined)).toBe('attention');
  });

  it('counts overdue days on the organisation calendar, not in hours', () => {
    const zone = 'Asia/Kuala_Lumpur';
    // Due 17:00 local on the 15th; at 09:00 local on the 18th that is 3 days.
    expect(daysOverdue('2026-09-15T09:00:00Z', new Date('2026-09-18T01:00:00Z'), zone)).toBe(3);
    // Past the due time on the same local day is overdue today, not a day.
    expect(daysOverdue('2026-09-15T09:00:00Z', new Date('2026-09-15T12:00:00Z'), zone)).toBe(0);
  });

  it('explains every problem a save returns, and falls back safely', () => {
    expect(findingProblem('owner_email_invalid')).toEqual({
      field: 'owner_email',
      message: 'That is not an email address.',
    });
    expect(findingProblem('something_new').field).toBe('form');
  });
});

import { describe, expect, it } from 'vitest';

import { compareDeadlines, deadlineFor, deadlineGlyph } from '@/domain/deadline';
import { endOfLocalDay } from '@/domain/duration';

/**
 * v187 — one deadline language (Product Owner, 15 September 2026).
 *
 * Overdue = already late. Due soon = inside the attention window, five days by
 * default. Normal = further out. The same words for tasks and steps.
 */

const KL = 'Asia/Kuala_Lumpur';
// 11:07 on Tuesday 15 September 2026 in Kuala Lumpur.
const NOW = new Date('2026-09-15T03:07:00Z');
const day = (date: string) => endOfLocalDay(date, KL).toISOString();
const at = (dueAt: string, extra: Parameters<typeof deadlineFor>[1] = {}) =>
  deadlineFor(dueAt, { timeZone: KL, now: NOW, ...extra });

describe('deadlineFor', () => {
  it('says how late, in calendar days, once the due instant has passed', () => {
    expect(at(day('2026-09-12'))).toMatchObject({
      tone: 'overdue',
      days: -3,
      label: 'Overdue 3 days',
      short: 'Overdue 3d',
      needsAttention: true,
    });
    expect(at(day('2026-09-14'))).toMatchObject({ label: 'Overdue 1 day', short: 'Overdue 1d' });
    // A time passed earlier today is overdue, with no count of days.
    expect(at('2026-09-15T01:00:00Z', { dueIsDateOnly: false })).toMatchObject({
      tone: 'overdue',
      days: 0,
      label: 'Overdue',
    });
  });

  it('says today and tomorrow in words, with the time when there is one', () => {
    expect(at(day('2026-09-15'))).toMatchObject({ tone: 'today', label: 'Due today' });
    expect(at(day('2026-09-16'))).toMatchObject({ tone: 'tomorrow', label: 'Due tomorrow' });
    expect(at('2026-09-15T06:30:00Z', { dueIsDateOnly: false })).toMatchObject({
      tone: 'today',
      label: 'Due today 14:30',
    });
    expect(at('2026-09-16T01:00:00Z', { dueIsDateOnly: false })).toMatchObject({
      label: 'Due tomorrow 09:00',
    });
  });

  it('counts down inside the window, and gives the date beyond it', () => {
    expect(at(day('2026-09-17'))).toMatchObject({
      tone: 'soon',
      days: 2,
      label: 'Due in 2 days',
      short: 'Due in 2d',
    });
    expect(at(day('2026-09-20'))).toMatchObject({ tone: 'soon', label: 'Due in 5 days' });
    expect(at(day('2026-09-21'))).toMatchObject({
      tone: 'later',
      label: 'Due 21 Sep',
      needsAttention: false,
    });
  });

  it('uses the organisation window when it is not five', () => {
    expect(at(day('2026-09-21'), { windowDays: 7 })).toMatchObject({ tone: 'soon' });
    expect(at(day('2026-09-18'), { windowDays: 2 })).toMatchObject({ tone: 'later' });
  });

  it('has nothing to say about undated or finished work', () => {
    expect(at(null as unknown as string)).toBeNull();
    expect(deadlineFor(undefined)).toBeNull();
    expect(at(day('2026-09-12'), { closed: true })).toBeNull();
  });

  it('reads the day in the viewer’s zone', () => {
    // 20:00 UTC on the 16th is the 17th in Kuala Lumpur and still the 16th in London.
    const dueAt = '2026-09-16T20:00:00Z';
    expect(at(dueAt, { dueIsDateOnly: false })).toMatchObject({ tone: 'soon', days: 2 });
    expect(
      deadlineFor(dueAt, { dueIsDateOnly: false, timeZone: 'Europe/London', now: NOW }),
    ).toMatchObject({ tone: 'tomorrow' });
  });
});

describe('urgency order and glyphs', () => {
  it('puts overdue first, the most overdue leading, and undated last', () => {
    const rows = [
      day('2026-09-25'),
      day('2026-09-16'),
      null,
      day('2026-09-13'),
      day('2026-09-15'),
      day('2026-09-10'),
      day('2026-09-18'),
    ].map((dueAt) => ({ dueAt, deadline: dueAt ? at(dueAt) : null }));
    const ordered = [...rows].sort(compareDeadlines).map((row) => row.deadline?.label ?? 'none');
    expect(ordered).toEqual([
      'Overdue 5 days',
      'Overdue 2 days',
      'Due today',
      'Due tomorrow',
      'Due in 3 days',
      'Due 25 Sep',
      'none',
    ]);
  });

  it('marks late with ⚠, close with !, and further out with nothing', () => {
    expect(deadlineGlyph('overdue')).toBe('⚠');
    expect(deadlineGlyph('today')).toBe('!');
    expect(deadlineGlyph('tomorrow')).toBe('!');
    expect(deadlineGlyph('soon')).toBe('!');
    expect(deadlineGlyph('later')).toBeNull();
  });
});

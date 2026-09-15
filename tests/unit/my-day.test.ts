import { describe, expect, it } from 'vitest';

import { endOfLocalDay } from '@/domain/duration';
import { buildMyDay, myDaySummary, type DelegatedStep, type MyDayInput } from '@/domain/my-day';
import type { OwedStep } from '@/domain/prioritisation';
import { makeTask } from './fixtures';

/**
 * v188 — My Day as the action view (Product Owner, 15 September 2026).
 *
 * Overdue and Due within the attention window, one card per problem: steps
 * fold into the work they belong to, a step owed on somebody else's work is
 * its own card, a routine appears once, and on-time work further out is not
 * on My Day at all.
 */

const KL = 'Asia/Kuala_Lumpur';
// 11:07 on Tuesday 15 September 2026 in Kuala Lumpur.
const NOW = new Date('2026-09-15T03:07:00Z');
const day = (date: string) => endOfLocalDay(date, KL).toISOString();

function input(overrides: Partial<MyDayInput>): MyDayInput {
  return {
    tasks: [],
    stepsIOwe: [],
    stepsOthersOwe: [],
    timeZone: KL,
    now: NOW,
    windowDays: 5,
    ...overrides,
  };
}

function owed(overrides: Partial<OwedStep>): OwedStep {
  return {
    stepId: 'step',
    taskId: 'elsewhere',
    title: 'Give department input',
    parentTitle: 'Create 3 Years Planning',
    dueAt: day('2026-09-17'),
    dueIsDateOnly: true,
    ownWork: false,
    stepHasOwnDate: true,
    parentDueAt: day('2026-09-30'),
    ...overrides,
  };
}

function delegated(overrides: Partial<DelegatedStep>): DelegatedStep {
  return {
    stepId: 'delegated',
    taskId: 'mine',
    title: 'Give EHS input',
    assigneeName: 'Amer Hakim',
    dueAt: day('2026-09-16'),
    dueIsDateOnly: true,
    ...overrides,
  };
}

describe('buildMyDay', () => {
  it('sorts work into Overdue and Due soon, and leaves on-time work further out off the page', () => {
    const result = buildMyDay(
      input({
        tasks: [
          makeTask({ id: 'late', title: 'Conduct DHA', dueAt: day('2026-09-12'), isOverdue: true }),
          makeTask({ id: 'tomorrow', title: 'LEV improvement', dueAt: day('2026-09-16') }),
          makeTask({ id: 'five', title: 'Monthly ESH report', dueAt: day('2026-09-20') }),
          makeTask({ id: 'six', title: 'Contractor audit', dueAt: day('2026-09-21') }),
          makeTask({ id: 'undated', title: 'Tidy the store', dueAt: null }),
        ],
      }),
    );
    expect(result.overdue.map((card) => card.title)).toEqual(['Conduct DHA']);
    expect(result.overdue[0]!.own!.label).toBe('Overdue 3 days');
    expect(result.dueSoon.map((card) => card.title)).toEqual([
      'LEV improvement',
      'Monthly ESH report',
    ]);
    expect(result.dueSoon.map((card) => card.own!.label)).toEqual([
      'Due tomorrow',
      'Due in 5 days',
    ]);
  });

  it('folds the owner’s own steps and delegated steps into one card for the work', () => {
    const result = buildMyDay(
      input({
        tasks: [
          makeTask({
            id: 'mine',
            title: 'Create 3 Years Planning',
            dueAt: day('2026-09-12'),
            isOverdue: true,
            checklistTotal: 3,
            checklistCompleted: 2,
          }),
        ],
        stepsIOwe: [
          owed({ stepId: 'own-late', taskId: 'mine', ownWork: true, dueAt: day('2026-09-14') }),
        ],
        stepsOthersOwe: [delegated({ stepId: 'amer-late', dueAt: day('2026-09-13') })],
      }),
    );
    expect(result.overdue).toHaveLength(1);
    expect(result.dueSoon).toHaveLength(0);
    const card = result.overdue[0]!;
    // Your own step first, then who you are waiting on: the order the
    // Product Owner's model reads in.
    expect(card.lines).toEqual([
      { kind: 'steps', completed: 2, total: 3 },
      expect.objectContaining({ kind: 'own_step' }),
      expect.objectContaining({ kind: 'waiting', assigneeName: 'Amer Hakim' }),
    ]);
  });

  it('surfaces work that is not due soon itself when one of its steps is', () => {
    const result = buildMyDay(
      input({
        tasks: [makeTask({ id: 'mine', title: 'BR2 improvement', dueAt: day('2026-09-30') })],
        stepsOthersOwe: [delegated({ dueAt: day('2026-09-17') })],
      }),
    );
    expect(result.dueSoon).toHaveLength(1);
    const card = result.dueSoon[0]!;
    // The card is in Due soon because of the step; its own date reads plainly.
    expect(card.urgent.label).toBe('Due in 2 days');
    expect(card.own!.tone).toBe('later');
    expect(card.lines).toEqual([
      expect.objectContaining({ kind: 'waiting', title: 'Give EHS input' }),
    ]);
  });

  it('puts a card in the section of its most urgent signal', () => {
    const result = buildMyDay(
      input({
        tasks: [makeTask({ id: 'mine', dueAt: day('2026-09-18') })],
        stepsOthersOwe: [delegated({ dueAt: day('2026-09-14') })],
      }),
    );
    expect(result.overdue).toHaveLength(1);
    expect(result.overdue[0]!.urgent.label).toBe('Overdue 1 day');
    expect(result.overdue[0]!.own!.label).toBe('Due in 3 days');
  });

  it('shows two step lines and counts the rest', () => {
    const result = buildMyDay(
      input({
        tasks: [makeTask({ id: 'mine', dueAt: day('2026-09-30') })],
        stepsOthersOwe: ['a', 'b', 'c', 'd'].map((id, index) =>
          delegated({ stepId: id, dueAt: day(`2026-09-1${6 + index}`) }),
        ),
      }),
    );
    const lines = result.dueSoon[0]!.lines;
    expect(lines.filter((line) => line.kind === 'waiting')).toHaveLength(2);
    expect(lines.at(-1)).toEqual({ kind: 'more', count: 2 });
  });

  it('makes a step owed on somebody else’s work a card of its own', () => {
    const result = buildMyDay(
      input({
        stepsIOwe: [
          owed({ stepId: 'late', dueAt: day('2026-09-13') }),
          owed({ stepId: 'soon', dueAt: day('2026-09-18') }),
          owed({ stepId: 'later', dueAt: day('2026-09-28') }),
        ],
      }),
    );
    expect(result.overdue.map((card) => [card.kind, card.stepId])).toEqual([
      ['shared_step', 'late'],
    ]);
    expect(result.dueSoon.map((card) => card.stepId)).toEqual(['soon']);
    expect(result.dueSoon[0]!.lines).toEqual([
      { kind: 'for', parentTitle: 'Create 3 Years Planning' },
    ]);
  });

  it('shows a routine once, for its most urgent open occurrence', () => {
    const occurrence = (id: string, date: string, isOverdue = false) =>
      makeTask({
        id,
        title: 'Daily PPE check',
        workClass: 'routine_occurrence',
        routineTemplateId: 'ppe',
        occurrenceDate: date,
        dueAt: day(date),
        isOverdue,
      });
    const result = buildMyDay(
      input({
        tasks: [
          occurrence('today', '2026-09-15'),
          occurrence('late', '2026-09-13', true),
          occurrence('tomorrow', '2026-09-16'),
        ],
      }),
    );
    expect(result.overdue.map((card) => card.taskId)).toEqual(['late']);
    expect(result.dueSoon).toHaveLength(0);
  });

  it('includes a goal discussion inside the window, and never finished work', () => {
    const result = buildMyDay(
      input({
        tasks: [
          makeTask({
            id: 'done',
            status: 'completed',
            dueAt: day('2026-09-12'),
            completedAt: NOW.toISOString(),
          }),
        ],
        goals: [
          { goalId: 'near', title: 'Reduce incidents', date: '2026-09-18' },
          { goalId: 'far', title: 'Frontline coaching', date: '2026-10-30' },
        ],
      }),
    );
    expect(result.overdue).toHaveLength(0);
    expect(result.dueSoon.map((card) => [card.kind, card.goalId, card.own!.label])).toEqual([
      ['goal', 'near', 'Due in 3 days'],
    ]);
  });

  it('orders each section by urgency: the most overdue first, then today, tomorrow, soon', () => {
    const result = buildMyDay(
      input({
        tasks: [
          makeTask({ id: 'soon', dueAt: day('2026-09-19') }),
          makeTask({ id: 'today', dueAt: day('2026-09-15') }),
          makeTask({ id: 'slightly', dueAt: day('2026-09-14'), isOverdue: true }),
          makeTask({ id: 'badly', dueAt: day('2026-09-08'), isOverdue: true }),
          makeTask({ id: 'tomorrow', dueAt: day('2026-09-16') }),
        ],
      }),
    );
    expect(result.overdue.map((card) => card.taskId)).toEqual(['badly', 'slightly']);
    expect(result.dueSoon.map((card) => card.taskId)).toEqual(['today', 'tomorrow', 'soon']);
  });
});

describe('myDaySummary', () => {
  const cards = (count: number) =>
    buildMyDay(
      input({
        tasks: Array.from({ length: count }, (_, index) =>
          makeTask({ id: `t${index}`, dueAt: day('2026-09-16') }),
        ),
      }),
    ).dueSoon;

  it('says what is late and what is close in one sentence', () => {
    expect(myDaySummary({ overdue: cards(2), dueSoon: cards(3) }, 5)).toBe(
      '2 overdue · 3 due within 5 days',
    );
    expect(myDaySummary({ overdue: [], dueSoon: cards(2) }, 5)).toBe(
      'Nothing overdue · 2 due within 5 days',
    );
    expect(myDaySummary({ overdue: cards(1), dueSoon: [] }, 5)).toBe('1 overdue');
    expect(myDaySummary({ overdue: [], dueSoon: [] }, 5)).toBe(
      'Nothing overdue, and nothing due in the next 5 days',
    );
  });
});

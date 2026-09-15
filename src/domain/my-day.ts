/**
 * My Day as the action view (v188, Product Owner 15 September 2026).
 *
 * > My Day warns me about late work and work entering the next five-day
 * > window. My Work shows the same status in the context of all my commitments.
 *
 * Two sections — Overdue, and Due within the attention window — and in them
 * one card per problem. Nothing else from the working list appears: work that
 * is on time and further out lives in My Work and the calendar.
 *
 * One problem, one card:
 *
 * - Work the viewer owns is a card when it is late or due soon itself, or
 *   when one of its steps is. Its own dated steps and the steps other people
 *   owe on it are lines on that card ("Your step overdue 1 day", "Waiting on
 *   Amer · overdue 2 days"), never cards of their own. The card sits in the
 *   section of its most urgent signal.
 * - A step the viewer owes on somebody else's work is a card of its own.
 * - A routine is one card, for its nearest open occurrence that needs
 *   attention.
 * - A quarterly goal discussion inside the window is a card.
 *
 * Pure, so the rules can be tested without a page.
 */

import { compareDeadlines, deadlineFor, type Deadline } from './deadline';
import type { OwedStep } from './prioritisation';
import type { TaskOverview } from './types';

/** A step somebody else owes on the viewer's own work. */
export interface DelegatedStep {
  stepId: string;
  taskId: string;
  title: string;
  assigneeName: string;
  /** The step's own date, or its work's when it has none (v154). */
  dueAt: string;
  dueIsDateOnly: boolean;
}

/** A goal discussion with a date. */
export interface GoalDiscussion {
  goalId: string;
  title: string;
  /** The date as `YYYY-MM-DD`. */
  date: string;
}

export type MyDayLine =
  | { kind: 'steps'; completed: number; total: number }
  | { kind: 'own_step'; title: string; deadline: Deadline }
  | { kind: 'waiting'; assigneeName: string; title: string; deadline: Deadline }
  | { kind: 'more'; count: number }
  | { kind: 'for'; parentTitle: string };

export interface MyDayCard {
  key: string;
  kind: 'task' | 'shared_step' | 'routine' | 'goal';
  title: string;
  taskId: string | null;
  stepId: string | null;
  goalId: string | null;
  /** The deadline of the record itself: the task's, the step's. Null when undated. */
  own: Deadline | null;
  /** The most urgent signal on the card, which chooses its section and order. */
  urgent: Deadline;
  urgentAt: string;
  lines: MyDayLine[];
}

export interface MyDay {
  overdue: MyDayCard[];
  dueSoon: MyDayCard[];
}

export interface MyDayInput {
  /** The viewer's own open work, as `getMyTasks` reads it. */
  tasks: readonly TaskOverview[];
  /** Steps assigned to the viewer, on their own work or anybody else's. */
  stepsIOwe: readonly OwedStep[];
  /** Steps other people owe on the viewer's work. */
  stepsOthersOwe: readonly DelegatedStep[];
  goals?: readonly GoalDiscussion[];
  timeZone: string;
  now: Date;
  windowDays: number;
}

/** How many step lines a card shows before "and N more". */
const LINE_LIMIT = 2;

const OPEN = new Set(['active', 'backlog', 'paused']);

export function buildMyDay(input: MyDayInput): MyDay {
  const { timeZone, now, windowDays } = input;
  const deadline = (dueAt: string | null, dueIsDateOnly: boolean) =>
    deadlineFor(dueAt, { dueIsDateOnly, timeZone, now, windowDays });
  const urgent = (candidate: Deadline | null): candidate is Deadline =>
    Boolean(candidate?.needsAttention);
  const mostUrgent = (signals: Array<{ deadline: Deadline; at: string }>) =>
    [...signals].sort((left, right) =>
      compareDeadlines(
        { deadline: left.deadline, dueAt: left.at },
        { deadline: right.deadline, dueAt: right.at },
      ),
    )[0];

  const cards: MyDayCard[] = [];
  const openTasks = input.tasks.filter((task) => OPEN.has(task.status));
  const ownTaskIds = new Set(openTasks.map((task) => task.id));

  // ---- Work the viewer owns, with its steps folded in.
  for (const task of openTasks) {
    if (task.workClass === 'routine_occurrence') continue;
    const own = deadline(task.dueAt, task.dueIsDateOnly);
    const signals: Array<{ deadline: Deadline; at: string }> = [];
    if (urgent(own)) signals.push({ deadline: own, at: task.dueAt! });

    const ownSteps = input.stepsIOwe
      .filter((step) => step.taskId === task.id && step.ownWork && step.stepHasOwnDate)
      .map((step) => ({ step, deadline: deadline(step.dueAt, true) }))
      .filter((entry): entry is { step: OwedStep; deadline: Deadline } => urgent(entry.deadline))
      .sort((left, right) =>
        compareDeadlines(
          { deadline: left.deadline, dueAt: left.step.dueAt },
          { deadline: right.deadline, dueAt: right.step.dueAt },
        ),
      );
    const waiting = input.stepsOthersOwe
      .filter((step) => step.taskId === task.id)
      .map((step) => ({ step, deadline: deadline(step.dueAt, step.dueIsDateOnly) }))
      .filter((entry): entry is { step: DelegatedStep; deadline: Deadline } =>
        urgent(entry.deadline),
      )
      .sort((left, right) =>
        compareDeadlines(
          { deadline: left.deadline, dueAt: left.step.dueAt },
          { deadline: right.deadline, dueAt: right.step.dueAt },
        ),
      );

    for (const entry of ownSteps) signals.push({ deadline: entry.deadline, at: entry.step.dueAt });
    for (const entry of waiting) signals.push({ deadline: entry.deadline, at: entry.step.dueAt });
    const lead = mostUrgent(signals);
    if (!lead) continue;

    const lines: MyDayLine[] = [];
    if (task.checklistTotal > 0) {
      lines.push({ kind: 'steps', completed: task.checklistCompleted, total: task.checklistTotal });
    }
    const stepLines: MyDayLine[] = [
      ...ownSteps.map((entry) => ({
        kind: 'own_step' as const,
        title: entry.step.title,
        deadline: entry.deadline,
      })),
      ...waiting.map((entry) => ({
        kind: 'waiting' as const,
        assigneeName: entry.step.assigneeName,
        title: entry.step.title,
        deadline: entry.deadline,
      })),
    ];
    lines.push(...stepLines.slice(0, LINE_LIMIT));
    if (stepLines.length > LINE_LIMIT) {
      lines.push({ kind: 'more', count: stepLines.length - LINE_LIMIT });
    }

    cards.push({
      key: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      taskId: task.id,
      stepId: null,
      goalId: null,
      own,
      urgent: lead.deadline,
      urgentAt: lead.at,
      lines,
    });
  }

  // ---- Steps the viewer owes on somebody else's work.
  for (const step of input.stepsIOwe) {
    if (step.ownWork || ownTaskIds.has(step.taskId)) continue;
    const own = deadline(step.dueAt, step.dueIsDateOnly);
    if (!urgent(own)) continue;
    cards.push({
      key: `step:${step.stepId}`,
      kind: 'shared_step',
      title: step.title,
      taskId: step.taskId,
      stepId: step.stepId,
      goalId: null,
      own,
      urgent: own,
      urgentAt: step.dueAt,
      lines: [{ kind: 'for', parentTitle: step.parentTitle }],
    });
  }

  // ---- Routines: the nearest open occurrence that needs attention, once.
  const routines = new Map<string, { task: TaskOverview; own: Deadline }>();
  for (const task of openTasks) {
    if (task.workClass !== 'routine_occurrence') continue;
    const own = deadline(task.dueAt, task.dueIsDateOnly);
    if (!urgent(own)) continue;
    const key = task.routineTemplateId ?? task.id;
    const held = routines.get(key);
    if (
      !held ||
      compareDeadlines(
        { deadline: own, dueAt: task.dueAt },
        { deadline: held.own, dueAt: held.task.dueAt },
      ) < 0
    ) {
      routines.set(key, { task, own });
    }
  }
  for (const { task, own } of routines.values()) {
    cards.push({
      key: `routine:${task.routineTemplateId ?? task.id}`,
      kind: 'routine',
      title: task.title,
      taskId: task.id,
      stepId: null,
      goalId: null,
      own,
      urgent: own,
      urgentAt: task.dueAt!,
      lines: [],
    });
  }

  // ---- Goal discussions inside the window.
  for (const goal of input.goals ?? []) {
    const at = `${goal.date}T12:00:00Z`;
    const own = deadline(at, true);
    if (!urgent(own)) continue;
    cards.push({
      key: `goal:${goal.goalId}`,
      kind: 'goal',
      title: goal.title,
      taskId: null,
      stepId: null,
      goalId: goal.goalId,
      own,
      urgent: own,
      urgentAt: at,
      lines: [],
    });
  }

  cards.sort((left, right) =>
    compareDeadlines(
      { deadline: left.urgent, dueAt: left.urgentAt },
      { deadline: right.urgent, dueAt: right.urgentAt },
    ),
  );

  return {
    overdue: cards.filter((card) => card.urgent.tone === 'overdue'),
    dueSoon: cards.filter((card) => card.urgent.tone !== 'overdue'),
  };
}

/**
 * The one sentence at the top of My Day: "2 overdue · 3 due within 5 days",
 * "Nothing overdue · 2 due within 5 days", or that nothing is either.
 */
export function myDaySummary(day: MyDay, windowDays: number): string {
  const within = `due within ${windowDays} day${windowDays === 1 ? '' : 's'}`;
  if (day.overdue.length === 0 && day.dueSoon.length === 0) {
    return `Nothing overdue, and nothing ${within.replace('due within', 'due in the next')}`;
  }
  const overdue = day.overdue.length > 0 ? `${day.overdue.length} overdue` : 'Nothing overdue';
  return day.dueSoon.length > 0 ? `${overdue} · ${day.dueSoon.length} ${within}` : overdue;
}

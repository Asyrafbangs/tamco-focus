import Link from 'next/link';

import { DeadlineLabel } from '@/components/ui/DeadlineLabel';
import { deadlineGlyph } from '@/domain/deadline';
import { taskDrawerHref } from '@/domain/navigation';
import { goalExceptionMessage } from '@/domain/goals';
import { buildMyDay, myDaySummary, type MyDayCard, type MyDayLine } from '@/domain/my-day';
import { needsAttention, type AttentionItem } from '@/domain/prioritisation';
import { requireProfile } from '@/lib/supabase/server';
import {
  getDisplaySettings,
  getMyAttention,
  getMyTasks,
  getStepsIOwe,
  getStepsOthersOwe,
  getTeamDirectory,
} from '@/server/queries';
import { getGoalExceptions, getMyGoals } from '@/server/goal-queries';
import { getAssignablePeople } from '@/server/actions/assignment-actions';

import { CaptureWork } from '../capture/CaptureWork';

import { MyDayNeedsAttentionSummary } from './MyDayNeedsAttentionSummary';

/**
 * My Day (section 9, v188).
 *
 * The action view. It warns about work that is already late and work entering
 * the attention window, and says nothing about the rest: that is what My Work
 * and the calendar are for (Product Owner, 15 September 2026).
 *
 * One sentence, then what is waiting on you from other people, then Overdue
 * and Due within N days, one card per problem. Start here, Next up, Waiting on
 * others and Coming up were replaced by the two sections: the first overdue
 * card is where the day starts, a late step somebody owes you is a line on the
 * work it belongs to, and a date inside the window is due soon whichever list
 * it used to sit in.
 */

/**
 * Exceptions the two sections do not already show, in a few words each —
 * "1 barrier needs a decision" — so the summary never repeats a card.
 */
const OTHER_EXCEPTIONS: Partial<Record<AttentionItem['kind'], (count: number) => string>> = {
  open_barrier: (count) => `${count} barrier${count === 1 ? ' needs' : 's need'} a decision`,
  urgent_mandatory: (count) => `${count} mandatory action${count === 1 ? '' : 's'}`,
  missing_evidence: (count) => `${count} awaiting evidence`,
  paused_review_passed: (count) => `${count} paused past review`,
  completion_review_overdue: (count) => `${count} completion review${count === 1 ? '' : 's'} due`,
  available_needs_decision: (count) =>
    `${count} waiting in Available need${count === 1 ? 's' : ''} a decision`,
};

function otherExceptions(items: readonly AttentionItem[], shown: ReadonlySet<string>): string[] {
  const counts = new Map<AttentionItem['kind'], number>();
  for (const item of items) {
    if (!OTHER_EXCEPTIONS[item.kind] || shown.has(item.taskId)) continue;
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, count]) => OTHER_EXCEPTIONS[kind]!(count));
}

const CARD_TYPE: Record<MyDayCard['kind'], string> = {
  task: 'Task',
  shared_step: 'Shared step',
  routine: 'Routine',
  goal: 'Quarterly discussion',
};

function cardHref(card: MyDayCard): string {
  if (card.kind === 'goal') return `/goals?goal=${card.goalId}&action=update`;
  const href = taskDrawerHref(card.taskId!, '/today');
  return card.stepId ? `${href}&step=${card.stepId}` : href;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function CardLine({ line }: { line: MyDayLine }) {
  switch (line.kind) {
    case 'steps':
      return (
        <span>
          {line.completed}/{line.total} step{line.total === 1 ? '' : 's'} complete
        </span>
      );
    case 'own_step':
      return (
        <span title={line.title}>
          • <DeadlineLabel deadline={line.deadline} prefix="Your step" />
        </span>
      );
    case 'waiting':
      return (
        <span title={line.title}>
          •{' '}
          <DeadlineLabel
            deadline={line.deadline}
            prefix={`Waiting on ${firstName(line.assigneeName)} ·`}
          />
        </span>
      );
    case 'more':
      return (
        <span>
          • and {line.count} more step{line.count === 1 ? '' : 's'}
        </span>
      );
    case 'for':
      return <span>For: {line.parentTitle}</span>;
  }
}

function DayCard({ card }: { card: MyDayCard }) {
  return (
    <Link
      href={cardHref(card)}
      className="today-item interactive-row day-card"
      data-urgency={card.urgent.tone}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div className={`today-icon day-icon day-icon-${card.urgent.tone}`} aria-hidden="true">
        {deadlineGlyph(card.urgent.tone)}
      </div>
      <div className="today-copy">
        <strong>{card.title}</strong>
        <span className="day-card-headline">
          {CARD_TYPE[card.kind]} ·{' '}
          {card.own ? <DeadlineLabel deadline={card.own} /> : 'No due date'}
        </span>
        {card.lines.map((line, index) => (
          <CardLine key={index} line={line} />
        ))}
      </div>
      <span className="day-card-chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ capture?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';

  const [
    tasks,
    settings,
    goalExceptions,
    myGoals,
    assignablePeople,
    actionRequests,
    teamDirectory,
    stepsOthersOwe,
    stepsIOwe,
  ] = await Promise.all([
    getMyTasks(profile.id),
    getDisplaySettings(),
    getGoalExceptions(profile.id),
    getMyGoals(profile.id),
    // Empty for anyone who is not a manager, so the assignment panel does not
    // exist for them rather than appearing and then refusing.
    params.capture === '1' ? getAssignablePeople() : Promise.resolve([]),
    getMyAttention(profile.id),
    // Only when Capture is open, for checklist assignment.
    params.capture === '1' ? getTeamDirectory() : Promise.resolve([]),
    getStepsOthersOwe(profile.id),
    // The steps this person owes: anything late, and a month ahead, which the
    // attention window never reaches.
    getStepsIOwe(profile.id, 31),
  ]);

  const now = new Date();
  const windowDays = settings.upcomingWindowDays;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);

  const activeGoals = myGoals.filter((goal) => goal.status === 'active');
  const day = buildMyDay({
    tasks,
    stepsIOwe,
    stepsOthersOwe,
    // A discussion still ahead: one already missed is the goal strip's to say.
    goals: activeGoals
      .filter((goal) => goal.isQuarterlyCheckinDue && goal.nextQuarterlyCheckinDate >= today)
      .map((goal) => ({ goalId: goal.id, title: goal.title, date: goal.nextQuarterlyCheckinDate })),
    timeZone,
    now,
    windowDays,
  });

  const shownTaskIds = new Set(
    [...day.overdue, ...day.dueSoon].flatMap((card) => (card.taskId ? [card.taskId] : [])),
  );
  const others = otherExceptions(
    needsAttention(tasks, {
      viewerId: profile.id,
      upcomingWindowDays: windowDays,
      timeZone,
      now,
    }),
    shownTaskIds,
  );
  const summary = [myDaySummary(day, windowDays), ...others].join(' · ');
  const summaryTone = day.overdue.length > 0 ? 'late' : day.dueSoon.length > 0 ? 'soon' : 'clear';

  const activeCount = tasks.filter((task) => task.status === 'active').length;
  const availableCount = tasks.filter((task) => task.status === 'backlog').length;
  const staleCount = tasks.filter((task) => task.isStale).length;
  const goalWeight = activeGoals.reduce((total, goal) => total + goal.weightPercent, 0);
  const weightedGoalProgress = goalWeight
    ? Math.round(
        activeGoals.reduce((total, goal) => total + goal.derivedProgress * goal.weightPercent, 0) /
          goalWeight,
      )
    : 0;

  const todayLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(now);

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Daily workspace</p>
          <h1>{profile.full_name.split(' ')[0]} · My Day</h1>
          <p>{todayLabel} · What is late, and what is due in the next few days.</p>
        </div>
        <div className="actions">
          <Link href="/work" className="btn ghost">
            My Focus
          </Link>
          <Link href="/today?capture=1" className="btn primary">
            ＋ New Work
          </Link>
        </div>
      </div>

      {/* v188 — one sentence, not a dashboard. */}
      <p className={`day-summary day-summary-${summaryTone}`} role="status">
        {summary}
      </p>

      {/*
        v46 — what somebody else is waiting on you for: a decision, an
        approval, support. Not a deadline, so not in the sections below.
      */}
      <MyDayNeedsAttentionSummary
        items={actionRequests}
        now={now}
        timeZone={timeZone}
        announceClear={day.overdue.length === 0 && day.dueSoon.length === 0 && others.length === 0}
      />

      {day.overdue.length === 0 && day.dueSoon.length === 0 ? (
        <section className="card coming day-section" aria-labelledby="day-clear-heading">
          <div className="empty-state">
            <h3 id="day-clear-heading">Nothing overdue, and nothing due soon</h3>
            <p>
              Work due in the next {windowDays} days appears here, and anything that becomes late.
              Everything else is in My Work and on the calendar.
            </p>
            <Link href="/work" className="btn">
              Open My Work
            </Link>
          </div>
        </section>
      ) : null}

      {day.overdue.length > 0 ? (
        <section className="card coming day-section" aria-labelledby="day-overdue-heading">
          <div className="sectionhead">
            <div>
              <h3 id="day-overdue-heading">
                Overdue <span className="day-section-count">{day.overdue.length}</span>
              </h3>
              <p>Already late, the longest overdue first</p>
            </div>
            <Link href="/work" className="btn small ghost">
              All work
            </Link>
          </div>
          <div className="day-card-list">
            {day.overdue.map((card) => (
              <DayCard key={card.key} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {day.dueSoon.length > 0 ? (
        <section className="card coming day-section" aria-labelledby="day-soon-heading">
          <div className="sectionhead">
            <div>
              <h3 id="day-soon-heading">
                Due within {windowDays} day{windowDays === 1 ? '' : 's'}{' '}
                <span className="day-section-count">{day.dueSoon.length}</span>
              </h3>
              <p>The nearest first</p>
            </div>
            <Link href="/plan" className="btn small ghost">
              View Monthly Plan
            </Link>
          </div>
          <div className="day-card-list">
            {day.dueSoon.map((card) => (
              <DayCard key={card.key} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {/* A compact workload summary, and the two counts that name a list go to it. */}
      <div className="summary-strip" role="group" aria-label="Workload summary">
        <Link href="/work" className="summary-item summary-link">
          <span className="summary-dot" aria-hidden="true" />
          <strong>{activeCount}</strong> active
        </Link>
        <Link href="/work?tab=available" className="summary-item summary-link">
          <span className="summary-dot" style={{ background: 'var(--muted)' }} aria-hidden="true" />
          <strong>{availableCount}</strong> available
        </Link>
        {staleCount > 0 && (
          <span className="summary-item">
            <span className="summary-dot amber" aria-hidden="true" />
            <strong>{staleCount}</strong> without a recent update
          </span>
        )}
      </div>

      {/*
        Exception-based: a goal strip that says nothing needs attention is a
        row of pixels reporting the absence of news.
      */}
      {goalExceptions.length > 0 && (
        <section className="goal-quick-strip attention" aria-label="Goal progress">
          <div className="goal-quick-strip-copy">
            <strong>
              {activeGoals.length > 0
                ? `${activeGoals.length} goal${activeGoals.length === 1 ? '' : 's'} · ${weightedGoalProgress}% weighted progress`
                : `${goalExceptions.length} goal check-in${goalExceptions.length === 1 ? '' : 's'} need attention`}
            </strong>
            <span>
              {goalExceptions[0]
                ? `${goalExceptions[0].title} · ${goalExceptionMessage(goalExceptions[0])}`
                : 'A goal check-in needs attention.'}
            </span>
          </div>
          <Link
            href={
              goalExceptions[0] ? `/goals?goal=${goalExceptions[0].id}&action=update` : '/goals'
            }
            className="btn small"
          >
            {goalExceptions[0] ? 'Update' : 'Open Goals'}
          </Link>
        </section>
      )}

      {params.capture === '1' && (
        <CaptureWork
          modal
          assignablePeople={assignablePeople}
          teamDirectory={teamDirectory}
          viewerName={profile.full_name}
        />
      )}
    </>
  );
}

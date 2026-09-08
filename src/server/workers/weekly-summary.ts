import type { SupabaseClient } from '@supabase/supabase-js';

import { formatDurationWords, staleAgeMs } from '@/domain/duration';
import { weeklyWindow, type WeeklyWindow } from '@/domain/weekly-schedule';
import { PermanentDeliveryError } from '@/server/workers/smtp-transport';
import type { Database } from '@/lib/database.types';

type Client = SupabaseClient<Database, 'public'>;
type Profile = Database['public']['Tables']['user_profiles']['Row'];
type TaskRow = Database['public']['Views']['task_overview']['Row'];
type GoalRow = Database['public']['Views']['goal_overview']['Row'];
type BarrierRow = Database['public']['Tables']['barriers']['Row'];
type CompletionReviewRow = Database['public']['Tables']['completion_reviews']['Row'];
type SharedContributionRow = Database['public']['Views']['shared_contributions']['Row'];
type CompletedContributionRow = Database['public']['Views']['completed_contributions']['Row'];
type RoutineOutcomeRow = Database['public']['Views']['routine_occurrence_outcomes']['Row'];

interface TeamPerson {
  userId: string;
  fullName: string;
}

interface DigestItem {
  key: string;
  title: string;
  label: string;
  detail: string;
  occurredAt?: string | null;
  dueAt?: string | null;
}

interface RenderSummaryInput {
  profile: Profile;
  mode: 'focused' | 'standard';
  tasks: TaskRow[];
  teamTasks: TaskRow[];
  sharedContributions?: SharedContributionRow[];
  completedContributions?: CompletedContributionRow[];
  barriers?: BarrierRow[];
  completionReviews?: CompletionReviewRow[];
  routineOutcomes?: RoutineOutcomeRow[];
  goals?: GoalRow[];
  teamBarriers?: BarrierRow[];
  teamRoutineOutcomes?: RoutineOutcomeRow[];
  teamGoals?: GoalRow[];
  teamPeople?: TeamPerson[];
  appBaseUrl: string;
  now: Date;
  window?: WeeklyWindow;
  timeZone?: string;
}

export interface WeeklyWorkerOptions {
  now?: Date;
  force?: boolean;
  timeZone?: string;
  scheduleDay?: string;
  scheduleHour?: number;
  appBaseUrl?: string;
  transport?: 'log' | 'inbucket' | 'smtp';
  send?: (delivery: { to: string; subject: string; html: string; text: string }) => Promise<void>;
}

export interface WeeklyWorkerResult {
  due: boolean;
  generated: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Permanently rejected. Counted apart from `failed`, which will retry. */
  undeliverable: number;
  periodStart: string;
}

/** HTML escaping is a security boundary because user-entered text leaves the app in email. */
export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function asTime(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function inWindow(value: string | null | undefined, start: Date, end: Date) {
  const time = asTime(value);
  return time !== null && time >= start.getTime() && time < end.getTime();
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function workLabel(workClass: TaskRow['work_class']) {
  const labels: Partial<Record<NonNullable<TaskRow['work_class']>, string>> = {
    major_project: 'Major Project',
    operational_action: 'Operational',
    self_development: 'Development',
    quick_action: 'Quick Action',
    routine_occurrence: 'Routine',
    collaborative_contribution: 'Shared',
  };
  return workClass ? (labels[workClass] ?? 'Work') : 'Work';
}

function formatWeekRange(window: WeeklyWindow, timeZone: string) {
  const finalDay = new Date(window.planningEnd.getTime() - 1);
  const start = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).formatToParts(window.reportingEnd);
  const end = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).formatToParts(finalDay);
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  const startDay = part(start, 'day');
  const startMonth = part(start, 'month');
  const endDay = part(end, 'day');
  const endMonth = part(end, 'month');
  const year = part(end, 'year');
  return startMonth === endMonth
    ? `${startDay}–${endDay} ${endMonth} ${year}`
    : `${startDay} ${startMonth}–${endDay} ${endMonth} ${year}`;
}

function formatDue(
  dueAt: string | null | undefined,
  dueIsDateOnly: boolean | null | undefined,
  now: Date,
  timeZone: string,
) {
  if (!dueAt) return 'No due date';
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) {
    return `Overdue ${formatDurationWords(now.getTime() - due.getTime())}`;
  }
  return `Due ${new Intl.DateTimeFormat('en-MY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(dueIsDateOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }),
    timeZone,
  }).format(due)}`;
}

function appLink(base: string, path: string) {
  try {
    const url = new URL(path, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '#';
  } catch {
    return '#';
  }
}

function latestReviewByTask(reviews: CompletionReviewRow[]) {
  const latest = new Map<string, CompletionReviewRow>();
  for (const review of [...reviews].sort((a, b) =>
    String(b.decided_at ?? b.submitted_at).localeCompare(String(a.decided_at ?? a.submitted_at)),
  )) {
    if (!latest.has(review.task_id)) latest.set(review.task_id, review);
  }
  return latest;
}

function personalDigest(input: RenderSummaryInput & { window: WeeklyWindow; timeZone: string }) {
  const { tasks, now, window, timeZone } = input;
  const taskById = new Map(tasks.flatMap((task) => (task.id ? ([[task.id, task]] as const) : [])));
  const goalById = new Map(
    (input.goals ?? []).flatMap((goal) => (goal.id ? ([[goal.id, goal]] as const) : [])),
  );
  const routineByTask = new Map(
    (input.routineOutcomes ?? []).flatMap((row) =>
      row.task_id ? ([[row.task_id, row]] as const) : [],
    ),
  );
  const attention = new Map<string, DigestItem>();
  const addAttention = (item: DigestItem) => {
    if (!attention.has(item.key)) attention.set(item.key, item);
  };

  for (const [taskId, review] of latestReviewByTask(input.completionReviews ?? [])) {
    const task = taskById.get(taskId);
    if (!task || ['completed', 'cancelled'].includes(task.status ?? '')) continue;
    if (review.decision !== 'changes_requested') continue;
    addAttention({
      key: `task:${taskId}`,
      title: task.title ?? 'Untitled work',
      label: workLabel(task.work_class),
      detail: `Changes requested after completion review${review.decision_note ? ` · ${review.decision_note}` : ''}`,
      dueAt: task.due_at,
    });
  }

  for (const outcome of input.routineOutcomes ?? []) {
    if (!outcome.task_id || outcome.exception_state !== 'returned') continue;
    const task = taskById.get(outcome.task_id);
    if (!task || ['completed', 'cancelled'].includes(task.status ?? '')) continue;
    addAttention({
      key: `task:${outcome.task_id}`,
      title: task.title ?? outcome.title ?? 'Routine occurrence',
      label: 'Routine',
      detail: `Returned by manager · Still due${outcome.decision_note ? ` · ${outcome.decision_note}` : ''}`,
      dueAt: task.due_at,
    });
  }

  for (const barrier of input.barriers ?? []) {
    const task = barrier.task_id ? taskById.get(barrier.task_id) : null;
    const goal = barrier.goal_id ? goalById.get(barrier.goal_id) : null;
    addAttention({
      key: task?.id ? `task:${task.id}` : goal?.id ? `goal:${goal.id}` : `barrier:${barrier.id}`,
      title: task?.title ?? goal?.title ?? barrier.description ?? 'Support request',
      label: task ? workLabel(task.work_class) : goal ? 'Goal' : 'Request',
      detail: `Action requested · ${barrier.support_needed}`,
      dueAt: task?.due_at ?? goal?.checkin_due_at,
    });
  }

  for (const task of tasks) {
    if (!task.id || ['completed', 'cancelled'].includes(task.status ?? '')) continue;
    const exceptionState = routineByTask.get(task.id)?.exception_state;
    if (exceptionState === 'pending') continue;
    if (task.is_overdue) {
      addAttention({
        key: `task:${task.id}`,
        title: task.title ?? 'Untitled work',
        label: workLabel(task.work_class),
        detail: formatDue(task.due_at, task.due_is_date_only, now, timeZone),
        dueAt: task.due_at,
      });
      continue;
    }
    if (task.is_stale && task.status === 'active' && task.last_meaningful_update_at) {
      addAttention({
        key: `task:${task.id}`,
        title: task.title ?? 'Untitled work',
        label: workLabel(task.work_class),
        detail: `No meaningful update for ${formatDurationWords(
          staleAgeMs(
            { status: task.status, lastMeaningfulUpdateAt: task.last_meaningful_update_at },
            now,
          ),
        )}`,
        dueAt: task.due_at,
      });
      continue;
    }

    const dueThisWeek = inWindow(task.due_at, window.reportingEnd, window.planningEnd);
    const reviewThisWeek = inWindow(task.review_at, window.reportingEnd, window.planningEnd);
    const urgentAvailable =
      task.status === 'backlog' && ['high', 'critical'].includes(task.urgency ?? 'normal');
    if (
      task.status === 'backlog' &&
      task.work_class !== 'routine_occurrence' &&
      (dueThisWeek || reviewThisWeek || urgentAvailable)
    ) {
      const reason = reviewThisWeek
        ? `Manager review ${formatDue(task.review_at, false, now, timeZone).toLowerCase()}`
        : urgentAvailable
          ? `${task.urgency === 'critical' ? 'Critical' : 'High'} urgency · Available work`
          : `Available work · ${formatDue(task.due_at, task.due_is_date_only, now, timeZone)}`;
      addAttention({
        key: `task:${task.id}`,
        title: task.title ?? 'Untitled work',
        label: workLabel(task.work_class),
        detail: reason,
        dueAt: task.due_at ?? task.review_at,
      });
    } else if (task.status === 'paused' && dueThisWeek) {
      addAttention({
        key: `task:${task.id}`,
        title: task.title ?? 'Untitled work',
        label: workLabel(task.work_class),
        detail: `Paused · ${formatDue(task.due_at, task.due_is_date_only, now, timeZone)}`,
        dueAt: task.due_at,
      });
    }
  }

  for (const goal of input.goals ?? []) {
    if (!goal.id || !['active', 'pending_discussion'].includes(goal.status ?? '')) continue;
    const reasons = [
      goal.is_update_requested ? 'Update requested' : null,
      goal.is_checkin_due ? 'Check-in due' : null,
      goal.needs_attention ? goal.attention_reason || 'Needs attention' : null,
    ].filter((reason): reason is string => Boolean(reason));
    if (!reasons.length) continue;
    addAttention({
      key: `goal:${goal.id}`,
      title: goal.title ?? 'Untitled Goal',
      label: 'Goal',
      detail: reasons.join(' · '),
      dueAt: goal.checkin_due_at ?? goal.target_date,
    });
  }

  const commitments: DigestItem[] = [];
  for (const task of tasks) {
    const isCurrentCommitment =
      task.status === 'active' ||
      (task.work_class === 'routine_occurrence' && task.status === 'backlog');
    if (!task.id || !isCurrentCommitment) continue;
    if (!inWindow(task.due_at, window.reportingEnd, window.planningEnd)) continue;
    const exceptionState = routineByTask.get(task.id)?.exception_state;
    if (exceptionState === 'pending' || exceptionState === 'returned') continue;
    if (attention.has(`task:${task.id}`)) continue;
    commitments.push({
      key: `task:${task.id}`,
      title: task.title ?? 'Untitled work',
      label: workLabel(task.work_class),
      detail: formatDue(task.due_at, task.due_is_date_only, now, timeZone),
      dueAt: task.due_at,
    });
  }
  for (const contribution of input.sharedContributions ?? []) {
    const dueAt = contribution.item_due_at ?? contribution.parent_due_at;
    if (!contribution.checklist_item_id || contribution.state === 'completed') continue;
    if (!inWindow(dueAt, window.reportingEnd, window.planningEnd)) continue;
    commitments.push({
      key: `shared:${contribution.checklist_item_id}`,
      title: contribution.title ?? 'Shared contribution',
      label: 'Shared',
      detail: `${contribution.parent_title ?? 'Shared work'} · ${formatDue(
        dueAt,
        contribution.item_due_at ? false : contribution.parent_due_is_date_only,
        now,
        timeZone,
      )}`,
      dueAt,
    });
  }

  const dateFormatter = new Intl.DateTimeFormat('en-MY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  });
  const completed: DigestItem[] = tasks
    .filter(
      (task) =>
        task.id &&
        task.status === 'completed' &&
        inWindow(task.completed_at, window.reportingStart, window.reportingEnd),
    )
    .map((task) => ({
      key: `task:${task.id}`,
      title: task.title ?? 'Untitled work',
      label: workLabel(task.work_class),
      detail: `Completed ${dateFormatter.format(new Date(task.completed_at!))}`,
      occurredAt: task.completed_at,
    }));
  for (const contribution of input.completedContributions ?? []) {
    if (
      !contribution.checklist_item_id ||
      !inWindow(contribution.completed_at, window.reportingStart, window.reportingEnd)
    ) {
      continue;
    }
    completed.push({
      key: `shared:${contribution.checklist_item_id}`,
      title: contribution.title ?? 'Shared contribution',
      label: 'Shared',
      detail: `${contribution.parent_title ?? 'Shared work'} · Completed${contribution.primary_owner_name && contribution.primary_owner_name !== 'Team member' ? ` for ${contribution.primary_owner_name}` : ''}`,
      occurredAt: contribution.completed_at,
    });
  }

  const byDue = (a: DigestItem, b: DigestItem) =>
    String(a.dueAt ?? '9999').localeCompare(String(b.dueAt ?? '9999')) ||
    a.title.localeCompare(b.title);
  const byRecent = (a: DigestItem, b: DigestItem) =>
    String(b.occurredAt ?? '').localeCompare(String(a.occurredAt ?? ''));
  return {
    attention: [...attention.values()].sort(byDue),
    commitments: commitments.sort(byDue),
    completed: completed.sort(byRecent),
  };
}

function teamDigest(input: RenderSummaryInput) {
  if (input.profile.team_summary_mode === 'off') return [];
  const names = new Map((input.teamPeople ?? []).map((person) => [person.userId, person.fullName]));
  for (const task of input.teamTasks) {
    if (task.primary_owner_id && task.owner_name) names.set(task.primary_owner_id, task.owner_name);
  }
  for (const goal of input.teamGoals ?? []) {
    if (goal.owner_id && goal.owner_name) names.set(goal.owner_id, goal.owner_name);
  }

  const pendingRoutineIds = new Set(
    (input.teamRoutineOutcomes ?? [])
      .filter((row) => row.exception_state === 'pending' && row.task_id)
      .map((row) => row.task_id as string),
  );
  const rows = new Map<string, { userId: string; fullName: string; signals: string[] }>();
  const add = (userId: string | null | undefined, signal: string) => {
    if (!userId) return;
    const row = rows.get(userId) ?? {
      userId,
      fullName: names.get(userId) ?? 'Team member',
      signals: [],
    };
    if (!row.signals.includes(signal)) row.signals.push(signal);
    rows.set(userId, row);
  };
  const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
    `${count} ${count === 1 ? singular : pluralForm}`;

  const overdueByPerson = new Map<string, number>();
  const reviewByPerson = new Map<string, number>();
  for (const task of input.teamTasks) {
    if (!task.primary_owner_id) continue;
    if (task.review_status === 'pending' && task.reviewer_id === input.profile.id) {
      reviewByPerson.set(
        task.primary_owner_id,
        (reviewByPerson.get(task.primary_owner_id) ?? 0) + 1,
      );
    }
    if (['completed', 'cancelled'].includes(task.status ?? '')) continue;
    if (task.is_overdue && (!task.id || !pendingRoutineIds.has(task.id))) {
      overdueByPerson.set(
        task.primary_owner_id,
        (overdueByPerson.get(task.primary_owner_id) ?? 0) + 1,
      );
    }
  }
  for (const [userId, count] of overdueByPerson) add(userId, plural(count, 'overdue item'));
  for (const [userId, count] of reviewByPerson) {
    add(userId, plural(count, 'completion awaiting review', 'completions awaiting review'));
  }

  const routineReviews = new Map<string, number>();
  for (const outcome of input.teamRoutineOutcomes ?? []) {
    if (outcome.exception_state !== 'pending' || !outcome.primary_owner_id) continue;
    routineReviews.set(
      outcome.primary_owner_id,
      (routineReviews.get(outcome.primary_owner_id) ?? 0) + 1,
    );
  }
  for (const [userId, count] of routineReviews) {
    add(
      userId,
      plural(count, 'routine exception awaiting review', 'routine exceptions awaiting review'),
    );
  }

  const taskOwner = new Map(
    input.teamTasks.flatMap((task) =>
      task.id && task.primary_owner_id ? ([[task.id, task.primary_owner_id]] as const) : [],
    ),
  );
  const goalOwner = new Map(
    (input.teamGoals ?? []).flatMap((goal) =>
      goal.id && goal.owner_id ? ([[goal.id, goal.owner_id]] as const) : [],
    ),
  );
  const barrierDecisions = new Map<string, number>();
  for (const barrier of input.teamBarriers ?? []) {
    const ownerId = barrier.task_id
      ? taskOwner.get(barrier.task_id)
      : barrier.goal_id
        ? goalOwner.get(barrier.goal_id)
        : null;
    if (!ownerId) continue;
    barrierDecisions.set(ownerId, (barrierDecisions.get(ownerId) ?? 0) + 1);
  }
  for (const [userId, count] of barrierDecisions) {
    add(
      userId,
      plural(count, 'barrier waiting on your decision', 'barriers waiting on your decision'),
    );
  }

  const goalActions = new Map<string, number>();
  for (const goal of input.teamGoals ?? []) {
    if (
      !goal.owner_id ||
      !(
        goal.manager_needs_attention ||
        goal.quarterly_requires_manager_action ||
        Number(goal.open_support_count ?? 0) > 0 ||
        goal.pending_version_id
      )
    ) {
      continue;
    }
    goalActions.set(goal.owner_id, (goalActions.get(goal.owner_id) ?? 0) + 1);
  }
  for (const [userId, count] of goalActions) {
    add(
      userId,
      plural(count, 'Goal decision or support request', 'Goal decisions or support requests'),
    );
  }
  /*
   * "workload review needed" used to be here, raised for anybody carrying more
   * than their focus target. v144 removed it with the target (specification §3):
   * a weekly email telling a manager to review somebody's workload, on the
   * strength of a ratio the product no longer trusts, is the same claim as the
   * strip that used to make it.
   */

  return [...rows.values()].sort(
    (a, b) => b.signals.length - a.signals.length || a.fullName.localeCompare(b.fullName),
  );
}

function renderItemRows(items: DigestItem[]) {
  return items
    .map(
      (item) =>
        `<tr><td style="padding:14px 0;border-top:1px solid #e7ebf0;vertical-align:top"><div style="font-size:15px;line-height:21px;font-weight:650;color:#182235">${escapeHtml(item.title)}</div><div style="padding-top:4px;font-size:13px;line-height:19px;color:#66758a">${escapeHtml(item.label)}&nbsp;&nbsp;·&nbsp;&nbsp;${escapeHtml(item.detail)}</div></td></tr>`,
    )
    .join('');
}

function renderSection(
  title: string,
  items: DigestItem[],
  limit: number,
  footer?: { href: string; label: string },
) {
  if (!items.length) return '';
  const visible = items.slice(0, limit);
  const remaining = items.length - visible.length;
  const footerText =
    remaining > 0 ? `+ ${remaining} more · ${footer?.label ?? 'View all'}` : footer?.label;
  return `<tr><td style="padding:26px 32px 0"><div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0d2342">${escapeHtml(title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:9px">${renderItemRows(visible)}</table>${footer && footerText ? `<div style="padding-top:10px;font-size:13px;line-height:18px"><a href="${escapeHtml(footer.href)}" style="color:#1668e8;text-decoration:none;font-weight:600">${escapeHtml(footerText)}</a></div>` : remaining > 0 ? `<div style="padding-top:10px;font-size:13px;line-height:18px;color:#66758a">+ ${remaining} more</div>` : ''}</td></tr>`;
}

/** Builds the small decision-ready digest without reading the database or clock. */
export function renderSummary(input: RenderSummaryInput) {
  const timeZone = input.timeZone ?? 'Asia/Kuala_Lumpur';
  const window = input.window ?? weeklyWindow(input.now, timeZone);
  const normalizedInput = { ...input, timeZone, window };
  const personal = personalDigest(normalizedInput);
  const team = teamDigest(normalizedInput);
  const itemLimit = input.mode === 'focused' ? 3 : 5;
  const subject = personal.attention.length
    ? `TAMCO Focus — ${personal.attention.length} ${personal.attention.length === 1 ? 'needs' : 'need'} attention${personal.commitments.length ? ` · ${personal.commitments.length} due this week` : ''}`
    : `TAMCO Focus — Your week ahead · ${personal.commitments.length} commitment${personal.commitments.length === 1 ? '' : 's'}`;
  const myDayHref = appLink(input.appBaseUrl, '/today');
  const completedHref = appLink(input.appBaseUrl, '/more/records?state=completed');
  const teamHref = appLink(input.appBaseUrl, '/work?scope=team&filter=attention');

  const textSections: string[] = ['NEEDS ATTENTION'];
  if (personal.attention.length) {
    textSections.push(
      ...personal.attention
        .slice(0, itemLimit)
        .map((item) => `- [${item.label}] ${item.title} — ${item.detail}`),
    );
    if (personal.attention.length > itemLimit) {
      textSections.push(`- + ${personal.attention.length - itemLimit} more in TAMCO Focus`);
    }
  } else {
    textSections.push('Nothing urgent needs your attention.');
  }
  if (personal.commitments.length) {
    textSections.push(
      '',
      'THIS WEEK',
      ...personal.commitments
        .slice(0, itemLimit)
        .map((item) => `- [${item.label}] ${item.title} — ${item.detail}`),
    );
    if (personal.commitments.length > itemLimit) {
      textSections.push(`- + ${personal.commitments.length - itemLimit} more in My Day`);
    }
  }
  if (personal.completed.length) {
    textSections.push(
      '',
      'COMPLETED LAST WEEK',
      ...personal.completed
        .slice(0, itemLimit)
        .map((item) => `- [${item.label}] ${item.title} — ${item.detail}`),
      `- View completed: ${completedHref}`,
    );
  }
  if (team.length) {
    textSections.push(
      '',
      'TEAM NEEDS ATTENTION',
      ...team.slice(0, 5).map((row) => `- ${row.fullName} — ${row.signals.join(' · ')}`),
    );
    if (team.length > 5) textSections.push(`- + ${team.length - 5} more people`);
    textSections.push(`- Open team attention: ${teamHref}`);
  }
  const text = [
    `Hello ${input.profile.full_name},`,
    `Here is your week at a glance for ${formatWeekRange(window, timeZone)}.`,
    '',
    ...textSections,
    '',
    `Open My Day: ${myDayHref}`,
  ].join('\n');

  const attentionHtml = personal.attention.length
    ? renderSection('Needs attention', personal.attention, itemLimit)
    : `<tr><td style="padding:24px 32px 0"><div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0d2342">Needs attention</div><div style="margin-top:10px;padding:12px 14px;border:1px solid #d9eee3;border-radius:10px;background:#f3faf6;font-size:14px;line-height:20px;color:#277a4f">Nothing urgent needs your attention.</div></td></tr>`;
  const teamItems: DigestItem[] = team.map((row) => ({
    key: row.userId,
    title: row.fullName,
    label: 'Team',
    detail: row.signals.join(' · '),
  }));
  const summaryLine = [
    personal.attention.length
      ? `${personal.attention.length} need attention`
      : 'No urgent exceptions',
    `${personal.commitments.length} this week`,
    `${personal.completed.length} completed last week`,
  ].join('  ·  ');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f5f6f8;color:#182235;font-family:Arial,'Helvetica Neue',sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(summaryLine)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f5f6f8"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #dde3ea;border-radius:16px;overflow:hidden"><tr><td style="height:5px;background:#1668e8;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:28px 32px 22px;border-bottom:1px solid #e7ebf0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:top"><div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1668e8">TAMCO Focus</div><h1 style="margin:8px 0 0;font-size:26px;line-height:32px;font-weight:700;letter-spacing:-.02em;color:#0d2342">Your week at a glance</h1><div style="margin-top:7px;font-size:13px;line-height:19px;color:#66758a">${escapeHtml(formatWeekRange(window, timeZone))}</div></td><td align="right" style="vertical-align:top"><div style="width:36px;height:36px;border-radius:10px;background:#0d2342;color:#ffffff;font-size:18px;font-weight:700;line-height:36px;text-align:center">T</div></td></tr></table><p style="margin:20px 0 0;font-size:15px;line-height:23px;color:#334155">Hello ${escapeHtml(firstName(input.profile.full_name))}, here is the small set of things most useful for the week ahead.</p><div style="margin-top:16px;padding:10px 12px;border-radius:9px;background:#f7f9fb;font-size:12px;line-height:18px;color:#66758a">${escapeHtml(summaryLine)}</div></td></tr>${attentionHtml}${renderSection('This week', personal.commitments, itemLimit)}${renderSection('Completed last week', personal.completed, itemLimit, { href: completedHref, label: 'View completed' })}${renderSection('Team needs attention', teamItems, 5, { href: teamHref, label: 'Open Team attention' })}<tr><td style="padding:28px 32px 32px"><a href="${escapeHtml(myDayHref)}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#1668e8;color:#ffffff;font-size:14px;line-height:18px;font-weight:700;text-decoration:none">Open My Day</a><div style="margin-top:18px;font-size:11px;line-height:17px;color:#8995a5">Generated from recorded work, routine, contribution, review and support activity. No separate weekly report is required.</div></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

async function claimAndDeliver(
  client: Client,
  deliveryId: string,
  delivery: { to: string; subject: string; html: string; text: string },
  send: WeeklyWorkerOptions['send'],
) {
  const { data, error } = await client.rpc('claim_email_delivery', { p_delivery_id: deliveryId });
  const claim = data as { ok?: boolean; delivery?: { attempt_count?: number } } | null;
  if (error || !claim?.ok) return 'skipped' as const;

  try {
    if (send) await send(delivery);
    const sentAt = new Date().toISOString();
    const updated = await client
      .from('email_deliveries')
      .update({ status: 'sent', sent_at: sentAt, processing_started_at: null })
      .eq('id', deliveryId)
      .eq('status', 'processing');
    if (updated.error) throw updated.error;
    return 'sent' as const;
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message.slice(0, 1000) : 'Unknown delivery error';
    /*
     * `undeliverable` is terminal: `claim_email_delivery` picks up `queued`,
     * retryable `failed` and abandoned `processing` rows, and nothing else.
     * Only the transport can tell a busy relay from an address that cannot
     * receive mail, so the distinction arrives as the type of the error.
     */
    const permanent = caught instanceof PermanentDeliveryError;
    const attempts = Number(claim.delivery?.attempt_count ?? 1);
    const retryMinutes = Math.min(24 * 60, 2 ** Math.min(attempts, 10));
    await client
      .from('email_deliveries')
      .update({
        status: permanent ? 'undeliverable' : 'failed',
        last_error: message,
        next_retry_at: permanent
          ? null
          : new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        processing_started_at: null,
      })
      .eq('id', deliveryId);
    return permanent ? ('undeliverable' as const) : ('failed' as const);
  }
}

/**
 * `in (...)` in batches, so the query string cannot outgrow the URL.
 *
 * A hundred UUIDs is about 3,800 characters, comfortably inside every limit in
 * the path. Ordering and the overall cap are applied after merging, so the
 * result is what a single query would have returned.
 */
async function readCompletionReviewsInBatches(
  client: SupabaseClient<Database>,
  taskIds: string[],
): Promise<{ data: Record<string, unknown>[]; error: { message: string } | null }> {
  if (taskIds.length === 0) return { data: [], error: null };

  const batches: string[][] = [];
  for (let index = 0; index < taskIds.length; index += 100) {
    batches.push(taskIds.slice(index, index + 100));
  }

  const rows: Record<string, unknown>[] = [];
  for (const batch of batches) {
    const { data, error } = await client
      .from('completion_reviews')
      .select('*')
      .in('task_id', batch)
      .order('submitted_at', { ascending: false })
      .limit(500);
    if (error) return { data: [], error };
    rows.push(...((data ?? []) as Record<string, unknown>[]));
  }

  rows.sort((left, right) =>
    String(right.submitted_at ?? '').localeCompare(String(left.submitted_at ?? '')),
  );
  return { data: rows.slice(0, 500), error: null };
}

async function loadPersonalSignals(
  client: Client,
  profileId: string,
  tasks: TaskRow[],
  window: WeeklyWindow,
) {
  const taskIds = tasks.map((task) => task.id).filter((id): id is string => id !== null);
  const [shared, completedContributions, barriers, routineOutcomes, completionReviews] =
    await Promise.all([
      client.from('shared_contributions').select('*').eq('assignee_id', profileId).limit(500),
      client
        .from('completed_contributions')
        .select(
          'checklist_item_id,task_id,title,assignee_id,completed_at,parent_title,primary_owner_name',
        )
        .eq('assignee_id', profileId)
        .gte('completed_at', window.reportingStart.toISOString())
        .lt('completed_at', window.reportingEnd.toISOString())
        .order('completed_at', { ascending: false })
        .limit(100),
      client
        .from('barriers')
        .select('*')
        .eq('action_required_from', profileId)
        .eq('action_pending', true)
        .eq('source_active', true)
        .eq('status', 'open')
        .limit(100),
      client
        .from('routine_occurrence_outcomes')
        .select(
          'task_id,title,primary_owner_id,occurrence_date,status,exception_state,decision_note,outcome',
        )
        .eq('primary_owner_id', profileId)
        .in('status', ['backlog', 'active', 'paused'])
        .order('occurrence_date', { ascending: false })
        .limit(500),
      /*
       * In batches, because a `.in()` list travels in the URL.
       *
       * The task query above returns up to 500 rows, and 500 UUIDs is roughly
       * 19,000 characters of query string — past what PostgREST accepts, which
       * comes back as "URI too long". So the weekly summary silently stopped
       * generating for anybody carrying enough open work, and only for them:
       * the failure scales with how busy a person is, which is the last place
       * anybody would look for it.
       */
      readCompletionReviewsInBatches(client, taskIds),
    ]);
  const error =
    shared.error ||
    completedContributions.error ||
    barriers.error ||
    routineOutcomes.error ||
    completionReviews.error;
  if (error) throw error;
  return {
    sharedContributions: (shared.data ?? []) as SharedContributionRow[],
    completedContributions: (completedContributions.data ?? []) as CompletedContributionRow[],
    barriers: (barriers.data ?? []) as BarrierRow[],
    routineOutcomes: (routineOutcomes.data ?? []) as RoutineOutcomeRow[],
    completionReviews: (completionReviews.data ?? []) as CompletionReviewRow[],
  };
}

/** Generates, claims, sends and retries weekly summaries without duplicate period records. */
export async function runWeeklySummaryWorker(
  client: Client,
  options: WeeklyWorkerOptions = {},
): Promise<WeeklyWorkerResult> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? 'Asia/Kuala_Lumpur';
  const window = weeklyWindow(now, timeZone, options.scheduleDay, options.scheduleHour);
  const result: WeeklyWorkerResult = {
    due: window.due,
    generated: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    undeliverable: 0,
    periodStart: window.reportingStart.toISOString(),
  };
  if ((options.transport === 'smtp' || options.transport === 'inbucket') && !options.send) {
    throw new Error(
      `The ${options.transport} transport was named but no send function was supplied. ` +
        'Every summary would be recorded as sent and discarded.',
    );
  }
  if (!window.due && !options.force) return result;

  const { data: profiles, error: profilesError } = await client
    .from('user_profiles')
    .select('*')
    .eq('status', 'active')
    .neq('personal_summary_mode', 'off')
    .order('employee_id');
  if (profilesError) throw profilesError;

  for (const profile of profiles ?? []) {
    const { data: tasks, error: taskError } = await client
      .from('task_overview')
      .select('*')
      .eq('primary_owner_id', profile.id)
      .order('due_at', { ascending: true, nullsFirst: false });
    if (taskError) throw taskError;
    const owned = tasks ?? [];
    const [personalSignals, goalResult] = await Promise.all([
      loadPersonalSignals(client, profile.id, owned, window),
      client
        .from('goal_overview')
        .select('*')
        .eq('owner_id', profile.id)
        .in('status', ['active', 'pending_discussion'])
        .order('target_date', { ascending: true }),
    ]);
    if (goalResult.error) throw goalResult.error;

    let teamTasks: TaskRow[] = [];
    let teamBarriers: BarrierRow[] = [];
    let teamRoutineOutcomes: RoutineOutcomeRow[] = [];
    let teamGoals: GoalRow[] = [];
    let teamPeople: TeamPerson[] = [];
    if (
      profile.team_summary_mode !== 'off' &&
      ['manager', 'administrator'].includes(profile.role)
    ) {
      const preview = await client.rpc('preview_effective_visibility', { p_viewer_id: profile.id });
      if (preview.error) throw preview.error;
      teamPeople = (preview.data ?? [])
        .filter((row) => row.user_id !== profile.id)
        .map((row) => ({ userId: row.user_id, fullName: row.full_name }));
      const subjectIds = teamPeople.map((person) => person.userId);
      if (subjectIds.length) {
        const [teamTaskResult, teamBarrierResult, teamRoutineResult, teamGoalResult] =
          await Promise.all([
            client
              .from('task_overview')
              .select('*')
              .in('primary_owner_id', subjectIds)
              .or('status.in.(backlog,active,paused),review_status.eq.pending')
              .limit(5000),
            client
              .from('barriers')
              .select('*')
              .eq('action_required_from', profile.id)
              .eq('action_pending', true)
              .eq('source_active', true)
              .eq('status', 'open')
              .limit(500),
            client
              .from('routine_occurrence_outcomes')
              .select(
                'task_id,title,primary_owner_id,occurrence_date,status,exception_state,decision_note,outcome',
              )
              .in('primary_owner_id', subjectIds)
              .eq('exception_state', 'pending')
              .limit(500),
            client
              .from('goal_overview')
              .select('*')
              .in('owner_id', subjectIds)
              .in('status', ['active', 'pending_discussion'])
              .limit(1000),
          ]);
        const teamError =
          teamTaskResult.error ||
          teamBarrierResult.error ||
          teamRoutineResult.error ||
          teamGoalResult.error;
        if (teamError) throw teamError;
        teamTasks = teamTaskResult.data ?? [];
        teamBarriers = (teamBarrierResult.data ?? []) as BarrierRow[];
        teamRoutineOutcomes = (teamRoutineResult.data ?? []) as RoutineOutcomeRow[];
        teamGoals = teamGoalResult.data ?? [];
      }
    }

    const rendered = renderSummary({
      profile,
      mode: profile.personal_summary_mode as 'focused' | 'standard',
      tasks: owned,
      teamTasks,
      ...personalSignals,
      goals: goalResult.data ?? [],
      teamBarriers,
      teamRoutineOutcomes,
      teamGoals,
      teamPeople,
      appBaseUrl: options.appBaseUrl ?? 'http://localhost:3000',
      now,
      window,
      timeZone,
    });
    const summaryType = profile.team_summary_mode === 'off' ? 'personal' : 'manager_team';
    const row = {
      recipient_id: profile.id,
      recipient_email: profile.email,
      summary_type: summaryType as 'personal' | 'manager_team',
      period_start: window.reportingStart.toISOString(),
      period_end: window.reportingEnd.toISOString(),
      subject: rendered.subject,
      body_html: rendered.html,
      body_text: rendered.text,
    };
    const inserted = await client.from('email_deliveries').insert(row).select('id').maybeSingle();
    let deliveryId = inserted.data?.id;
    if (inserted.error) {
      if (inserted.error.code !== '23505') throw inserted.error;
      const existing = await client
        .from('email_deliveries')
        .select('id,status,next_retry_at')
        .eq('recipient_id', profile.id)
        .eq('summary_type', summaryType)
        .eq('period_start', window.reportingStart.toISOString())
        .single();
      if (existing.error) throw existing.error;
      if (existing.data.status === 'sent') {
        result.skipped += 1;
        continue;
      }
      deliveryId = existing.data.id;
    } else result.generated += 1;

    if (!deliveryId) continue;
    const outcome = await claimAndDeliver(
      client,
      deliveryId,
      { to: profile.email, subject: rendered.subject, html: rendered.html, text: rendered.text },
      options.send,
    );
    result[outcome] += 1;
  }
  return result;
}

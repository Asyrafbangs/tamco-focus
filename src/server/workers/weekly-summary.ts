import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { formatDurationWords, staleAgeMs } from '@/domain/duration';
import { weeklyWindow } from '@/domain/weekly-schedule';

type Client = SupabaseClient<Database, 'public'>;
type Profile = Database['public']['Tables']['user_profiles']['Row'];
type TaskRow = Database['public']['Views']['task_overview']['Row'];
type GoalRow = Database['public']['Views']['goal_overview']['Row'];

export interface WeeklyWorkerOptions {
  now?: Date;
  force?: boolean;
  timeZone?: string;
  scheduleDay?: string;
  scheduleHour?: number;
  appBaseUrl?: string;
  transport?: 'log' | 'inbucket';
  send?: (delivery: { to: string; subject: string; html: string; text: string }) => Promise<void>;
}

export interface WeeklyWorkerResult {
  due: boolean;
  generated: number;
  sent: number;
  skipped: number;
  failed: number;
  periodStart: string;
}

/**
 * Exported so the escaping can be tested directly. Section 14.4 requires email
 * bodies to escape user-entered content, and task titles reach the HTML body
 * verbatim — an untested escape is the one place a silent XSS would survive.
 */
export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const titleList = (title: string, tasks: TaskRow[], empty: string) => ({
  title,
  items: tasks.length ? tasks.map((task) => task.title ?? 'Untitled work') : [empty],
});

function meaningfulGoal(goal: GoalRow, reportingStart: Date) {
  return Boolean(
    goal.needs_attention ||
    goal.is_checkin_due ||
    goal.is_update_requested ||
    goal.is_target_approaching ||
    goal.has_recent_milestone_completion ||
    Number(goal.open_support_count ?? 0) > 0 ||
    goal.pending_version_id ||
    (goal.last_meaningful_update_at &&
      new Date(goal.last_meaningful_update_at).getTime() >= reportingStart.getTime()),
  );
}

function goalSummaryLine(goal: GoalRow) {
  const reasons = [
    Number(goal.open_support_count ?? 0) > 0 ? 'support requested' : null,
    goal.is_update_requested ? 'update requested' : null,
    goal.is_checkin_due ? 'check-in due' : null,
    goal.is_target_approaching ? 'target approaching' : null,
    goal.has_recent_milestone_completion ? 'milestone completed' : null,
    goal.pending_version_id ? 'changes awaiting agreement' : null,
  ].filter(Boolean);
  const health = String(goal.health ?? 'on_track').replaceAll('_', ' ');
  return `${goal.title ?? 'Untitled Goal'} — ${health}${reasons.length ? `; ${reasons.join(', ')}` : '; updated this week'}`;
}

/**
 * Exported for unit testing. Pure: it takes rows and returns strings, touching
 * neither the database nor the clock, so the preference-mode section selection
 * (PRODUCTION_LOGIC.md "V30", items 4 to 7) can be asserted directly.
 */
export function renderSummary(input: {
  profile: Profile;
  mode: 'focused' | 'standard';
  tasks: TaskRow[];
  changes: number;
  teamTasks: TaskRow[];
  teamChanges: number;
  teamBarriers: number;
  goals?: GoalRow[];
  teamGoals?: GoalRow[];
  appBaseUrl: string;
  now: Date;
}) {
  const { profile, tasks, now } = input;
  const meaningfulGoals = (input.goals ?? []).filter((goal) =>
    meaningfulGoal(goal, new Date(now.getTime() - 7 * 86_400_000)),
  );
  const completed = tasks.filter((task) => task.status === 'completed' && task.completed_at);
  const attention = tasks.filter((task) => task.is_overdue || task.is_stale);
  const due = tasks.filter(
    (task) => task.status !== 'completed' && task.status !== 'cancelled' && task.due_at,
  );
  const routines = due.filter((task) => task.work_class === 'routine_occurrence');
  const ranked = [...tasks]
    .filter((task) => ['backlog', 'active', 'paused'].includes(task.status ?? ''))
    .sort((a, b) => {
      const score = (task: TaskRow) =>
        task.is_mandatory
          ? 0
          : task.is_overdue
            ? 1
            : task.is_stale
              ? 2
              : task.status === 'active'
                ? 3
                : 4;
      return (
        score(a) - score(b) || String(a.due_at ?? '9999').localeCompare(String(b.due_at ?? '9999'))
      );
    });
  const recommendation = ranked[0];
  const sections = [
    titleList('Wins from last week', completed, 'No completed work was recorded last week.'),
    titleList('Needs attention', attention, 'No overdue or stale active work needs attention.'),
    titleList(
      'Due this week',
      due.filter((task) => task.work_class !== 'routine_occurrence'),
      'No dated commitments are due this week.',
    ),
  ];
  if (input.mode === 'standard') {
    sections.splice(1, 0, {
      title: 'Meaningful changes',
      items: [`${input.changes} recorded task change${input.changes === 1 ? '' : 's'} last week.`],
    });
    sections.push(
      titleList('Routine work due', routines, 'No routine occurrences are due this week.'),
    );
  }
  if (meaningfulGoals.length > 0) {
    sections.push({
      title: 'Goal progress and check-ins',
      items: meaningfulGoals.slice(0, 6).map(goalSummaryLine),
    });
  }
  sections.push({
    title: 'Recommended starting point',
    items: recommendation
      ? [
          `${recommendation.title ?? 'Untitled work'}${recommendation.is_stale && recommendation.status && recommendation.last_meaningful_update_at ? ` — no meaningful update for ${formatDurationWords(staleAgeMs({ status: recommendation.status, lastMeaningfulUpdateAt: recommendation.last_meaningful_update_at }, now))}` : ''}`,
        ]
      : ['No recommendation is needed right now.'],
  });

  if (profile.team_summary_mode !== 'off') {
    const meaningfulTeamGoals = (input.teamGoals ?? []).filter((goal) =>
      meaningfulGoal(goal, new Date(now.getTime() - 7 * 86_400_000)),
    );
    sections.push(
      titleList(
        'Team wins and changes',
        input.teamTasks.filter((task) => task.status === 'completed'),
        'No team completions were recorded last week.',
      ),
      titleList(
        'Team exceptions',
        input.teamTasks.filter(
          (task) => task.is_overdue || task.is_stale || task.over_focus_target,
        ),
        'No overdue, stale, or over-target team work needs attention.',
      ),
      {
        title: 'Manager decisions and support',
        items: [
          `${input.teamBarriers} open barrier${input.teamBarriers === 1 ? '' : 's'} and ${input.teamChanges} recorded team change${input.teamChanges === 1 ? '' : 's'}.`,
        ],
      },
    );
    if (meaningfulTeamGoals.length > 0) {
      sections.push({
        title: 'Team Goal coaching',
        items: meaningfulTeamGoals
          .slice(0, 8)
          .map((goal) => `${goal.owner_name ?? 'Team member'}: ${goalSummaryLine(goal)}`),
      });
    }
  }

  const subject = `TAMCO Focus weekly summary — ${profile.full_name}`;
  const text = [
    `Hello ${profile.full_name},`,
    '',
    ...sections.flatMap((section) => [
      section.title,
      ...section.items.map((item) => `- ${item}`),
      '',
    ]),
    `Open My Day: ${input.appBaseUrl}/today`,
  ].join('\n');
  const htmlSections = sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.title)}</h2><ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`,
    )
    .join('');
  const html = `<!doctype html><html><body><main><h1>Your TAMCO Focus week</h1><p>Hello ${escapeHtml(profile.full_name)},</p>${htmlSections}<p><a href="${escapeHtml(input.appBaseUrl)}/today">Open My Day</a></p></main></body></html>`;
  return { subject, text, html };
}

async function loadTaskChanges(client: Client, taskIds: string[], start: string, end: string) {
  if (!taskIds.length) return 0;
  const { count, error } = await client
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .in('task_id', taskIds)
    .gte('occurred_at', start)
    .lt('occurred_at', end)
    .neq('event_type', 'attachment_opened');
  if (error) throw error;
  return count ?? 0;
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
    // The local log transport is the delivery log itself. Mark it sent before
    // returning so a worker restart cannot print or process it twice.
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
    const attempts = Number(claim.delivery?.attempt_count ?? 1);
    const retryMinutes = Math.min(24 * 60, 2 ** Math.min(attempts, 10));
    await client
      .from('email_deliveries')
      .update({
        status: 'failed',
        last_error: message,
        next_retry_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        processing_started_at: null,
      })
      .eq('id', deliveryId);
    return 'failed' as const;
  }
}

/** Generates real summaries, claims delivery rows atomically, and retries
 * transient failures without creating duplicate period records. */
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
    periodStart: window.reportingStart.toISOString(),
  };
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
    const changes = await loadTaskChanges(
      client,
      owned.map((task) => task.id).filter((id): id is string => id !== null),
      window.reportingStart.toISOString(),
      window.reportingEnd.toISOString(),
    );
    const { data: goalRows, error: goalError } = await client
      .from('goal_overview')
      .select('*')
      .eq('owner_id', profile.id)
      .eq('status', 'active')
      .order('target_date', { ascending: true });
    if (goalError) throw goalError;

    let teamTasks: TaskRow[] = [];
    let teamChanges = 0;
    let teamBarriers = 0;
    let teamGoals: GoalRow[] = [];
    if (
      profile.team_summary_mode !== 'off' &&
      ['manager', 'administrator'].includes(profile.role)
    ) {
      const preview = await client.rpc('preview_effective_visibility', { p_viewer_id: profile.id });
      if (preview.error) throw preview.error;
      const subjectIds = (preview.data ?? [])
        .map((row) => row.user_id)
        .filter((id) => id !== profile.id);
      if (subjectIds.length) {
        const teamResult = await client
          .from('task_overview')
          .select('*')
          .in('primary_owner_id', subjectIds);
        if (teamResult.error) throw teamResult.error;
        teamTasks = (teamResult.data ?? []).filter((task) => {
          const completedAt = task.completed_at ? new Date(task.completed_at).getTime() : null;
          return (
            task.is_overdue ||
            task.is_stale ||
            task.over_focus_target ||
            ['backlog', 'active', 'paused'].includes(task.status ?? '') ||
            (completedAt !== null &&
              completedAt >= window.reportingStart.getTime() &&
              completedAt < window.reportingEnd.getTime())
          );
        });
        const teamTaskIds = teamTasks
          .map((task) => task.id)
          .filter((id): id is string => id !== null);
        teamChanges = await loadTaskChanges(
          client,
          teamTaskIds,
          window.reportingStart.toISOString(),
          window.reportingEnd.toISOString(),
        );
        const barriers = await client
          .from('barriers')
          .select('id', { count: 'exact', head: true })
          .in('task_id', teamTaskIds)
          .eq('status', 'open');
        if (barriers.error) throw barriers.error;
        teamBarriers = barriers.count ?? 0;
        const teamGoalResult = await client
          .from('goal_overview')
          .select('*')
          .in('owner_id', subjectIds)
          .in('status', ['active', 'pending_discussion'])
          .order('target_date', { ascending: true });
        if (teamGoalResult.error) throw teamGoalResult.error;
        teamGoals = teamGoalResult.data ?? [];
      }
    }

    const rendered = renderSummary({
      profile,
      mode: profile.personal_summary_mode as 'focused' | 'standard',
      tasks: owned.filter((task) => {
        const completedAt = task.completed_at ? new Date(task.completed_at).getTime() : null;
        const dueAt = task.due_at ? new Date(task.due_at).getTime() : null;
        return (
          task.is_overdue ||
          task.is_stale ||
          (completedAt !== null &&
            completedAt >= window.reportingStart.getTime() &&
            completedAt < window.reportingEnd.getTime()) ||
          (dueAt !== null &&
            dueAt >= window.reportingEnd.getTime() &&
            dueAt < window.planningEnd.getTime()) ||
          ['backlog', 'active', 'paused'].includes(task.status ?? '')
        );
      }),
      changes,
      teamTasks,
      teamChanges,
      teamBarriers,
      goals: goalRows ?? [],
      teamGoals,
      appBaseUrl: options.appBaseUrl ?? 'http://localhost:3000',
      now,
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
      options.transport === 'inbucket' ? options.send : undefined,
    );
    result[outcome] += 1;
  }
  return result;
}

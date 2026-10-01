import 'server-only';

import { dayOf, type ActivityEvent } from '@/domain/team-activity';
import type { ResolvedPeriod } from '@/domain/period';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getTeamLoad } from '@/server/queries';

/**
 * What the team moved forward, as events ready to be merged (v232, §20).
 *
 * Reads the audit trail rather than keeping a second record of what happened,
 * and takes only the kinds a manager can act on — `attachment_opened` and
 * `task_created` are true and useless here. Completions come from
 * `task_overview` and `completed_contributions`, the same sources the Completed
 * tab uses, so the two screens can never disagree about what closed.
 *
 * Visibility is `getTeamLoad`, exactly as every other team view, so this makes
 * no new claim about who may see whose work.
 */

/** The audit events a manager should see. Everything else stays in the trail. */
const ACTIVITY_EVENT_TYPES = [
  'checklist_item_completed',
  'update_posted',
  'attachment_added',
  'task_due_date_changed',
  'task_urgency_changed',
  'barrier_raised',
  'barrier_resolved',
  'completion_submitted',
  'routine_finding_recorded',
] as const;

function shortDay(value: unknown, timeZone: string): string | null {
  if (typeof value !== 'string' || !value) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(value),
  );
}

function kindOf(type: string, detail: Record<string, unknown>): ActivityEvent['kind'] | null {
  switch (type) {
    case 'checklist_item_completed':
      return 'step';
    case 'update_posted':
      return detail.evidence_only === true ? 'evidence' : 'note';
    case 'attachment_added':
      return 'evidence';
    case 'task_due_date_changed':
      return 'due';
    case 'task_urgency_changed':
      return 'priority';
    case 'barrier_raised':
      return 'blocked';
    case 'barrier_resolved':
      return 'unblocked';
    case 'completion_submitted':
      return 'submitted';
    case 'routine_finding_recorded':
      return 'finding';
    default:
      return null;
  }
}

function blank(): Pick<
  ActivityEvent,
  | 'parentTitle'
  | 'body'
  | 'progressAfter'
  | 'progressBefore'
  | 'dueFrom'
  | 'dueTo'
  | 'priorityFrom'
  | 'priorityTo'
  | 'stepName'
> {
  return {
    parentTitle: null,
    body: null,
    progressAfter: null,
    progressBefore: null,
    dueFrom: null,
    dueTo: null,
    priorityFrom: null,
    priorityTo: null,
    stepName: null,
  };
}

/**
 * How many activity cards the window holds, for the tab badge (v236, §20).
 *
 * The badge was left off because a figure there would cost a query on every
 * other tab. It is wanted — a manager should be able to see whether the week
 * had anything in it before clicking — so this is the cheapest read that can
 * still give the right number: the same three sources and the same allow-list,
 * selecting only the three columns the merge key is built from.
 *
 * It counts cards rather than rows, because that is what the tab shows. One
 * person on one task for an afternoon is one card there, and a badge saying
 * six would be counting something nobody can see.
 */
export async function getTeamActivityCount(
  viewerId: string,
  period: ResolvedPeriod,
  timeZone: string,
  limit = 400,
): Promise<number> {
  const team = await getTeamLoad(viewerId);
  const ids = team.map((person) => person.userId);
  if (ids.length === 0) return 0;

  const supabase = await createSupabaseServerClient();

  const auditQuery = supabase
    .from('audit_events')
    .select('occurred_at,actor_id,task_id')
    .in('actor_id', ids)
    .in('event_type', ACTIVITY_EVENT_TYPES)
    .gte('occurred_at', period.since)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  const completedQuery = supabase
    .from('task_overview')
    .select('id,completed_at,completed_owner_id')
    .in('completed_owner_id', ids)
    .eq('status', 'completed')
    .gte('completed_at', period.since)
    .order('completed_at', { ascending: false })
    .limit(limit);
  const contributedQuery = supabase
    .from('completed_contributions')
    .select('task_id,completed_at,assignee_id')
    .in('assignee_id', ids)
    .gte('completed_at', period.since)
    .order('completed_at', { ascending: false })
    .limit(limit);

  const [audit, completed, contributed] = await Promise.all([
    period.until ? auditQuery.lte('occurred_at', period.until) : auditQuery,
    period.until ? completedQuery.lte('completed_at', period.until) : completedQuery,
    period.until ? contributedQuery.lte('completed_at', period.until) : contributedQuery,
  ]);

  /*
   * A badge that cannot be read is left off, not reported as zero: "Recent
   * activity 0" is a claim about the team, and a failed query does not support
   * one.
   */
  if (audit.error || completed.error || contributed.error) {
    console.error(
      `[getTeamActivityCount] ${audit.error?.message ?? ''} ${completed.error?.message ?? ''} ${contributed.error?.message ?? ''}`,
    );
    return 0;
  }

  // The merge key `mergeActivity` uses, so this counts exactly what is shown.
  const cards = new Set<string>();
  for (const row of audit.data ?? []) {
    cards.add(`${row.actor_id}|${row.task_id}|${dayOf(String(row.occurred_at), timeZone)}`);
  }
  for (const row of completed.data ?? []) {
    cards.add(`${row.completed_owner_id}|${row.id}|${dayOf(String(row.completed_at), timeZone)}`);
  }
  for (const row of contributed.data ?? []) {
    cards.add(`${row.assignee_id}|${row.task_id}|${dayOf(String(row.completed_at), timeZone)}`);
  }
  return cards.size;
}

export async function getTeamActivity(
  viewerId: string,
  period: ResolvedPeriod,
  timeZone: string,
  limit = 400,
): Promise<{
  events: ActivityEvent[];
  team: Array<{ userId: string; fullName: string }>;
  failed: boolean;
}> {
  const team = await getTeamLoad(viewerId);
  const names = new Map(team.map((person) => [person.userId, person.fullName]));
  const people = team.map((person) => ({ userId: person.userId, fullName: person.fullName }));
  const ids = [...names.keys()];
  if (ids.length === 0) return { events: [], team: people, failed: false };

  const supabase = await createSupabaseServerClient();

  const auditQuery = supabase
    .from('audit_events')
    .select('id,event_type,occurred_at,actor_id,task_id,detail,tasks!inner(title)')
    .in('actor_id', ids)
    .in('event_type', ACTIVITY_EVENT_TYPES)
    .gte('occurred_at', period.since)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  const completedQuery = supabase
    .from('task_overview')
    .select('id,title,completed_at,completed_owner_id')
    .in('completed_owner_id', ids)
    .eq('status', 'completed')
    .gte('completed_at', period.since)
    .order('completed_at', { ascending: false })
    .limit(limit);
  const contributedQuery = supabase
    .from('completed_contributions')
    .select('checklist_item_id,task_id,title,parent_title,completed_at,assignee_id')
    .in('assignee_id', ids)
    .gte('completed_at', period.since)
    .order('completed_at', { ascending: false })
    .limit(limit);

  const [audit, completed, contributed] = await Promise.all([
    period.until ? auditQuery.lte('occurred_at', period.until) : auditQuery,
    period.until ? completedQuery.lte('completed_at', period.until) : completedQuery,
    period.until ? contributedQuery.lte('completed_at', period.until) : contributedQuery,
  ]);

  if (audit.error || completed.error || contributed.error) {
    console.error(
      `[getTeamActivity] ${audit.error?.message ?? ''} ${completed.error?.message ?? ''} ${contributed.error?.message ?? ''}`,
    );
    return { events: [], team: people, failed: true };
  }

  const auditRows = audit.data ?? [];
  const detailOf = (row: (typeof auditRows)[number]) =>
    (row.detail ?? {}) as Record<string, unknown>;

  /*
   * One progress figure from before the window per task, so the first card in
   * it can still say where the work started rather than only where it reached.
   */
  const taskIds = [...new Set(auditRows.map((row) => String(row.task_id)).filter(Boolean))];
  const anchors = new Map<string, number>();
  if (taskIds.length > 0) {
    const { data: prior } = await supabase
      .from('audit_events')
      .select('task_id,detail,occurred_at')
      .in('task_id', taskIds)
      .eq('event_type', 'checklist_item_completed')
      .lt('occurred_at', period.since)
      .order('occurred_at', { ascending: false })
      .limit(500);
    for (const row of prior ?? []) {
      const key = String(row.task_id);
      if (anchors.has(key)) continue;
      const value = (row.detail as Record<string, unknown> | null)?.progress_percent;
      if (typeof value === 'number') anchors.set(key, value);
    }
  }

  const events: ActivityEvent[] = [];
  for (const row of auditRows) {
    const detail = detailOf(row);
    const kind = kindOf(String(row.event_type), detail);
    if (!kind) continue;
    const task = row.tasks as unknown as { title?: string } | null;
    events.push({
      ...blank(),
      id: `audit-${row.id}`,
      kind,
      at: String(row.occurred_at),
      personId: String(row.actor_id),
      personName: names.get(String(row.actor_id)) ?? 'Somebody',
      taskId: String(row.task_id),
      taskTitle: String(task?.title ?? 'Work'),
      body: typeof detail.note === 'string' ? detail.note : null,
      progressAfter: typeof detail.progress_percent === 'number' ? detail.progress_percent : null,
      dueFrom: shortDay(detail.previous_due_at, timeZone),
      dueTo: shortDay(detail.new_due_at, timeZone),
      priorityFrom: typeof detail.previous_urgency === 'string' ? detail.previous_urgency : null,
      priorityTo: typeof detail.new_urgency === 'string' ? detail.new_urgency : null,
      stepName: typeof detail.action === 'string' ? detail.action : null,
    });
  }

  // The audit row records that an update was posted; the update itself holds
  // what the person actually wrote, which is the part worth reading.
  const updateIdOf = new Map<string, string>();
  for (const row of auditRows) {
    if (String(row.event_type) !== 'update_posted') continue;
    const id = detailOf(row).update_id;
    if (typeof id === 'string' && id) updateIdOf.set(`audit-${row.id}`, id);
  }
  if (updateIdOf.size > 0) {
    const { data: bodies } = await supabase
      .from('task_updates')
      .select('id,body')
      .in('id', [...updateIdOf.values()]);
    const bodyOf = new Map((bodies ?? []).map((row) => [String(row.id), row.body ?? null]));
    for (const event of events) {
      const updateId = updateIdOf.get(event.id);
      if (updateId) event.body = bodyOf.get(updateId) ?? event.body;
    }
  }

  for (const row of completed.data ?? []) {
    events.push({
      ...blank(),
      id: `done-${row.id}`,
      kind: 'completed',
      at: String(row.completed_at),
      personId: String(row.completed_owner_id),
      personName: names.get(String(row.completed_owner_id)) ?? 'Somebody',
      taskId: String(row.id),
      taskTitle: String(row.title),
    });
  }
  for (const row of contributed.data ?? []) {
    events.push({
      ...blank(),
      id: `part-${row.checklist_item_id}`,
      kind: 'contribution',
      at: String(row.completed_at),
      personId: String(row.assignee_id),
      personName: names.get(String(row.assignee_id)) ?? 'Somebody',
      taskId: String(row.task_id),
      taskTitle: String(row.title),
      parentTitle: row.parent_title ? String(row.parent_title) : null,
    });
  }

  /*
   * Walk each task's progress figures oldest first so every event knows the
   * progress immediately before it. Where there is no anchor the first card
   * simply has no "from" and says only where the work reached — which is the
   * right failure, because a made-up starting point overstates the move.
   */
  const byTask = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    if (event.progressAfter === null) continue;
    const list = byTask.get(event.taskId);
    if (list) list.push(event);
    else byTask.set(event.taskId, [event]);
  }
  for (const [taskId, list] of byTask) {
    list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    let previous: number | null = anchors.get(taskId) ?? null;
    for (const event of list) {
      event.progressBefore = previous;
      previous = event.progressAfter;
    }
  }

  return { events, team: people, failed: false };
}

-- ============================================================================
-- TAMCO Focus v191 — The owner's overdue step notice is about new lateness
--
-- v190 began telling the owner of work when a step somebody else owes on it is
-- overdue, once per step and due date. Its first scheduled run, on Production
-- the morning after deploy, would have told owners about every such step
-- already late, however long ago: one email each, all at once, about lateness
-- My Day has been showing for weeks.
--
-- The owner's notice now covers a step whose date passed within the last three
-- organisation-local days: the morning after, with room for a missed run. The
-- assignee's notice (v158) is unchanged; assignees have been told since v158,
-- so they have no backlog to send.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_overdue_contributions(p_task_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  told integer;
  owners_told integer;
begin
  with late as (
    select
      item.id,
      item.task_id,
      item.action,
      item.assigned_to,
      parent.title as parent_title,
      coalesce(item.due_at, parent.due_at) as due_at
    from public.task_checklist_items item
    join public.tasks parent on parent.id = item.task_id
    join public.user_profiles assignee
      on assignee.id = item.assigned_to and assignee.status = 'active'
    -- v185 - "Due-today and selection deadlines" in My Alerts.
    left join public.user_alert_preferences pref
      on pref.user_id = item.assigned_to
    where item.assigned_to is not null
      and item.assigned_to <> parent.primary_owner_id
      and item.state <> 'completed'
      and parent.status = 'active'
      and parent.deleted_at is null
      and coalesce(item.due_at, parent.due_at) < now()
      and (coalesce(pref.due_today_and_deadlines, true) or parent.is_mandatory)
      and (p_task_ids is null or item.task_id = any (p_task_ids))
  ),
  inserted as (
    insert into public.notifications (
      recipient_id, kind, channel, requires_action, title, body,
      task_id, entity_type, entity_id, dedupe_key
    )
    select
      late.assigned_to,
      'collaboration_handoff',
      'immediate',
      true,
      'Contribution overdue',
      format('%s · Part of "%s". It was due %s.',
             late.action, late.parent_title, focus.short_org_date(late.due_at)),
      late.task_id,
      'checklist_item',
      late.id,
      format('step_overdue:%s:%s',
             late.id, (late.due_at at time zone focus.org_time_zone())::date)
    from late
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
    returning 1
  )
  select count(*)::integer into told from inserted;

  -- v190 - the owner of the work, for a step with a date of its own.
  -- v191 - only while it is newly late: due within the last three days, which
  -- also covers a scheduled run or two that did not happen. An alert is about
  -- something that has just gone wrong; older lateness is on My Day. Without
  -- this, the first run after v190 would email an owner once for every step
  -- ever left late on their work.
  with late as (
    select
      item.id,
      item.task_id,
      item.action,
      item.due_at,
      parent.title as parent_title,
      parent.primary_owner_id,
      assignee.full_name as assignee_name
    from public.task_checklist_items item
    join public.tasks parent on parent.id = item.task_id
    join public.user_profiles assignee on assignee.id = item.assigned_to
    join public.user_profiles owner
      on owner.id = parent.primary_owner_id and owner.status = 'active'
    left join public.user_alert_preferences pref
      on pref.user_id = parent.primary_owner_id
    where item.assigned_to is not null
      and item.assigned_to <> parent.primary_owner_id
      and item.due_at is not null
      and item.due_at < now()
      and (item.due_at at time zone focus.org_time_zone())::date
          >= (now() at time zone focus.org_time_zone())::date - 3
      and item.state <> 'completed'
      and parent.status = 'active'
      and parent.deleted_at is null
      and (coalesce(pref.due_today_and_deadlines, true) or parent.is_mandatory)
      and (p_task_ids is null or item.task_id = any (p_task_ids))
  ),
  inserted as (
    insert into public.notifications (
      recipient_id, kind, channel, requires_action, title, body,
      task_id, entity_type, entity_id, dedupe_key
    )
    select
      late.primary_owner_id,
      'collaboration_handoff',
      'immediate',
      false,
      'Contribution overdue on your work',
      format('%s · Waiting on %s. Part of "%s". It was due %s.',
             late.action, late.assignee_name, late.parent_title,
             focus.short_org_date(late.due_at)),
      late.task_id,
      'task_step',
      late.id,
      format('step_overdue:%s:%s',
             late.id, (late.due_at at time zone focus.org_time_zone())::date)
    from late
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
    returning 1
  )
  select count(*)::integer into owners_told from inserted;

  return jsonb_build_object('ok', true, 'notified', told, 'owners', owners_told);
end;
$function$;

revoke all on function public.notify_overdue_contributions(uuid[]) from public, anon, authenticated;
grant execute on function public.notify_overdue_contributions(uuid[]) to service_role;

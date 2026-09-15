-- ============================================================================
-- TAMCO Focus v190 — Step notifications
--
-- The Product Owner's table of who is told what about a step (15 September
-- 2026, MASTER_PRODUCT_SPEC.md "V187–V190"):
--
--   assigned            the assignee                  unchanged (v44, v158)
--   reassigned          the old and new assignee      unchanged (v44, v161)
--   due tomorrow        the assignee, bell and email  new: notify_steps_due_tomorrow
--   overdue             the assignee and the owner    the owner is new
--   completed           the owner, quietly            unchanged (v158)
--   reopened            the assignee, straight away   new: reopen_checklist_item
--   due date changed    the assignee                  new, for a change of day
--
-- Nobody is told about their own act. Every notice honours My Alerts as v186
-- set it: the deadline notices answer to "Due-today and selection deadlines"
-- and are not written when it is off; the reopened notice answers to
-- "Collaborative handoff" and stays in the bell. Mandatory work ignores both.
--
-- `due_soon` has been in notification_kind since the first migration and was
-- never written, so the reminder needs no new vocabulary.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Due tomorrow: the reminder, from the daily scheduled job.
--
-- The same steps the overdue notice covers - open, owed by somebody other than
-- the owner, on active work that is not in the Bin - whose date, or their
-- work's date when they have none, falls tomorrow in the organisation's time
-- zone. Once per step and due date: a step given a new date is reminded again.
-- The owner's own steps are on their My Day and are not reminded.
-- ---------------------------------------------------------------------------

create or replace function public.notify_steps_due_tomorrow(p_task_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  zone text := focus.org_time_zone();
  tomorrow date := (now() at time zone focus.org_time_zone())::date + 1;
  told integer;
begin
  with soon as (
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
    left join public.user_alert_preferences pref
      on pref.user_id = item.assigned_to
    where item.assigned_to is not null
      and item.assigned_to <> parent.primary_owner_id
      and item.state <> 'completed'
      and parent.status = 'active'
      and parent.deleted_at is null
      and (coalesce(item.due_at, parent.due_at) at time zone zone)::date = tomorrow
      and (coalesce(pref.due_today_and_deadlines, true) or parent.is_mandatory)
      and (p_task_ids is null or item.task_id = any (p_task_ids))
  ),
  inserted as (
    insert into public.notifications (
      recipient_id, kind, channel, requires_action, title, body,
      task_id, entity_type, entity_id, dedupe_key
    )
    select
      soon.assigned_to,
      'due_soon',
      'immediate',
      false,
      'Contribution due tomorrow',
      format('%s · Part of "%s". It is due tomorrow, %s.',
             soon.action, soon.parent_title, focus.short_org_date(soon.due_at)),
      soon.task_id,
      'checklist_item',
      soon.id,
      format('step_due_tomorrow:%s:%s', soon.id, (soon.due_at at time zone zone)::date)
    from soon
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
    returning 1
  )
  select count(*)::integer into told from inserted;

  return jsonb_build_object('ok', true, 'notified', told);
end;
$$;

comment on function public.notify_steps_due_tomorrow(uuid[]) is
  'v190 - reminds whoever owes a step on somebody else''s work that it is due tomorrow. Once per step and due date. Run by /api/cron.';

revoke all on function public.notify_steps_due_tomorrow(uuid[]) from public, anon, authenticated;
grant execute on function public.notify_steps_due_tomorrow(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Overdue: the owner is told as well.
--
-- v158 told only the assignee, and left the owner to Needs attention. The
-- owner now hears once per step and due date too, keyed like the assignee's
-- notice - the key is unique per recipient. Only for a step with a date of its
-- own: one that is due with its work is late exactly when the work is, and
-- v185's "Work overdue" has told the owner that. `notified` still counts the
-- assignees' notices; `owners` counts these.
-- ---------------------------------------------------------------------------

create or replace function public.notify_overdue_contributions(p_task_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.notify_overdue_contributions(uuid[]) from public, anon, authenticated;
grant execute on function public.notify_overdue_contributions(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- A step's own date changed, or it was completed.
--
-- update_checklist_step writes every field on every save, so the trigger's
-- condition is what changed, not what was written. Told: whoever owes the step
-- - the owner, for one assigned to nobody - when its due day moved, unless
-- they moved it, it was reassigned in the same save (the assignment notice
-- carries the date), or it or its work is closed. v158 kept these edits
-- silent; the Product Owner's table supersedes that.
--
-- A step completed, or given a date that is no longer past, answers the
-- overdue notices about it, the assignee's and the owner's.
-- ---------------------------------------------------------------------------

create or replace function focus.notify_step_due_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
  zone text := focus.org_time_zone();
  actor uuid := focus.current_user_id();
  owes uuid;
  before_due timestamptz;
  after_due timestamptz;
  actor_name text;
begin
  select * into parent from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;

  before_due := coalesce(old.due_at, parent.due_at);
  after_due := coalesce(new.due_at, parent.due_at);

  if new.state = 'completed'
     or (new.due_at is distinct from old.due_at
         and (after_due is null or after_due > now())) then
    update public.notifications
       set read_at = now()
     where entity_id = new.id
       and dedupe_key like 'step_overdue:%'
       and read_at is null;
  end if;

  if new.due_at is not distinct from old.due_at
     or new.assigned_to is distinct from old.assigned_to
     or new.state = 'completed'
     or parent.status in ('completed', 'cancelled')
     or parent.deleted_at is not null
     or (before_due at time zone zone)::date
        is not distinct from (after_due at time zone zone)::date then
    return new;
  end if;

  owes := coalesce(new.assigned_to, parent.primary_owner_id);
  if owes is null
     or owes = actor
     or not exists (
       select 1 from public.user_profiles where id = owes and status = 'active'
     )
     or not focus.alert_is_on(owes, focus.work_alert(parent.id, 'due_today_and_deadlines')) then
    return new;
  end if;

  select full_name into actor_name from public.user_profiles where id = actor;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, actor_id, entity_type, entity_id
  ) values (
    owes,
    'due_date_changed',
    'immediate',
    false,
    case when owes = parent.primary_owner_id then 'Step due date changed'
         else 'Contribution due date changed' end,
    format('%s · Part of "%s". %s moved it from %s to %s.',
           new.action, parent.title, coalesce(actor_name, 'A colleague'),
           coalesce(focus.short_org_date(before_due), 'no date'),
           coalesce(focus.short_org_date(after_due), 'no date')),
    new.task_id,
    actor,
    case when owes = parent.primary_owner_id then 'task_step' else 'checklist_item' end,
    new.id
  );

  return new;
end;
$$;

revoke all on function focus.notify_step_due_changed() from public, anon, authenticated;

create trigger checklist_items_notify_due_changed
  after update of due_at, state on public.task_checklist_items
  for each row
  when (old.due_at is distinct from new.due_at or old.state is distinct from new.state)
  execute function focus.notify_step_due_changed();

-- ---------------------------------------------------------------------------
-- Reopened: whoever owes the step is told. v186 body, plus the notice.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reopen_checklist_item(p_item_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  item record;
  total_items integer;
  done_items integer;
  new_progress integer;
  -- v190
  parent_title text;
  parent_owner uuid;
  owes uuid;
  actor_name text;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to reopen a step.');
  end if;

  select * into item from public.task_checklist_items where id = p_item_id for update;
  if not found then return focus.error('not_found', 'This step no longer exists.'); end if;

  if not focus.can_complete_checklist_item(item.id) then
    return focus.error('not_authorised', focus.checklist_completion_refusal(item.id, 'reopen'));
  end if;

  if item.state <> 'completed' then
    return focus.error('invalid_state', 'Only a completed step can be reopened.');
  end if;

  update public.task_checklist_items
     set state = 'ready', completed_by = null, completed_at = null, completion_note = null
   where id = p_item_id;

  select count(*), count(*) filter (where state = 'completed')
    into total_items, done_items
    from public.task_checklist_items where task_id = item.task_id;

  new_progress := case when total_items = 0 then 0 else (done_items * 100) / total_items end;

  update public.tasks
     set progress_percent = new_progress,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = item.task_id;

  perform focus.write_audit(
    p_event_type := 'checklist_item_reopened',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_detail := jsonb_build_object(
      'checklist_item_id', p_item_id, 'action', item.action, 'reason', p_reason)
  );

  -- v190 - whoever owes the step is told it is open again, straight away,
  -- unless they reopened it themselves. A step assigned to nobody is the
  -- owner's own (v159). "Collaborative handoff" off keeps it in the bell only.
  select title, primary_owner_id into parent_title, parent_owner
    from public.tasks where id = item.task_id;
  owes := coalesce(item.assigned_to, parent_owner);
  if owes is not null
     and owes <> actor
     and exists (select 1 from public.user_profiles where id = owes and status = 'active') then
    select full_name into actor_name from public.user_profiles where id = actor;
    insert into public.notifications (
      recipient_id, kind, channel, requires_action, title, body,
      task_id, actor_id, entity_type, entity_id, quiet
    ) values (
      owes,
      'collaboration_handoff',
      'immediate',
      true,
      case when owes = parent_owner then 'Step reopened' else 'Contribution reopened' end,
      format('%s · Part of "%s". Reopened by %s.%s',
             item.action, parent_title, coalesce(actor_name, 'a colleague'),
             case when clean_reason is null then ''
                  else format(' Reason: "%s".', rtrim(left(clean_reason, 300), '.')) end),
      item.task_id,
      actor,
      case when owes = parent_owner then 'task_step' else 'checklist_item' end,
      item.id,
      not focus.alert_is_on(owes, focus.work_alert(item.task_id, 'collaboration_handoff'))
    );
  end if;

  return jsonb_build_object('ok', true, 'code', 'reopened', 'progress_percent', new_progress);
end;
$function$;


-- ---------------------------------------------------------------------------
-- The work's date moved: the steps due with it moved too. v186 body, plus the
-- notice to whoever owes one and the clearing of their overdue notices.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.change_task_due_date(p_task_id uuid, p_expected_version integer, p_new_due_at timestamp with time zone, p_due_is_date_only boolean, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  task record;
  replayed jsonb;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  event_id uuid;
  result jsonb;
  blocking_step record;
  -- v185
  zone text := focus.org_time_zone();
  postponed boolean;
  late_days integer;
  actor_name text;
  owner_manager uuid;
  from_text text;
  to_text text;
  reason_text text;
  -- v190
  moved_day boolean;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change the due date.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select id, title, primary_owner_id, assigned_by, due_at, due_is_date_only, status, version,
         is_mandatory
    into task
    from public.tasks
   where id = p_task_id
   for update;

  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;
  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'Only an authorised task editor can change the due date.');
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed or cancelled work cannot receive a new due date.');
  end if;
  if task.version <> p_expected_version then
    return focus.error('version_conflict', 'This work changed while it was open. Refresh and try again.');
  end if;
  if p_new_due_at is null then
    return focus.error('validation_failed', 'Choose a new due date.');
  end if;

  -- v154 - the work cannot fall due before one of its own open steps. A step
  -- that inherits the task's date moves with it and is never in the way; only
  -- a step given its own date can be, and the person is told which one. This
  -- is also the Monthly Plan's drag, which is exactly where it would be missed.
  select ci.action, ci.due_at
    into blocking_step
    from public.task_checklist_items ci
   where ci.task_id = p_task_id
     and ci.state <> 'completed'
     and ci.due_at is not null
     and (ci.due_at at time zone focus.org_time_zone())::date
         > (p_new_due_at at time zone focus.org_time_zone())::date
   order by ci.due_at desc
   limit 1;
  if found then
    return focus.error('validation_failed', format(
      'The step "%s" is due %s, after that date. Move the step first, or choose a later deadline.',
      blocking_step.action,
      to_char(blocking_step.due_at at time zone focus.org_time_zone(), 'FMDD Mon YYYY')));
  end if;
  if clean_reason is not null and length(clean_reason) > 1000 then
    return focus.error('validation_failed', 'Keep the reason to 1,000 characters or fewer.');
  end if;

  if task.due_at is not distinct from p_new_due_at
     and task.due_is_date_only is not distinct from p_due_is_date_only then
    return jsonb_build_object(
      'ok', true,
      'code', 'due_date_unchanged',
      'due_at', task.due_at,
      'due_is_date_only', task.due_is_date_only,
      'version', task.version,
      'changed', false
    );
  end if;

  update public.tasks
     set due_at = p_new_due_at,
         due_is_date_only = p_due_is_date_only,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  event_id := focus.write_audit(
    p_event_type := 'task_due_date_changed',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'previous_due_at', task.due_at,
      'previous_due_is_date_only', task.due_is_date_only,
      'new_due_at', p_new_due_at,
      'new_due_is_date_only', p_due_is_date_only,
      'reason', clean_reason
    )
  );

  -- v185 - who hears about it.
  postponed := task.due_at is not null and p_new_due_at > task.due_at;
  late_days := case
    when task.due_at is not null and task.due_at < now()
      then (now() at time zone zone)::date - (task.due_at at time zone zone)::date
  end;
  select full_name into actor_name from public.user_profiles where id = actor;
  actor_name := coalesce(actor_name, 'A colleague');
  select reporting_manager_id into owner_manager
    from public.user_profiles
   where id = task.primary_owner_id;
  from_text := coalesce(focus.short_org_date(task.due_at), 'no date');
  to_text := focus.short_org_date(p_new_due_at);
  reason_text := case when clean_reason is null then '' else format(' Reason: "%s".', clean_reason) end;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, actor_id, entity_type, entity_id
  )
  select
    recipient.id,
    'due_date_changed',
    'immediate',
    false,
    case
      when recipient.is_owner then format('Due date changed: %s', left(task.title, 120))
      else format('Due date moved: %s', left(task.title, 120))
    end,
    case
      when recipient.is_owner then
        format('%s changed it from %s to %s.%s', actor_name, from_text, to_text, reason_text)
      else
        format(
          '%s moved it from %s to %s.%s%s',
          actor_name,
          from_text,
          to_text,
          case
            when late_days is null then ''
            when late_days <= 0 then ' It was already overdue.'
            when late_days = 1 then ' It was 1 day overdue.'
            else format(' It was %s days overdue.', late_days)
          end,
          reason_text
        )
    end,
    p_task_id,
    actor,
    'task',
    p_task_id
  from (
    select candidate.id, bool_or(candidate.is_owner) as is_owner
      from (
        values
          (task.primary_owner_id, true),
          (owner_manager, false),
          (task.assigned_by, false)
      ) as candidate (id, is_owner)
     where candidate.id is not null
       and candidate.id <> actor
     group by candidate.id
  ) recipient
  join public.user_profiles person
    on person.id = recipient.id
   and person.status = 'active'
  left join public.user_alert_preferences pref
    on pref.user_id = recipient.id
  where (coalesce(pref.due_today_and_deadlines, true) or task.is_mandatory)
    and (recipient.is_owner or postponed);

  -- v190 - a step with no date of its own is due with its work, so its date
  -- moved as well. Whoever owes one is told once, however many they owe here,
  -- when the day changed. Not the person who moved it, and not somebody told
  -- above already: the owner, or - pushed later - the manager and the
  -- assigner. Same alert as above: switched off, nothing is written.
  moved_day := (task.due_at at time zone zone)::date
               is distinct from (p_new_due_at at time zone zone)::date;
  if moved_day then
    insert into public.notifications (
      recipient_id, kind, channel, requires_action, title, body,
      task_id, actor_id, entity_type, entity_id
    )
    select
      owed.assigned_to,
      'due_date_changed',
      'immediate',
      false,
      'Contribution due date changed',
      format('%s · Part of "%s". %s moved the work from %s to %s, and your %s with it.',
             owed.actions, task.title, actor_name, from_text, to_text,
             case when owed.steps = 1 then 'step' else 'steps' end),
      p_task_id,
      actor,
      'checklist_item',
      owed.first_step
    from (
      select
        item.assigned_to,
        string_agg(item.action, '; ' order by item.position) as actions,
        count(*) as steps,
        (array_agg(item.id order by item.position))[1] as first_step
      from public.task_checklist_items item
      where item.task_id = p_task_id
        and item.due_at is null
        and item.state <> 'completed'
        and item.assigned_to is not null
        and item.assigned_to <> actor
        and item.assigned_to <> task.primary_owner_id
        and not (postponed and item.assigned_to in (
          coalesce(owner_manager, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(task.assigned_by, '00000000-0000-0000-0000-000000000000'::uuid)))
      group by item.assigned_to
    ) owed
    join public.user_profiles person
      on person.id = owed.assigned_to
     and person.status = 'active'
    left join public.user_alert_preferences pref
      on pref.user_id = owed.assigned_to
    where coalesce(pref.due_today_and_deadlines, true) or task.is_mandatory;
  end if;

  -- A date back in the future answers the owner's overdue notice.
  if p_new_due_at > now() then
    update public.notifications
       set read_at = now()
     where kind = 'work_overdue'
       and task_id = p_task_id
       and read_at is null;

    -- v190 - and the overdue notices about steps that are due with it.
    update public.notifications notice
       set read_at = now()
      from public.task_checklist_items item
     where item.task_id = p_task_id
       and item.due_at is null
       and notice.entity_id = item.id
       and notice.dedupe_key like 'step_overdue:%'
       and notice.read_at is null;
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', 'task_due_date_changed',
    'due_at', p_new_due_at,
    'due_is_date_only', p_due_is_date_only,
    'version', task.version + 1,
    'audit_event_id', event_id,
    'changed', true
  );
  return focus.remember_operation(actor, p_idempotency_key, 'change_task_due_date', result);
end;
$function$;

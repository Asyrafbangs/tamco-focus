-- ============================================================================
-- TAMCO Focus v185 — Overdue, told
--
-- Until now the only person ever told that something was late was whoever owed
-- a step on somebody else's work. The owner of late work heard nothing, by
-- email or in the bell, and a due date could be pushed back — late work
-- included — without anybody who was waiting on it hearing either.
--
-- 1. The daily job tells the owner, once per piece of work per due date, the
--    morning after it passed. Several at once are one notice, so an owner with
--    a backlog of late work is sent one email rather than one each.
-- 2. Pushing a due date later tells the owner's manager and whoever assigned
--    the work. Somebody moving another person's date, either way, tells that
--    person.
-- 3. Both honour "Due-today and selection deadlines" in My Alerts, which no
--    notification had read since it was added; the step overdue notice now
--    honours it too.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Which late work has been told about, per due date. A new due date is a new
-- commitment, and becomes due to be told about again if that one passes too.
-- Written when the owner has switched the alert off as well, so switching it
-- back on does not send the whole backlog at once.
-- ---------------------------------------------------------------------------

create table public.task_overdue_notices (
  task_id uuid not null references public.tasks (id) on delete cascade,
  due_at timestamptz not null,
  recipient_id uuid not null references public.user_profiles (id),
  notification_id uuid references public.notifications (id) on delete set null,
  notified_at timestamptz not null default now(),
  primary key (task_id, due_at)
);

comment on table public.task_overdue_notices is
  'v185 - late work the owner has been told about, one row per task and due date. Written only by notify_overdue_work.';

alter table public.task_overdue_notices enable row level security;
revoke all on public.task_overdue_notices from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The owner's notice, from the daily scheduled job.
--
-- Work that is carried or waiting — Active, Paused or Available — and not a
-- routine occurrence: an occurrence has its own escalation, and a person with
-- a daily check would otherwise be told about each missed day separately.
-- `p_task_ids` narrows the run to some work. The schedule passes nothing.
-- ---------------------------------------------------------------------------

create or replace function public.notify_overdue_work(p_task_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  batch record;
  notice_id uuid;
  people integer := 0;
  work_count integer := 0;
begin
  -- One run at a time: two firings together would each find the same work
  -- untold.
  perform pg_advisory_xact_lock(hashtextextended('notify_overdue_work', 0));

  for batch in
    select
      t.primary_owner_id as owner_id,
      coalesce(pref.due_today_and_deadlines, true) as wants,
      count(*)::integer as n,
      array_agg(t.id order by t.due_at, t.id) as task_ids,
      array_agg(t.due_at order by t.due_at, t.id) as due_ats,
      array_agg(t.title order by t.due_at, t.id) as titles
    from public.tasks t
    join public.user_profiles owner
      on owner.id = t.primary_owner_id
     and owner.status = 'active'
    left join public.user_alert_preferences pref
      on pref.user_id = t.primary_owner_id
    where t.status in ('active', 'paused', 'backlog')
      and t.deleted_at is null
      and t.work_class <> 'routine_occurrence'
      and t.due_at is not null
      and t.due_at < now()
      and (p_task_ids is null or t.id = any (p_task_ids))
      and not exists (
        select 1
          from public.task_overdue_notices told
         where told.task_id = t.id
           and told.due_at = t.due_at
      )
    group by t.primary_owner_id, pref.due_today_and_deadlines
  loop
    notice_id := null;

    if batch.wants then
      insert into public.notifications (
        recipient_id, kind, channel, requires_action, title, body,
        task_id, entity_type, entity_id
      ) values (
        batch.owner_id,
        'work_overdue',
        'immediate',
        true,
        case
          when batch.n = 1 then 'Work overdue'
          else format('%s pieces of work overdue', batch.n)
        end,
        case
          when batch.n = 1 then
            format('%s · It was due %s.', batch.titles[1], focus.short_org_date(batch.due_ats[1]))
          else
            (
              select string_agg(
                       format('"%s" was due %s', batch.titles[i], focus.short_org_date(batch.due_ats[i])),
                       '; '
                       order by i
                     )
                from generate_subscripts(batch.titles, 1) as i
               where i <= 3
            )
            || case when batch.n > 3 then format('; and %s more.', batch.n - 3) else '.' end
        end,
        -- One piece of work opens it. Several carry no record, so the notice
        -- opens My Day, whose Needs attention lists them.
        case when batch.n = 1 then batch.task_ids[1] end,
        case when batch.n = 1 then 'task' end,
        case when batch.n = 1 then batch.task_ids[1] end
      )
      returning id into notice_id;
      people := people + 1;
    end if;

    insert into public.task_overdue_notices (task_id, due_at, recipient_id, notification_id)
    select batch.task_ids[i], batch.due_ats[i], batch.owner_id, notice_id
      from generate_subscripts(batch.task_ids, 1) as i
    on conflict (task_id, due_at) do nothing;

    work_count := work_count + batch.n;
  end loop;

  return jsonb_build_object('ok', true, 'notified', people, 'work', work_count);
end;
$$;

revoke all on function public.notify_overdue_work(uuid[]) from public, anon, authenticated;
grant execute on function public.notify_overdue_work(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Closing the work, or sending it to the Bin, clears the owner's notice.
-- ---------------------------------------------------------------------------

create or replace function focus.clear_overdue_notices()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('completed', 'cancelled') or new.deleted_at is not null then
    update public.notifications
       set read_at = now()
     where kind = 'work_overdue'
       and task_id = new.id
       and read_at is null;
  end if;
  return new;
end;
$$;

revoke all on function focus.clear_overdue_notices() from public, anon, authenticated;

create trigger tasks_clear_overdue_notices
  after update of status, deleted_at on public.tasks
  for each row
  when (old.status is distinct from new.status or old.deleted_at is distinct from new.deleted_at)
  execute function focus.clear_overdue_notices();

-- ---------------------------------------------------------------------------
-- The step notice honours the assignee's alert setting.
-- Reproduced from 20260911004000_v158_step_notifications.sql.
-- ---------------------------------------------------------------------------

create or replace function public.notify_overdue_contributions(p_task_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  told integer;
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
      and coalesce(pref.due_today_and_deadlines, true)
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

  return jsonb_build_object('ok', true, 'notified', told);
end;
$$;

revoke all on function public.notify_overdue_contributions(uuid[]) from public, anon, authenticated;
grant execute on function public.notify_overdue_contributions(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Moving a due date says so to the people it affects.
-- Reproduced from 20260911001000_v154_step_due_within_task.sql.
--
-- Pushed later: the owner's manager and whoever assigned the work, with how
-- late it already was and the reason. Moved by somebody other than the owner,
-- in either direction: the owner. Never the person who moved it. Brought
-- earlier by the owner themselves: nobody, because nothing slipped.
-- ---------------------------------------------------------------------------

create or replace function public.change_task_due_date(
  p_task_id uuid,
  p_expected_version integer,
  p_new_due_at timestamp with time zone,
  p_due_is_date_only boolean,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change the due date.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select id, title, primary_owner_id, assigned_by, due_at, due_is_date_only, status, version
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
  where coalesce(pref.due_today_and_deadlines, true)
    and (recipient.is_owner or postponed);

  -- A date back in the future answers the owner's overdue notice.
  if p_new_due_at > now() then
    update public.notifications
       set read_at = now()
     where kind = 'work_overdue'
       and task_id = p_task_id
       and read_at is null;
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
$$;

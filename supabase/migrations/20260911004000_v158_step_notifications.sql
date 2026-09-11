-- ============================================================================
-- v158 - Trackable Steps, stage 5: who is told what about a step, and when
--
-- The Product Owner's rule (11 September 2026): assigned, the assignee is
-- told; overdue, the assignee is told and the owner sees it in Needs
-- attention; completed, the owner is told quietly; small edits are silent.
--
-- Before this, only two of those held:
--
--   assigned    told since v44, but without the date - and since v154 a step
--               has one, which is most of what an assignee needs to know.
--   overdue     the owner has seen it in Needs attention since v155; the
--               person who owes the step was told nothing.
--   completed   nobody was told. The owner found out by opening the work.
--   edits       silent already: nothing fires on a step's text or date. Kept
--               that way, and now tested.
--
-- "Quietly" needs a meaning the schema can hold. Since v120 every
-- notification queues an email whatever its channel, so a completion notice
-- would have sent one per finished step. `notifications.quiet` marks a notice
-- that belongs in the bell only, and the email outbox skips it.
--
-- The overdue notice is scheduled, and scheduled work may run twice.
-- `notifications.dedupe_key`, unique per recipient, makes a second run add
-- nothing. It keys on the day the step was due, so a step given a new date
-- and missed again is told again.
-- ============================================================================

alter table public.notifications
  add column quiet boolean not null default false,
  add column dedupe_key text;

comment on column public.notifications.quiet is
  'v158 - in the bell only. The email outbox (v120) is not queued for a quiet notification.';
comment on column public.notifications.dedupe_key is
  'v158 - at most one notification per recipient and key; set by scheduled notices that may run more than once.';

create unique index notifications_recipient_dedupe_key
  on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null;

-- "10 Sep": the organisation's day, written the way every row writes a date.
create or replace function focus.short_org_date(p_at timestamptz)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select to_char(p_at at time zone focus.org_time_zone(), 'FMDD Mon');
$$;

-- " Due 10 Sep." for a step: its own date, or its work's when it has none
-- (v154). Empty when neither has one, so no message ever says "Due ."
create or replace function focus.step_due_sentence(
  p_step_due timestamptz,
  p_task_due timestamptz
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
           when coalesce(p_step_due, p_task_due) is null then ''
           else format(' Due %s.', focus.short_org_date(coalesce(p_step_due, p_task_due)))
         end;
$$;

grant execute on function focus.short_org_date(timestamptz) to authenticated, service_role;
grant execute on function focus.step_due_sentence(timestamptz, timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Assigned: the assignee is told, now with the date.
-- Reproduced from 20260808006000_v44_handoff_loops.sql; only the message changes.
-- ---------------------------------------------------------------------------

create or replace function focus.notify_contribution_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
  assigner_name text;
  ready boolean;
begin
  -- Only a genuine change of person, and never the owner's own step: a step
  -- assigned to the person who owns the result is not a contribution.
  if new.assigned_to is null or new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found or parent.primary_owner_id = new.assigned_to then
    return new;
  end if;

  select full_name into assigner_name
    from public.user_profiles where id = focus.current_user_id();

  ready := parent.status = 'active' and new.state = 'ready';

  -- One notification, not two (section 4). Whether it is startable yet belongs
  -- in this message, not in a second one arriving in the same second.
  perform focus.notify(
    new.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'New contribution assigned',
    format('%s · Part of "%s".%s Assigned by %s. %s',
           new.action, parent.title,
           focus.step_due_sentence(new.due_at, parent.due_at),
           coalesce(assigner_name, 'a colleague'),
           case when ready then 'Ready to start.'
                else 'Waiting for the owner to start.' end),
    new.task_id,
    null,
    focus.current_user_id());

  update public.notifications
     set entity_type = 'checklist_item', entity_id = new.id
   where recipient_id = new.assigned_to
     and task_id = new.task_id
     and entity_id is null
     and read_at is null;

  -- The previous assignee learns it left their list, but is not asked to act.
  if old.assigned_to is not null
     and old.assigned_to <> parent.primary_owner_id
     and old.assigned_to <> new.assigned_to then
    perform focus.notify(
      old.assigned_to,
      'collaboration_handoff',
      'digest',
      false,
      'Contribution reassigned',
      format('"%s" has been reassigned. It is no longer on your Shared list.', new.action),
      new.task_id,
      null,
      focus.current_user_id());
  end if;

  perform focus.write_audit(
    p_event_type := 'checklist_item_assigned',
    p_actor_id := focus.current_user_id(),
    p_task_id := new.task_id,
    p_detail := jsonb_build_object(
      'checklist_item_id', new.id,
      'action', new.action,
      'previous_assignee', old.assigned_to,
      'new_assignee', new.assigned_to));

  return new;
end;
$$;

create or replace function focus.notify_contribution_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
  assigner_name text;
begin
  if new.assigned_to is null then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found or parent.primary_owner_id = new.assigned_to
     or new.assigned_to = focus.current_user_id() then
    return new;
  end if;

  select full_name into assigner_name
    from public.user_profiles where id = focus.current_user_id();

  perform focus.notify(
    new.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'New contribution assigned',
    format('%s · Part of "%s".%s Assigned by %s. %s',
           new.action, parent.title,
           focus.step_due_sentence(new.due_at, parent.due_at),
           coalesce(assigner_name, 'a colleague'),
           case when parent.status = 'active' and new.state = 'ready'
                then 'Ready to start.'
                else 'Waiting for the owner to start.' end),
    new.task_id,
    null,
    focus.current_user_id());

  update public.notifications
     set entity_type = 'checklist_item', entity_id = new.id
   where recipient_id = new.assigned_to
     and task_id = new.task_id
     and entity_id is null
     and read_at is null;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- The email outbox skips a quiet notice.
-- Reproduced from 20260830001000_v120_notification_email_delivery.sql.
-- ---------------------------------------------------------------------------

create or replace function focus.queue_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- v158 - a quiet notice belongs in the bell and nowhere else.
  if new.quiet then
    return new;
  end if;

  insert into public.notification_email_deliveries (
    notification_id,
    recipient_id,
    recipient_email
  )
  select
    new.id,
    profile.id,
    profile.email
  from public.user_profiles profile
  where profile.id = new.recipient_id
    and profile.status = 'active'
  on conflict (notification_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Completed: the owner is told, quietly.
--
-- Not when the owner finished it themselves, and not for a step that was
-- theirs to begin with. It opens their own work at the step ('task_step'),
-- not the Shared list, which is the assignee's view of the same record.
-- ---------------------------------------------------------------------------

create or replace function focus.notify_contribution_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
  completer_name text;
begin
  if new.state <> 'completed'
     or old.state = 'completed'
     or new.assigned_to is null then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found
     or parent.primary_owner_id = new.assigned_to
     or parent.primary_owner_id = focus.current_user_id() then
    return new;
  end if;

  if not exists (
    select 1 from public.user_profiles
     where id = parent.primary_owner_id and status = 'active'
  ) then
    return new;
  end if;

  select full_name into completer_name
    from public.user_profiles
   where id = coalesce(new.completed_by, focus.current_user_id());

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, actor_id, entity_type, entity_id, quiet
  ) values (
    parent.primary_owner_id,
    'collaboration_handoff',
    'digest',
    false,
    'Contribution completed',
    format('%s · Part of "%s". Completed by %s.',
           new.action, parent.title, coalesce(completer_name, 'a colleague')),
    new.task_id,
    focus.current_user_id(),
    'task_step',
    new.id,
    true
  );

  return new;
end;
$$;

drop trigger if exists checklist_items_notify_completed on public.task_checklist_items;
create trigger checklist_items_notify_completed
  after update of state on public.task_checklist_items
  for each row execute function focus.notify_contribution_completed();

-- ---------------------------------------------------------------------------
-- Overdue: the person who owes the step is told, once per day it was due.
--
-- Run by the daily scheduled job. Only work that is under way: a step on work
-- its owner has not started, or has paused, cannot be done yet, and telling
-- somebody it is late would blame them for waiting. The owner is not sent a
-- notice; they see it in Needs attention (v155), which is where it asks them
-- to act.
--
-- `p_task_ids` narrows the run to some work. The schedule passes nothing.
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
    where item.assigned_to is not null
      and item.assigned_to <> parent.primary_owner_id
      and item.state <> 'completed'
      and parent.status = 'active'
      and parent.deleted_at is null
      and coalesce(item.due_at, parent.due_at) < now()
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

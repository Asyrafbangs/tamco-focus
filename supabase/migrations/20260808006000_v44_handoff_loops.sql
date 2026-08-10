-- ---------------------------------------------------------------------------
-- v44 — closing two unfinished handoff loops.
--
-- Both loops failed the same way: the system knew something had been handed
-- over, and never told the person it was handed to.
--
--   1. CHECKLIST COLLABORATION. Assigning a contribution updated the checklist
--      item and the Shared projection, then stopped. The contributor found out
--      by going and looking, which is not a handoff — it is a hiding place.
--
--   2. BARRIER. A barrier recorded what was blocked and what support was
--      needed, but not WHO had to act. "Somebody should decide this" reaches
--      nobody's list, so a manager had to discover it by touring the team.
--
-- Both notifications are written by triggers, in the same transaction as the
-- change that caused them. That is deliberate (v44 section 10): a committed
-- assignment with no notification record is not a successful handoff, and
-- putting the write here makes it impossible to commit one without the other.
-- Delivery can be retried from the row; the row itself cannot be lost.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Barrier: who must act, and what kind of action it is.
-- ---------------------------------------------------------------------------

create type public.barrier_action_type as enum (
  'decision',
  'approval',
  'support',
  'escalation',
  'other'
);

alter table public.barriers
  add column if not exists action_required_from uuid references public.user_profiles (id),
  add column if not exists action_type public.barrier_action_type not null default 'support',
  add column if not exists version integer not null default 1;

comment on column public.barriers.action_required_from is
  'The one person who must act. A barrier addressed to nobody is a complaint; '
  'this is what makes it a request.';

comment on column public.barriers.action_type is
  'Metadata that shapes the manager''s primary control — Provide decision, '
  'Approve, Respond. It is NOT five separate workflows.';

-- Existing barriers predate the column, so they are addressed to the owner's
-- reporting manager: the person who would have been asked anyway.
update public.barriers b
   set action_required_from = coalesce(
         (select p.reporting_manager_id
            from public.tasks t
            join public.user_profiles p on p.id = t.primary_owner_id
           where t.id = b.task_id),
         b.raised_by)
 where action_required_from is null;

create index if not exists barriers_action_required_idx
  on public.barriers (action_required_from, status)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- Barrier responses.
--
-- A reply is not a resolution (section 16). "I will confirm by 3pm" moves
-- nothing: the shutdown is still unapproved and the work is still blocked.
-- Keeping responses in their own table means answering can never accidentally
-- close the barrier.
-- ---------------------------------------------------------------------------

create table if not exists public.barrier_responses (
  id uuid primary key default extensions.gen_random_uuid(),
  barrier_id uuid not null references public.barriers (id) on delete cascade,
  author_id uuid not null references public.user_profiles (id),
  message text not null,
  created_at timestamptz not null default now(),

  constraint barrier_responses_message_not_blank check (length(btrim(message)) > 0)
);

create index if not exists barrier_responses_barrier_idx
  on public.barrier_responses (barrier_id, created_at);

alter table public.barrier_responses enable row level security;

-- Whoever may see the barrier's task may read and add to the conversation
-- about it. The barrier's own policies already decide who that is.
create policy barrier_responses_select on public.barrier_responses
  for select to authenticated
  using (
    exists (
      select 1 from public.barriers b
       where b.id = barrier_id and focus.can_view_task(b.task_id)
    )
  );

create policy barrier_responses_insert on public.barrier_responses
  for insert to authenticated
  with check (
    author_id = focus.current_user_id()
    and exists (
      select 1 from public.barriers b
       where b.id = barrier_id and focus.can_contribute_to_task(b.task_id)
    )
  );

grant select, insert on public.barrier_responses to authenticated;

-- ---------------------------------------------------------------------------
-- Loop 1 — the contributor is told.
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
    format('%s · Part of "%s". Assigned by %s. %s',
           new.action, parent.title, coalesce(assigner_name, 'a colleague'),
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

drop trigger if exists checklist_items_notify_assignment on public.task_checklist_items;
create trigger checklist_items_notify_assignment
  after update of assigned_to on public.task_checklist_items
  for each row execute function focus.notify_contribution_assigned();

-- The same message when a step is created already pointing at somebody else.
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
    format('%s · Part of "%s". Assigned by %s. %s',
           new.action, parent.title, coalesce(assigner_name, 'a colleague'),
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

drop trigger if exists checklist_items_notify_created on public.task_checklist_items;
create trigger checklist_items_notify_created
  after insert on public.task_checklist_items
  for each row execute function focus.notify_contribution_created();

-- The waiting → ready transition, and only that transition (section 6). Firing
-- on every recalculation would notify people each time anything was queried.
create or replace function focus.notify_contribution_ready()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
begin
  if new.assigned_to is null
     or old.state <> 'waiting'
     or new.state <> 'ready' then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found or parent.primary_owner_id = new.assigned_to then
    return new;
  end if;

  perform focus.notify(
    new.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'Your contribution is ready',
    format('%s · Part of "%s". Nothing is blocking it now.', new.action, parent.title),
    new.task_id,
    null,
    null);

  update public.notifications
     set entity_type = 'checklist_item', entity_id = new.id
   where recipient_id = new.assigned_to
     and task_id = new.task_id
     and entity_id is null
     and read_at is null;

  return new;
end;
$$;

drop trigger if exists checklist_items_notify_ready on public.task_checklist_items;
create trigger checklist_items_notify_ready
  after update of state on public.task_checklist_items
  for each row execute function focus.notify_contribution_ready();

-- ---------------------------------------------------------------------------
-- Loop 2 — the person who must act is told.
-- ---------------------------------------------------------------------------

create or replace function focus.notify_barrier_action_required()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
  raiser_name text;
  action_label text;
begin
  if new.action_required_from is null
     or new.action_required_from = new.raised_by then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  select full_name into raiser_name from public.user_profiles where id = new.raised_by;

  action_label := case new.action_type
    when 'decision' then 'Decision needed'
    when 'approval' then 'Approval required'
    when 'escalation' then 'Escalation requested'
    when 'support' then 'Support requested'
    else 'Response requested'
  end;

  perform focus.notify(
    new.action_required_from,
    'barrier_raised',
    'immediate',
    true,
    action_label,
    format('%s needs you on "%s": %s',
           coalesce(raiser_name, 'A colleague'),
           coalesce(parent.title, 'a task'),
           new.support_needed),
    new.task_id,
    new.id,
    new.raised_by);

  update public.notifications
     set entity_type = 'barrier', entity_id = new.id
   where recipient_id = new.action_required_from
     and barrier_id = new.id;

  return new;
end;
$$;

drop trigger if exists barriers_notify_action_required on public.barriers;
create trigger barriers_notify_action_required
  after insert on public.barriers
  for each row execute function focus.notify_barrier_action_required();

-- Resolution hands control back to the owner rather than resuming for them
-- (section 26). Only they know whether the work can actually restart.
create or replace function focus.notify_barrier_resolved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
begin
  if old.status <> 'open' or new.status <> 'resolved' then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found or parent.primary_owner_id = focus.current_user_id() then
    return new;
  end if;

  perform focus.notify(
    parent.primary_owner_id,
    'barrier_raised',
    'immediate',
    true,
    'Barrier resolved — review your work',
    coalesce(nullif(btrim(new.resolution_note), ''), 'The blocker has been removed.'),
    new.task_id,
    new.id,
    focus.current_user_id());

  update public.notifications
     set entity_type = 'barrier', entity_id = new.id
   where recipient_id = parent.primary_owner_id
     and barrier_id = new.id;

  return new;
end;
$$;

drop trigger if exists barriers_notify_resolved on public.barriers;
create trigger barriers_notify_resolved
  after update of status on public.barriers
  for each row execute function focus.notify_barrier_resolved();

-- ---------------------------------------------------------------------------
-- A barrier always reaches somebody.
--
-- The Raise Barrier form does not yet ask "who needs to act?", and until it
-- does an unaddressed barrier would notify nobody — the exact failure this
-- migration exists to fix. Defaulting to the owner's reporting manager is who
-- would have been asked anyway, so the loop closes now and the form can make
-- the choice explicit later without changing this behaviour for the default
-- case (v44 section 14).
-- ---------------------------------------------------------------------------

create or replace function focus.default_barrier_recipient()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.action_required_from is null then
    select p.reporting_manager_id into new.action_required_from
      from public.tasks t
      join public.user_profiles p on p.id = t.primary_owner_id
     where t.id = new.task_id;
  end if;

  -- An impact of "work cannot continue" is a decision to make, not support to
  -- offer, so the manager's primary control should say so.
  if new.impact = 'cannot_continue' and new.action_type = 'support' then
    new.action_type := 'decision';
  end if;

  return new;
end;
$$;

drop trigger if exists barriers_default_recipient on public.barriers;
create trigger barriers_default_recipient
  before insert on public.barriers
  for each row execute function focus.default_barrier_recipient();

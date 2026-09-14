-- ============================================================================
-- TAMCO Focus v184 — Ask for an update
--
-- Somebody who can see another person's work — their manager, a person given
-- visibility, whoever assigned it, the owner of work with a step handed to
-- somebody else — can ask for an update on the work or on one of its steps.
-- The person it is with is emailed and sees the request on the work. A written
-- update from them answers it, and so does completing the step; either way the
-- person who asked is emailed.
--
-- Who is asked is never chosen: the work's owner, or the step's assignee (its
-- owner when nobody is assigned). One open request per person per work or
-- step. Asking again inside 24 hours is refused, so a request cannot become a
-- stream of email; after that the same request is repeated.
-- ============================================================================

create table public.task_update_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- Null asks about the work; a step asks about that step.
  checklist_item_id uuid references public.task_checklist_items (id) on delete cascade,
  requested_by uuid not null references public.user_profiles (id),
  -- Who was asked, at the time. Reassigning the work or the step does not move
  -- the request; the person who asked can ask whoever has it now.
  requested_of uuid not null references public.user_profiles (id),
  message text check (message is null or char_length(message) between 1 and 1000),
  requested_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  times_asked integer not null default 1 check (times_asked >= 1),
  resolved_at timestamptz,
  resolution text check (resolution in ('update_posted', 'step_completed', 'work_closed')),
  update_id uuid references public.task_updates (id) on delete set null,
  constraint task_update_requests_not_self check (requested_by <> requested_of),
  constraint task_update_requests_resolution_complete
    check ((resolved_at is null) = (resolution is null))
);

comment on table public.task_update_requests is
  'v184 - a request for an update on somebody else''s work or step. Written only by request_task_update and the triggers that settle it.';

create unique index task_update_requests_one_open
  on public.task_update_requests (
    task_id,
    coalesce(checklist_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    requested_by
  )
  where resolved_at is null;

create index task_update_requests_open_by_recipient
  on public.task_update_requests (requested_of)
  where resolved_at is null;

create index task_update_requests_step
  on public.task_update_requests (checklist_item_id)
  where checklist_item_id is not null;

alter table public.task_update_requests enable row level security;

create policy task_update_requests_select
  on public.task_update_requests
  for select
  to authenticated
  using (focus.can_view_task(task_id));

revoke insert, update, delete, truncate on public.task_update_requests from anon, authenticated;
grant select on public.task_update_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Who can answer a request now: the step's assignee, or the work's owner.
-- ---------------------------------------------------------------------------

create or replace function focus.update_request_answerer(p_task_id uuid, p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select ci.assigned_to
       from public.task_checklist_items ci
      where p_item_id is not null
        and ci.id = p_item_id
        and ci.task_id = t.id),
    t.primary_owner_id
  )
    from public.tasks t
   where t.id = p_task_id;
$$;

revoke all on function focus.update_request_answerer(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What this person may ask about on this work, and when they may ask again.
--
-- One row for the work and one for each unfinished step, each naming who
-- would be asked, leaving out anything that would ask the viewer themselves
-- or somebody without an active account. `again_at` is set while their last
-- ask of that same person is under 24 hours old.
--
-- The rules live here and nowhere else: the drawer reads this to decide what
-- to offer, and request_task_update reads it before writing anything. Whether
-- the viewer may see the work at all is the caller's check.
-- ---------------------------------------------------------------------------

create or replace function focus.update_request_targets(p_task_id uuid, p_viewer uuid)
returns table (checklist_item_id uuid, requested_of uuid, again_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with work as (
    select t.id, t.primary_owner_id
      from public.tasks t
     where t.id = p_task_id
       and t.deleted_at is null
       and t.status not in ('completed', 'cancelled')
       and t.work_class <> 'quick_action'
  ),
  targets as (
    select null::uuid as checklist_item_id, w.primary_owner_id as requested_of
      from work w
    union all
    select ci.id, coalesce(ci.assigned_to, w.primary_owner_id)
      from work w
      join public.task_checklist_items ci on ci.task_id = w.id
     where ci.state <> 'completed'
  )
  select
    target.checklist_item_id,
    target.requested_of,
    (
      select r.last_asked_at + interval '24 hours'
        from public.task_update_requests r
       where r.task_id = p_task_id
         and r.checklist_item_id is not distinct from target.checklist_item_id
         and r.requested_by = p_viewer
         and r.resolved_at is null
         and r.requested_of = target.requested_of
         and r.last_asked_at + interval '24 hours' > now()
    ) as again_at
    from targets target
    join public.user_profiles person
      on person.id = target.requested_of
     and person.status = 'active'
   where target.requested_of <> p_viewer;
$$;

revoke all on function focus.update_request_targets(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The drawer's read: requests still waiting, and what the viewer may ask.
-- ---------------------------------------------------------------------------

create or replace function public.get_task_update_requests(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or not focus.can_view_task(p_task_id) then
      jsonb_build_object('open', '[]'::jsonb, 'targets', '[]'::jsonb)
    else jsonb_build_object(
      'open', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'checklist_item_id', r.checklist_item_id,
            'requested_by', r.requested_by,
            'requested_of', r.requested_of,
            'answerer', focus.update_request_answerer(r.task_id, r.checklist_item_id),
            'message', r.message,
            'last_asked_at', r.last_asked_at,
            'times_asked', r.times_asked
          )
          order by r.requested_at
        )
          from public.task_update_requests r
         where r.task_id = p_task_id
           and r.resolved_at is null
      ), '[]'::jsonb),
      'targets', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'checklist_item_id', target.checklist_item_id,
            'requested_of', target.requested_of,
            'again_at', target.again_at
          )
        )
          from focus.update_request_targets(p_task_id, auth.uid()) target
      ), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.get_task_update_requests(uuid) from public, anon;
grant execute on function public.get_task_update_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Asking.
-- ---------------------------------------------------------------------------

create or replace function public.request_task_update(
  p_task_id uuid,
  p_checklist_item_id uuid default null,
  p_message text default null,
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
  step record;
  -- Read from `step` only when there is one: PL/pgSQL evaluates every field an
  -- expression names, including a CASE branch that is never taken.
  step_action text;
  recipient record;
  target_id uuid;
  existing record;
  requester_name text;
  note text := nullif(btrim(coalesce(p_message, '')), '');
  again_at timestamptz;
  request_id uuid;
  asked integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to ask for an update.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task
    from public.tasks
   where id = p_task_id
     and deleted_at is null;
  -- Not found and not visible read the same, so the answer says nothing about
  -- work this person may not see.
  if not found or not focus.can_view_task(p_task_id) then
    return focus.error('not_found', 'This work no longer exists, or you can no longer see it.');
  end if;

  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'This work is finished, so there is no update to ask for.');
  end if;

  if task.work_class = 'quick_action' then
    return focus.error('invalid_state', 'A Quick Action has no updates to ask for.');
  end if;

  if note is not null and char_length(note) > 1000 then
    return focus.error('validation_failed', 'Keep the note to 1,000 characters.');
  end if;

  if p_checklist_item_id is not null then
    select * into step
      from public.task_checklist_items
     where id = p_checklist_item_id
       and task_id = p_task_id;
    if not found then
      return focus.error('not_found', 'This step is no longer on the work.');
    end if;
    if step.state = 'completed' then
      return focus.error('invalid_state', 'This step is already complete.');
    end if;
    target_id := coalesce(step.assigned_to, task.primary_owner_id);
    step_action := step.action;
  else
    target_id := task.primary_owner_id;
  end if;

  if target_id = actor then
    return focus.error(
      'own_work',
      case when p_checklist_item_id is null
        then 'This is your own work. Add an update instead.'
        else 'This step is yours. Add an update instead.'
      end
    );
  end if;

  select id, full_name, status into recipient
    from public.user_profiles
   where id = target_id;
  if not found or recipient.status <> 'active' then
    return focus.error(
      'owner_inactive',
      'The person this is with no longer has an active account, so they cannot be asked.'
    );
  end if;

  -- Two asks from the same person about the same thing, pressed at once with
  -- different keys, are taken one after the other; the second is then refused
  -- by the 24-hour rule rather than by the unique index.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'request_task_update:' || p_task_id::text || ':'
        || coalesce(p_checklist_item_id::text, 'work') || ':' || actor::text,
      0
    )
  );

  -- The final word on whether this may be asked: the same rows the drawer
  -- reads to decide what to offer.
  select target.again_at into again_at
    from focus.update_request_targets(p_task_id, actor) target
   where target.checklist_item_id is not distinct from p_checklist_item_id;
  if not found then
    return focus.error('invalid_state', 'There is nobody to ask about this.');
  end if;
  if again_at is not null then
    return focus.error(
      'already_requested',
      format('You already asked %s for an update. You can ask again 24 hours after that.', recipient.full_name),
      jsonb_build_object('again_at', again_at)
    );
  end if;

  select * into existing
    from public.task_update_requests
   where task_id = p_task_id
     and checklist_item_id is not distinct from p_checklist_item_id
     and requested_by = actor
     and resolved_at is null
   for update;

  if found then
    update public.task_update_requests
       set requested_of = target_id,
           message = note,
           last_asked_at = now(),
           times_asked = times_asked + 1
     where id = existing.id
    returning id, times_asked into request_id, asked;

    -- This ask replaces the last one, so only one waits in the bell.
    update public.notifications
       set read_at = now()
     where kind = 'update_requested'
       and task_id = p_task_id
       and actor_id = actor
       and entity_id = coalesce(p_checklist_item_id, p_task_id)
       and read_at is null;
  else
    insert into public.task_update_requests (
      task_id, checklist_item_id, requested_by, requested_of, message
    ) values (
      p_task_id, p_checklist_item_id, actor, target_id, note
    )
    returning id, times_asked into request_id, asked;
  end if;

  select full_name into requester_name
    from public.user_profiles
   where id = actor;
  requester_name := coalesce(requester_name, 'A colleague');

  -- Immediate and not quiet, so focus.queue_notification_email puts it in the
  -- email outbox in the same transaction.
  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, actor_id, entity_type, entity_id
  ) values (
    target_id,
    'update_requested',
    'immediate',
    true,
    case when p_checklist_item_id is null
      then format('Update requested: %s', left(task.title, 120))
      else format('Update requested: %s', left(step_action, 120))
    end,
    case
      when p_checklist_item_id is null and note is null then
        format('%s asked you for an update on this work.', requester_name)
      when p_checklist_item_id is null then
        format('%s asked you for an update: "%s"', requester_name, note)
      when note is null then
        format('%s asked you for an update on this step of %s.', requester_name, task.title)
      else
        format('%s asked you for an update on this step of %s: "%s"', requester_name, task.title, note)
    end,
    p_task_id,
    actor,
    case when p_checklist_item_id is null then 'task_update_request' else 'step_update_request' end,
    coalesce(p_checklist_item_id, p_task_id)
  );

  perform focus.write_audit(
    p_event_type := 'update_requested',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_subject_user_id := target_id,
    p_task_version := task.version,
    p_detail := jsonb_build_object(
      'request_id', request_id,
      'checklist_item_id', p_checklist_item_id,
      'action', step_action,
      'message', note,
      'times_asked', asked
    )
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'update_requested',
    'request_id', request_id,
    'recipient_name', recipient.full_name,
    'times_asked', asked
  );
  return focus.remember_operation(actor, p_idempotency_key, 'request_task_update', result);
end;
$$;

revoke all on function public.request_task_update(uuid, uuid, text, text) from public, anon;
grant execute on function public.request_task_update(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Answering with an update: a written update from the person who can answer.
--
-- Evidence-only posts are not answers: attaching a photo to a step is
-- bookkeeping, not a reply. Each person who asked is told once, with what was
-- written, however many of their requests the update answered, and the
-- recipient's request notices are cleared because they are done.
-- ---------------------------------------------------------------------------

create or replace function focus.answer_update_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  work record;
  answered record;
  author_name text;
  excerpt text;
begin
  if new.is_evidence_only or length(btrim(coalesce(new.body, ''))) = 0 then
    return new;
  end if;

  select id, title into work
    from public.tasks
   where id = new.task_id;
  if not found then
    return new;
  end if;

  select full_name into author_name
    from public.user_profiles
   where id = new.author_id;

  excerpt := btrim(new.body);
  if char_length(excerpt) > 300 then
    excerpt := left(excerpt, 297) || '...';
  end if;

  for answered in
    with settled as (
      update public.task_update_requests r
         set resolved_at = now(),
             resolution = 'update_posted',
             update_id = new.id
       where r.task_id = new.task_id
         and r.resolved_at is null
         and r.requested_by <> new.author_id
         and (
           r.requested_of = new.author_id
           or focus.update_request_answerer(r.task_id, r.checklist_item_id) = new.author_id
         )
      returning r.requested_by, coalesce(r.checklist_item_id, r.task_id) as subject_id
    )
    select requested_by, array_agg(subject_id) as subject_ids
      from settled
     group by requested_by
  loop
    update public.notifications
       set read_at = now()
     where kind = 'update_requested'
       and task_id = new.task_id
       and actor_id = answered.requested_by
       and entity_id = any(answered.subject_ids)
       and read_at is null;

    if exists (
      select 1 from public.user_profiles
       where id = answered.requested_by and status = 'active'
    ) then
      insert into public.notifications (
        recipient_id, kind, channel, requires_action, title, body,
        task_id, actor_id, entity_type, entity_id
      ) values (
        answered.requested_by,
        'update_request_answered',
        'immediate',
        false,
        format('Update received: %s', left(work.title, 120)),
        format('%s replied: "%s"', coalesce(author_name, 'A colleague'), excerpt),
        new.task_id,
        new.author_id,
        'task_update',
        new.id
      );
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function focus.answer_update_requests() from public, anon, authenticated;

create trigger task_updates_answer_update_requests
  after insert on public.task_updates
  for each row execute function focus.answer_update_requests();

-- ---------------------------------------------------------------------------
-- Steps: completing one answers what was asked about it; reassigning one
-- clears the old assignee's notice; removing one clears everybody's.
-- ---------------------------------------------------------------------------

create or replace function focus.settle_step_update_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  work record;
  answered record;
  completer uuid;
  completer_name text;
begin
  if tg_op = 'DELETE' then
    update public.notifications
       set read_at = now()
     where kind = 'update_requested'
       and task_id = old.task_id
       and entity_id = old.id
       and read_at is null;
    return old;
  end if;

  if new.state = 'completed' and old.state <> 'completed' then
    select id, title into work
      from public.tasks
     where id = new.task_id;
    completer := coalesce(new.completed_by, focus.current_user_id());
    select full_name into completer_name
      from public.user_profiles
     where id = completer;

    for answered in
      with settled as (
        update public.task_update_requests r
           set resolved_at = now(),
               resolution = 'step_completed'
         where r.checklist_item_id = new.id
           and r.resolved_at is null
        returning r.requested_by
      )
      select distinct requested_by from settled
    loop
      update public.notifications
         set read_at = now()
       where kind = 'update_requested'
         and task_id = new.task_id
         and actor_id = answered.requested_by
         and entity_id = new.id
         and read_at is null;

      if answered.requested_by is distinct from completer
         and exists (
           select 1 from public.user_profiles
            where id = answered.requested_by and status = 'active'
         ) then
        insert into public.notifications (
          recipient_id, kind, channel, requires_action, title, body,
          task_id, actor_id, entity_type, entity_id
        ) values (
          answered.requested_by,
          'update_request_answered',
          'immediate',
          false,
          format('Step completed: %s', left(new.action, 120)),
          case
            when nullif(btrim(coalesce(new.completion_note, '')), '') is null then
              format('%s completed this step of %s.', coalesce(completer_name, 'A colleague'), work.title)
            else
              format(
                '%s completed this step of %s: "%s"',
                coalesce(completer_name, 'A colleague'),
                work.title,
                left(btrim(new.completion_note), 300)
              )
          end,
          new.task_id,
          completer,
          'task_step',
          new.id
        );
      end if;
    end loop;
  elsif new.assigned_to is distinct from old.assigned_to then
    update public.notifications
       set read_at = now()
     where kind = 'update_requested'
       and task_id = new.task_id
       and entity_id = new.id
       and recipient_id is distinct from new.assigned_to
       and read_at is null;
  end if;

  return new;
end;
$$;

revoke all on function focus.settle_step_update_requests() from public, anon, authenticated;

create trigger task_checklist_items_settle_update_requests
  after update of state, assigned_to on public.task_checklist_items
  for each row
  when (old.state is distinct from new.state or old.assigned_to is distinct from new.assigned_to)
  execute function focus.settle_step_update_requests();

create trigger task_checklist_items_clear_update_requests
  after delete on public.task_checklist_items
  for each row execute function focus.settle_step_update_requests();

-- ---------------------------------------------------------------------------
-- The work: closing it or sending it to the Bin settles everything still
-- open; a new owner means the old owner is no longer the one being asked.
-- ---------------------------------------------------------------------------

create or replace function focus.settle_update_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.status in ('completed', 'cancelled') and old.status not in ('completed', 'cancelled'))
     or (new.deleted_at is not null and old.deleted_at is null) then
    update public.task_update_requests
       set resolved_at = now(),
           resolution = 'work_closed'
     where task_id = new.id
       and resolved_at is null;

    update public.notifications
       set read_at = now()
     where kind = 'update_requested'
       and task_id = new.id
       and read_at is null;
  elsif new.primary_owner_id is distinct from old.primary_owner_id then
    -- The work, and any step nobody else holds, were the old owner's to answer.
    update public.notifications
       set read_at = now()
     where kind = 'update_requested'
       and task_id = new.id
       and recipient_id = old.primary_owner_id
       and read_at is null
       and (
         entity_id = new.id
         or entity_id in (
           select ci.id
             from public.task_checklist_items ci
            where ci.task_id = new.id
              and ci.assigned_to is null
         )
       );
  end if;

  return new;
end;
$$;

revoke all on function focus.settle_update_requests() from public, anon, authenticated;

create trigger tasks_settle_update_requests
  after update of status, deleted_at, primary_owner_id on public.tasks
  for each row
  when (
    old.status is distinct from new.status
    or old.deleted_at is distinct from new.deleted_at
    or old.primary_owner_id is distinct from new.primary_owner_id
  )
  execute function focus.settle_update_requests();

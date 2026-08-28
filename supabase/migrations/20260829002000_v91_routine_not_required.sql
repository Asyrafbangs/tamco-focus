-- ---------------------------------------------------------------------------
-- v91 - a routine occurrence has two honest outcomes.
--
-- "I did it", and "it genuinely did not apply this time". Everything else the
-- system already knows: who owns it, when it was due, which steps were ticked,
-- by whom, at what time, whether evidence exists, whether it was late. Asking
-- an employee to restate any of that is asking them to operate the governance
-- system rather than do the work.
--
-- WHY NOT A NEW STATUS. `task_status` is read by every view, constraint and
-- screen in the product; adding a sixth value to it to describe something that
-- only happens to routine occurrences would spread routine vocabulary across
-- all of Focus. The exception is its own record instead, and the occurrence
-- keeps the states it already had: it stays `backlog` while a manager decides,
-- and becomes `cancelled` only once the exception is accepted - at which point
-- it correctly drops out of Due and Overdue.
--
-- WHY A MANAGER AT ALL. "It was not needed" is the one claim about routine
-- work that nobody else can check afterwards: there is no evidence, because
-- nothing happened. Acceptance is one click and needs no comment. Returning it
-- requires one, because the employee has to know why it came back.
--
-- The exception to the exception: somebody with no reporting manager has
-- nobody to ask. Their own statement stands, recorded as self-accepted, rather
-- than leaving the occurrence waiting for a decision that can never come.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Evidence is decided once, on the schedule.
-- ---------------------------------------------------------------------------

alter table public.routine_templates
  add column if not exists evidence_instruction text;

comment on column public.routine_templates.evidence_instruction is
  'One short sentence telling the person what evidence to attach, shown on every occurrence. The rule belongs to the schedule, not to the person doing it.';

-- ---------------------------------------------------------------------------
-- The record.
-- ---------------------------------------------------------------------------

create table if not exists public.routine_occurrence_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,

  reason_code public.routine_exception_reason not null,
  reason_note text,

  raised_by uuid not null references public.user_profiles (id),
  raised_at timestamptz not null default now(),

  state public.routine_exception_state not null default 'pending',
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  decision_note text,

  -- "Other" says nothing on its own, so it has to say something.
  constraint routine_exception_other_needs_a_note check (
    reason_code <> 'other' or length(btrim(coalesce(reason_note, ''))) > 0),
  -- Returning it is the only decision the employee has to read, so it carries
  -- the words. Accepting is one click and needs none.
  constraint routine_exception_return_needs_a_note check (
    state <> 'returned' or length(btrim(coalesce(decision_note, ''))) > 0),
  constraint routine_exception_decision_consistent check (
    (state = 'pending' and decided_by is null and decided_at is null)
    or (state <> 'pending' and decided_by is not null and decided_at is not null))
);

-- One open question per occurrence. A returned one may be raised again, which
-- is why this is partial rather than a plain unique constraint.
create unique index if not exists routine_exception_one_open
  on public.routine_occurrence_exceptions (task_id)
  where state = 'pending';

create index if not exists routine_exception_task_idx
  on public.routine_occurrence_exceptions (task_id, raised_at desc);

alter table public.routine_occurrence_exceptions enable row level security;

-- Readable by anybody who can already see the occurrence: the record explains a
-- task, so it inherits that task's audience rather than inventing one.
create policy routine_exception_select on public.routine_occurrence_exceptions
  for select to authenticated
  using (focus.can_view_task(task_id));

-- Written only through the procedures below, which carry the authority checks
-- and the audit trail.
revoke all on public.routine_occurrence_exceptions from anon;

-- ---------------------------------------------------------------------------
-- "Not required this time."
-- ---------------------------------------------------------------------------

create or replace function public.mark_routine_not_required(
  p_task_id uuid,
  p_reason_code public.routine_exception_reason,
  p_reason_note text default null,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  task public.tasks;
  manager uuid;
  clean_note text := nullif(btrim(coalesce(p_reason_note, '')), '');
  exception_id uuid;
  auto_accepted boolean := false;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found or task.deleted_at is not null then
    return focus.error('not_found', 'This occurrence no longer exists.');
  end if;

  if task.work_class <> 'routine_occurrence' then
    return focus.error(
      'validation_failed',
      'Only a routine occurrence can be marked as not required.');
  end if;

  if not focus.can_contribute_to_task(p_task_id) then
    return focus.error(
      'not_authorised',
      'Only the person this occurrence belongs to can say it was not required.');
  end if;

  if task.status in ('completed', 'cancelled') then
    return focus.error(
      'invalid_state',
      'This occurrence is already closed.');
  end if;

  if exists (
    select 1 from public.routine_occurrence_exceptions e
     where e.task_id = p_task_id and e.state = 'pending'
  ) then
    return focus.error(
      'invalid_state',
      'This occurrence is already waiting for a decision.');
  end if;

  if p_reason_code = 'other' and clean_note is null then
    return focus.error('validation_failed', 'Say briefly why it was not required.');
  end if;
  if clean_note is not null and length(clean_note) > 500 then
    return focus.error('validation_failed', 'Keep the reason to 500 characters or fewer.');
  end if;

  select reporting_manager_id into manager
    from public.user_profiles where id = task.primary_owner_id;
  -- Nobody to ask. The statement stands on its own rather than waiting for a
  -- decision that can never arrive.
  auto_accepted := manager is null;

  insert into public.routine_occurrence_exceptions (
    task_id, reason_code, reason_note, raised_by,
    state, decided_by, decided_at)
  values (
    p_task_id, p_reason_code, clean_note, actor,
    case when auto_accepted then 'accepted'::public.routine_exception_state
         else 'pending'::public.routine_exception_state end,
    case when auto_accepted then actor else null end,
    case when auto_accepted then now() else null end)
  returning id into exception_id;

  if auto_accepted then
    update public.tasks
       set status = 'cancelled',
           cancelled_at = now(),
           over_focus_target = false,
           last_meaningful_update_at = now(),
           version = version + 1
     where id = p_task_id;
    perform focus.deactivate_task_projections(p_task_id);
  else
    perform focus.notify(
      p_recipient := manager,
      p_kind := 'manager_decision_required',
      p_channel := 'immediate',
      p_requires_action := true,
      p_title := format('%s marked as not required', task.title),
      p_body := 'Accept it, or return it if the work still needs doing.',
      p_task_id := p_task_id,
      p_actor_id := actor);
  end if;

  perform focus.write_audit(
    p_event_type := 'routine_not_required_raised',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_detail := jsonb_build_object(
      'exception_id', exception_id,
      'reason_code', p_reason_code,
      'reason_note', clean_note,
      'auto_accepted', auto_accepted));

  result := jsonb_build_object(
    'ok', true,
    'code', case when auto_accepted then 'not_required_accepted' else 'not_required_pending' end,
    'exception_id', exception_id,
    'auto_accepted', auto_accepted);
  return focus.remember_operation(actor, p_idempotency_key, 'mark_routine_not_required', result);
end;
$$;

revoke all on function public.mark_routine_not_required(
  uuid, public.routine_exception_reason, text, text) from public, anon;
grant execute on function public.mark_routine_not_required(
  uuid, public.routine_exception_reason, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The manager's one click, or their one sentence.
-- ---------------------------------------------------------------------------

create or replace function public.decide_routine_exception(
  p_exception_id uuid,
  p_accept boolean,
  p_note text default null,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  record_row public.routine_occurrence_exceptions;
  task public.tasks;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into record_row
    from public.routine_occurrence_exceptions where id = p_exception_id for update;
  if not found then
    return focus.error('not_found', 'That request no longer exists.');
  end if;
  if record_row.state <> 'pending' then
    return jsonb_build_object('ok', true, 'code', 'already_decided');
  end if;

  select * into task from public.tasks where id = record_row.task_id for update;
  if not found or task.deleted_at is not null then
    return focus.error('not_found', 'This occurrence no longer exists.');
  end if;

  -- The owner's manager, or an administrator. Never the person who raised it:
  -- accepting your own statement that no work was needed is not a review.
  if actor = record_row.raised_by then
    return focus.error(
      'not_authorised',
      'Somebody else has to accept this. You raised it.');
  end if;
  if not (focus.is_admin() or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))) then
    return focus.error(
      'not_authorised',
      'Only this person''s manager can decide whether the work was needed.');
  end if;

  if not p_accept and clean_note is null then
    return focus.error(
      'validation_failed',
      'Say why it is coming back. The person has to know what still needs doing.');
  end if;
  if clean_note is not null and length(clean_note) > 500 then
    return focus.error('validation_failed', 'Keep the note to 500 characters or fewer.');
  end if;

  update public.routine_occurrence_exceptions
     set state = case when p_accept then 'accepted'::public.routine_exception_state
                      else 'returned'::public.routine_exception_state end,
         decided_by = actor,
         decided_at = now(),
         decision_note = clean_note
   where id = p_exception_id;

  if p_accept then
    update public.tasks
       set status = 'cancelled',
           cancelled_at = now(),
           over_focus_target = false,
           last_meaningful_update_at = now(),
           version = version + 1
     where id = record_row.task_id;
    perform focus.deactivate_task_projections(record_row.task_id);
  else
    -- Nothing to undo on the task: it never left `backlog`, so it simply
    -- reappears in Due or Overdue where it always was.
    perform focus.notify(
      p_recipient := record_row.raised_by,
      p_kind := 'work_cannot_continue',
      p_channel := 'immediate',
      p_requires_action := true,
      p_title := format('%s returned - it still needs to be completed', task.title),
      p_body := clean_note,
      p_task_id := record_row.task_id,
      p_actor_id := actor);
  end if;

  perform focus.write_audit(
    p_event_type := case when p_accept then 'routine_not_required_accepted'
                         else 'routine_not_required_returned' end,
    p_actor_id := actor,
    p_task_id := record_row.task_id,
    p_detail := jsonb_build_object(
      'exception_id', p_exception_id,
      'reason_code', record_row.reason_code,
      'decision_note', clean_note));

  result := jsonb_build_object(
    'ok', true,
    'code', case when p_accept then 'exception_accepted' else 'exception_returned' end);
  return focus.remember_operation(actor, p_idempotency_key, 'decide_routine_exception', result);
end;
$$;

revoke all on function public.decide_routine_exception(uuid, boolean, text, text) from public, anon;
grant execute on function public.decide_routine_exception(uuid, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What the screens read.
-- ---------------------------------------------------------------------------

create or replace view public.routine_occurrence_outcomes
with (security_invoker = true)
as
select
  t.id as task_id,
  t.title,
  t.primary_owner_id,
  t.routine_template_id,
  t.occurrence_date,
  t.status,
  t.completed_at,
  t.cancelled_at,
  e.id as exception_id,
  e.reason_code,
  e.reason_note,
  e.state as exception_state,
  e.raised_by,
  e.raised_at,
  e.decided_by,
  e.decided_at,
  e.decision_note,
  coalesce(decider.full_name, '') as decided_by_name,
  coalesce(raiser.full_name, '') as raised_by_name,
  -- One word for what happened, so no screen has to work it out twice.
  case
    when t.status = 'completed' then 'done'
    when e.state = 'accepted' then 'not_required'
    when e.state = 'pending' then 'awaiting_decision'
    else 'open'
  end as outcome
from public.tasks t
left join lateral (
  select * from public.routine_occurrence_exceptions x
   where x.task_id = t.id
   order by x.raised_at desc
   limit 1
) e on true
left join public.user_profiles decider on decider.id = e.decided_by
left join public.user_profiles raiser on raiser.id = e.raised_by
where t.work_class = 'routine_occurrence'
  and t.deleted_at is null;

comment on view public.routine_occurrence_outcomes is
  'Every routine occurrence with its latest not-required record, and one word for the outcome: done, not_required, awaiting_decision or open.';

-- ---------------------------------------------------------------------------
-- v76b — emptying something out of the Bin for good.
--
-- The Bin only ever filled up. Deleting moved work into it and there was no way
-- to finish the job, so a mistake made once stayed on screen for ever — one
-- account had twenty-one rows of the same few titles, none of which will ever
-- be restored.
--
-- "Permanently" cannot mean a row DELETE here, and it is worth being plain
-- about why rather than appearing to offer one. `focus.reject_audit_mutation`
-- makes `audit_events` append-only, so deleting a task raises instead of
-- cascading: the record of what happened is not the author's to withdraw, and
-- that rule is deliberate. What somebody actually wants is for the thing to be
-- gone from the application and for the database to say it was deleted. That is
-- what this does — the row is marked purged, every view already excludes it,
-- and the audit trail gains an entry naming who ended it and when.
--
-- The title is kept, because it is what makes that audit entry mean anything a
-- year later, and it was only ever visible to people who could see the work.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists purged_at timestamptz,
  add column if not exists purged_by uuid references public.user_profiles (id);

alter table public.routine_templates
  add column if not exists purged_at timestamptz,
  add column if not exists purged_by uuid references public.user_profiles (id);

comment on column public.tasks.purged_at is
  'Set when the creator empties this out of the Bin. The row and its audit history are retained; every application view excludes it.';

-- The Bin stops listing what has been emptied out of it.
create or replace view public.binned_tasks
with (security_invoker = true) as
  select
    t.id,
    t.title,
    t.status,
    t.work_class,
    t.focus_bucket,
    t.due_at,
    t.due_is_date_only,
    t.version,
    t.primary_owner_id,
    coalesce(owner.full_name, owner_dir.full_name) as owner_name,
    t.deleted_at,
    t.deleted_by,
    coalesce(remover.full_name, remover_dir.full_name) as deleted_by_name
  from public.tasks t
    left join public.user_profiles owner on owner.id = t.primary_owner_id
    left join public.person_display owner_dir on owner_dir.id = t.primary_owner_id
    left join public.user_profiles remover on remover.id = t.deleted_by
    left join public.person_display remover_dir on remover_dir.id = t.deleted_by
  where t.deleted_at is not null
    and t.purged_at is null;

-- ---------------------------------------------------------------------------
-- Emptying one task out of the Bin.
-- ---------------------------------------------------------------------------

create or replace function public.purge_task(
  p_task_id uuid,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  actor uuid := auth.uid();
  task public.tasks%rowtype;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to empty the Bin.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id;
  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;

  if task.purged_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_purged', 'task_id', p_task_id);
  end if;

  -- Only from the Bin. Emptying is the second half of deleting, never a
  -- shortcut past it: live work has to be deleted first, and that step is the
  -- one that can be undone.
  if task.deleted_at is null then
    return focus.error(
      'invalid_state',
      'Only work that is already in the Bin can be permanently deleted.');
  end if;

  -- The same authority as deleting: the person who created it, or an
  -- administrator. Ownership can move; authorship cannot.
  if not focus.can_delete_task(p_task_id) then
    return focus.error(
      'not_authorised',
      'Only the person who created this work can permanently delete it.');
  end if;

  update public.tasks
     set purged_at = now(), purged_by = actor, updated_at = now()
   where id = p_task_id;

  perform focus.write_audit(
    p_event_type := 'task_purged',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_detail := jsonb_build_object('title', task.title, 'deleted_at', task.deleted_at));

  result := jsonb_build_object('ok', true, 'code', 'task_purged', 'task_id', p_task_id);
  return focus.remember_operation(actor, p_idempotency_key, 'purge_task', result);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The same, for a routine schedule.
-- ---------------------------------------------------------------------------

create or replace function public.purge_routine_template(
  p_template_id uuid,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  actor uuid := auth.uid();
  template public.routine_templates%rowtype;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to empty the Bin.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into template from public.routine_templates where id = p_template_id;
  if not found then
    return focus.error('not_found', 'That routine no longer exists.');
  end if;

  if template.purged_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_purged',
      'routine_template_id', p_template_id);
  end if;

  if template.deleted_at is null then
    return focus.error(
      'invalid_state',
      'Only a routine that is already in the Bin can be permanently deleted.');
  end if;

  if not (focus.is_admin() or template.created_by = actor) then
    return focus.error(
      'not_authorised',
      'Only the person who set this routine up can permanently delete it.');
  end if;

  update public.routine_templates
     set purged_at = now(), purged_by = actor, updated_at = now()
   where id = p_template_id;

  perform focus.write_audit(
    p_event_type := 'routine_template_purged',
    p_actor_id := actor,
    p_subject_user_id := template.default_owner_id,
    p_detail := jsonb_build_object('routine_template_id', p_template_id,
      'title', template.title, 'deleted_at', template.deleted_at));

  result := jsonb_build_object('ok', true, 'code', 'routine_purged',
    'routine_template_id', p_template_id);
  return focus.remember_operation(actor, p_idempotency_key, 'purge_routine_template', result);
end;
$fn$;

revoke all on function public.purge_task(uuid, text) from public, anon;
revoke all on function public.purge_routine_template(uuid, text) from public, anon;
grant execute on function public.purge_task(uuid, text) to authenticated;
grant execute on function public.purge_routine_template(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The routine list learns about purging.
--
-- Reproduced verbatim from v62 apart from the two new columns, which are
-- appended at the end. `create or replace view` keeps the existing column
-- order and refuses to rename one, so new columns can only be added last.
-- ---------------------------------------------------------------------------

create or replace view public.routine_template_overview
with (security_invoker = true) as
select t.id,
       t.title,
       t.description,
       t.default_owner_id,
       coalesce(owner.full_name, owner_dir.full_name) as owner_name,
       t.frequency,
       t.interval_count,
       t.weekday,
       t.weekdays,
       t.monthly_mode,
       t.day_of_month,
       t.nth_weekday,
       t.nth_weekday_dow,
       t.month_of_year,
       t.due_time,
       t.start_date,
       t.ends_mode,
       t.ends_after_count,
       t.ends_on_date,
       t.evidence_required,
       t.requires_completion_review,
       t.is_active,
       t.generated_through,
       t.deleted_at,
       t.deleted_by,
       t.created_by,
       t.created_at,
       (select count(*) from public.tasks o
         where o.routine_template_id = t.id and o.deleted_at is null) as occurrence_count,
       (select min(o.occurrence_date) from public.tasks o
         where o.routine_template_id = t.id and o.deleted_at is null
           and o.occurrence_date >= current_date) as next_occurrence_date,
       /*
        * What the schedule says, whether or not a task exists for it yet.
        *
        * The list only knew about generated occurrences, and generation runs a
        * fortnight ahead — so a routine due in three weeks read "nothing
        * scheduled yet", which is indistinguishable from a routine that is
        * broken. That is exactly what a monthly routine set up mid-month looked
        * like, and it was the reason a working schedule was reported as doing
        * nothing.
        */
       focus.next_occurrence_date(t.*, greatest(current_date - 1, t.start_date - 1))
         as scheduled_next_date,
       -- Appended, not inserted: `create or replace view` refuses to rename an
       -- existing column, so a new one can only go on the end.
       t.purged_at,
       t.purged_by
  from public.routine_templates t
  left join public.user_profiles owner on owner.id = t.default_owner_id
  left join public.person_display owner_dir on owner_dir.id = t.default_owner_id;

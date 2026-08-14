-- ---------------------------------------------------------------------------
-- v62d — setting up, changing and removing a routine.
--
-- The create procedure used to compute a fake `generated_through` anchor
-- backwards through the monthly rule, because the rule advanced a period
-- before it looked and there was nowhere to record when the series actually
-- began. `start_date` is a real column now and `focus.next_occurrence_date`
-- counts from it, so the anchor is simply the day before the start and the
-- arithmetic disappears.
--
-- The update procedure never accepted a start date at all, so editing a
-- routine silently discarded its anchor. It now takes the whole pattern, and
-- clears future unstarted occurrences so a change to the schedule is a change
-- to the schedule rather than a change that applies from some indefinite point.
-- ---------------------------------------------------------------------------

create or replace function focus.validate_routine_shape(
  p_frequency public.recurrence_frequency,
  p_interval_count smallint,
  p_weekdays smallint[],
  p_monthly_mode text,
  p_day_of_month smallint,
  p_nth_weekday smallint,
  p_nth_weekday_dow smallint,
  p_month_of_year smallint,
  p_ends_mode text,
  p_ends_after_count integer,
  p_ends_on_date date,
  p_start_date date)
returns text
language sql
immutable
as $$
  select case
    when p_interval_count is null or p_interval_count < 1 or p_interval_count > 99
      then 'Repeat every must be between 1 and 99.'
    when p_frequency = 'weekly'
         and (p_weekdays is null or array_length(p_weekdays, 1) is null)
      then 'Choose at least one day of the week.'
    when p_frequency = 'weekly'
         and exists (select 1 from unnest(p_weekdays) d where d < 1 or d > 7)
      then 'A weekday must be between Monday and Sunday.'
    when p_frequency in ('monthly', 'yearly') and coalesce(p_monthly_mode, 'day_of_month') = 'day_of_month'
         and (p_day_of_month is null or p_day_of_month < 1 or p_day_of_month > 31)
      then 'Choose which day of the month this repeats on.'
    when p_frequency in ('monthly', 'yearly') and p_monthly_mode = 'nth_weekday'
         and (p_nth_weekday is null or p_nth_weekday_dow is null
              or p_nth_weekday_dow < 1 or p_nth_weekday_dow > 7)
      then 'Choose which weekday of the month this repeats on.'
    when p_frequency = 'yearly'
         and (p_month_of_year is null or p_month_of_year < 1 or p_month_of_year > 12)
      then 'Choose which month of the year this repeats in.'
    when coalesce(p_ends_mode, 'never') not in ('never', 'after', 'on_date')
      then 'Choose when the series ends.'
    when p_ends_mode = 'after' and (p_ends_after_count is null or p_ends_after_count < 1)
      then 'Enter how many times this should happen.'
    when p_ends_mode = 'on_date' and p_ends_on_date is null
      then 'Choose the date the series ends on.'
    when p_ends_mode = 'on_date' and p_start_date is not null and p_ends_on_date < p_start_date
      then 'The end date cannot be before the start date.'
    else null
  end;
$$;

drop function if exists public.create_routine_template(text, text, uuid, public.recurrence_frequency, smallint, smallint, smallint, time, date, boolean, boolean, text);
drop function if exists public.update_routine_template(uuid, text, text, public.recurrence_frequency, smallint, smallint, smallint, time, boolean, boolean, text);

create or replace function public.create_routine_template(
  p_title text,
  p_description text,
  p_owner_id uuid,
  p_frequency public.recurrence_frequency,
  p_interval_count smallint,
  p_weekdays smallint[],
  p_monthly_mode text,
  p_day_of_month smallint,
  p_nth_weekday smallint,
  p_nth_weekday_dow smallint,
  p_month_of_year smallint,
  p_due_time time,
  p_start_date date,
  p_ends_mode text default 'never',
  p_ends_after_count integer default null,
  p_ends_on_date date default null,
  p_evidence_required boolean default false,
  p_requires_completion_review boolean default false,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  actor uuid := auth.uid();
  manager_authority boolean;
  shape_error text;
  owner uuid;
  new_id uuid;
  starts_active boolean;
  replayed jsonb;
  result jsonb;
  starts_on date;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to create a routine.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  owner := coalesce(p_owner_id, actor);
  manager_authority := focus.is_admin()
    or (focus.is_manager_or_admin() and (owner = actor or focus.is_manager_of(owner)));

  if owner <> actor and not manager_authority then
    return focus.error('not_authorised',
      'Only a manager can set up a routine for somebody else.');
  end if;

  if length(btrim(coalesce(p_title, ''))) = 0 then
    return focus.error('validation_failed', 'Give the routine a name.');
  end if;

  starts_on := coalesce(p_start_date, current_date);

  shape_error := focus.validate_routine_shape(
    p_frequency, p_interval_count, p_weekdays, p_monthly_mode, p_day_of_month,
    p_nth_weekday, p_nth_weekday_dow, p_month_of_year,
    p_ends_mode, p_ends_after_count, p_ends_on_date, starts_on);
  if shape_error is not null then
    return focus.error('validation_failed', shape_error);
  end if;

  -- The promise in the interface, enforced: a routine somebody sets up for
  -- themselves waits for their manager before it starts committing their days.
  starts_active := manager_authority;

  insert into public.routine_templates (
    title, description, default_owner_id, frequency, interval_count,
    weekday, weekdays, monthly_mode, day_of_month, nth_weekday, nth_weekday_dow,
    month_of_year, due_time, start_date,
    ends_mode, ends_after_count, ends_on_date,
    requires_completion_review, evidence_required, is_active,
    -- The day before the start, so the start date itself can be generated.
    generated_through, created_by
  ) values (
    btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), owner,
    p_frequency, p_interval_count,
    case when p_frequency = 'weekly' then p_weekdays[1] else null end,
    case when p_frequency = 'weekly' then p_weekdays else null end,
    case when p_frequency in ('monthly', 'yearly')
         then coalesce(p_monthly_mode, 'day_of_month') else null end,
    case when p_frequency in ('monthly', 'yearly')
          and coalesce(p_monthly_mode, 'day_of_month') = 'day_of_month'
         then p_day_of_month else null end,
    case when p_monthly_mode = 'nth_weekday' then p_nth_weekday else null end,
    case when p_monthly_mode = 'nth_weekday' then p_nth_weekday_dow else null end,
    case when p_frequency = 'yearly' then p_month_of_year else null end,
    coalesce(p_due_time, '17:00'::time), starts_on,
    coalesce(p_ends_mode, 'never'), p_ends_after_count, p_ends_on_date,
    coalesce(p_requires_completion_review, false),
    coalesce(p_evidence_required, false), starts_active,
    starts_on - 1, actor
  ) returning id into new_id;

  perform focus.write_audit(
    p_event_type := 'routine_template_created',
    p_actor_id := actor,
    p_subject_user_id := owner,
    p_detail := jsonb_build_object(
      'routine_template_id', new_id, 'title', btrim(p_title),
      'frequency', p_frequency, 'interval_count', p_interval_count,
      'start_date', starts_on, 'starts_active', starts_active));

  result := jsonb_build_object(
    'ok', true,
    'code', case when starts_active then 'routine_created' else 'routine_awaiting_review' end,
    'routine_template_id', new_id,
    'is_active', starts_active);
  return focus.remember_operation(actor, p_idempotency_key, 'create_routine_template', result);
end;
$$;

create or replace function public.update_routine_template(
  p_template_id uuid,
  p_title text,
  p_description text,
  p_frequency public.recurrence_frequency,
  p_interval_count smallint,
  p_weekdays smallint[],
  p_monthly_mode text,
  p_day_of_month smallint,
  p_nth_weekday smallint,
  p_nth_weekday_dow smallint,
  p_month_of_year smallint,
  p_due_time time,
  p_start_date date,
  p_ends_mode text default 'never',
  p_ends_after_count integer default null,
  p_ends_on_date date default null,
  p_evidence_required boolean default false,
  p_requires_completion_review boolean default false,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  actor uuid := auth.uid();
  template public.routine_templates%rowtype;
  shape_error text;
  replayed jsonb;
  result jsonb;
  starts_on date;
  cleared integer := 0;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change a routine.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into template from public.routine_templates
   where id = p_template_id and deleted_at is null;
  if not found then
    return focus.error('not_found', 'That routine no longer exists.');
  end if;

  if not (focus.is_admin()
          or template.default_owner_id = actor
          or template.created_by = actor
          or (focus.is_manager_or_admin() and focus.is_manager_of(template.default_owner_id))) then
    return focus.error('not_authorised', 'You cannot change this routine.');
  end if;

  if length(btrim(coalesce(p_title, ''))) = 0 then
    return focus.error('validation_failed', 'Give the routine a name.');
  end if;

  starts_on := coalesce(p_start_date, template.start_date, current_date);

  shape_error := focus.validate_routine_shape(
    p_frequency, p_interval_count, p_weekdays, p_monthly_mode, p_day_of_month,
    p_nth_weekday, p_nth_weekday_dow, p_month_of_year,
    p_ends_mode, p_ends_after_count, p_ends_on_date, starts_on);
  if shape_error is not null then
    return focus.error('validation_failed', shape_error);
  end if;

  /*
   * Clear the future, keep the past.
   *
   * Changing "every Monday" to "every Friday" has to move the Mondays that
   * have not happened yet, or the change means nothing until the old dates
   * have all passed. Only untouched `backlog` occurrences from tomorrow on are
   * removed: anything started, completed or overdue is a record of real work
   * and is never rewritten by an edit to the schedule.
   */
  -- Soft-deleted, not deleted. `focus.reject_audit_mutation` makes
  -- `audit_events` append-only, so removing a task row fails outright once it
  -- has any history — and every generated occurrence has a
  -- `routine_occurrence_generated` event from the moment it exists. Withdrawing
  -- an occurrence is the same act as binning a task, and uses the same columns.
  with removed as (
    update public.tasks
       set deleted_at = now(), deleted_by = actor
     where routine_template_id = template.id
       and status = 'backlog'
       and occurrence_date > current_date
       and activated_at is null
       and deleted_at is null
    returning 1)
  select count(*) into cleared from removed;

  update public.routine_templates
     set title = btrim(p_title),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         frequency = p_frequency,
         interval_count = p_interval_count,
         weekday = case when p_frequency = 'weekly' then p_weekdays[1] else null end,
         weekdays = case when p_frequency = 'weekly' then p_weekdays else null end,
         monthly_mode = case when p_frequency in ('monthly', 'yearly')
                             then coalesce(p_monthly_mode, 'day_of_month') else null end,
         day_of_month = case when p_frequency in ('monthly', 'yearly')
                              and coalesce(p_monthly_mode, 'day_of_month') = 'day_of_month'
                             then p_day_of_month else null end,
         nth_weekday = case when p_monthly_mode = 'nth_weekday' then p_nth_weekday else null end,
         nth_weekday_dow = case when p_monthly_mode = 'nth_weekday' then p_nth_weekday_dow else null end,
         month_of_year = case when p_frequency = 'yearly' then p_month_of_year else null end,
         due_time = coalesce(p_due_time, '17:00'::time),
         start_date = starts_on,
         ends_mode = coalesce(p_ends_mode, 'never'),
         ends_after_count = p_ends_after_count,
         ends_on_date = p_ends_on_date,
         evidence_required = coalesce(p_evidence_required, false),
         requires_completion_review = coalesce(p_requires_completion_review, false),
         -- Re-open the window from today so the new pattern can generate.
         generated_through = least(coalesce(generated_through, current_date), current_date),
         updated_at = now()
   where id = template.id;

  perform focus.write_audit(
    p_event_type := 'routine_template_updated',
    p_actor_id := actor,
    p_subject_user_id := template.default_owner_id,
    p_detail := jsonb_build_object(
      'routine_template_id', template.id, 'title', btrim(p_title),
      'frequency', p_frequency, 'interval_count', p_interval_count,
      'start_date', starts_on, 'future_occurrences_cleared', cleared));

  result := jsonb_build_object(
    'ok', true, 'code', 'routine_updated',
    'routine_template_id', template.id,
    'future_occurrences_cleared', cleared);
  return focus.remember_operation(actor, p_idempotency_key, 'update_routine_template', result);
end;
$$;

-- ---------------------------------------------------------------------------
-- The Bin, for routines.
-- ---------------------------------------------------------------------------

create or replace function public.delete_routine_template(
  p_template_id uuid,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  actor uuid := auth.uid();
  template public.routine_templates%rowtype;
  replayed jsonb;
  result jsonb;
  cleared integer := 0;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to delete a routine.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into template from public.routine_templates
   where id = p_template_id and deleted_at is null;
  if not found then
    return focus.error('not_found', 'That routine has already been deleted.');
  end if;

  -- Same rule as a task: the person who set it up can remove it, and so can an
  -- administrator. Deleting is for a mistake at creation, not a way to end
  -- somebody else's schedule — that is what Pause is for.
  if not (focus.is_admin() or template.created_by = actor) then
    return focus.error('not_authorised',
      'Only the person who set this routine up can delete it. Pause it instead.');
  end if;

  -- Future occurrences nobody has started go with it. Work already begun or
  -- completed stays: it happened, and the record of it is not the schedule's
  -- to withdraw.
  -- Soft-deleted, not deleted. `focus.reject_audit_mutation` makes
  -- `audit_events` append-only, so removing a task row fails outright once it
  -- has any history — and every generated occurrence has a
  -- `routine_occurrence_generated` event from the moment it exists. Withdrawing
  -- an occurrence is the same act as binning a task, and uses the same columns.
  with removed as (
    update public.tasks
       set deleted_at = now(), deleted_by = actor
     where routine_template_id = template.id
       and status = 'backlog'
       and occurrence_date > current_date
       and activated_at is null
       and deleted_at is null
    returning 1)
  select count(*) into cleared from removed;

  update public.routine_templates
     set deleted_at = now(), deleted_by = actor, is_active = false, updated_at = now()
   where id = template.id;

  perform focus.write_audit(
    p_event_type := 'routine_template_deleted',
    p_actor_id := actor,
    p_subject_user_id := template.default_owner_id,
    p_detail := jsonb_build_object(
      'routine_template_id', template.id, 'title', template.title,
      'future_occurrences_cleared', cleared));

  result := jsonb_build_object(
    'ok', true, 'code', 'routine_deleted',
    'routine_template_id', template.id,
    'future_occurrences_cleared', cleared);
  return focus.remember_operation(actor, p_idempotency_key, 'delete_routine_template', result);
end;
$$;

create or replace function public.restore_routine_template(
  p_template_id uuid,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  actor uuid := auth.uid();
  template public.routine_templates%rowtype;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to restore a routine.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into template from public.routine_templates
   where id = p_template_id and deleted_at is not null;
  if not found then
    return focus.error('not_found', 'That routine is not in the Bin.');
  end if;

  if not (focus.is_admin() or template.created_by = actor or template.deleted_by = actor) then
    return focus.error('not_authorised', 'You cannot restore this routine.');
  end if;

  /*
   * Restored paused, never running.
   *
   * A routine that comes back generates work for somebody's days. Bringing it
   * back the way it left would fill a diary without anybody deciding to, so it
   * returns as a schedule waiting to be started. The watermark moves to today
   * so the gap it spent in the Bin is not generated retrospectively.
   */
  update public.routine_templates
     set deleted_at = null, deleted_by = null, is_active = false,
         generated_through = greatest(coalesce(generated_through, current_date), current_date),
         updated_at = now()
   where id = template.id;

  perform focus.write_audit(
    p_event_type := 'routine_template_restored',
    p_actor_id := actor,
    p_subject_user_id := template.default_owner_id,
    p_detail := jsonb_build_object(
      'routine_template_id', template.id, 'title', template.title));

  result := jsonb_build_object(
    'ok', true, 'code', 'routine_restored', 'routine_template_id', template.id);
  return focus.remember_operation(actor, p_idempotency_key, 'restore_routine_template', result);
end;
$$;

grant execute on function public.delete_routine_template(uuid, text) to authenticated;
grant execute on function public.restore_routine_template(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The list, which now knows the next date before one has been generated.
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced: `create or replace view` cannot introduce a
-- column in the middle of the list, and the new pattern columns belong beside
-- the ones they extend rather than appended in migration order.
drop view if exists public.routine_template_overview;

create view public.routine_template_overview
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
         as scheduled_next_date
  from public.routine_templates t
  left join public.user_profiles owner on owner.id = t.default_owner_id
  left join public.person_display owner_dir on owner_dir.id = t.default_owner_id;

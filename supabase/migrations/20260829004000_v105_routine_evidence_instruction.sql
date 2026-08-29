-- ---------------------------------------------------------------------------
-- v105 - the evidence instruction can be written where it is decided.
--
-- v91 put `evidence_instruction` on `routine_templates` and every occurrence
-- reads it, but neither procedure accepted it - so the sentence could be
-- stored and displayed and never entered. The setup dialog is where somebody
-- decides evidence is required, and it is the only place that knows what the
-- evidence should be.
--
-- Both procedures are dropped and recreated rather than replaced, because a
-- new parameter is a new signature: `create or replace` would leave the old
-- one behind as an overload, and PostgREST would then have two candidates for
-- the same call.
--
-- The instruction is held only while evidence is required. A routine switched
-- back to optional drops it, so nothing can go on telling people to attach
-- something the schedule no longer asks for.
-- ---------------------------------------------------------------------------

drop function if exists public.create_routine_template(
  text, text, uuid, public.recurrence_frequency, smallint, smallint[], text,
  smallint, smallint, smallint, smallint, time, date, text, integer, date,
  boolean, boolean, text);

drop function if exists public.update_routine_template(
  uuid, text, text, public.recurrence_frequency, smallint, smallint[], text,
  smallint, smallint, smallint, smallint, time, date, text, integer, date,
  boolean, boolean, text);

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
  p_evidence_instruction text default null,
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
    generated_through, created_by, evidence_instruction
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
    starts_on - 1, actor,
    -- Only meaningful when evidence is required. Held null otherwise, so a
    -- routine switched to optional cannot keep instructing people to attach
    -- something it no longer asks for.
    case when coalesce(p_evidence_required, false)
         then nullif(btrim(coalesce(p_evidence_instruction, '')), '') end
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
  p_evidence_instruction text default null,
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
         evidence_instruction = case when coalesce(p_evidence_required, false)
           then nullif(btrim(coalesce(p_evidence_instruction, '')), '') end,
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

revoke all on function public.create_routine_template(
  text, text, uuid, public.recurrence_frequency, smallint, smallint[], text,
  smallint, smallint, smallint, smallint, time, date, text, integer, date,
  boolean, text, boolean, text) from public, anon;
grant execute on function public.create_routine_template(
  text, text, uuid, public.recurrence_frequency, smallint, smallint[], text,
  smallint, smallint, smallint, smallint, time, date, text, integer, date,
  boolean, text, boolean, text) to authenticated;

revoke all on function public.update_routine_template(
  uuid, text, text, public.recurrence_frequency, smallint, smallint[], text,
  smallint, smallint, smallint, smallint, time, date, text, integer, date,
  boolean, text, boolean, text) from public, anon;
grant execute on function public.update_routine_template(
  uuid, text, text, public.recurrence_frequency, smallint, smallint[], text,
  smallint, smallint, smallint, smallint, time, date, text, integer, date,
  boolean, text, boolean, text) to authenticated;

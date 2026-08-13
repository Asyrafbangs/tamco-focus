-- ---------------------------------------------------------------------------
-- v60 — managing a routine.
--
-- The routine lifecycle had a hole in the middle. Choosing Routine in New Work
-- created a `work_proposals` row of kind `routine_template`, and nothing in the
-- system could ever act on it: `decide_major_project_proposal` exists,
-- `decide_routine_template_proposal` never did. Meanwhile
-- `generate_routine_occurrences` reads `routine_templates`, and no procedure or
-- screen could create a row in that table. The two seeded templates worked; a
-- template made by a person was unreachable.
--
-- So the reported symptom — "I created a routine and nothing happened" — was
-- literally accurate. A proposal was written to a table nobody reads.
--
-- FREQUENCY. The recurrence maths in `focus.next_occurrence_date` was already
-- capable of far more than the interface admitted:
--
--   daily    every `interval_count` days
--   weekly   next `weekday`, then `interval_count - 1` further weeks
--   monthly  `interval_count` months on, clamped to `day_of_month`
--
-- Quarterly is monthly with an interval of 3. Yearly is 12. Fortnightly is
-- weekly with 2. Nothing new is needed in the engine and the enum is left
-- alone; what was missing was a way to say it. These procedures take the same
-- four fields and validate the combinations that actually make sense.
--
-- REVIEW. `MANAGER_VISIBILITY` has always promised "your manager reviews the
-- routine before occurrences are generated", and nothing enforced it. A
-- template created by a manager starts active. One created by anybody else
-- starts paused, and only a manager can activate it — which honours the
-- promise using the `is_active` flag the generator already respects, rather
-- than a parallel approval mechanism.
-- ---------------------------------------------------------------------------

create or replace function focus.validate_routine_shape(
  p_frequency public.recurrence_frequency,
  p_interval_count smallint,
  p_weekday smallint,
  p_day_of_month smallint
)
returns text
language sql
immutable
as $$
  select case
    when p_interval_count is null or p_interval_count < 1 or p_interval_count > 52
      then 'Repeat every must be between 1 and 52.'
    when p_frequency = 'weekly' and (p_weekday is null or p_weekday < 1 or p_weekday > 7)
      then 'Choose which day of the week this repeats on.'
    when p_frequency = 'monthly' and (p_day_of_month is null or p_day_of_month < 1 or p_day_of_month > 31)
      then 'Choose which day of the month this repeats on.'
    else null
  end;
$$;

comment on function focus.validate_routine_shape is
  'The combinations focus.next_occurrence_date can actually resolve. Weekly needs a weekday; monthly needs a day of month; daily needs neither.';

-- ---------------------------------------------------------------------------
create or replace function public.create_routine_template(
  p_title text,
  p_description text,
  p_owner_id uuid,
  p_frequency public.recurrence_frequency,
  p_interval_count smallint,
  p_weekday smallint,
  p_day_of_month smallint,
  p_due_time time,
  p_start_date date,
  p_evidence_required boolean default false,
  p_requires_completion_review boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  anchor date;
  first_month date;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to create a routine.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  owner := coalesce(p_owner_id, actor);
  manager_authority := focus.is_admin()
    or (focus.is_manager_or_admin() and (owner = actor or focus.is_manager_of(owner)));

  -- Somebody may always set up their own routine. Naming a different owner is
  -- an assignment, and assignment is a manager act.
  if owner <> actor and not manager_authority then
    return focus.error(
      'not_authorised',
      'Only a manager can set up a routine for somebody else.'
    );
  end if;

  if length(btrim(coalesce(p_title, ''))) = 0 then
    return focus.error('validation_failed', 'Give the routine a name.');
  end if;

  shape_error := focus.validate_routine_shape(
    p_frequency, p_interval_count, p_weekday, p_day_of_month
  );
  if shape_error is not null then
    return focus.error('validation_failed', shape_error);
  end if;

  -- The promise in the interface, enforced: a routine somebody sets up for
  -- themselves waits for their manager before it starts committing their days.
  starts_active := manager_authority;

  /*
   * Where generation starts from.
   *
   * `generate_routine_occurrences` advances from `generated_through` using
   * `focus.next_occurrence_date`, so the anchor decides the first occurrence —
   * and for monthly the naive answer is wrong in a way nobody would notice
   * until it bit them. That rule reads `date_trunc('month', anchor) +
   * interval_count months`, so anchoring a quarterly routine at "yesterday"
   * puts its first occurrence a full quarter away: set one up on 13 August and
   * the first extinguisher check lands on 15 NOVEMBER. Three months of a
   * routine that looks configured and does nothing.
   *
   * Daily and weekly do not have this problem — both step forward from the
   * anchor directly — so only monthly needs the arithmetic. The first
   * occurrence should be this month's chosen day if it has not passed, and
   * otherwise one full cycle later.
   */
  starts_on := coalesce(p_start_date, current_date);

  if p_frequency = 'monthly' then
    first_month := date_trunc('month', starts_on)::date;
    if p_day_of_month < extract(day from starts_on)::integer then
      first_month := (first_month + (p_interval_count || ' months')::interval)::date;
    end if;
    anchor := (first_month - (p_interval_count || ' months')::interval)::date;
  else
    anchor := starts_on - 1;
  end if;

  insert into public.routine_templates (
    title, description, default_owner_id, frequency, interval_count,
    weekday, day_of_month, due_time, requires_completion_review,
    evidence_required, is_active, generated_through, created_by
  ) values (
    btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), owner,
    p_frequency, p_interval_count,
    case when p_frequency = 'weekly' then p_weekday else null end,
    case when p_frequency = 'monthly' then p_day_of_month else null end,
    coalesce(p_due_time, '17:00'::time), coalesce(p_requires_completion_review, false),
    coalesce(p_evidence_required, false), starts_active,
    anchor,
    actor
  ) returning id into new_id;

  perform focus.write_audit(
    p_event_type := 'routine_template_created',
    p_actor_id := actor,
    p_subject_user_id := owner,
    p_detail := jsonb_build_object(
      'routine_template_id', new_id,
      'title', btrim(p_title),
      'frequency', p_frequency,
      'interval_count', p_interval_count,
      'starts_active', starts_active
    )
  );

  result := jsonb_build_object(
    'ok', true,
    'code', case when starts_active then 'routine_created' else 'routine_awaiting_review' end,
    'routine_template_id', new_id,
    'is_active', starts_active
  );
  return focus.remember_operation(actor, p_idempotency_key, 'create_routine_template', result);
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function public.update_routine_template(
  p_template_id uuid,
  p_title text,
  p_description text,
  p_frequency public.recurrence_frequency,
  p_interval_count smallint,
  p_weekday smallint,
  p_day_of_month smallint,
  p_due_time time,
  p_evidence_required boolean default false,
  p_requires_completion_review boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  template public.routine_templates;
  shape_error text;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to edit a routine.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into template from public.routine_templates where id = p_template_id for update;
  if not found then return focus.error('not_found', 'That routine no longer exists.'); end if;

  if not (
    focus.is_admin()
    or template.default_owner_id = actor
    or (focus.is_manager_or_admin() and focus.is_manager_of(template.default_owner_id))
  ) then
    return focus.error('not_authorised', 'Only the owner or their manager can edit this routine.');
  end if;

  if length(btrim(coalesce(p_title, ''))) = 0 then
    return focus.error('validation_failed', 'Give the routine a name.');
  end if;

  shape_error := focus.validate_routine_shape(
    p_frequency, p_interval_count, p_weekday, p_day_of_month
  );
  if shape_error is not null then
    return focus.error('validation_failed', shape_error);
  end if;

  update public.routine_templates
  set title = btrim(p_title),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      frequency = p_frequency,
      interval_count = p_interval_count,
      weekday = case when p_frequency = 'weekly' then p_weekday else null end,
      day_of_month = case when p_frequency = 'monthly' then p_day_of_month else null end,
      due_time = coalesce(p_due_time, template.due_time),
      evidence_required = coalesce(p_evidence_required, template.evidence_required),
      requires_completion_review =
        coalesce(p_requires_completion_review, template.requires_completion_review),
      updated_at = now()
  where id = p_template_id;

  perform focus.write_audit(
    p_event_type := 'routine_template_updated',
    p_actor_id := actor,
    p_subject_user_id := template.default_owner_id,
    p_detail := jsonb_build_object(
      'routine_template_id', p_template_id,
      'previous_frequency', template.frequency,
      'previous_interval_count', template.interval_count,
      'frequency', p_frequency,
      'interval_count', p_interval_count
    )
  );

  result := jsonb_build_object('ok', true, 'code', 'routine_updated', 'routine_template_id', p_template_id);
  return focus.remember_operation(actor, p_idempotency_key, 'update_routine_template', result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pausing and activating.
--
-- Pausing is how a routine stops, rather than deletion: occurrences already
-- generated are real work somebody may have started, and removing the template
-- underneath them would strand that. `generate_routine_occurrences` only reads
-- active templates, so pausing stops future commitments immediately.
-- ---------------------------------------------------------------------------
create or replace function public.set_routine_template_active(
  p_template_id uuid,
  p_active boolean,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  template public.routine_templates;
  manager_authority boolean;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change a routine.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into template from public.routine_templates where id = p_template_id for update;
  if not found then return focus.error('not_found', 'That routine no longer exists.'); end if;

  manager_authority := focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(template.default_owner_id))
    or (focus.is_manager_or_admin() and template.default_owner_id = actor);

  -- Activating is the review step, so it is a manager's to make. Pausing your
  -- own routine is not: stopping work you own needs no permission.
  if p_active and not manager_authority then
    return focus.error(
      'not_authorised',
      'A manager reviews a routine before it starts generating work.'
    );
  end if;
  if not p_active and not (manager_authority or template.default_owner_id = actor) then
    return focus.error('not_authorised', 'Only the owner or their manager can pause this routine.');
  end if;

  if template.is_active = p_active then
    return jsonb_build_object(
      'ok', true,
      'code', case when p_active then 'already_active' else 'already_paused' end,
      'routine_template_id', p_template_id
    );
  end if;

  update public.routine_templates
  set is_active = p_active,
      -- Resuming should not back-fill every occurrence missed while paused.
      generated_through = case when p_active then current_date - 1 else generated_through end,
      updated_at = now()
  where id = p_template_id;

  perform focus.write_audit(
    -- Cast required: a CASE expression is `text`, and `write_audit` takes the
    -- enum. A bare literal coerces, a CASE does not, so this resolved to no
    -- matching function and the pause failed at the last step.
    p_event_type := (case when p_active then 'routine_template_activated'
                          else 'routine_template_paused' end)::public.audit_event_type,
    p_actor_id := actor,
    p_subject_user_id := template.default_owner_id,
    p_detail := jsonb_build_object('routine_template_id', p_template_id, 'title', template.title)
  );

  result := jsonb_build_object(
    'ok', true,
    'code', case when p_active then 'routine_activated' else 'routine_paused' end,
    'routine_template_id', p_template_id,
    'is_active', p_active
  );
  return focus.remember_operation(actor, p_idempotency_key, 'set_routine_template_active', result);
end;
$$;

revoke all on function public.create_routine_template(text, text, uuid, public.recurrence_frequency, smallint, smallint, smallint, time, date, boolean, boolean, text) from public, anon;
revoke all on function public.update_routine_template(uuid, text, text, public.recurrence_frequency, smallint, smallint, smallint, time, boolean, boolean, text) from public, anon;
revoke all on function public.set_routine_template_active(uuid, boolean, text) from public, anon;
grant execute on function public.create_routine_template(text, text, uuid, public.recurrence_frequency, smallint, smallint, smallint, time, date, boolean, boolean, text) to authenticated;
grant execute on function public.update_routine_template(uuid, text, text, public.recurrence_frequency, smallint, smallint, smallint, time, boolean, boolean, text) to authenticated;
grant execute on function public.set_routine_template_active(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What the Routines screen reads.
--
-- `security_invoker`, so the existing SELECT policy decides the rows: managers
-- and admins see the team's, everybody sees their own.
-- ---------------------------------------------------------------------------
create or replace view public.routine_template_overview
with (security_invoker = true) as
  select
    t.id,
    t.title,
    t.description,
    t.default_owner_id,
    coalesce(owner.full_name, owner_dir.full_name) as owner_name,
    t.frequency,
    t.interval_count,
    t.weekday,
    t.day_of_month,
    t.due_time,
    t.evidence_required,
    t.requires_completion_review,
    t.is_active,
    t.generated_through,
    t.created_at,
    (select count(*) from public.tasks o
      where o.routine_template_id = t.id and o.deleted_at is null) as occurrence_count,
    (select min(o.occurrence_date) from public.tasks o
      where o.routine_template_id = t.id
        and o.deleted_at is null
        and o.occurrence_date >= current_date) as next_occurrence_date
  from public.routine_templates t
    left join public.user_profiles owner on owner.id = t.default_owner_id
    left join public.person_display owner_dir on owner_dir.id = t.default_owner_id;

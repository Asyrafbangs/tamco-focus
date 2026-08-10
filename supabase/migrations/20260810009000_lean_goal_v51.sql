-- TAMCO Focus v51 - lean Goal authoring on the existing versioned Goal model.

alter table public.goal_success_measures
  add column description text,
  add column optional_target_date date;

update public.goal_success_measures
set description = label
where description is null;

alter table public.goal_success_measures
  add constraint goal_success_measures_description_not_blank
    check (description is null or length(btrim(description)) > 0);

comment on column public.goal_success_measures.description is
  'The natural-language result statement shown in lean Goal authoring.';
comment on column public.goal_success_measures.optional_target_date is
  'A measure-specific date only when it differs from the parent Goal target date.';

create or replace function focus.insert_goal_success_measures(
  p_goal_version_id uuid,
  p_measures jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
  item_count integer;
  item_index integer := 0;
  parsed_type public.goal_measure_type;
  statement text;
begin
  if jsonb_typeof(coalesce(p_measures, '[]'::jsonb)) <> 'array' then
    raise exception 'Success measures must be a JSON array.' using errcode = 'check_violation';
  end if;

  item_count := jsonb_array_length(coalesce(p_measures, '[]'::jsonb));
  if item_count < 1 or item_count > 10 then
    raise exception 'A Goal requires between one and ten success measures.'
      using errcode = 'check_violation';
  end if;

  for item in
    select *
    from jsonb_to_recordset(p_measures) as x(
      description text,
      optional_target_date date,
      label text,
      measure_type text,
      target_numeric numeric,
      current_numeric numeric,
      unit text,
      period text,
      target_text text
    )
  loop
    item_index := item_index + 1;
    statement := btrim(coalesce(item.description, item.label, ''));
    if length(statement) = 0 then
      raise exception 'Each success measure needs a clear result statement.'
        using errcode = 'check_violation';
    end if;

    parsed_type := coalesce(item.measure_type, 'qualitative')::public.goal_measure_type;
    if parsed_type in ('number', 'percentage')
       and (item.target_numeric is null or item.target_numeric <= 0) then
      raise exception 'Numeric success measures need a target greater than zero.'
        using errcode = 'check_violation';
    end if;
    if parsed_type = 'percentage'
       and (item.target_numeric > 100
            or coalesce(item.current_numeric, 0) not between 0 and 100) then
      raise exception 'Percentage success measures must stay between zero and 100.'
        using errcode = 'check_violation';
    end if;

    insert into public.goal_success_measures (
      goal_version_id,
      position,
      description,
      optional_target_date,
      label,
      measure_type,
      target_numeric,
      current_numeric,
      unit,
      period,
      target_text,
      current_state
    ) values (
      p_goal_version_id,
      item_index,
      statement,
      item.optional_target_date,
      statement,
      parsed_type,
      case when parsed_type = 'qualitative' then null else item.target_numeric end,
      case when parsed_type = 'qualitative' then null else item.current_numeric end,
      nullif(btrim(coalesce(item.unit, '')), ''),
      nullif(btrim(coalesce(item.period, '')), ''),
      case
        when parsed_type = 'qualitative'
          then coalesce(nullif(btrim(coalesce(item.target_text, '')), ''), statement)
        else null
      end,
      case when parsed_type = 'qualitative' then 'not_started'::public.goal_measure_state end
    );
  end loop;

  return item_count;
exception
  when invalid_text_representation then
    raise exception 'Each success measure needs a valid shape.' using errcode = 'check_violation';
end;
$$;

create or replace function focus.insert_goal_milestones(
  p_goal_version_id uuid,
  p_milestones jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
  item_count integer;
  item_index integer := 0;
  base_weight integer;
  remainder integer;
  supplied_weight_count integer;
begin
  if jsonb_typeof(coalesce(p_milestones, '[]'::jsonb)) <> 'array' then
    raise exception 'Milestones must be a JSON array.' using errcode = 'check_violation';
  end if;

  item_count := jsonb_array_length(coalesce(p_milestones, '[]'::jsonb));
  if item_count > 5 then
    raise exception 'A Goal can have at most five milestones.' using errcode = 'check_violation';
  end if;
  if item_count = 0 then return 0; end if;

  select count(*) into supplied_weight_count
  from jsonb_to_recordset(p_milestones) as x(weight_percent integer)
  where x.weight_percent is not null;

  if supplied_weight_count not in (0, item_count) then
    raise exception 'Provide every milestone weight or leave every weight blank.'
      using errcode = 'check_violation';
  end if;
  if supplied_weight_count = item_count and (
    select coalesce(sum(x.weight_percent), 0)
    from jsonb_to_recordset(p_milestones) as x(weight_percent integer)
  ) <> 100 then
    raise exception 'Milestone weights must total 100.' using errcode = 'check_violation';
  end if;

  base_weight := floor(100.0 / item_count);
  remainder := 100 - base_weight * item_count;

  for item in
    select * from jsonb_to_recordset(p_milestones) as x(
      id uuid,
      source_milestone_id uuid,
      title text,
      completion_definition text,
      weight_percent integer,
      progress_percent integer
    )
  loop
    item_index := item_index + 1;
    if length(btrim(coalesce(item.title, ''))) = 0
       or length(btrim(coalesce(item.completion_definition, ''))) = 0 then
      raise exception 'Every milestone needs a result and definition of done.'
        using errcode = 'check_violation';
    end if;
    if coalesce(item.progress_percent, 0) not between 0 and 100
       or coalesce(item.progress_percent, 0) % 5 <> 0 then
      raise exception 'Milestone progress must use five-percent increments.'
        using errcode = 'check_violation';
    end if;

    insert into public.goal_milestones (
      id, goal_version_id, source_milestone_id, position, title,
      completion_definition, weight_percent, progress_percent,
      completed_by, completed_at
    ) values (
      coalesce(item.id, extensions.gen_random_uuid()),
      p_goal_version_id,
      item.source_milestone_id,
      item_index,
      btrim(item.title),
      btrim(item.completion_definition),
      coalesce(item.weight_percent, base_weight + case when item_index <= remainder then 1 else 0 end),
      coalesce(item.progress_percent, 0),
      case when coalesce(item.progress_percent, 0) = 100 then auth.uid() else null end,
      case when coalesce(item.progress_percent, 0) = 100 then now() else null end
    );
  end loop;
  return item_count;
end;
$$;

create or replace function focus.copy_goal_measures_to_new_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_version_id uuid;
begin
  if new.version_number <= 1 then return new; end if;

  select g.active_version_id into source_version_id
  from public.goals g
  where g.id = new.goal_id;

  if source_version_id is not null then
    insert into public.goal_success_measures (
      goal_version_id, source_measure_id, position, description, optional_target_date,
      label, measure_type, target_numeric, current_numeric, unit, period, target_text, current_state
    )
    select
      new.id, m.id, m.position, coalesce(m.description, m.label), m.optional_target_date,
      m.label, m.measure_type, m.target_numeric, m.current_numeric,
      m.unit, m.period, m.target_text, m.current_state
    from public.goal_success_measures m
    where m.goal_version_id = source_version_id
    order by m.position;
  end if;

  if not exists (
    select 1 from public.goal_success_measures m where m.goal_version_id = new.id
  ) then
    insert into public.goal_success_measures (
      goal_version_id, position, description, label, measure_type, target_text, current_state
    ) values (
      new.id, 1, new.success_measure, new.success_measure,
      'qualitative', new.success_measure, 'not_started'
    );
  end if;
  return new;
end;
$$;

create or replace function public.create_lean_goal(
  p_owner_id uuid,
  p_expected_result text,
  p_target_date date,
  p_weight_percent integer,
  p_measures jsonb,
  p_agreed_approach text default null,
  p_support_needed text default null,
  p_dependencies text default null,
  p_baseline text default null,
  p_purpose text default null,
  p_category text default 'performance',
  p_milestones jsonb default '[]'::jsonb,
  p_submission_mode text default 'discussion',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  owner_profile record;
  assigned_manager uuid;
  goal_id uuid := extensions.gen_random_uuid();
  goal_version_id uuid := extensions.gen_random_uuid();
  goal_status_value public.goal_status;
  version_status_value public.goal_version_status;
  active_weight integer := 0;
  measure_count integer;
  milestone_count integer;
  legacy_measure text;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to create a Goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into owner_profile
  from public.user_profiles
  where id = p_owner_id and status = 'active';
  if not found then return focus.error('invalid_owner', 'Select an active employee.'); end if;

  if actor <> p_owner_id
     and (not focus.is_manager_or_admin()
          or (not focus.is_admin() and not focus.is_manager_of(p_owner_id))) then
    return focus.error('not_authorised', 'You cannot create a Goal for this employee.');
  end if;
  if p_submission_mode not in ('draft', 'discussion', 'active') then
    return focus.error('validation_failed', 'Choose Draft, For Discussion or Active.');
  end if;
  if p_submission_mode = 'active' and (
    actor = p_owner_id
    or not focus.is_manager_or_admin()
    or (not focus.is_admin() and not focus.is_manager_of(p_owner_id))
  ) then
    return focus.error('not_authorised', 'Only the authorised manager can agree and activate a formal Goal.');
  end if;
  if length(btrim(coalesce(p_expected_result, ''))) = 0
     or p_target_date is null or p_target_date < current_date
     or p_weight_percent not between 1 and 100
     or p_category not in ('performance', 'improvement', 'development') then
    return focus.error('validation_failed', 'Add a clear result, future target date and formal weight.');
  end if;
  if jsonb_typeof(coalesce(p_measures, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_measures, '[]'::jsonb)) not between 1 and 10 then
    return focus.error('validation_failed', 'Add between one and ten success measures.');
  end if;
  if jsonb_typeof(coalesce(p_milestones, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_milestones, '[]'::jsonb)) > 5 then
    return focus.error('validation_failed', 'Add no more than five optional milestones.');
  end if;

  assigned_manager := owner_profile.reporting_manager_id;
  if assigned_manager is null and actor <> p_owner_id then assigned_manager := actor; end if;

  if p_submission_mode = 'active' then
    perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 51));
    select coalesce(sum(weight_percent), 0)::integer into active_weight
    from public.goals
    where owner_id = p_owner_id and status = 'active';
    if active_weight + p_weight_percent > 100 then
      return focus.error(
        'invalid_target',
        format('This Goal would bring the allocation to %s%%. Adjust the weight before activation.', active_weight + p_weight_percent)
      );
    end if;
  end if;

  goal_status_value := case p_submission_mode
    when 'draft' then 'draft'::public.goal_status
    when 'discussion' then 'pending_discussion'::public.goal_status
    else 'active'::public.goal_status
  end;
  version_status_value := case when p_submission_mode = 'active'
    then 'active'::public.goal_version_status else 'pending'::public.goal_version_status end;

  select string_agg(btrim(coalesce(value ->> 'description', value ->> 'label')), '; ' order by ordinal)
    into legacy_measure
  from jsonb_array_elements(p_measures) with ordinality as measures(value, ordinal);

  begin
    insert into public.goals (
      id, owner_id, manager_id, created_by, title, category, status, health,
      target_date, weight_percent, checkin_due_at, agreed_at
    ) values (
      goal_id, p_owner_id, assigned_manager, actor, btrim(p_expected_result), p_category,
      goal_status_value, 'on_track', p_target_date, p_weight_percent,
      case when p_submission_mode = 'active' then now() + interval '30 days' end,
      case when p_submission_mode = 'active' then now() end
    );

    insert into public.goal_versions (
      id, goal_id, version_number, status, title, expected_result, success_measure,
      employee_approach, support_agreed, dependencies, baseline, purpose,
      target_date, weight_percent, proposed_by, activated_at
    ) values (
      goal_version_id, goal_id, 1, version_status_value,
      btrim(p_expected_result), btrim(p_expected_result), legacy_measure,
      nullif(btrim(coalesce(p_agreed_approach, '')), ''),
      nullif(btrim(coalesce(p_support_needed, '')), ''),
      nullif(btrim(coalesce(p_dependencies, '')), ''),
      nullif(btrim(coalesce(p_baseline, '')), ''),
      nullif(btrim(coalesce(p_purpose, '')), ''),
      p_target_date, p_weight_percent, actor,
      case when p_submission_mode = 'active' then now() end
    );

    measure_count := focus.insert_goal_success_measures(goal_version_id, p_measures);
    milestone_count := focus.insert_goal_milestones(goal_version_id, p_milestones);
  exception when check_violation or invalid_text_representation then
    return focus.error('validation_failed', sqlerrm);
  end;

  update public.goals
  set active_version_id = case when p_submission_mode = 'active' then goal_version_id end,
      pending_version_id = case when p_submission_mode <> 'active' then goal_version_id end
  where id = goal_id;

  insert into public.goal_participants (goal_id, user_id, participant_role, added_by)
  values (goal_id, p_owner_id, 'employee', actor)
  on conflict on constraint goal_participants_pkey do nothing;
  if assigned_manager is not null and assigned_manager <> p_owner_id then
    insert into public.goal_participants (goal_id, user_id, participant_role, added_by)
    values (goal_id, assigned_manager, 'manager', actor)
    on conflict on constraint goal_participants_pkey do nothing;
  end if;

  if p_submission_mode = 'active' then
    insert into public.goal_agreements (
      goal_id, goal_version_id, employee_id, manager_id, agreed_by, detail
    ) values (
      goal_id, goal_version_id, p_owner_id, actor, actor,
      jsonb_build_object('mode', 'manager_agree_and_activate')
    );
  elsif p_submission_mode = 'discussion' then
    if actor = p_owner_id and assigned_manager is not null then
      perform focus.notify_goal(
        assigned_manager, 'goal_version_ready', 'immediate', true,
        'Goal ready for discussion', btrim(p_expected_result), goal_id, actor
      );
    elsif actor <> p_owner_id then
      perform focus.notify_goal(
        p_owner_id, 'goal_version_ready', 'immediate', true,
        'Goal ready for discussion', btrim(p_expected_result), goal_id, actor
      );
    end if;
  end if;

  perform focus.write_goal_audit(
    'goal_created', actor, goal_id, p_owner_id, 1,
    jsonb_build_object(
      'status', goal_status_value,
      'measure_count', measure_count,
      'milestone_count', milestone_count,
      'target_date', p_target_date,
      'weight_percent', p_weight_percent
    )
  );
  if p_submission_mode = 'active' then
    perform focus.write_goal_audit(
      'goal_version_agreed', actor, goal_id, p_owner_id, 1,
      jsonb_build_object('goal_version_id', goal_version_id, 'version_number', 1)
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', case p_submission_mode
      when 'draft' then 'goal_draft_saved'
      when 'discussion' then 'goal_saved_for_discussion'
      else 'goal_activated'
    end,
    'goal_id', goal_id,
    'goal_version_id', goal_version_id,
    'version', 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'create_lean_goal', result);
end;
$$;

create or replace function public.save_lean_goal_version(
  p_goal_id uuid,
  p_expected_version integer,
  p_expected_result text,
  p_target_date date,
  p_weight_percent integer,
  p_measures jsonb,
  p_agreed_approach text default null,
  p_support_needed text default null,
  p_dependencies text default null,
  p_baseline text default null,
  p_purpose text default null,
  p_milestones jsonb default '[]'::jsonb,
  p_submission_mode text default 'discussion',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal record;
  pending_id uuid := extensions.gen_random_uuid();
  previous_pending_id uuid;
  next_version_number integer;
  measure_count integer;
  milestone_count integer;
  legacy_measure text;
  recipient uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to edit a Goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if not focus.can_edit_goal_structure(p_goal_id) then
    return focus.error('not_authorised', 'You cannot edit this Goal.');
  end if;
  if goal.status not in ('draft', 'pending_discussion', 'active') then
    return focus.error('invalid_state', 'This Goal cannot be revised in its current state.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This Goal changed while you were editing it. Review the latest version and try again.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;
  if p_submission_mode not in ('draft', 'discussion') then
    return focus.error('validation_failed', 'Save the Goal as Draft or For Discussion.');
  end if;
  if goal.status = 'active' and actor = goal.owner_id and p_weight_percent <> goal.weight_percent then
    return focus.error('not_authorised', 'Formal weight changes are manager-controlled.');
  end if;
  if length(btrim(coalesce(p_expected_result, ''))) = 0
     or p_target_date is null or p_weight_percent not between 1 and 100 then
    return focus.error('validation_failed', 'Add a clear result, target date and formal weight.');
  end if;
  if jsonb_typeof(coalesce(p_measures, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_measures, '[]'::jsonb)) not between 1 and 10 then
    return focus.error('validation_failed', 'Add between one and ten success measures.');
  end if;
  if jsonb_typeof(coalesce(p_milestones, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_milestones, '[]'::jsonb)) > 5 then
    return focus.error('validation_failed', 'Add no more than five optional milestones.');
  end if;

  previous_pending_id := goal.pending_version_id;
  if previous_pending_id is not null then
    update public.goal_versions
    set status = 'superseded', superseded_at = now(), version = version + 1
    where id = previous_pending_id and status = 'pending';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version_number
  from public.goal_versions where goal_id = p_goal_id;
  select string_agg(btrim(coalesce(value ->> 'description', value ->> 'label')), '; ' order by ordinal)
    into legacy_measure
  from jsonb_array_elements(p_measures) with ordinality as measures(value, ordinal);

  begin
    insert into public.goal_versions (
      id, goal_id, version_number, status, title, expected_result, success_measure,
      employee_approach, support_agreed, dependencies, baseline, purpose,
      target_date, weight_percent, proposed_by
    ) values (
      pending_id, p_goal_id, next_version_number, 'pending',
      btrim(p_expected_result), btrim(p_expected_result), legacy_measure,
      nullif(btrim(coalesce(p_agreed_approach, '')), ''),
      nullif(btrim(coalesce(p_support_needed, '')), ''),
      nullif(btrim(coalesce(p_dependencies, '')), ''),
      nullif(btrim(coalesce(p_baseline, '')), ''),
      nullif(btrim(coalesce(p_purpose, '')), ''),
      p_target_date, p_weight_percent, actor
    );

    -- The compatibility trigger copies the active measures for legacy callers.
    -- This lean operation owns the replacement payload, so replace that copy.
    delete from public.goal_success_measures where goal_version_id = pending_id;
    measure_count := focus.insert_goal_success_measures(pending_id, p_measures);
    milestone_count := focus.insert_goal_milestones(pending_id, p_milestones);
  exception when check_violation or invalid_text_representation or unique_violation then
    return focus.error('validation_failed', sqlerrm);
  end;

  update public.goals
  set pending_version_id = pending_id,
      title = case when goal.status = 'active' then title else btrim(p_expected_result) end,
      target_date = case when goal.status = 'active' then target_date else p_target_date end,
      weight_percent = case when goal.status = 'active' then weight_percent else p_weight_percent end,
      status = case
        when goal.status = 'active' then 'active'::public.goal_status
        when p_submission_mode = 'draft' then 'draft'::public.goal_status
        else 'pending_discussion'::public.goal_status
      end,
      version = version + 1
  where id = p_goal_id;

  perform focus.write_goal_audit(
    'goal_version_proposed', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'pending_version_id', pending_id,
      'previous_pending_version_id', previous_pending_id,
      'version_number', next_version_number,
      'submission_mode', p_submission_mode,
      'measure_count', measure_count,
      'milestone_count', milestone_count,
      'active_version_unchanged', goal.active_version_id
    )
  );

  if p_submission_mode = 'discussion' or goal.status = 'active' then
    recipient := case when actor = goal.owner_id then goal.manager_id else goal.owner_id end;
    if recipient is not null then
      perform focus.notify_goal(
        recipient, 'goal_version_ready', 'immediate', true,
        'Goal ready for discussion', btrim(p_expected_result), p_goal_id, actor
      );
    end if;
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', case when p_submission_mode = 'draft' and goal.status <> 'active'
      then 'goal_draft_saved' else 'goal_version_proposed' end,
    'pending_version_id', pending_id,
    'version_number', next_version_number,
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'save_lean_goal_version', result);
end;
$$;

create or replace function public.agree_lean_goal_version(
  p_goal_id uuid,
  p_pending_version_id uuid,
  p_expected_version integer,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal record;
  pending record;
  active_weight integer;
  milestone_count integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to activate a Goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if not focus.can_agree_goal(p_goal_id) then
    return focus.error('not_authorised', 'Only the authorised manager can agree and activate this Goal.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This Goal changed before activation. Review the latest version and try again.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;
  if goal.pending_version_id is distinct from p_pending_version_id then
    return focus.error('invalid_state', 'That version is no longer awaiting agreement.');
  end if;

  select * into pending from public.goal_versions
  where id = p_pending_version_id and goal_id = p_goal_id and status = 'pending'
  for update;
  if not found then return focus.error('invalid_state', 'No Goal version is ready to activate.'); end if;

  perform pg_advisory_xact_lock(hashtextextended(goal.owner_id::text, 51));
  select coalesce(sum(weight_percent), 0)::integer into active_weight
  from public.goals
  where owner_id = goal.owner_id and status = 'active' and id <> p_goal_id;
  if active_weight + pending.weight_percent > 100 then
    return focus.error(
      'invalid_target',
      format('This Goal would bring the allocation to %s%%. Adjust the weight before activation.', active_weight + pending.weight_percent)
    );
  end if;

  select count(*) into milestone_count
  from public.goal_milestones where goal_version_id = pending.id;

  if goal.active_version_id is not null then
    update public.goal_versions
    set status = 'superseded', superseded_at = now(), version = version + 1
    where id = goal.active_version_id;
  end if;
  update public.goal_versions
  set status = 'active', activated_at = now(), version = version + 1
  where id = pending.id;

  update public.goals
  set title = pending.title,
      target_date = pending.target_date,
      weight_percent = pending.weight_percent,
      active_version_id = pending.id,
      pending_version_id = null,
      manager_id = actor,
      status = 'active',
      health = case when health = 'completed' then 'on_track' else health end,
      agreed_at = now(),
      completed_at = null,
      closed_at = null,
      checkin_due_at = now() + interval '30 days',
      version = version + 1
  where id = p_goal_id;

  insert into public.goal_participants (goal_id, user_id, participant_role, added_by)
  values (p_goal_id, actor, 'manager', actor)
  on conflict on constraint goal_participants_pkey
  do update set participant_role = 'manager';

  insert into public.goal_agreements (
    goal_id, goal_version_id, employee_id, manager_id, agreed_by, detail
  ) values (
    p_goal_id, pending.id, goal.owner_id, actor, actor,
    jsonb_build_object(
      'previous_active_version_id', goal.active_version_id,
      'mode', 'manager_agree_and_activate'
    )
  );

  perform focus.write_goal_audit(
    'goal_version_agreed', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'goal_version_id', pending.id,
      'version_number', pending.version_number,
      'previous_active_version_id', goal.active_version_id,
      'milestone_count', milestone_count,
      'employee_id', goal.owner_id,
      'manager_id', actor
    )
  );
  perform focus.notify_goal(
    goal.owner_id, 'goal_version_ready', 'digest', false,
    'Goal agreed and active', pending.title, p_goal_id, actor
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'goal_version_agreed',
    'active_version_id', pending.id,
    'version_number', pending.version_number,
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'agree_lean_goal_version', result);
end;
$$;

revoke all on function public.create_lean_goal(
  uuid, text, date, integer, jsonb, text, text, text, text, text, text, jsonb, text, text
) from public, anon;
revoke all on function public.save_lean_goal_version(
  uuid, integer, text, date, integer, jsonb, text, text, text, text, text, jsonb, text, text
) from public, anon;
revoke all on function public.agree_lean_goal_version(uuid, uuid, integer, text)
  from public, anon;

grant execute on function public.create_lean_goal(
  uuid, text, date, integer, jsonb, text, text, text, text, text, text, jsonb, text, text
) to authenticated;
grant execute on function public.save_lean_goal_version(
  uuid, integer, text, date, integer, jsonb, text, text, text, text, text, jsonb, text, text
) to authenticated;
grant execute on function public.agree_lean_goal_version(uuid, uuid, integer, text)
  to authenticated;

comment on function public.create_lean_goal(
  uuid, text, date, integer, jsonb, text, text, text, text, text, text, jsonb, text, text
) is 'Creates a self or manager-authored Goal Draft, For Discussion candidate or manager-activated agreement without duplicating Goal records.';
comment on function public.save_lean_goal_version(
  uuid, integer, text, date, integer, jsonb, text, text, text, text, text, jsonb, text, text
) is 'Atomically edits a pre-activation Goal candidate or proposes an audited revision while the active agreement remains unchanged.';
comment on function public.agree_lean_goal_version(uuid, uuid, integer, text)
  is 'Manager-only activation of a pending lean Goal version; zero milestones are valid and formal allocation remains authoritative.';

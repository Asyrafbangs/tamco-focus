-- TAMCO Focus v50 - transactional Goal lifecycle operations.

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
    if length(btrim(coalesce(item.label, ''))) = 0
       or item.measure_type not in ('number', 'percentage', 'qualitative') then
      raise exception 'Each success measure needs a label and valid type.'
        using errcode = 'check_violation';
    end if;

    parsed_type := item.measure_type::public.goal_measure_type;
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
      btrim(item.label),
      parsed_type,
      case when parsed_type = 'qualitative' then null else item.target_numeric end,
      case when parsed_type = 'qualitative' then null else item.current_numeric end,
      nullif(btrim(coalesce(item.unit, '')), ''),
      nullif(btrim(coalesce(item.period, '')), ''),
      case
        when parsed_type = 'qualitative'
          then coalesce(nullif(btrim(coalesce(item.target_text, '')), ''), btrim(item.label))
        else null
      end,
      case when parsed_type = 'qualitative' then 'not_started'::public.goal_measure_state end
    );
  end loop;

  return item_count;
end;
$$;

create or replace function public.create_goal_with_measures(
  p_owner_id uuid,
  p_expected_result text,
  p_target_date date,
  p_weight_percent integer,
  p_measures jsonb,
  p_employee_approach text default null,
  p_support_agreed text default null,
  p_dependencies text default null,
  p_baseline text default null,
  p_purpose text default null,
  p_category text default 'performance',
  p_milestones jsonb default '[]'::jsonb,
  p_activate boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  replayed jsonb;
  base_result jsonb;
  measure_count integer;
  milestone_count integer;
  legacy_measure text;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to create a Goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  if jsonb_typeof(coalesce(p_measures, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_measures, '[]'::jsonb)) < 1
     or jsonb_array_length(coalesce(p_measures, '[]'::jsonb)) > 10 then
    return focus.error('validation_failed', 'Add at least one clear success measure.');
  end if;
  if jsonb_typeof(coalesce(p_milestones, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_milestones, '[]'::jsonb)) not between 2 and 5 then
    return focus.error('validation_failed', 'Agree between two and five meaningful milestones.');
  end if;
  if p_weight_percent is null or p_weight_percent not between 1 and 100 then
    return focus.error('validation_failed', 'Formal Goal weight must be between 1% and 100%.');
  end if;

  select string_agg(btrim(value ->> 'label'), '; ' order by ordinal)
    into legacy_measure
  from jsonb_array_elements(p_measures) with ordinality as measures(value, ordinal);

  base_result := public.create_goal(
    p_owner_id,
    p_expected_result,
    legacy_measure,
    p_target_date,
    p_employee_approach,
    p_support_agreed,
    p_dependencies,
    p_baseline,
    p_purpose,
    p_weight_percent,
    p_category,
    p_milestones,
    p_activate,
    case when p_idempotency_key is null then null else p_idempotency_key || ':goal' end
  );
  if not coalesce((base_result ->> 'ok')::boolean, false) then
    return base_result;
  end if;

  measure_count := focus.insert_goal_success_measures(
    (base_result ->> 'goal_version_id')::uuid,
    p_measures
  );
  milestone_count := jsonb_array_length(p_milestones);

  result := base_result || jsonb_build_object(
    'measure_count', measure_count,
    'milestone_count', milestone_count
  );
  return focus.remember_operation(actor, p_idempotency_key, 'create_goal_with_measures', result);
exception
  when check_violation or invalid_text_representation then
    raise exception 'Goal success measures are invalid: %', sqlerrm using errcode = 'check_violation';
end;
$$;

create or replace function public.post_goal_monthly_checkin(
  p_goal_id uuid,
  p_expected_version integer,
  p_progress_status public.goal_health,
  p_summary text default null,
  p_no_material_change boolean default false,
  p_support_requested boolean default false,
  p_support_details text default null,
  p_measure_updates jsonb default '[]'::jsonb,
  p_attachments jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal record;
  measure record;
  item record;
  replayed jsonb;
  check_in_id uuid := extensions.gen_random_uuid();
  goal_update_id uuid := extensions.gen_random_uuid();
  support_id uuid;
  period_start date := date_trunc('month', current_date)::date;
  period_end date := focus.goal_month_end(current_date);
  attachment_count integer;
  changed_measure_count integer := 0;
  exact_progress smallint;
  stored_progress smallint;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to check in.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_goal_id::text || ':monthly:' || to_char(current_date, 'YYYY-MM'),
    50
  ));

  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if not focus.can_submit_goal_monthly(p_goal_id) then
    return focus.error('not_authorised', 'Only the Goal owner can submit the monthly check-in.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This Goal changed while you were checking in. Review it and try again.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;
  if p_progress_status is null
     or p_progress_status not in ('on_track', 'at_risk', 'off_track') then
    return focus.error('validation_failed', 'Choose On track, At risk, or Off track.');
  end if;
  if not p_no_material_change and length(btrim(coalesce(p_summary, ''))) = 0 then
    return focus.error('validation_failed', 'Record a short summary or choose No material change.');
  end if;
  if p_support_requested and length(btrim(coalesce(p_support_details, ''))) = 0 then
    return focus.error('validation_failed', 'Describe the support or decision needed.');
  end if;
  if jsonb_typeof(coalesce(p_measure_updates, '[]'::jsonb)) <> 'array' then
    return focus.error('validation_failed', 'Success-measure updates are malformed.');
  end if;
  if exists (
    select 1
    from public.goal_check_ins ci
    where ci.goal_id = p_goal_id
      and ci.checkin_type = 'monthly'
      and ci.period_year = extract(year from current_date)::integer
      and ci.period_month = extract(month from current_date)::integer
  ) then
    return focus.error('already_submitted', 'This month already has a Goal check-in.');
  end if;

  begin
    attachment_count := focus.verify_goal_attachments(p_goal_id, actor, p_attachments);
  exception when check_violation then
    return focus.error('validation_failed', sqlerrm);
  end;

  for item in
    select *
    from jsonb_to_recordset(coalesce(p_measure_updates, '[]'::jsonb)) as x(
      measure_id uuid,
      current_numeric numeric,
      current_state text,
      note text
    )
  loop
    select m.* into measure
    from public.goal_success_measures m
    where m.id = item.measure_id
      and m.goal_version_id = goal.active_version_id
    for update;
    if not found then
      return focus.error('validation_failed', 'A success measure is not part of the active Goal version.');
    end if;

    if measure.measure_type = 'qualitative' then
      if item.current_state not in ('not_started', 'progressing', 'achieved', 'exceeded') then
        return focus.error('validation_failed', 'Choose a valid qualitative measure state.');
      end if;
      if measure.current_state is distinct from item.current_state::public.goal_measure_state then
        insert into public.goal_success_measure_updates (
          goal_id, measure_id, check_in_id, author_id,
          previous_state, new_state, note
        ) values (
          p_goal_id, measure.id, check_in_id, actor,
          measure.current_state, item.current_state::public.goal_measure_state,
          nullif(btrim(coalesce(item.note, '')), '')
        );
        update public.goal_success_measures
        set current_state = item.current_state::public.goal_measure_state
        where id = measure.id;
        changed_measure_count := changed_measure_count + 1;
      end if;
    else
      if item.current_numeric is null
         or (measure.measure_type = 'percentage' and item.current_numeric not between 0 and 100) then
        return focus.error('validation_failed', 'Enter a valid current measure value.');
      end if;
      if measure.current_numeric is distinct from item.current_numeric then
        insert into public.goal_success_measure_updates (
          goal_id, measure_id, check_in_id, author_id,
          previous_numeric, new_numeric, note
        ) values (
          p_goal_id, measure.id, check_in_id, actor,
          measure.current_numeric, item.current_numeric,
          nullif(btrim(coalesce(item.note, '')), '')
        );
        update public.goal_success_measures
        set current_numeric = item.current_numeric
        where id = measure.id;
        changed_measure_count := changed_measure_count + 1;
      end if;
    end if;
  end loop;

  exact_progress := focus.goal_version_measure_progress(goal.active_version_id);
  stored_progress := (round(exact_progress::numeric / 5) * 5)::smallint;

  insert into public.goal_updates (
    id, goal_id, goal_version_id, author_id, kind,
    previous_reported_progress, new_reported_progress,
    what_changed, next_step, support_requested, support_details
  ) values (
    goal_update_id, p_goal_id, goal.active_version_id, actor, 'overall',
    goal.reported_progress, stored_progress,
    case
      when p_no_material_change then 'No material change this month.'
      else btrim(p_summary)
    end,
    null,
    p_support_requested,
    nullif(btrim(coalesce(p_support_details, '')), '')
  );

  insert into public.goal_attachments (
    id, goal_id, goal_update_id, storage_bucket, storage_path,
    file_name, mime_type, byte_size, uploaded_by
  )
  select x.id, p_goal_id, goal_update_id, 'task-attachments', x.storage_path,
         x.file_name, x.mime_type, x.byte_size, actor
  from jsonb_to_recordset(coalesce(p_attachments, '[]'::jsonb)) as x(
    id uuid, storage_path text, file_name text, mime_type text, byte_size bigint
  );

  insert into public.goal_check_ins (
    id, goal_id, goal_version_id, checkin_type, status,
    period_start, period_end, period_year, period_month,
    progress_status, no_material_change, employee_summary,
    support_requested, support_details, goal_update_id,
    submitted_by, submitted_at
  ) values (
    check_in_id, p_goal_id, goal.active_version_id, 'monthly', 'submitted',
    period_start, period_end,
    extract(year from current_date)::smallint,
    extract(month from current_date)::smallint,
    p_progress_status, p_no_material_change,
    case when p_no_material_change then null else btrim(p_summary) end,
    p_support_requested, nullif(btrim(coalesce(p_support_details, '')), ''),
    goal_update_id, actor, now()
  );

  if p_support_requested then
    insert into public.goal_support_requests (
      goal_id, goal_update_id, requested_by, manager_id, details
    ) values (
      p_goal_id, goal_update_id, actor, goal.manager_id, btrim(p_support_details)
    ) returning id into support_id;
  end if;

  update public.goals
  set reported_progress = stored_progress,
      health = case
        when p_support_requested then 'support_requested'::public.goal_health
        else p_progress_status
      end,
      last_meaningful_update_at = now(),
      checkin_due_at = focus.goal_month_end((current_date + interval '1 month')::date)::timestamptz,
      update_requested_at = null,
      version = version + 1
  where id = p_goal_id;

  perform focus.write_goal_audit(
    'goal_monthly_checkin_submitted', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'check_in_id', check_in_id,
      'period_start', period_start,
      'period_end', period_end,
      'progress_status', p_progress_status,
      'no_material_change', p_no_material_change,
      'measure_update_count', changed_measure_count,
      'attachment_count', attachment_count,
      'progress', exact_progress,
      'support_requested', p_support_requested
    )
  );

  if changed_measure_count > 0 then
    perform focus.write_goal_audit(
      'goal_measure_updated', actor, p_goal_id, goal.owner_id, goal.version + 1,
      jsonb_build_object('check_in_id', check_in_id, 'measure_update_count', changed_measure_count)
    );
  end if;

  if p_support_requested or p_progress_status in ('at_risk', 'off_track') then
    perform focus.notify_goal(
      goal.manager_id,
      'goal_manager_attention',
      'immediate',
      true,
      case when p_support_requested then 'Goal support requested' else 'Goal needs attention' end,
      goal.title || ': ' || case
        when p_support_requested then left(btrim(p_support_details), 220)
        when p_progress_status = 'off_track' then 'Employee reported Off track.'
        else 'Employee reported At risk.'
      end,
      p_goal_id,
      actor
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', 'goal_monthly_checkin_submitted',
    'check_in_id', check_in_id,
    'goal_update_id', goal_update_id,
    'support_request_id', support_id,
    'progress', exact_progress,
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'post_goal_monthly_checkin', result);
exception
  when unique_violation then
    return focus.error('already_submitted', 'This month already has a Goal check-in.');
end;
$$;

create or replace function public.save_goal_quarterly_checkin(
  p_goal_id uuid,
  p_expected_version integer,
  p_employee_summary text default null,
  p_manager_discussion text default null,
  p_agreed_actions text default null,
  p_progress_status public.goal_health default null,
  p_agree_and_continue boolean default false,
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
  existing record;
  has_existing boolean;
  replayed jsonb;
  check_in_id uuid;
  period_start date := date_trunc('quarter', current_date)::date;
  period_end date := focus.goal_quarter_end(current_date);
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to continue.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_goal_id::text || ':quarterly:' || extract(year from current_date)::text
      || ':' || extract(quarter from current_date)::text,
    50
  ));

  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if goal.status <> 'active' then
    return focus.error('invalid_state', 'Quarterly discussions belong to active Goals.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This Goal changed while you were recording the discussion.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;
  if p_progress_status is not null
     and p_progress_status not in ('on_track', 'at_risk', 'off_track') then
    return focus.error('validation_failed', 'Choose On track, At risk, or Off track.');
  end if;

  select * into existing
  from public.goal_check_ins ci
  where ci.goal_id = p_goal_id
    and ci.checkin_type = 'quarterly'
    and ci.period_year = extract(year from current_date)::integer
    and ci.period_quarter = extract(quarter from current_date)::integer
  for update;
  has_existing := found;

  if p_agree_and_continue then
    if not focus.can_complete_goal_quarterly(p_goal_id) then
      return focus.error('not_authorised', 'Only the authorised manager can agree the quarterly discussion.');
    end if;
    if not has_existing or existing.status <> 'submitted' then
      return focus.error('invalid_state', 'The employee summary must be submitted before agreement.');
    end if;
    if length(btrim(coalesce(p_manager_discussion, ''))) = 0
       or length(btrim(coalesce(p_agreed_actions, ''))) = 0 then
      return focus.error('validation_failed', 'Record the discussion and agreed actions.');
    end if;

    update public.goal_check_ins
    set status = 'agreed',
        manager_discussion = btrim(p_manager_discussion),
        agreed_actions = btrim(p_agreed_actions),
        progress_status = coalesce(p_progress_status, progress_status),
        manager_completed_by = actor,
        manager_completed_at = now(),
        version = version + 1
    where id = existing.id;
    check_in_id := existing.id;

    update public.goals
    set health = coalesce(p_progress_status, health),
        last_meaningful_update_at = now(),
        version = version + 1
    where id = p_goal_id;

    perform focus.write_goal_audit(
      'goal_quarterly_checkin_agreed', actor, p_goal_id, goal.owner_id, goal.version + 1,
      jsonb_build_object(
        'check_in_id', check_in_id,
        'period_start', period_start,
        'period_end', period_end,
        'status', coalesce(p_progress_status, existing.progress_status)
      )
    );
  else
    if not focus.can_prepare_goal_quarterly(p_goal_id) then
      return focus.error('not_authorised', 'Only the Goal owner can submit the employee summary.');
    end if;
    if length(btrim(coalesce(p_employee_summary, ''))) = 0 then
      return focus.error('validation_failed', 'Add a concise employee summary.');
    end if;
    if has_existing and existing.status in ('submitted', 'agreed', 'finalized') then
      return focus.error('already_submitted', 'This quarter already has an employee summary.');
    end if;

    check_in_id := coalesce(existing.id, extensions.gen_random_uuid());
    if has_existing then
      update public.goal_check_ins
      set status = 'submitted',
          employee_summary = btrim(p_employee_summary),
          progress_status = coalesce(p_progress_status, progress_status),
          submitted_by = actor,
          submitted_at = now(),
          version = version + 1
      where id = check_in_id;
    else
      insert into public.goal_check_ins (
        id, goal_id, goal_version_id, checkin_type, status,
        period_start, period_end, period_year, period_quarter,
        progress_status, employee_summary, submitted_by, submitted_at
      ) values (
        check_in_id, p_goal_id, goal.active_version_id, 'quarterly', 'submitted',
        period_start, period_end,
        extract(year from current_date)::smallint,
        extract(quarter from current_date)::smallint,
        p_progress_status, btrim(p_employee_summary), actor, now()
      );
    end if;

    update public.goals
    set health = coalesce(p_progress_status, health),
        last_meaningful_update_at = now(),
        version = version + 1
    where id = p_goal_id;

    perform focus.write_goal_audit(
      'goal_quarterly_checkin_submitted', actor, p_goal_id, goal.owner_id, goal.version + 1,
      jsonb_build_object(
        'check_in_id', check_in_id,
        'period_start', period_start,
        'period_end', period_end,
        'status', p_progress_status
      )
    );

    perform focus.notify_goal(
      goal.manager_id,
      'goal_quarterly_due',
      'immediate',
      true,
      'Quarterly Goal discussion ready',
      goal.title || ': review the employee summary and agree the next actions.',
      p_goal_id,
      actor
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', case
      when p_agree_and_continue then 'goal_quarterly_checkin_agreed'
      else 'goal_quarterly_checkin_submitted'
    end,
    'check_in_id', check_in_id,
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'save_goal_quarterly_checkin', result);
exception
  when unique_violation then
    return focus.error('already_submitted', 'This quarter already has a Goal discussion record.');
end;
$$;

create or replace function public.save_goal_year_end_result(
  p_goal_id uuid,
  p_expected_version integer,
  p_result_statement text,
  p_finalize boolean default false,
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
  existing record;
  has_existing boolean;
  replayed jsonb;
  check_in_id uuid;
  v_source_snapshot jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to continue.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_goal_id::text || ':year-end:' || extract(year from current_date)::text,
    50
  ));
  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if not focus.can_save_goal_year_end(p_goal_id) then
    return focus.error('not_authorised', 'You cannot record this Goal result.');
  end if;
  if p_finalize and not focus.can_agree_goal(p_goal_id) then
    return focus.error('not_authorised', 'Only the authorised manager can finalize the year-end Result.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This Goal changed while you were editing the Result.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;
  if length(btrim(coalesce(p_result_statement, ''))) = 0 then
    return focus.error('validation_failed', 'Record the year-end Result.');
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'goal_version_id', goal.active_version_id,
    'measure_progress', focus.goal_version_measure_progress(goal.active_version_id),
    'measures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'label', m.label,
        'type', m.measure_type,
        'target_numeric', m.target_numeric,
        'current_numeric', m.current_numeric,
        'target_text', m.target_text,
        'current_state', m.current_state,
        'progress', focus.goal_measure_progress(
          m.measure_type, m.target_numeric, m.current_numeric, m.current_state
        )
      ) order by m.position)
      from public.goal_success_measures m
      where m.goal_version_id = goal.active_version_id
    ), '[]'::jsonb),
    'monthly_check_in_count', (
      select count(*) from public.goal_check_ins ci
      where ci.goal_id = p_goal_id and ci.checkin_type = 'monthly'
    ),
    'quarterly_discussion_count', (
      select count(*) from public.goal_check_ins ci
      where ci.goal_id = p_goal_id and ci.checkin_type = 'quarterly' and ci.status = 'agreed'
    ),
    'milestones', jsonb_build_object(
      'total', (select count(*) from public.goal_milestones m where m.goal_version_id = goal.active_version_id),
      'completed', (select count(*) from public.goal_milestones m where m.goal_version_id = goal.active_version_id and m.progress_percent = 100)
    ),
    'evidence_count', (
      select count(*) from public.goal_attachments ga where ga.goal_id = p_goal_id
    ),
    'support_request_count', (
      select count(*) from public.goal_support_requests sr where sr.goal_id = p_goal_id
    )
  ) into v_source_snapshot;

  select * into existing
  from public.goal_check_ins ci
  where ci.goal_id = p_goal_id
    and ci.checkin_type = 'year_end'
    and ci.period_year = extract(year from current_date)::integer
  for update;
  has_existing := found;

  if has_existing and existing.status = 'finalized' then
    return focus.error('invalid_state', 'The year-end Result is already finalized.');
  end if;

  check_in_id := coalesce(existing.id, extensions.gen_random_uuid());
  if has_existing then
    update public.goal_check_ins
    set status = case when p_finalize then 'finalized' else 'draft' end,
        result_statement = btrim(p_result_statement),
        source_snapshot = v_source_snapshot,
        submitted_by = coalesce(submitted_by, actor),
        submitted_at = coalesce(submitted_at, now()),
        finalized_by = case when p_finalize then actor else null end,
        finalized_at = case when p_finalize then now() else null end,
        version = version + 1
    where id = check_in_id;
  else
    insert into public.goal_check_ins (
      id, goal_id, goal_version_id, checkin_type, status,
      period_start, period_end, period_year,
      result_statement, source_snapshot, submitted_by, submitted_at,
      finalized_by, finalized_at
    ) values (
      check_in_id, p_goal_id, goal.active_version_id, 'year_end',
      case when p_finalize then 'finalized' else 'draft' end,
      make_date(extract(year from current_date)::integer, 1, 1),
      make_date(extract(year from current_date)::integer, 12, 31),
      extract(year from current_date)::smallint,
      btrim(p_result_statement), v_source_snapshot, actor, now(),
      case when p_finalize then actor end,
      case when p_finalize then now() end
    );
  end if;

  update public.goals
  set last_meaningful_update_at = now(), version = version + 1
  where id = p_goal_id;

  perform focus.write_goal_audit(
    case
      when p_finalize then 'goal_year_end_result_finalized'::public.audit_event_type
      else 'goal_year_end_result_saved'::public.audit_event_type
    end,
    actor,
    p_goal_id,
    goal.owner_id,
    goal.version + 1,
    jsonb_build_object(
      'check_in_id', check_in_id,
      'period_year', extract(year from current_date)::integer,
      'finalized', p_finalize,
      'source_snapshot', v_source_snapshot
    )
  );

  if not p_finalize and actor = goal.owner_id then
    perform focus.notify_goal(
      goal.manager_id,
      'goal_year_end_due',
      'immediate',
      true,
      'Year-end Goal Result ready',
      goal.title || ': review and finalize the Result.',
      p_goal_id,
      actor
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', case when p_finalize then 'goal_year_end_result_finalized' else 'goal_year_end_result_saved' end,
    'check_in_id', check_in_id,
    'source_snapshot', v_source_snapshot,
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'save_goal_year_end_result', result);
exception
  when unique_violation then
    return focus.error('already_exists', 'This year already has a year-end Result record.');
end;
$$;

revoke all on function public.create_goal_with_measures(
  uuid, text, date, integer, jsonb, text, text, text, text, text, text, jsonb, boolean, text
) from public;
revoke all on function public.post_goal_monthly_checkin(
  uuid, integer, public.goal_health, text, boolean, boolean, text, jsonb, jsonb, text
) from public;
revoke all on function public.save_goal_quarterly_checkin(
  uuid, integer, text, text, text, public.goal_health, boolean, text
) from public;
revoke all on function public.save_goal_year_end_result(
  uuid, integer, text, boolean, text
) from public;

grant execute on function public.create_goal_with_measures(
  uuid, text, date, integer, jsonb, text, text, text, text, text, text, jsonb, boolean, text
) to authenticated;
grant execute on function public.post_goal_monthly_checkin(
  uuid, integer, public.goal_health, text, boolean, boolean, text, jsonb, jsonb, text
) to authenticated;
grant execute on function public.save_goal_quarterly_checkin(
  uuid, integer, text, text, text, public.goal_health, boolean, text
) to authenticated;
grant execute on function public.save_goal_year_end_result(
  uuid, integer, text, boolean, text
) to authenticated;

comment on function public.post_goal_monthly_checkin(
  uuid, integer, public.goal_health, text, boolean, boolean, text, jsonb, jsonb, text
) is 'Submits one owner-authored monthly Goal check-in and atomically records measures, evidence, exceptions, audit, and history.';
comment on function public.save_goal_quarterly_checkin(
  uuid, integer, text, text, text, public.goal_health, boolean, text
) is 'Records the employee summary and manager Agree & continue discussion for the current Goal quarter.';

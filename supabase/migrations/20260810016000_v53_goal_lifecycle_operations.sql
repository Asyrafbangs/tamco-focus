-- TAMCO Focus v53 — employee-level Goal sessions, governance and terminal outcomes.

-- ---------------------------------------------------------------------------
-- Period assignment and activation governance snapshots.
-- ---------------------------------------------------------------------------

create or replace function focus.assign_goal_period_and_governance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  period_id uuid;
  configured_mode text;
begin
  if new.performance_period_id is null then
    select id into period_id
    from public.performance_periods
    where new.target_date between starts_on and ends_on
    order by starts_on desc
    limit 1;
    if period_id is null then
      insert into public.performance_periods (name, starts_on, ends_on)
      values (
        extract(year from new.target_date)::integer || ' Performance Period',
        make_date(extract(year from new.target_date)::integer, 1, 1),
        make_date(extract(year from new.target_date)::integer, 12, 31)
      )
      on conflict (name) do update set name = excluded.name
      returning id into period_id;
    end if;
    new.performance_period_id := period_id;
  end if;

  if new.status = 'active' and new.governance_mode_at_activation is null then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status is distinct from 'active') then
      configured_mode := coalesce(
        focus.setting('goals.governance_mode') #>> '{}', 'department_only'
      );
      new.governance_mode_at_activation := configured_mode::public.goal_governance_mode;
    end if;
  end if;
  return new;
end;
$$;

create trigger goals_assign_period_and_governance
  before insert or update of status, target_date, performance_period_id on public.goals
  for each row execute function focus.assign_goal_period_and_governance();

create or replace function focus.ensure_goal_plan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.employee_goal_plans (employee_id, performance_period_id)
  values (new.owner_id, new.performance_period_id)
  on conflict (employee_id, performance_period_id) do nothing;
  return new;
end;
$$;

create trigger goals_ensure_employee_plan
  after insert on public.goals
  for each row execute function focus.ensure_goal_plan();

-- The period allocation includes completed agreements as historical formal
-- weight. A replacement may fill a cancelled gap but may not silently exceed
-- the period total.
create or replace function focus.enforce_goal_period_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare allocated integer;
begin
  if new.status <> 'active' then return new; end if;
  select coalesce(sum(weight_percent), 0)::integer into allocated
  from public.goals existing
  where existing.owner_id = new.owner_id
    and existing.performance_period_id = new.performance_period_id
    and existing.status in ('active', 'completed')
    and existing.id <> new.id;
  if allocated + new.weight_percent > 100 then
    raise check_violation using message = format(
      'Formal period allocation would be %s%%; it cannot exceed 100%%.',
      allocated + new.weight_percent
    );
  end if;
  return new;
end;
$$;

create trigger goals_enforce_period_allocation
  before insert or update of status, weight_percent, owner_id, performance_period_id
  on public.goals
  for each row execute function focus.enforce_goal_period_allocation();

-- In department-only governance, a manager/administrator confirms their own
-- Goals rather than the application inventing a superior. Ordinary employees
-- with a real manager still require that manager.
create or replace function focus.can_agree_goal(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
    from public.goals goal
    join public.user_profiles actor on actor.id = auth.uid()
    where goal.id = target_goal_id
      and (
        focus.is_admin()
        or goal.manager_id = auth.uid()
        or (focus.is_manager_or_admin() and focus.is_manager_of(goal.owner_id))
        or (
          coalesce(focus.setting('goals.governance_mode') #>> '{}', 'department_only')
            = 'department_only'
          and goal.owner_id = auth.uid()
          and actor.role in ('manager', 'administrator')
        )
      )
  );
$$;

-- Goal-sourced requests use the same insert trigger as Task Barriers, with the
-- correct subject and notification link.
create or replace function focus.default_barrier_recipient()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.action_required_from is null and new.task_id is not null then
    select profile.reporting_manager_id into new.action_required_from
    from public.tasks task
    join public.user_profiles profile on profile.id = task.primary_owner_id
    where task.id = new.task_id;
  elsif new.action_required_from is null and new.goal_id is not null then
    select coalesce(goal.manager_id, profile.reporting_manager_id)
    into new.action_required_from
    from public.goals goal
    join public.user_profiles profile on profile.id = goal.owner_id
    where goal.id = new.goal_id;
  end if;
  if new.impact = 'cannot_continue' and new.action_type = 'support' then
    new.action_type := 'decision';
  end if;
  return new;
end;
$$;

create or replace function focus.notify_barrier_action_required()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  task_title text;
  goal_title text;
  raiser_name text;
  action_label text;
begin
  if new.action_required_from is null or new.action_required_from = new.raised_by then
    return new;
  end if;
  select full_name into raiser_name from public.user_profiles where id = new.raised_by;
  action_label := case new.action_type
    when 'decision' then 'Decision needed'
    when 'approval' then 'Approval required'
    when 'escalation' then 'Escalation requested'
    when 'support' then 'Support requested'
    else 'Response requested' end;

  if new.task_id is not null then
    select title into task_title from public.tasks where id = new.task_id;
    perform focus.notify(
      new.action_required_from, 'barrier_raised', 'immediate', true, action_label,
      format('%s needs you on "%s": %s', coalesce(raiser_name, 'A colleague'),
        coalesce(task_title, 'a task'), new.support_needed),
      new.task_id, new.id, new.raised_by
    );
  else
    select title into goal_title from public.goals where id = new.goal_id;
    insert into public.notifications (
      recipient_id, kind, channel, requires_action, title, body,
      goal_id, barrier_id, actor_id, entity_type, entity_id
    ) values (
      new.action_required_from, 'goal_support_requested', 'immediate', true,
      action_label,
      format('%s needs you on Goal "%s": %s', coalesce(raiser_name, 'A colleague'),
        coalesce(goal_title, 'Goal'), new.support_needed),
      new.goal_id, new.id, new.raised_by, 'barrier', new.id
    );
  end if;
  return new;
end;
$$;

-- Remove the duplicate Goal notification from the first implementation; the
-- trigger above now owns the handoff for both subjects.
-- (The function body is replaced below by session writes, so no direct notify
-- call is used there.)

-- ---------------------------------------------------------------------------
-- Monthly employee session.
-- ---------------------------------------------------------------------------

create or replace function public.submit_goal_monthly_session(
  p_employee_id uuid,
  p_performance_period_id uuid,
  p_period_year integer,
  p_period_month integer,
  p_items jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  session_id uuid := extensions.gen_random_uuid();
  active_count integer;
  supplied_count integer;
  item record;
  goal public.goals;
  check_in_id uuid;
  goal_update_id uuid;
  recipient uuid;
  health_value public.goal_health;
  replayed jsonb;
  result jsonb;
  period_start date;
  period_end date;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in to submit the monthly Goal check-in.');
  end if;
  if actor <> p_employee_id then
    return focus.error('not_authorised', 'The employee submits their own monthly Goal session.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  if p_period_month not between 1 and 12 or p_period_year not between 2000 and 2200 then
    return focus.error('validation_failed', 'Choose a valid check-in month.');
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return focus.error('validation_failed', 'The Goal snapshots are malformed.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_employee_id::text || ':monthly-session:' || p_period_year || '-' || p_period_month, 53
  ));
  if not exists (
    select 1 from public.performance_periods period
    where period.id = p_performance_period_id
      and make_date(p_period_year, p_period_month, 1) between period.starts_on and period.ends_on
  ) then
    return focus.error('validation_failed', 'That month is outside the selected performance period.');
  end if;
  if exists (
    select 1 from public.goal_checkin_sessions session
    where session.employee_id = p_employee_id
      and session.performance_period_id = p_performance_period_id
      and session.session_kind = 'monthly'
      and session.period_year = p_period_year
      and session.period_month = p_period_month
  ) then
    return focus.error('already_submitted', 'This employee month already has a submitted check-in.');
  end if;

  select count(*) into active_count
  from public.goals
  where owner_id = p_employee_id and performance_period_id = p_performance_period_id
    and status = 'active';
  select count(*) into supplied_count from jsonb_array_elements(coalesce(p_items, '[]'::jsonb));
  if active_count = 0 then
    return focus.error('invalid_state', 'There are no Active Goals in this performance period.');
  end if;
  if supplied_count <> active_count
     or exists (
       select 1 from public.goals active_goal
       where active_goal.owner_id = p_employee_id
         and active_goal.performance_period_id = p_performance_period_id
         and active_goal.status = 'active'
         and not exists (
           select 1 from jsonb_to_recordset(p_items) as supplied(goal_id uuid)
           where supplied.goal_id = active_goal.id
         )
     )
     or exists (
       select 1
       from jsonb_to_recordset(p_items) as supplied(goal_id uuid)
       left join public.goals active_goal on active_goal.id = supplied.goal_id
       where active_goal.id is null
          or active_goal.owner_id <> p_employee_id
          or active_goal.performance_period_id <> p_performance_period_id
          or active_goal.status <> 'active'
     )
     or exists (
       select 1 from jsonb_to_recordset(p_items) as supplied(goal_id uuid)
       group by supplied.goal_id having count(*) > 1
     ) then
    return focus.error(
      'validation_failed',
      'Submit one snapshot for every Active Goal in this performance period.'
    );
  end if;

  -- Validate the complete employee session before writing its header. A
  -- returned domain error must never leave a partial session behind.
  if exists (
    select 1 from jsonb_to_recordset(p_items) as supplied(
      goal_id uuid, health text, update_text text,
      support_requested boolean, support_details text, action_required_from uuid
    )
    where supplied.health not in ('on_track', 'at_risk', 'off_track', 'no_material_change')
       or (
         supplied.health in ('at_risk', 'off_track')
         and length(btrim(coalesce(supplied.update_text, ''))) = 0
       )
       or (
         coalesce(supplied.support_requested, false)
         and length(btrim(coalesce(supplied.support_details, ''))) = 0
       )
  ) then
    return focus.error(
      'validation_failed',
      'Choose valid health, explain risk, and describe every support request.'
    );
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as supplied(
      goal_id uuid, support_requested boolean, action_required_from uuid
    )
    join public.goals supplied_goal on supplied_goal.id = supplied.goal_id
    left join public.user_profiles owner_profile on owner_profile.id = supplied_goal.owner_id
    where coalesce(supplied.support_requested, false)
      and coalesce(
        supplied.action_required_from,
        supplied_goal.manager_id,
        owner_profile.reporting_manager_id
      ) is not distinct from actor
       or (
         coalesce(supplied.support_requested, false)
         and coalesce(
           supplied.action_required_from,
           supplied_goal.manager_id,
           owner_profile.reporting_manager_id
         ) is null
       )
  ) then
    return focus.error(
      'validation_failed',
      'Choose another person for requested support. The system does not invent a superior.'
    );
  end if;

  period_start := make_date(p_period_year, p_period_month, 1);
  period_end := focus.goal_month_end(period_start);
  insert into public.goal_checkin_sessions (
    id, employee_id, performance_period_id, session_kind, status,
    period_year, period_month, submitted_by, submitted_at
  ) values (
    session_id, p_employee_id, p_performance_period_id, 'monthly', 'submitted',
    p_period_year, p_period_month, actor, now()
  );

  for item in
    select * from jsonb_to_recordset(p_items) as x(
      goal_id uuid,
      health text,
      update_text text,
      support_requested boolean,
      support_details text,
      action_required_from uuid
    )
  loop
    select * into goal from public.goals where id = item.goal_id for update;
    if item.health not in ('on_track', 'at_risk', 'off_track', 'no_material_change') then
      return focus.error('validation_failed', 'Choose a valid health state for every Goal.');
    end if;
    if item.health in ('at_risk', 'off_track')
       and length(btrim(coalesce(item.update_text, ''))) = 0 then
      return focus.error('validation_failed', 'Explain every Goal marked At risk or Off track.');
    end if;
    if coalesce(item.support_requested, false)
       and length(btrim(coalesce(item.support_details, ''))) = 0 then
      return focus.error('validation_failed', 'Describe the support or decision needed.');
    end if;

    recipient := coalesce(
      item.action_required_from,
      goal.manager_id,
      (select reporting_manager_id from public.user_profiles where id = goal.owner_id)
    );
    if coalesce(item.support_requested, false)
       and (recipient is null or recipient = actor) then
      return focus.error(
        'validation_failed',
        'Choose another person for requested support. The system does not invent a superior.'
      );
    end if;

    health_value := case when item.health = 'no_material_change' then goal.health
      else item.health::public.goal_health end;
    goal_update_id := null;
    if length(btrim(coalesce(item.update_text, ''))) > 0 then
      insert into public.goal_updates (
        goal_id, goal_version_id, author_id, kind,
        previous_reported_progress, new_reported_progress,
        what_changed, support_requested, support_details
      ) values (
        goal.id, goal.active_version_id, actor, 'overall',
        goal.reported_progress, goal.reported_progress, btrim(item.update_text),
        coalesce(item.support_requested, false),
        nullif(btrim(coalesce(item.support_details, '')), '')
      ) returning id into goal_update_id;
    end if;

    insert into public.goal_check_ins (
      goal_id, goal_version_id, checkin_type, status,
      period_start, period_end, period_year, period_month,
      progress_status, no_material_change, employee_summary,
      support_requested, support_details, goal_update_id,
      submitted_by, submitted_at, session_id
    ) values (
      goal.id, goal.active_version_id, 'monthly', 'submitted',
      period_start, period_end, p_period_year, p_period_month,
      health_value, item.health = 'no_material_change',
      nullif(btrim(coalesce(item.update_text, '')), ''),
      coalesce(item.support_requested, false),
      nullif(btrim(coalesce(item.support_details, '')), ''), goal_update_id,
      actor, now(), session_id
    ) returning id into check_in_id;

    insert into public.goal_checkin_session_items (
      session_id, goal_id, goal_version_id, health, update_text,
      support_requested, support_details, legacy_check_in_id, source_snapshot
    ) values (
      session_id, goal.id, goal.active_version_id, item.health,
      nullif(btrim(coalesce(item.update_text, '')), ''),
      coalesce(item.support_requested, false),
      nullif(btrim(coalesce(item.support_details, '')), ''), check_in_id,
      jsonb_build_object(
        'title', goal.title,
        'health_before', goal.health,
        'reported_progress', goal.reported_progress,
        'goal_version_id', goal.active_version_id
      )
    );

    if coalesce(item.support_requested, false) then
      insert into public.barriers (
        task_id, goal_id, description, support_needed, impact, action_type,
        action_required_from, raised_by
      ) values (
        null, goal.id,
        coalesce(nullif(btrim(item.update_text), ''), 'Goal support requested'),
        btrim(item.support_details), 'management_decision_required', 'support',
        recipient, actor
      );
      health_value := 'support_requested';
    elsif item.health in ('at_risk', 'off_track') and goal.manager_id is not null then
      perform focus.notify_goal(
        goal.manager_id, 'goal_manager_attention', 'digest', false,
        'Goal health update', goal.title || ' was reported ' || replace(item.health, '_', ' ') || '.',
        goal.id, actor
      );
    end if;

    update public.goals
    set health = health_value,
        update_requested_at = null,
        last_meaningful_update_at = now(),
        version = version + 1
    where id = goal.id;

    perform focus.write_goal_audit(
      'goal_monthly_checkin_submitted', actor, goal.id, goal.owner_id, goal.version + 1,
      jsonb_build_object(
        'session_id', session_id, 'check_in_id', check_in_id,
        'period_year', p_period_year, 'period_month', p_period_month,
        'health', item.health, 'support_requested', coalesce(item.support_requested, false)
      )
    );
  end loop;

  perform focus.write_audit(
    p_event_type := 'goal_monthly_session_submitted',
    p_actor_id := actor,
    p_subject_user_id := p_employee_id,
    p_detail := jsonb_build_object(
      'session_id', session_id, 'performance_period_id', p_performance_period_id,
      'period_year', p_period_year, 'period_month', p_period_month,
      'goal_count', active_count
    )
  );

  result := jsonb_build_object(
    'ok', true, 'code', 'goal_monthly_session_submitted',
    'session_id', session_id, 'goal_count', active_count
  );
  return focus.remember_operation(actor, p_idempotency_key, 'submit_goal_monthly_session', result);
exception when unique_violation then
  return focus.error('already_submitted', 'This employee month already has a submitted check-in.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Quarterly employee session.
-- ---------------------------------------------------------------------------

create or replace function public.complete_goal_quarterly_session(
  p_employee_id uuid,
  p_performance_period_id uuid,
  p_period_year integer,
  p_period_quarter integer,
  p_items jsonb,
  p_summary text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  session_id uuid := extensions.gen_random_uuid();
  active_count integer;
  supplied_count integer;
  item record;
  goal public.goals;
  check_in_id uuid;
  replayed jsonb;
  result jsonb;
  period_start date;
  period_end date;
  self_review boolean;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in to complete the quarterly Goal review.');
  end if;
  self_review := actor = p_employee_id and exists (
    select 1 from public.user_profiles where id = actor and role in ('manager', 'administrator')
  );
  if not (
    focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(p_employee_id))
    or self_review
  ) then
    return focus.error('not_authorised', 'Only the employee''s manager can complete this review.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  if p_period_quarter not between 1 and 4 or p_period_year not between 2000 and 2200 then
    return focus.error('validation_failed', 'Choose a valid review quarter.');
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return focus.error('validation_failed', 'The Goal review items are malformed.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_employee_id::text || ':quarterly-session:' || p_period_year || '-' || p_period_quarter, 53
  ));

  select count(*) into active_count from public.goals
  where owner_id = p_employee_id and performance_period_id = p_performance_period_id
    and status = 'active';
  select count(*) into supplied_count from jsonb_array_elements(p_items);
  if active_count = 0 or supplied_count <> active_count
     or exists (
       select 1 from public.goals active_goal
       where active_goal.owner_id = p_employee_id
         and active_goal.performance_period_id = p_performance_period_id
         and active_goal.status = 'active'
         and not exists (
           select 1 from jsonb_to_recordset(p_items) as supplied(goal_id uuid)
           where supplied.goal_id = active_goal.id
         )
     )
     or exists (
       select 1 from jsonb_to_recordset(p_items) as supplied(goal_id uuid)
       group by supplied.goal_id having count(*) > 1
     ) then
    return focus.error('validation_failed', 'Review every Active Goal exactly once.');
  end if;
  if exists (
    select 1 from public.goal_checkin_sessions session
    where session.employee_id = p_employee_id
      and session.performance_period_id = p_performance_period_id
      and session.session_kind = 'quarterly'
      and session.period_year = p_period_year
      and session.period_quarter = p_period_quarter
  ) then
    return focus.error('already_submitted', 'This employee quarter is already complete.');
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as supplied(goal_id uuid, health text)
    where supplied.health not in ('on_track', 'at_risk', 'off_track', 'no_material_change')
  ) then
    return focus.error('validation_failed', 'Choose a valid current health for every Goal.');
  end if;

  period_start := make_date(p_period_year, ((p_period_quarter - 1) * 3) + 1, 1);
  period_end := focus.goal_quarter_end(period_start);
  insert into public.goal_checkin_sessions (
    id, employee_id, performance_period_id, session_kind, status,
    period_year, period_quarter, submitted_by, submitted_at,
    reviewed_by, reviewed_at, summary
  ) values (
    session_id, p_employee_id, p_performance_period_id, 'quarterly', 'completed',
    p_period_year, p_period_quarter, actor, now(), actor, now(),
    nullif(btrim(coalesce(p_summary, '')), '')
  );

  for item in
    select * from jsonb_to_recordset(p_items) as x(
      goal_id uuid, health text, attention_text text, support_adjustment text
    )
  loop
    select * into goal from public.goals where id = item.goal_id for update;
    if goal.owner_id <> p_employee_id or goal.performance_period_id <> p_performance_period_id
       or goal.status <> 'active' then
      return focus.error('validation_failed', 'A review item is not an Active Goal in this plan.');
    end if;
    if item.health not in ('on_track', 'at_risk', 'off_track', 'no_material_change') then
      return focus.error('validation_failed', 'Choose a valid current health for every Goal.');
    end if;

    insert into public.goal_check_ins (
      goal_id, goal_version_id, checkin_type, status,
      period_start, period_end, period_year, period_quarter,
      progress_status, employee_summary, manager_discussion, agreed_actions,
      submitted_by, submitted_at, manager_completed_by, manager_completed_at,
      session_id
    ) values (
      goal.id, goal.active_version_id, 'quarterly', 'agreed',
      period_start, period_end, p_period_year, p_period_quarter,
      case when item.health = 'no_material_change' then goal.health
        else item.health::public.goal_health end,
      nullif(btrim(coalesce(item.attention_text, '')), ''),
      nullif(btrim(coalesce(item.attention_text, '')), ''),
      nullif(btrim(coalesce(item.support_adjustment, '')), ''),
      actor, now(), actor, now(), session_id
    ) returning id into check_in_id;

    insert into public.goal_checkin_session_items (
      session_id, goal_id, goal_version_id, health, attention_text,
      support_details, legacy_check_in_id, source_snapshot
    ) values (
      session_id, goal.id, goal.active_version_id, item.health,
      nullif(btrim(coalesce(item.attention_text, '')), ''),
      nullif(btrim(coalesce(item.support_adjustment, '')), ''), check_in_id,
      jsonb_build_object(
        'title', goal.title, 'health_before', goal.health,
        'last_meaningful_update_at', goal.last_meaningful_update_at,
        'self_review', self_review
      )
    );

    update public.goals
    set health = case when item.health = 'no_material_change' then health
          else item.health::public.goal_health end,
        last_meaningful_update_at = now(), version = version + 1
    where id = goal.id;

    perform focus.write_goal_audit(
      'goal_quarterly_checkin_agreed', actor, goal.id, goal.owner_id, goal.version + 1,
      jsonb_build_object(
        'session_id', session_id, 'check_in_id', check_in_id,
        'period_year', p_period_year, 'period_quarter', p_period_quarter,
        'health', item.health, 'self_review', self_review
      )
    );
  end loop;

  perform focus.write_audit(
    p_event_type := 'goal_quarterly_session_completed',
    p_actor_id := actor,
    p_subject_user_id := p_employee_id,
    p_detail := jsonb_build_object(
      'session_id', session_id, 'performance_period_id', p_performance_period_id,
      'period_year', p_period_year, 'period_quarter', p_period_quarter,
      'goal_count', active_count, 'self_review', self_review
    )
  );
  result := jsonb_build_object(
    'ok', true, 'code', 'goal_quarterly_session_completed',
    'session_id', session_id, 'goal_count', active_count, 'self_review', self_review
  );
  return focus.remember_operation(actor, p_idempotency_key, 'complete_goal_quarterly_session', result);
exception when unique_violation then
  return focus.error('already_submitted', 'This employee quarter is already complete.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Plan finalisation, Goal completion and cancellation.
-- ---------------------------------------------------------------------------

create or replace function public.finalize_goal_plan(
  p_employee_id uuid,
  p_performance_period_id uuid,
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
  plan public.employee_goal_plans;
  allocated integer;
  self_authority boolean;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in to finalize the Goal plan.');
  end if;
  self_authority := actor = p_employee_id and exists (
    select 1 from public.user_profiles where id = actor and role in ('manager', 'administrator')
  );
  if not (
    focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(p_employee_id))
    or self_authority
  ) then
    return focus.error('not_authorised', 'Only the authorised manager can finalize this plan.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into plan from public.employee_goal_plans
  where employee_id = p_employee_id and performance_period_id = p_performance_period_id
  for update;
  if not found then return focus.error('not_found', 'This Goal plan does not exist.'); end if;
  if plan.status = 'finalized' then
    return jsonb_build_object('ok', true, 'code', 'goal_plan_already_finalized');
  end if;
  if plan.version <> p_expected_version then
    return focus.error('version_conflict', 'This Goal plan changed. Review it and try again.');
  end if;
  select coalesce(sum(weight_percent), 0)::integer into allocated
  from public.goals
  where owner_id = p_employee_id and performance_period_id = p_performance_period_id
    and status in ('active', 'completed');
  if allocated <> 100 then
    return focus.error(
      'invalid_target',
      format('Formal Active Goal weight is %s%%. It must equal 100%% before finalisation.', allocated),
      jsonb_build_object('allocated', allocated, 'remaining', greatest(0, 100 - allocated))
    );
  end if;
  update public.employee_goal_plans
  set status = 'finalized', finalized_by = actor, finalized_at = now(), version = version + 1
  where id = plan.id;
  perform focus.write_audit(
    p_event_type := 'goal_plan_finalized', p_actor_id := actor,
    p_subject_user_id := p_employee_id,
    p_detail := jsonb_build_object(
      'goal_plan_id', plan.id, 'performance_period_id', p_performance_period_id,
      'formal_weight', allocated, 'self_authority', self_authority
    )
  );
  result := jsonb_build_object(
    'ok', true, 'code', 'goal_plan_finalized', 'goal_plan_id', plan.id,
    'formal_weight', allocated, 'version', plan.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'finalize_goal_plan', result);
end;
$$;

create or replace function focus.deactivate_goal_requests(target_goal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare request_count integer; notification_count integer; queue_count integer;
begin
  update public.barriers
  set source_active = false, source_inactive_at = coalesce(source_inactive_at, now()),
      action_pending = false, version = version + 1
  where goal_id = target_goal_id and source_active;
  get diagnostics request_count = row_count;
  update public.notifications
  set requires_action = false
  where requires_action and (
    goal_id = target_goal_id
    or barrier_id in (select id from public.barriers where goal_id = target_goal_id)
  );
  get diagnostics notification_count = row_count;
  update public.meeting_queue_items item
  set source_active = false, source_inactive_at = coalesce(source_inactive_at, now()),
      status = case when item.status in ('open', 'queued')
        then 'removed'::public.meeting_item_status else item.status end
  where source_active and barrier_id in (
    select id from public.barriers where goal_id = target_goal_id
  );
  get diagnostics queue_count = row_count;
  return jsonb_build_object(
    'requests_deactivated', request_count,
    'notifications_deactivated', notification_count,
    'queue_items_deactivated', queue_count
  );
end;
$$;

create or replace function public.complete_goal(
  p_goal_id uuid,
  p_expected_version integer,
  p_final_result_summary text,
  p_measure_results jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal public.goals;
  measure record;
  supplied_count integer;
  required_count integer;
  cleanup jsonb;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in to complete this Goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if not focus.can_agree_goal(goal.id) then
    return focus.error('not_authorised', 'Only the authorised Goal reviewer can complete it.');
  end if;
  if goal.status <> 'active' then
    return focus.error('invalid_state', 'Only an Active Goal can be completed.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error('version_conflict', 'This Goal changed. Review it and try again.');
  end if;
  if length(btrim(coalesce(p_final_result_summary, ''))) = 0 then
    return focus.error('validation_failed', 'Record the final result summary.');
  end if;
  if jsonb_typeof(coalesce(p_measure_results, '[]'::jsonb)) <> 'array' then
    return focus.error('validation_failed', 'The success-measure results are malformed.');
  end if;
  select count(*) into required_count from public.goal_success_measures
  where goal_version_id = goal.active_version_id;
  select count(*) into supplied_count from jsonb_array_elements(p_measure_results);
  if required_count = 0 or supplied_count <> required_count
     or exists (
       select 1 from public.goal_success_measures required
       where required.goal_version_id = goal.active_version_id
         and not exists (
           select 1 from jsonb_to_recordset(p_measure_results) supplied(
             measure_id uuid, actual_result text
           ) where supplied.measure_id = required.id
             and length(btrim(coalesce(supplied.actual_result, ''))) > 0
         )
     )
     or exists (
       select 1 from jsonb_to_recordset(p_measure_results) supplied(
         measure_id uuid, actual_result text
       ) group by supplied.measure_id having count(*) > 1
     ) then
    return focus.error('validation_failed', 'Record an actual result for every success measure.');
  end if;

  for measure in
    select * from jsonb_to_recordset(p_measure_results) supplied(
      measure_id uuid, actual_result text
    )
  loop
    update public.goal_success_measures
    set actual_result = btrim(measure.actual_result),
        actual_recorded_by = actor, actual_recorded_at = now()
    where id = measure.measure_id and goal_version_id = goal.active_version_id;
    if not found then
      return focus.error('validation_failed', 'A success measure is not part of the Active Goal.');
    end if;
  end loop;

  update public.goals
  set status = 'completed', health = 'completed', completed_at = now(),
      final_result_summary = btrim(p_final_result_summary),
      checkin_due_at = null, update_requested_at = null,
      last_meaningful_update_at = now(), version = version + 1
  where id = goal.id;
  cleanup := focus.deactivate_goal_requests(goal.id);
  perform focus.write_goal_audit(
    'goal_completed', actor, goal.id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'final_result_summary', btrim(p_final_result_summary),
      'measure_result_count', required_count,
      'request_cleanup', cleanup
    )
  );
  result := jsonb_build_object(
    'ok', true, 'code', 'goal_completed', 'version', goal.version + 1,
    'request_cleanup', cleanup
  );
  return focus.remember_operation(actor, p_idempotency_key, 'complete_goal', result);
end;
$$;

create or replace function public.cancel_goal(
  p_goal_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal public.goals;
  cleanup jsonb;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in to cancel this Goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if not (
    goal.owner_id = actor
    or focus.is_admin()
    or goal.manager_id = actor
    or (focus.is_manager_or_admin() and focus.is_manager_of(goal.owner_id))
  ) then
    return focus.error('not_authorised', 'Only the owner or authorised manager can cancel this Goal.');
  end if;
  if goal.status in ('completed', 'closed', 'cancelled') then
    return focus.error('invalid_state', 'This Goal is already terminal.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error('version_conflict', 'This Goal changed. Review it and try again.');
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return focus.error('validation_failed', 'Record why this Goal no longer applies.');
  end if;
  update public.goals
  set status = 'cancelled', cancelled_at = now(), cancelled_by = actor,
      cancellation_reason = btrim(p_reason), checkin_due_at = null,
      update_requested_at = null, last_meaningful_update_at = now(),
      version = version + 1
  where id = goal.id;
  update public.employee_goal_plans
  set status = 'reallocation_required', version = version + 1
  where employee_id = goal.owner_id
    and performance_period_id = goal.performance_period_id;
  cleanup := focus.deactivate_goal_requests(goal.id);
  perform focus.write_goal_audit(
    'goal_cancelled', actor, goal.id, goal.owner_id, goal.version + 1,
    jsonb_build_object('reason', btrim(p_reason), 'request_cleanup', cleanup)
  );
  result := jsonb_build_object(
    'ok', true, 'code', 'goal_cancelled', 'version', goal.version + 1,
    'allocation_recalculated', true, 'request_cleanup', cleanup
  );
  return focus.remember_operation(actor, p_idempotency_key, 'cancel_goal', result);
end;
$$;

-- Compatibility only. New clients expose Complete and Cancel separately.
create or replace function public.close_goal(
  p_goal_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.cancel_goal(p_goal_id, p_expected_version, p_reason, p_idempotency_key);
$$;

-- ---------------------------------------------------------------------------
-- Structural revisions require a reason. The original procedure remains the
-- internal implementation for candidate versions but is no longer directly
-- executable by authenticated clients.
-- ---------------------------------------------------------------------------

create or replace function public.save_goal_candidate_version(
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
declare actor uuid := auth.uid(); goal_status public.goal_status; replayed jsonb; result jsonb;
begin
  if actor is null then return focus.error('not_authorised', 'Sign in to edit this Goal.'); end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select status into goal_status from public.goals where id = p_goal_id;
  if goal_status is null then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if goal_status = 'active' then
    return focus.error('reason_required', 'Use Revise Goal and record why the agreement changes.');
  end if;
  result := public.save_lean_goal_version(
    p_goal_id, p_expected_version, p_expected_result, p_target_date, p_weight_percent,
    p_measures, p_agreed_approach, p_support_needed, p_dependencies, p_baseline,
    p_purpose, p_milestones, p_submission_mode, null
  );
  if coalesce((result ->> 'ok')::boolean, false) then
    return focus.remember_operation(actor, p_idempotency_key, 'save_goal_candidate_version', result);
  end if;
  return result;
end;
$$;

create or replace function public.revise_lean_goal_version(
  p_goal_id uuid,
  p_expected_version integer,
  p_expected_result text,
  p_target_date date,
  p_weight_percent integer,
  p_measures jsonb,
  p_revision_reason text,
  p_agreed_approach text default null,
  p_support_needed text default null,
  p_dependencies text default null,
  p_baseline text default null,
  p_purpose text default null,
  p_milestones jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal public.goals;
  before_snapshot jsonb;
  after_snapshot jsonb;
  replayed jsonb;
  result jsonb;
begin
  if actor is null then return focus.error('not_authorised', 'Sign in to revise this Goal.'); end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if goal.status <> 'active' then
    return focus.error('invalid_state', 'Only an Active agreement uses Revise Goal.');
  end if;
  if length(btrim(coalesce(p_revision_reason, ''))) = 0 then
    return focus.error('reason_required', 'Record why the Active Goal agreement is changing.');
  end if;
  select jsonb_build_object(
    'goal_version_id', version.id, 'expected_result', version.expected_result,
    'target_date', version.target_date, 'weight_percent', version.weight_percent,
    'measures', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', measure.id, 'description', measure.description,
      'optional_target_date', measure.optional_target_date
    ) order by measure.position), '[]'::jsonb)
      from public.goal_success_measures measure where measure.goal_version_id = version.id)
  ) into before_snapshot
  from public.goal_versions version where version.id = goal.active_version_id;
  after_snapshot := jsonb_build_object(
    'expected_result', btrim(p_expected_result), 'target_date', p_target_date,
    'weight_percent', p_weight_percent, 'measures', p_measures,
    'milestones', p_milestones
  );
  result := public.save_lean_goal_version(
    p_goal_id, p_expected_version, p_expected_result, p_target_date, p_weight_percent,
    p_measures, p_agreed_approach, p_support_needed, p_dependencies, p_baseline,
    p_purpose, p_milestones, 'discussion', null
  );
  if not coalesce((result ->> 'ok')::boolean, false) then return result; end if;
  perform focus.write_goal_audit(
    'goal_version_proposed', actor, goal.id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'revision_record', true, 'reason', btrim(p_revision_reason),
      'before', before_snapshot, 'after', after_snapshot,
      'pending_version_id', result ->> 'pending_version_id'
    )
  );
  result := result || jsonb_build_object('revision_reason_recorded', true);
  return focus.remember_operation(actor, p_idempotency_key, 'revise_lean_goal_version', result);
end;
$$;

-- Milestone support now enters the same Goal-sourced Barrier/request engine as
-- employee sessions. The milestone update remains the immutable work record;
-- the request remains a distinct response/resolution lifecycle.
create or replace function public.post_goal_milestone_checkin(
  p_goal_id uuid,
  p_milestone_id uuid,
  p_expected_version integer,
  p_progress integer,
  p_comment text,
  p_what_changed text,
  p_next_step text default null,
  p_support_requested boolean default false,
  p_support_details text default null,
  p_mark_complete boolean default false,
  p_attachments jsonb default '[]'::jsonb,
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
  milestone_result jsonb;
  support_result jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to update a milestone.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  milestone_result := public.post_goal_milestone_update(
    p_goal_id, p_milestone_id, p_expected_version, p_progress, p_comment,
    p_mark_complete, p_attachments, p_idempotency_key || ':milestone'
  );
  if not coalesce((milestone_result ->> 'ok')::boolean, false) then
    return milestone_result;
  end if;

  if p_support_requested then
    support_result := public.raise_goal_support_request(
      p_goal_id,
      coalesce(nullif(btrim(coalesce(p_what_changed, '')), ''), 'Milestone support requested'),
      p_support_details,
      null,
      p_idempotency_key || ':support'
    );
    if not coalesce((support_result ->> 'ok')::boolean, false) then
      raise exception 'Milestone support request failed: %',
        coalesce(support_result ->> 'message', 'unknown error');
    end if;
  end if;

  result := milestone_result || jsonb_build_object(
    'support_requested', p_support_requested,
    'support_request_id', support_result ->> 'request_id',
    'version', coalesce(support_result -> 'version', milestone_result -> 'version'),
    'next_step', nullif(btrim(coalesce(p_next_step, '')), '')
  );
  return focus.remember_operation(actor, p_idempotency_key, 'post_goal_milestone_checkin', result);
end;
$$;

revoke all on function public.submit_goal_monthly_session(uuid, uuid, integer, integer, jsonb, text) from public, anon;
revoke all on function public.complete_goal_quarterly_session(uuid, uuid, integer, integer, jsonb, text, text) from public, anon;
revoke all on function public.finalize_goal_plan(uuid, uuid, integer, text) from public, anon;
revoke all on function public.complete_goal(uuid, integer, text, jsonb, text) from public, anon;
revoke all on function public.cancel_goal(uuid, integer, text, text) from public, anon;
revoke all on function public.close_goal(uuid, integer, text, text) from public, anon;
revoke all on function public.save_goal_candidate_version(
  uuid, integer, text, date, integer, jsonb, text, text, text, text, text, jsonb, text, text
) from public, anon;
revoke all on function public.revise_lean_goal_version(
  uuid, integer, text, date, integer, jsonb, text, text, text, text, text, text, jsonb, text
) from public, anon;
revoke execute on function public.save_lean_goal_version(
  uuid, integer, text, date, integer, jsonb, text, text, text, text, text, jsonb, text, text
) from authenticated;

grant execute on function public.submit_goal_monthly_session(uuid, uuid, integer, integer, jsonb, text) to authenticated;
grant execute on function public.complete_goal_quarterly_session(uuid, uuid, integer, integer, jsonb, text, text) to authenticated;
grant execute on function public.finalize_goal_plan(uuid, uuid, integer, text) to authenticated;
grant execute on function public.complete_goal(uuid, integer, text, jsonb, text) to authenticated;
grant execute on function public.cancel_goal(uuid, integer, text, text) to authenticated;
grant execute on function public.close_goal(uuid, integer, text, text) to authenticated;
grant execute on function public.save_goal_candidate_version(
  uuid, integer, text, date, integer, jsonb, text, text, text, text, text, jsonb, text, text
) to authenticated;
grant execute on function public.revise_lean_goal_version(
  uuid, integer, text, date, integer, jsonb, text, text, text, text, text, text, jsonb, text
) to authenticated;

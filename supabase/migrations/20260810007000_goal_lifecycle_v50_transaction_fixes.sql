-- v50 transaction corrections found by the role-authenticated integration run.

alter table public.goal_success_measure_updates
  drop constraint goal_success_measure_updates_check_in_id_fkey,
  add constraint goal_success_measure_updates_check_in_id_fkey
    foreign key (check_in_id) references public.goal_check_ins (id) on delete cascade
    deferrable initially deferred;

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
  v_status public.goal_checkin_status;
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

  v_status := case
    when p_finalize then 'finalized'::public.goal_checkin_status
    else 'draft'::public.goal_checkin_status
  end;

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
    set status = v_status,
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
      check_in_id, p_goal_id, goal.active_version_id, 'year_end', v_status,
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

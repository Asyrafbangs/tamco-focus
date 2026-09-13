-- ---------------------------------------------------------------------------
-- v174 — Importing the organisation, checked before anything is written
--
-- Moving one person at a time is right for keeping an organisation tidy and
-- wrong for setting one up or reorganising it: six hundred people are six
-- hundred confirmations. This takes a file of where people sit — department,
-- job title, reporting manager, dotted-line manager — and answers in two steps.
--
-- First it says what the file would do, row by row, and what it cannot do: an
-- employee ID nobody holds, a department code that does not exist, a manager
-- who is not here, lines that would loop. Nothing is written. Then it applies
-- the rows that passed, in one transaction, into the same dated history and
-- audit every other move goes through.
--
-- One planner serves both steps, so the check and the apply cannot disagree
-- about a rule. The apply plans again against the organisation as it is at that
-- moment, and refuses if the answer is no longer the one the administrator saw.
--
-- It does not create accounts. An account is who somebody is and how they sign
-- in, and that belongs to the Directory; this places people who already exist.
-- A row for somebody who is not in the Directory is reported, not guessed at.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The planner
--
-- Reads the rows into a transaction-scoped table and decides, for each, one of
-- three things: it would change somebody, it matches what is already recorded,
-- or it has a problem — and only the first problem is named, because fixing it
-- is the next thing to do and a list of five is a list nobody reads.
--
-- A column the file does not have is left alone for everybody. A column it has
-- with an empty cell means "none": no job title, nobody above them, no dotted
-- line. That is what an empty choice means on every other form, and a file
-- exported from this screen round-trips to "nothing to change".
-- ---------------------------------------------------------------------------

create or replace function focus.plan_organisation_import(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cycle_ids uuid[];
  deep_ids uuid[];
begin
  drop table if exists pg_temp.organisation_import_plan;
  create temp table organisation_import_plan (
    line integer not null,
    employee_id text,
    file_name text,
    file_email text,
    has_department boolean not null,
    department_code text,
    has_job_title boolean not null,
    job_title text,
    has_manager boolean not null,
    manager_employee_id text,
    has_functional boolean not null,
    functional_employee_id text,
    subject_id uuid,
    subject_name text,
    subject_email text,
    subject_status public.account_status,
    current_department_id uuid,
    current_job_title text,
    current_manager_id uuid,
    current_functional_id uuid,
    department_id uuid,
    department_status public.department_status,
    manager_id uuid,
    manager_status public.account_status,
    functional_id uuid,
    functional_status public.account_status,
    next_department_id uuid,
    next_job_title text,
    next_manager_id uuid,
    next_functional_id uuid,
    dotted_line_ended boolean not null default false,
    problem text,
    message text,
    changes boolean not null default false
  ) on commit drop;

  insert into organisation_import_plan (
    line, employee_id, file_name, file_email,
    has_department, department_code, has_job_title, job_title,
    has_manager, manager_employee_id, has_functional, functional_employee_id
  )
  select
    case when r.value ->> 'line' ~ '^[0-9]{1,7}$'
      then (r.value ->> 'line')::integer else r.ordinality::integer + 1 end,
    upper(nullif(btrim(r.value ->> 'employee_id'), '')),
    nullif(btrim(r.value ->> 'name'), ''),
    lower(nullif(btrim(r.value ->> 'email'), '')),
    r.value ? 'department_code',
    upper(nullif(btrim(r.value ->> 'department_code'), '')),
    r.value ? 'job_title',
    nullif(btrim(r.value ->> 'job_title'), ''),
    r.value ? 'manager_employee_id',
    upper(nullif(btrim(r.value ->> 'manager_employee_id'), '')),
    r.value ? 'functional_manager_employee_id',
    upper(nullif(btrim(r.value ->> 'functional_manager_employee_id'), ''))
  from jsonb_array_elements(p_rows) with ordinality as r(value, ordinality)
  where jsonb_typeof(r.value) = 'object';

  -- Who each row is about, and where they sit now.
  update organisation_import_plan p
     set subject_id = u.id,
         subject_name = u.full_name,
         subject_email = u.email::text,
         subject_status = u.status,
         current_department_id = u.department_id,
         current_job_title = u.job_title,
         current_manager_id = u.reporting_manager_id,
         current_functional_id = u.functional_manager_id
    from public.user_profiles u
   where upper(u.employee_id) = p.employee_id;

  update organisation_import_plan p
     set department_id = d.id, department_status = d.status
    from public.departments d
   where d.code = p.department_code;

  update organisation_import_plan p
     set manager_id = u.id, manager_status = u.status
    from public.user_profiles u
   where upper(u.employee_id) = p.manager_employee_id;

  update organisation_import_plan p
     set functional_id = u.id, functional_status = u.status
    from public.user_profiles u
   where upper(u.employee_id) = p.functional_employee_id;

  -- The problems, in the order they are worth fixing. The first one found wins.
  update organisation_import_plan
     set problem = 'missing_employee_id', message = 'This row has no employee ID.'
   where employee_id is null;

  update organisation_import_plan p
     set problem = 'duplicate_employee',
         message = format('%s is on more than one row. Keep one.', p.employee_id)
   where p.problem is null
     and (select count(*) from organisation_import_plan o where o.employee_id = p.employee_id) > 1;

  update organisation_import_plan
     set problem = 'unknown_employee',
         message = format('Nobody in the Directory has the employee ID %s. Add them there first.',
                          employee_id)
   where problem is null and subject_id is null;

  update organisation_import_plan
     set problem = 'deactivated_employee',
         message = format('%s is deactivated.', subject_name)
   where problem is null and subject_status <> 'active';

  update organisation_import_plan
     set problem = 'email_mismatch',
         message = format('The Directory has %s for %s, not %s. Check the employee ID.',
                          subject_email, employee_id, file_email)
   where problem is null and file_email is not null and file_email <> lower(subject_email);

  update organisation_import_plan
     set problem = 'missing_department', message = 'This row has no department code.'
   where problem is null and has_department and department_code is null;

  update organisation_import_plan
     set problem = 'unknown_department',
         message = format('No department has the code %s.', department_code)
   where problem is null and has_department and department_code is not null
     and department_id is null;

  update organisation_import_plan
     set problem = 'archived_department',
         message = format('The %s department is archived.', department_code)
   where problem is null and department_status = 'archived';

  update organisation_import_plan
     set problem = 'job_title_too_long',
         message = 'The job title is longer than 120 characters.'
   where problem is null and has_job_title and length(job_title) > 120;

  update organisation_import_plan
     set problem = 'own_manager', message = 'Somebody cannot report to themselves.'
   where problem is null and has_manager and manager_employee_id = employee_id;

  update organisation_import_plan
     set problem = 'missing_manager',
         message = format('Nobody in the Directory has the manager''s employee ID %s.',
                          manager_employee_id)
   where problem is null and has_manager and manager_employee_id is not null
     and manager_id is null;

  update organisation_import_plan
     set problem = 'inactive_manager',
         message = format('The manager %s is deactivated.', manager_employee_id)
   where problem is null and manager_status <> 'active';

  update organisation_import_plan
     set problem = 'own_functional_manager',
         message = 'Somebody cannot be their own dotted-line manager.'
   where problem is null and has_functional and functional_employee_id = employee_id;

  update organisation_import_plan
     set problem = 'missing_functional_manager',
         message = format('Nobody in the Directory has the dotted-line manager''s employee ID %s.',
                          functional_employee_id)
   where problem is null and has_functional and functional_employee_id is not null
     and functional_id is null;

  update organisation_import_plan
     set problem = 'inactive_functional_manager',
         message = format('The dotted-line manager %s is deactivated.', functional_employee_id)
   where problem is null and functional_status <> 'active';

  -- Where each row would leave the person.
  update organisation_import_plan
     set next_department_id = case when has_department then department_id
                                   else current_department_id end,
         next_job_title = case when has_job_title then job_title else current_job_title end,
         next_manager_id = case when has_manager then manager_id else current_manager_id end,
         next_functional_id = case when has_functional then functional_id
                                   else current_functional_id end
   where problem is null;

  update organisation_import_plan
     set problem = 'functional_is_primary',
         message = format('%s is both the manager and the dotted line. A dotted line to the same '
                          'person adds nothing.', functional_employee_id)
   where problem is null and has_functional and next_functional_id is not null
     and next_functional_id = next_manager_id;

  -- A dotted line kept from before that now points at the new reporting
  -- manager ends, as it does when one person is moved (v173).
  update organisation_import_plan
     set next_functional_id = null, dotted_line_ended = true
   where problem is null and next_functional_id is not null
     and next_functional_id = next_manager_id;

  /*
   * Loops, judged on the organisation as the file would leave it.
   *
   * Each row is fine against today's lines taken alone; it is the file as a
   * whole that can loop — one row puts A under B, another puts B under A. So
   * the walk runs over a proposed organisation: every row that passed, over the
   * people it does not mention. A row found on a loop is set aside, which
   * restores that person's current line and can close a different loop, so the
   * walk repeats until nothing more is set aside.
   *
   * A walk that runs past 64 levels is refused too: the table's own guard
   * refuses a line that deep, and saying so here is better than an apply that
   * fails half-way through the file. It is only named when no true loop was
   * found, since a person under a loop walks past 64 without being part of it.
   */
  loop
    with recursive proposed as (
      select u.id,
             case when p.subject_id is null then u.reporting_manager_id
                  else p.next_manager_id end as manager_id
        from public.user_profiles u
        left join organisation_import_plan p on p.subject_id = u.id and p.problem is null
    ),
    walk as (
      select p.subject_id as start_id, p.next_manager_id as cursor_id, 1 as depth
        from organisation_import_plan p
       where p.problem is null
         and p.next_manager_id is distinct from p.current_manager_id
         and p.next_manager_id is not null
      union all
      select w.start_id, pr.manager_id, w.depth + 1
        from walk w
        join proposed pr on pr.id = w.cursor_id
       where w.cursor_id <> w.start_id and w.depth <= 64
    )
    select coalesce(array_agg(distinct start_id) filter (where cursor_id = start_id), '{}'),
           coalesce(array_agg(distinct start_id) filter (where depth > 64), '{}')
      into cycle_ids, deep_ids
      from walk;

    if cardinality(cycle_ids) > 0 then
      update organisation_import_plan
         set problem = 'circular',
             message = 'This would make the reporting line loop back on itself.'
       where problem is null and subject_id = any(cycle_ids);
    elsif cardinality(deep_ids) > 0 then
      update organisation_import_plan
         set problem = 'too_deep',
             message = 'This reporting line would be more than 64 levels deep.'
       where problem is null and subject_id = any(deep_ids);
    else
      exit;
    end if;
  end loop;

  -- Every row. The WHERE is not decoration: the API's connections refuse an
  -- UPDATE without one (pg_safeupdate), which psql alone would never show.
  update organisation_import_plan
     set changes = problem is null and (
           next_department_id is distinct from current_department_id
        or next_job_title is distinct from current_job_title
        or next_manager_id is distinct from current_manager_id
        or next_functional_id is distinct from current_functional_id)
   where line is not null;
end;
$$;

revoke all on function focus.plan_organisation_import(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The check
--
-- Every row, in file order, with what it would change in words an administrator
-- recognises — department names and people's names, not ids — or the sentence
-- saying why it cannot be applied. Writes nothing.
-- ---------------------------------------------------------------------------

create or replace function public.preview_organisation_import(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can import the organisation.');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return focus.error('invalid_file', 'The file could not be read.');
  end if;
  if jsonb_array_length(p_rows) = 0 then
    return focus.error('empty_file', 'The file has no people in it, only a header.');
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    return focus.error('too_many_rows',
      'A file can hold up to 2,000 people. Split it and import each part.');
  end if;

  perform focus.plan_organisation_import(p_rows);

  select jsonb_build_object(
    'ok', true,
    'code', 'checked',
    'counts', jsonb_build_object(
      'change', count(*) filter (where s.changes),
      'unchanged', count(*) filter (where s.problem is null and not s.changes),
      'problem', count(*) filter (where s.problem is not null)),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'line', s.line,
      'employee_id', s.employee_id,
      'name', coalesce(s.subject_name, s.file_name),
      'status', case when s.problem is not null then 'problem'
                     when s.changes then 'change' else 'unchanged' end,
      'problem', s.problem,
      'message', s.message,
      'changes', case when s.changes then s.described else '[]'::jsonb end
    ) order by s.line), '[]'::jsonb))
    into result
    from (
      select p.*,
             (select coalesce(jsonb_agg(c.item order by c.position), '[]'::jsonb)
                from (values
                  (1, case when p.next_department_id is distinct from p.current_department_id
                    then jsonb_build_object('field', 'department',
                      'from', (select d.name from public.departments d
                                where d.id = p.current_department_id),
                      'to', (select d.name from public.departments d
                              where d.id = p.next_department_id)) end),
                  (2, case when p.next_job_title is distinct from p.current_job_title
                    then jsonb_build_object('field', 'job_title',
                      'from', p.current_job_title, 'to', p.next_job_title) end),
                  (3, case when p.next_manager_id is distinct from p.current_manager_id
                    then jsonb_build_object('field', 'manager',
                      'from', (select u.full_name from public.user_profiles u
                                where u.id = p.current_manager_id),
                      'to', (select u.full_name from public.user_profiles u
                              where u.id = p.next_manager_id)) end),
                  (4, case when p.next_functional_id is distinct from p.current_functional_id
                    then jsonb_build_object('field', 'dotted_line',
                      'from', (select u.full_name from public.user_profiles u
                                where u.id = p.current_functional_id),
                      'to', (select u.full_name from public.user_profiles u
                              where u.id = p.next_functional_id)) end)
                ) as c(position, item)
               where c.item is not null) as described
        from organisation_import_plan p
    ) s;

  return result;
end;
$$;

comment on function public.preview_organisation_import is
  'Administrator-only. Says what an organisation file would change, row by row, and writes nothing.';

revoke all on function public.preview_organisation_import(jsonb) from public, anon;
grant execute on function public.preview_organisation_import(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The apply
--
-- Plans again, and refuses unless the number of changes is the one the
-- administrator was shown: somebody may have moved a person, or deactivated a
-- manager, since the check. Then writes every row that passed, in one
-- transaction, and nothing else.
--
-- The order of the writes matters because the table's cycle guard judges each
-- one against the organisation as it stands at that moment. Swapping two people
-- — B under A where A was under B — is a valid file whose first write, taken
-- alone, is a loop. So everybody whose line changes lets go of it first, and
-- then each takes their new manager. Every step on the way is then part of the
-- organisation the planner already walked, which has no loop in it.
-- ---------------------------------------------------------------------------

create or replace function public.apply_organisation_import(
  p_rows jsonb,
  p_expected_changes integer,
  p_reason text default null,
  p_effective_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  effective date := coalesce(p_effective_date, focus.local_today());
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  ready integer;
  item record;
  detail jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can import the organisation.');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return focus.error('invalid_file', 'The file could not be read.');
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    return focus.error('too_many_rows',
      'A file can hold up to 2,000 people. Split it and import each part.');
  end if;

  -- Nobody named in the file can be changed by somebody else while this runs.
  perform 1
     from public.user_profiles u
    where upper(u.employee_id) in (
      select upper(btrim(r.value ->> 'employee_id'))
        from jsonb_array_elements(p_rows) as r(value)
       where jsonb_typeof(r.value) = 'object')
    for update;

  perform focus.plan_organisation_import(p_rows);

  select count(*) into ready from organisation_import_plan where changes;

  if ready = 0 then
    return focus.error('nothing_to_apply', 'Nothing in this file would change anybody.');
  end if;
  if ready is distinct from p_expected_changes then
    return focus.error('plan_changed',
      format('The organisation has changed since this file was checked: %s %s ready now, not %s. '
             'Check the file again.',
             ready, case when ready = 1 then 'change is' else 'changes are' end,
             coalesce(p_expected_changes, 0)));
  end if;

  perform set_config('focus.privileged_write', 'on', true);

  update public.user_profiles u
     set reporting_manager_id = null
    from organisation_import_plan p
   where p.subject_id = u.id
     and p.changes
     and p.next_manager_id is distinct from p.current_manager_id
     and p.current_manager_id is not null;

  for item in
    select * from organisation_import_plan where changes order by line
  loop
    update public.user_profiles
       set department_id = item.next_department_id,
           job_title = item.next_job_title,
           reporting_manager_id = item.next_manager_id,
           functional_manager_id = item.next_functional_id
     where id = item.subject_id;

    detail := jsonb_build_object(
      'action', 'organisation_imported',
      'effective_date', effective);

    if item.next_department_id is distinct from item.current_department_id then
      detail := detail || jsonb_build_object('department_id', jsonb_build_object(
        'from', item.current_department_id, 'to', item.next_department_id));
    end if;

    if item.next_job_title is distinct from item.current_job_title then
      detail := detail || jsonb_build_object('job_title', jsonb_build_object(
        'from', item.current_job_title, 'to', item.next_job_title));
    end if;

    if item.next_manager_id is distinct from item.current_manager_id then
      insert into public.reporting_assignments (
        subject_id, previous_manager_id, new_manager_id, effective_date, reason, changed_by,
        relationship
      ) values (
        item.subject_id, item.current_manager_id, item.next_manager_id, effective, reason, actor,
        'primary'
      );
      detail := detail || jsonb_build_object('reporting_manager_id', jsonb_build_object(
        'from', item.current_manager_id, 'to', item.next_manager_id));
    end if;

    if item.next_functional_id is distinct from item.current_functional_id then
      insert into public.reporting_assignments (
        subject_id, previous_manager_id, new_manager_id, effective_date, reason, changed_by,
        relationship
      ) values (
        item.subject_id, item.current_functional_id, item.next_functional_id, effective,
        case when item.dotted_line_ended then 'Became the reporting manager.' else reason end,
        actor, 'functional'
      );
      detail := detail || jsonb_build_object('functional_manager_id', jsonb_build_object(
        'from', item.current_functional_id, 'to', item.next_functional_id));
    end if;

    perform focus.write_audit(
      p_event_type := 'user_updated',
      p_actor_id := actor,
      p_subject_user_id := item.subject_id,
      p_detail := detail);

    insert into public.admin_security_log (
      event_type, actor_user_id, subject_user_id, subject_employee_id,
      subject_email, summary, detail
    ) values (
      'user_updated', actor, item.subject_id, item.employee_id, item.subject_email,
      format('Placed %s (%s) from an organisation import', item.subject_name, item.employee_id),
      detail
    );
  end loop;

  return jsonb_build_object('ok', true, 'code', 'imported', 'applied', ready);
exception
  -- The planner walked the organisation as the file leaves it; the guard can
  -- still fire if somebody not named in the file moved in between. Everything
  -- above is undone with it.
  when check_violation then
    return focus.error('manager_invalid',
      'The organisation changed while this was being applied, and a reporting line would now '
      'loop back on itself. Nothing was changed. Check the file again.');
end;
$$;

comment on function public.apply_organisation_import is
  'Administrator-only. Applies the rows of an organisation file that pass the check, in one '
  'transaction, into the reporting history and audit. Refuses if the check''s answer has changed.';

revoke all on function public.apply_organisation_import(jsonb, integer, text, date)
  from public, anon;
grant execute on function public.apply_organisation_import(jsonb, integer, text, date)
  to authenticated;

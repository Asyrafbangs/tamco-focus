-- ============================================================================
-- v210 ESH Finding Management: what the letter says, what a preview shows,
-- what the register shows, and whether the scheduler ran.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §24,
-- §27, §33.2, §34.1, §34.2.
--
-- Four things a second reading found missing: a weekly letter with no
-- department summary in it, a report that goes live without anybody being
-- shown what it would say, a register that never mentions escalation, and a
-- daily scheduler that could stop running for a week without anybody knowing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Did the scheduled work actually run? (§27)
-- ---------------------------------------------------------------------------

create table public.esh_worker_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  worker text not null check (length(btrim(worker)) between 1 and 60),
  ok boolean not null,
  detail jsonb not null default '{}'::jsonb,
  ran_at timestamptz not null default now()
);

create index esh_worker_runs_recent_idx
  on public.esh_worker_runs (organization_id, worker, ran_at desc);

-- A record of what happened is not something a later run may rewrite.
create trigger esh_worker_runs_written_once
  before update or delete on public.esh_worker_runs
  for each row execute function focus.reject_audit_mutation();

alter table public.esh_worker_runs enable row level security;

create policy esh_worker_runs_select on public.esh_worker_runs
  as permissive for select to authenticated
  using ((select focus.esh_enabled())
         and organization_id = (select focus.esh_organization_id()));

revoke all on public.esh_worker_runs from anon, authenticated;
grant select on public.esh_worker_runs to authenticated;

/** The scheduled runner says what it did, so silence becomes visible (§27). */
create or replace function public.esh_record_worker_run(
  p_worker text,
  p_ok boolean,
  p_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid;
begin
  select id into org from public.organizations order by created_at limit 1;
  if org is null then return jsonb_build_object('ok', false, 'code', 'no_organization'); end if;
  insert into public.esh_worker_runs (organization_id, worker, ok, detail)
  values (org, left(btrim(p_worker), 60), coalesce(p_ok, false), coalesce(p_detail, '{}'::jsonb));
  return jsonb_build_object('ok', true);
end;
$$;

/**
 * What ESH should be told about the machinery, rather than about the work.
 *
 * A green HTTP response proves nothing about a scheduler that has not run
 * since Tuesday (§27), so the overview asks this and says so plainly.
 */
create or replace function public.esh_operational_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := focus.esh_organization_id();
  v_last timestamptz;
  v_last_ok boolean;
begin
  if org is null or not focus.esh_enabled() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select ran_at, ok into v_last, v_last_ok
    from public.esh_worker_runs
   where organization_id = org and worker = 'cron'
   order by ran_at desc
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'last_run_at', v_last,
    'last_run_ok', v_last_ok,
    'hours_since_run', case when v_last is null then null
                            else round(extract(epoch from (now() - v_last)) / 3600)::int end,
    'queued', (select count(*)::int from public.esh_notification_outbox
                where organization_id = org and state in ('queued', 'digested')),
    'failing', (select count(*)::int from public.esh_notification_outbox
                 where organization_id = org
                   and (state = 'bounced'
                        or (state = 'failed' and next_attempt_at is null))),
    'held', (select count(*)::int from public.esh_notification_outbox
              where organization_id = org and state = 'held_rollout'),
    'review_overdue', (select count(*)::int
                         from public.esh_action_submissions submission
                         join public.esh_finding_actions action on action.id = submission.action_id
                        where submission.organization_id = org
                          and submission.state = 'pending'
                          and submission.submitted_at < now() - interval '7 days'),
    -- There is no scanner in this deployment, so nothing can be waiting for
    -- one. Said rather than left out, so the absence is not mistaken for zero.
    'scan_backlog', null);
end;
$$;

revoke all on function public.esh_record_worker_run(text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.esh_operational_health() from public, anon;

grant execute on function public.esh_record_worker_run(text, boolean, jsonb) to service_role;
grant execute on function public.esh_operational_health() to authenticated;
-- ---------------------------------------------------------------------------
-- 2. What the weekly letter carries (§34.2)
--
-- The email had the four signals and a link. §34.2 asks for the department
-- summary as well, with "Showing X of Y" where it is truncated, and up to five
-- overdue owner actions. All of it comes from the snapshot the run already
-- captured: the letter and the page cannot disagree, because they are the same
-- rows.
-- ---------------------------------------------------------------------------

/** The department summary and a few overdue rows, from one captured run. */
create or replace function focus.esh_report_letter(p_run_id uuid, p_departments integer)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with by_department as (
    select coalesce(row.department_name, 'Unassigned') as department,
           count(*) filter (where row.signal = 'open') as open_count,
           count(*) filter (where row.signal = 'overdue') as overdue_count,
           count(*) filter (where row.signal = 'awaiting_verification') as awaiting_count,
           count(*) filter (where row.signal = 'closed') as closed_count
      from public.esh_report_snapshot_rows row
     where row.run_id = p_run_id
     group by 1
  ),
  ranked as (
    select *, row_number() over (order by overdue_count desc, open_count desc, department)
             as position
      from by_department
  )
  select jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'department', ranked.department,
               'open', ranked.open_count,
               'overdue', ranked.overdue_count,
               'awaiting', ranked.awaiting_count,
               'closed', ranked.closed_count) order by ranked.position)
        from ranked where ranked.position <= greatest(coalesce(p_departments, 6), 1)), '[]'::jsonb),
    'department_total', (select count(*) from by_department),
    -- Up to five, worst first, so the letter says who is waiting on what
    -- without becoming the report itself (§34.2).
    'overdue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reference', row.reference,
               'title', coalesce(row.action_title, row.finding_title),
               'owner', row.owner_email,
               'due_at', row.due_at,
               'due_is_date_only', row.due_is_date_only) order by row.due_at)
        from (select * from public.esh_report_snapshot_rows
               where run_id = p_run_id and signal = 'overdue'
               order by due_at limit 5) row), '[]'::jsonb));
$$;

revoke all on function focus.esh_report_letter(uuid, integer) from public, anon, authenticated;
grant execute on function focus.esh_report_letter(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. What a report would say, before anybody activates it (§34.1)
--
-- A preview sends nothing and captures nothing. It runs the same scope the
-- capture would run, against now, so an operator can see the audience and the
-- numbers before turning a draft into something that posts every Monday.
-- ---------------------------------------------------------------------------

create or replace function public.esh_preview_report(p_definition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  definition public.esh_report_definitions;
  org uuid := focus.esh_organization_id();
  v_departments uuid[];
  v_week_start timestamptz;
begin
  if auth.uid() is null or not focus.esh_can('manage_reports') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into definition from public.esh_report_definitions
   where id = p_definition_id and organization_id = org;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  v_departments := focus.esh_report_scope_departments(definition.id);
  v_week_start := (date_trunc('week', now() at time zone definition.timezone))
                    at time zone definition.timezone;

  return jsonb_build_object(
    'ok', true,
    'name', definition.name,
    'state', definition.state,
    'timezone', definition.timezone,
    'as_of', now(),
    'closed_from', v_week_start - interval '7 days',
    'closed_to', v_week_start,
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', principal.display_email,
               'enabled', recipient.enabled,
               'access_enabled', principal.access_enabled) order by principal.display_email)
        from public.esh_report_recipients recipient
        join public.esh_email_principals principal on principal.id = recipient.principal_id
       where recipient.report_definition_id = definition.id), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(department.name order by department.name)
        from public.departments department
       where department.id = any(v_departments)), '[]'::jsonb),
    'open_count', (select count(*) from public.esh_findings f
                    where f.organization_id = org and f.status = 'open'
                      and not f.is_restricted
                      and f.accountable_department_id = any(v_departments)),
    'overdue_count', (select count(*) from public.esh_finding_actions action
                       join public.esh_findings f on f.id = action.finding_id
                      where f.organization_id = org and f.status = 'open'
                        and not f.is_restricted
                        and f.accountable_department_id = any(v_departments)
                        and action.state in ('assigned', 'in_progress')
                        and action.due_at < now()),
    'awaiting_count', (select count(*) from public.esh_finding_actions action
                        join public.esh_findings f on f.id = action.finding_id
                       where f.organization_id = org and f.status = 'open'
                         and not f.is_restricted
                         and f.accountable_department_id = any(v_departments)
                         and action.state = 'awaiting_verification'),
    'closed_count', (select count(*) from public.esh_findings f
                      where f.organization_id = org and f.status = 'closed'
                        and not f.is_restricted
                        and f.accountable_department_id = any(v_departments)
                        and f.closed_at >= v_week_start - interval '7 days'
                        and f.closed_at < v_week_start),
    -- Said out loud on the screen: this is a look, not a send (§34.1).
    'sends_nothing', true);
end;
$$;

revoke all on function public.esh_preview_report(uuid) from public, anon;
grant execute on function public.esh_preview_report(uuid) to authenticated;
-- ---------------------------------------------------------------------------
-- 4. The register says how far something has escalated (§24)
--
-- The view is v201's, with one column added: the highest escalation level live
-- under this action's current assignment. A reassignment starts the route
-- again, so the indicator follows the assignment rather than the history.
-- ---------------------------------------------------------------------------

create or replace view public.esh_register_rows
with (security_invoker = true)
as
select f.id as finding_id,
       f.organization_id,
       f.reference,
       f.title,
       f.location,
       f.status,
       f.is_restricted,
       f.risk_level,
       f.accountable_department_id,
       d.name as department_name,
       f.created_at,
       f.closed_at,
       a.id as action_id,
       a.state as action_state,
       a.priority,
       a.due_at,
       a.due_is_date_only,
       (select count(*) from public.esh_finding_actions x where x.finding_id = f.id) as action_count,
       p.display_email as owner_email,
       coalesce(held.any_held, false) as notification_held,
       coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false) as is_overdue,
       (f.status in ('draft', 'new')
        or (f.status = 'open'
            and (coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false)
                 or coalesce(a.state = 'awaiting_verification', false)
                 or coalesce(held.any_held, false)
                 or coalesce(failed.any_failed, false)))) as needs_attention,
       coalesce(latest.occurred_at, f.created_at) as last_update_at,
       coalesce(latest.event_type, 'finding_created') as last_update_type,
       coalesce(failed.any_failed, false) as notification_failed,
       coalesce(p.status = 'active' and p.access_enabled, false) as owner_access_enabled,
       -- v210: how far this action has escalated, so the register says what
       -- §24's row content asks it to say.
       escalated.level as escalation_level
  from public.esh_findings f
  left join public.departments d on d.id = f.accountable_department_id
  left join lateral (
    select * from public.esh_finding_actions x
     where x.finding_id = f.id
     order by x.sequence
     limit 1
  ) a on true
  left join public.esh_email_principals p on p.id = a.owner_principal_id
  left join lateral (
    select true as any_held
      from public.esh_notification_outbox o
     where o.action_id = a.id and o.state = 'held_rollout'
     limit 1
  ) held on true
  left join lateral (
    select max(e.level) as level
      from public.esh_escalation_entitlements e
     where e.action_id = a.id
       and e.revoked_at is null
       and e.assignment_version = a.assignment_version
  ) escalated on true
  left join lateral (
    select true as any_failed
      from public.esh_notification_outbox o
     where o.action_id = a.id
       and (o.state = 'bounced' or (o.state = 'failed' and o.next_attempt_at is null))
     limit 1
  ) failed on true
  left join lateral (
    select e.occurred_at, e.event_type
      from public.esh_audit_events e
     where e.finding_id = f.id
       and e.event_type in ('finding_created', 'action_assigned', 'action_started',
                            'owner_message', 'esh_message', 'escalation_message',
                            'submission_created', 'submission_withdrawn')
     order by e.occurred_at desc,
              array_position(array['submission_created', 'submission_withdrawn',
                                   'owner_message', 'esh_message', 'escalation_message',
                                   'action_started', 'action_assigned', 'finding_created'],
                             e.event_type)
     limit 1
  ) latest on true;

-- ---------------------------------------------------------------------------
-- 5. The weekly claim carries what the letter says
--
-- v204's routine, extended: the same grant, the same checks, plus the summary
-- the email needs so leadership can read it without opening anything.
-- ---------------------------------------------------------------------------

create or replace function public.esh_report_dispatch_claim(
  p_outbox_id uuid,
  p_secret text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  outbox public.esh_report_outbox;
  recipient public.esh_report_recipients;
  run public.esh_report_runs;
  definition public.esh_report_definitions;
  principal public.esh_email_principals;
begin
  select * into outbox from public.esh_report_outbox
   where id = p_outbox_id for update skip locked;
  if not found then return jsonb_build_object('ok', false, 'code', 'busy'); end if;
  if not (outbox.state = 'queued'
          or (outbox.state = 'failed' and outbox.next_attempt_at <= now())
          or (outbox.state = 'processing' and outbox.updated_at < now() - interval '15 minutes')) then
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  select * into recipient from public.esh_report_recipients where id = outbox.recipient_id;
  select * into run from public.esh_report_runs where id = outbox.run_id;
  select * into definition from public.esh_report_definitions where id = run.report_definition_id;
  select * into principal from public.esh_email_principals where id = recipient.principal_id;
  if not focus.esh_report_recipient_live(recipient.id, run.id) then
    update public.esh_report_outbox set state = 'suppressed', last_error = 'access_changed',
      next_attempt_at = null, updated_at = now() where id = outbox.id;
    return jsonb_build_object('ok', false, 'code', 'suppressed');
  end if;
  if p_secret is null or p_secret !~ '^[A-Za-z0-9_-]{40,64}$' then
    raise exception 'esh_report_dispatch_claim: no valid secret';
  end if;
  update public.esh_report_outbox set state = 'processing', attempts = attempts + 1,
    updated_at = now() where id = outbox.id;
  insert into public.esh_access_grants
    (organization_id, principal_id, purpose, report_run_id, report_recipient_id,
     token_hash, issued_reason, expires_at)
  values
    (outbox.organization_id, recipient.principal_id, 'report_viewer', run.id,
     recipient.id, focus.esh_secret_hash(p_secret), 'notification', now() + interval '7 days');
  return jsonb_build_object(
    'ok', true, 'to', principal.display_email, 'run_id', run.id,
    'report_name', run.definition_name, 'captured_at', run.captured_at,
    'timezone', run.timezone, 'open_count', run.open_count,
    'overdue_count', run.overdue_count, 'awaiting_count', run.awaiting_count,
    'closed_count', run.closed_count, 'expires_minutes', 10080,
    'closed_from', run.closed_window_start, 'closed_to', run.closed_window_end)
    -- v210: the department summary and a few overdue rows the letter carries
    -- (§34.2), taken from this run's own snapshot so the email and the page
    -- cannot disagree.
    || focus.esh_report_letter(run.id, 6);
end;
$$;

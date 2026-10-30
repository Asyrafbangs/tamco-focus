-- ============================================================================
-- v267 — did the fix actually work, three months later
--
-- Acceptance says ESH looked at what the owner sent and believed it. It does
-- not say the hazard stayed controlled. A guard refitted in October and
-- removed again in November closes exactly as well as one that stayed on, and
-- the register cannot tell the difference — which is how a programme reports
-- 94% closure while the same finding comes back every year.
--
-- So, for the findings worth it: a date, somebody to look, and what they have
-- to see. Not for everything. A check on every housekeeping observation is a
-- backlog of checks, and the first thing an overloaded team stops doing.
--
-- A failure does not reopen the original. The original closure was a true
-- statement about October, and rewriting it would destroy the only evidence
-- that the fix was once in place and later was not. A failure raises a new
-- finding that says so and links back.
-- ============================================================================

create table public.esh_effectiveness_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  finding_id uuid not null,
  action_id uuid not null,
  due_on date not null,
  -- What the person checking has to see. Not "confirm it is still fine": that
  -- is a question whose answer is always yes.
  pass_criteria text not null check (length(btrim(pass_criteria)) between 3 and 1000),
  -- Free text, like the interim control's keeper: often a line supervisor.
  checker text,
  state text not null default 'scheduled'
    check (state in ('scheduled', 'passed', 'failed', 'cancelled')),
  scheduled_by uuid not null references public.user_profiles (id),
  scheduled_at timestamptz not null default now(),
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  decision_note text,
  -- What a failure raised. The original stays closed and keeps its history.
  follow_up_finding_id uuid references public.esh_findings (id),
  foreign key (organization_id, finding_id) references public.esh_findings (organization_id, id),
  foreign key (organization_id, action_id)
    references public.esh_finding_actions (organization_id, id),
  constraint esh_effectiveness_decided_together
    check ((state in ('scheduled', 'cancelled')) = (decided_at is null)),
  constraint esh_effectiveness_decided_by_somebody
    check (decided_at is null or decided_by is not null),
  constraint esh_effectiveness_failure_explains
    check (state <> 'failed' or length(btrim(coalesce(decision_note, ''))) > 0)
);

create index esh_effectiveness_due_idx
  on public.esh_effectiveness_checks (organization_id, due_on) where state = 'scheduled';
create index esh_effectiveness_finding_idx
  on public.esh_effectiveness_checks (finding_id, scheduled_at desc);

alter table public.esh_effectiveness_checks enable row level security;

create policy esh_effectiveness_select on public.esh_effectiveness_checks
  as permissive for select to authenticated
  using (finding_id in (select f.id from public.esh_findings f));

revoke all on public.esh_effectiveness_checks from anon, authenticated;
grant select on public.esh_effectiveness_checks to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling one
-- ---------------------------------------------------------------------------

create or replace function public.esh_schedule_effectiveness_check(
  p_action_id uuid,
  p_due_on date,
  p_pass_criteria text,
  p_checker text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  a public.esh_finding_actions;
  fnd public.esh_findings;
  v_criteria text := btrim(coalesce(p_pass_criteria, ''));
  v_id uuid;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into a from public.esh_finding_actions
   where id = p_action_id and organization_id = org;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into fnd from public.esh_findings where id = a.finding_id;
  if not (focus.esh_scope_all()
          or fnd.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  /*
   * Only once the correction has been accepted. Scheduling a check on work
   * still being done asks somebody to confirm a fix that does not exist yet.
   */
  if a.state <> 'accepted' then
    return jsonb_build_object('ok', false, 'code', 'not_accepted');
  end if;
  if length(v_criteria) not between 3 and 1000 then
    return jsonb_build_object('ok', false, 'code', 'criteria_required');
  end if;
  if p_due_on is null or p_due_on <= current_date or p_due_on > current_date + 1095 then
    return jsonb_build_object('ok', false, 'code', 'date_invalid');
  end if;
  if exists (select 1 from public.esh_effectiveness_checks
              where action_id = a.id and state = 'scheduled') then
    return jsonb_build_object('ok', false, 'code', 'already_scheduled');
  end if;

  insert into public.esh_effectiveness_checks
    (organization_id, finding_id, action_id, due_on, pass_criteria, checker, scheduled_by)
  values (org, a.finding_id, a.id, p_due_on, v_criteria,
          nullif(btrim(coalesce(p_checker, '')), ''), actor)
  returning id into v_id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'effectiveness_scheduled', a.finding_id,
          jsonb_build_object('action_id', a.id, 'due_on', p_due_on, 'checker', p_checker));

  return jsonb_build_object('ok', true, 'check_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Recording what was found
-- ---------------------------------------------------------------------------

/*
 * A failure raises a new finding rather than reopening the old one.
 *
 * The October closure was a true statement about October. Reopening it would
 * overwrite the only record that the fix was once in place and later was not,
 * and that record is the whole reason anybody schedules these.
 */
create or replace function public.esh_record_effectiveness_check(
  p_check_id uuid,
  p_passed boolean,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  c public.esh_effectiveness_checks;
  fnd public.esh_findings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_new uuid;
  v_reference text;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into c from public.esh_effectiveness_checks
   where id = p_check_id and organization_id = org for update;
  if not found or c.state <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into fnd from public.esh_findings where id = c.finding_id;
  if not (focus.esh_scope_all()
          or fnd.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_passed is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if not p_passed and v_note is null then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;

  if not p_passed then
    v_reference := focus.esh_next_reference(org);
    insert into public.esh_findings
      (organization_id, reference, title, description, source, source_reference,
       reported_on, location, accountable_department_id, risk_level, is_restricted,
       status, created_by)
    values (org, v_reference,
            'Control did not hold: ' || fnd.title,
            coalesce(v_note, '') || E'\n\nRaised by the effectiveness check on '
              || fnd.reference || '. What should have been seen: ' || c.pass_criteria,
            fnd.source, fnd.reference, current_date, fnd.location,
            fnd.accountable_department_id, fnd.risk_level, fnd.is_restricted,
            'new', actor)
    returning id into v_new;
  end if;

  update public.esh_effectiveness_checks
     set state = case when p_passed then 'passed' else 'failed' end,
         decided_by = actor,
         decided_at = now(),
         decision_note = v_note,
         follow_up_finding_id = v_new
   where id = c.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor,
          case when p_passed then 'effectiveness_passed' else 'effectiveness_failed' end,
          c.finding_id,
          jsonb_build_object('check_id', c.id, 'note', v_note,
                             'follow_up_finding_id', v_new));

  return jsonb_build_object('ok', true, 'follow_up_finding_id', v_new,
                            'follow_up_reference', v_reference);
end;
$$;

grant execute on function
  public.esh_schedule_effectiveness_check(uuid, date, text, text) to authenticated;
grant execute on function
  public.esh_record_effectiveness_check(uuid, boolean, text) to authenticated;

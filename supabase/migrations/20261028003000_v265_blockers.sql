-- ============================================================================
-- v265 — "waiting for purchasing" as something the system can act on
--
-- An owner who is stuck already says so, in the conversation, in their own
-- words. Nothing can count it, nothing can chase it, and an escalation
-- recipient opening the action at level 2 has to read a thread to discover
-- that the answer is a purchase order nobody has signed.
--
-- So: a category, what help is needed, who can give it and when the next
-- decision is expected. Four facts that turn an escalation email from "this is
-- late again" into something a supervisor can actually resolve.
--
-- **Reporting a blocker changes nothing else.** Not the due date, not the
-- state, not the reminder schedule. It is an overlay on work that remains the
-- owner's and remains late if it is late; the alternative — a self-service
-- pause — is how a tracker quietly stops tracking.
-- ============================================================================

create table public.esh_action_blockers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  category text not null check (category in
    ('materials', 'budget', 'shutdown', 'contractor', 'technical_decision', 'access', 'other')),
  help_needed text not null check (length(btrim(help_needed)) between 3 and 1000),
  -- Free text: the person who can unblock it is usually not in any directory
  -- this system has, which is the whole reason the owner is stuck.
  responsible text,
  next_decision_on date,
  raised_by_principal_id uuid not null,
  raised_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references public.user_profiles (id),
  cleared_note text,
  -- Cleared by somebody, or cleared with a note saying what happened: the
  -- owner replacing their own report has no staff actor to name.
  constraint esh_action_blockers_cleared_accounted
    check (cleared_at is null or cleared_by is not null or cleared_note is not null),
  foreign key (organization_id, action_id)
    references public.esh_finding_actions (organization_id, id),
  foreign key (organization_id, raised_by_principal_id)
    references public.esh_email_principals (organization_id, id)
);

create index esh_blockers_action_idx on public.esh_action_blockers (action_id, raised_at desc);
-- The open ones are what every reader wants; one per action at a time.
create unique index esh_blockers_one_open_idx
  on public.esh_action_blockers (action_id) where cleared_at is null;

alter table public.esh_action_blockers enable row level security;

-- Staff read the blockers of any action they can read, exactly as they read
-- its conversation (v198). Owners reach theirs through the guest procedures.
create policy esh_action_blockers_select on public.esh_action_blockers
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));

revoke all on public.esh_action_blockers from anon, authenticated;
grant select on public.esh_action_blockers to authenticated;

comment on table public.esh_action_blockers is
  'What is stopping an owner finishing, in a shape an escalation recipient can '
  'act on (v265). An overlay: it moves no deadline and stops no reminder.';

-- ---------------------------------------------------------------------------
-- The owner raises it
-- ---------------------------------------------------------------------------

create or replace function public.esh_guest_report_blocker(
  p_session text,
  p_action_id uuid,
  p_category text,
  p_help_needed text,
  p_responsible text default null,
  p_next_decision_on date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  a public.esh_finding_actions;
  v_help text := btrim(coalesce(p_help_needed, ''));
  v_responsible text := nullif(btrim(coalesce(p_responsible, '')), '');
  v_id uuid;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;

  select * into a from public.esh_finding_actions where id = p_action_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  /*
   * The owner only. An escalation recipient is who a blocker is raised *to*;
   * letting them raise one on the owner's behalf would put a statement in the
   * owner's mouth about work that is still the owner's.
   */
  if not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if a.state not in ('assigned', 'in_progress') then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  if coalesce(p_category, '') not in
     ('materials', 'budget', 'shutdown', 'contractor', 'technical_decision', 'access', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if length(v_help) not between 3 and 1000 then
    return jsonb_build_object('ok', false, 'code', 'help_required');
  end if;
  if p_next_decision_on is not null
     and (p_next_decision_on < current_date or p_next_decision_on > current_date + 365) then
    return jsonb_build_object('ok', false, 'code', 'date_invalid');
  end if;

  -- One open blocker at a time: a second one replaces the first rather than
  -- stacking, because two answers to "what is stopping you" is no answer.
  update public.esh_action_blockers
     set cleared_at = now(),
         cleared_by = null,
         cleared_note = 'Replaced by a newer report from the owner.'
   where action_id = a.id and cleared_at is null;

  insert into public.esh_action_blockers
    (organization_id, action_id, category, help_needed, responsible,
     next_decision_on, raised_by_principal_id)
  values (a.organization_id, a.id, p_category, v_help, v_responsible,
          p_next_decision_on, s.principal_id)
  returning id into v_id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_principal_id, event_type, finding_id, detail)
  values (a.organization_id, 'principal', s.principal_id, 'blocker_reported', a.finding_id,
          jsonb_build_object('action_id', a.id, 'category', p_category,
                             'next_decision_on', p_next_decision_on));

  -- Deliberately no change to state, due date or follow-up. Being stuck is a
  -- fact about the work, not permission to stop being accountable for it.
  return jsonb_build_object('ok', true, 'blocker_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- ESH clears it
-- ---------------------------------------------------------------------------

create or replace function public.esh_clear_blocker(p_blocker_id uuid, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  b public.esh_action_blockers;
  f public.esh_findings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into b from public.esh_action_blockers
   where id = p_blocker_id and organization_id = org for update;
  if not found or b.cleared_at is not null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- `fnd`, not `f`: the record variable is already called f, and Postgres
  -- resolves the alias against it and calls the column reference ambiguous.
  select fnd.* into f from public.esh_findings fnd
    join public.esh_finding_actions a on a.finding_id = fnd.id
   where a.id = b.action_id;
  if not (focus.esh_scope_all()
          or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.esh_action_blockers
     set cleared_at = now(), cleared_by = actor, cleared_note = v_note
   where id = b.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'blocker_cleared', f.id,
          jsonb_build_object('action_id', b.action_id, 'category', b.category, 'note', v_note));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.esh_guest_report_blocker(text, uuid, text, text, text, date)
  from public, anon, authenticated;
grant execute on function public.esh_guest_report_blocker(text, uuid, text, text, text, date)
  to service_role;
grant execute on function public.esh_clear_blocker(uuid, text) to authenticated;

-- ============================================================================
-- v208 ESH Finding Management: priority, changed and explained.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §39;
-- FM90.
--
-- Priority is how an owner decides what to do first. It is set when the action
-- is assigned and, until now, never again: a backlog imported as Normal stayed
-- Normal however the week went. §39 asks for the opposite — ESH confirms it and
-- changes it, each change recorded with its reason.
--
-- What it deliberately does not do is move anything else. Risk is the finding's
-- assessment, the due date is the agreement, and overdue is arithmetic on that
-- date. Changing priority touches none of them, and it does not restart a
-- reminder or an escalation clock: the follow-up schedule belongs to the due
-- date it was set from.
-- ============================================================================

create table public.esh_priority_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  from_priority text,
  to_priority text not null check (to_priority in ('urgent', 'high', 'normal')),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  changed_by uuid not null references public.user_profiles (id),
  changed_at timestamptz not null default now(),
  foreign key (organization_id, action_id)
    references public.esh_finding_actions (organization_id, id)
);

create index esh_priority_changes_action_idx
  on public.esh_priority_changes (action_id, changed_at desc);

create trigger esh_priority_changes_written_once
  before update or delete on public.esh_priority_changes
  for each row execute function focus.reject_audit_mutation();

alter table public.esh_priority_changes enable row level security;

create policy esh_priority_changes_select on public.esh_priority_changes
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));

revoke all on public.esh_priority_changes from anon, authenticated;
grant select on public.esh_priority_changes to authenticated;

/**
 * ESH changes what an owner should do first, and says why.
 *
 * The reason is required because a priority nobody can account for is how
 * everything becomes Urgent. Nothing else moves: the due date, the risk
 * assessment and the follow-up schedule are left exactly as they were, and the
 * answer says so, so the screen can say so too (§39).
 */
create or replace function public.esh_set_priority(
  p_action_id uuid,
  p_priority text,
  p_reason text
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
  f public.esh_findings;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if coalesce(p_priority, '') not in ('urgent', 'high', 'normal') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  select * into a from public.esh_finding_actions
   where id = p_action_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  select * into f from public.esh_findings where id = a.finding_id;
  if not (focus.esh_scope_all()
          or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if f.status <> 'open' or a.state not in ('assigned', 'in_progress') then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  if a.priority is not distinct from p_priority then
    return jsonb_build_object('ok', false, 'code', 'unchanged');
  end if;

  insert into public.esh_priority_changes
    (organization_id, action_id, from_priority, to_priority, reason, changed_by)
  values (org, a.id, a.priority, p_priority, v_reason, actor);

  update public.esh_finding_actions set
    priority = p_priority,
    updated_at = now(),
    row_version = row_version + 1
   where id = a.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
  values
    (org, 'staff', actor, 'priority_changed', f.id, a.id,
     jsonb_build_object('from', a.priority, 'to', p_priority, 'reason', v_reason,
                        'due_at', a.due_at, 'followup_unchanged', true));

  return jsonb_build_object('ok', true, 'priority', p_priority,
                            -- Said out loud so the screen can repeat it: the
                            -- deadline and its reminders are where they were.
                            'due_at', a.due_at, 'followup_unchanged', true);
end;
$$;

revoke all on function public.esh_set_priority(uuid, text, text) from public, anon;
grant execute on function public.esh_set_priority(uuid, text, text) to authenticated;

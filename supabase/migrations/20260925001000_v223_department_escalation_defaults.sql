-- ============================================================================
-- v223 ESH Finding Management: an escalation route a department already has.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §7, §16.
--
-- ESH types the same two addresses for every finding in the same warehouse.
-- The route is a property of the department far more often than of the
-- finding, so it is recorded once and offered at assignment. It remains a
-- default, not a policy: §7 says ESH confirms the actual action-specific
-- route, and nothing here writes an escalation without that confirmation.
-- ============================================================================

create table public.esh_department_escalation_defaults (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  department_id uuid not null references public.departments (id),
  level smallint not null check (level between 1 and 9),
  email text not null check (length(btrim(email)) between 3 and 254),
  canonical_email text not null,
  updated_by uuid not null references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  unique (department_id, level, canonical_email)
);

create index esh_department_escalation_defaults_idx
  on public.esh_department_escalation_defaults (organization_id, department_id, level);

alter table public.esh_department_escalation_defaults enable row level security;

create policy esh_department_escalation_defaults_select
  on public.esh_department_escalation_defaults
  as permissive for select to authenticated
  using ((select focus.esh_enabled())
         and organization_id = (select focus.esh_organization_id()));

revoke all on public.esh_department_escalation_defaults from anon, authenticated;
grant select on public.esh_department_escalation_defaults to authenticated;

/**
 * Replace one department's default route, in full (§7).
 *
 * The whole route is written at once so a level cannot be half-removed: what
 * ESH sees in settings is exactly what a new finding will be offered.
 */
create or replace function public.esh_set_department_escalation(
  p_department_id uuid,
  p_levels jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := focus.esh_organization_id();
  actor uuid := auth.uid();
  entry jsonb;
  v_level integer;
  v_email text;
  v_written integer := 0;
begin
  if actor is null or not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if not exists (
    select 1 from public.departments d
     where d.id = p_department_id
       and (focus.esh_scope_all() or d.id = any (focus.esh_visible_department_ids()))
  ) then
    return jsonb_build_object('ok', false, 'code', 'department_not_found');
  end if;
  if jsonb_typeof(p_levels) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  for entry in select value from jsonb_array_elements(p_levels) loop
    begin
      v_level := (entry->>'level')::int;
    exception when others then
      v_level := null;
    end;
    v_email := btrim(coalesce(entry->>'email', ''));
    if v_level is null or v_level < 1 or v_level > 9 then
      return jsonb_build_object('ok', false, 'code', 'level_invalid');
    end if;
    if not focus.esh_email_is_valid(v_email) then
      return jsonb_build_object('ok', false, 'code', 'email_invalid');
    end if;
  end loop;

  delete from public.esh_department_escalation_defaults where department_id = p_department_id;

  for entry in select value from jsonb_array_elements(p_levels) loop
    insert into public.esh_department_escalation_defaults
      (organization_id, department_id, level, email, canonical_email, updated_by)
    values
      (org, p_department_id, (entry->>'level')::smallint, btrim(entry->>'email'),
       focus.esh_canonical_email(entry->>'email'), actor)
    on conflict (department_id, level, canonical_email) do nothing;
    v_written := v_written + 1;
  end loop;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values
    (org, 'staff', actor, 'department_escalation_set',
     jsonb_build_object('department_id', p_department_id, 'levels', p_levels));

  return jsonb_build_object('ok', true, 'written', v_written);
end;
$$;

revoke all on function public.esh_set_department_escalation(uuid, jsonb) from public, anon;
grant execute on function public.esh_set_department_escalation(uuid, jsonb) to authenticated;

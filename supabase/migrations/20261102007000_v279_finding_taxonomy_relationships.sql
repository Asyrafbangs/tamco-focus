-- ============================================================================
-- v279 — reviewed Finding taxonomy and relationships
--
-- Classification is an ESH decision, never an inference from title, risk,
-- priority, or a related record.  Relationships record an explicit reviewed
-- decision and do not replace the existing effectiveness-check failure link.
-- ============================================================================

create table public.esh_hazard_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  label text not null check (length(btrim(label)) between 2 and 120),
  aliases jsonb not null default '[]'::jsonb check (jsonb_typeof(aliases) = 'array'),
  sort_order integer not null check (sort_order >= 0),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- These are the supplied v4.1 starter taxonomy, deliberately small.  The
-- `unclassified` value preserves the truth about historical and draft records;
-- it does not infer a hazard or root cause from their text.
insert into public.esh_hazard_categories (code, label, sort_order) values
  ('unclassified', 'Unclassified / needs review', 0),
  ('electrical_safety', 'Electrical safety', 10),
  ('machinery_guarding', 'Machinery and guarding', 20),
  ('lifting_material_handling', 'Lifting and material handling', 30),
  ('vehicles_workplace_traffic', 'Vehicles and workplace traffic', 40),
  ('fire_emergency', 'Fire and emergency', 50),
  ('chemicals_environment', 'Chemicals and environment', 60),
  ('slips_trips_falls', 'Slips, trips and falls', 70),
  ('work_at_height', 'Work at height', 80),
  ('occupational_health_ergonomics', 'Occupational health and ergonomics', 90),
  ('work_control_compliance', 'Work control and compliance', 100),
  ('other_needs_review', 'Other / needs review', 110);

-- Existing `esh_save_finding` remains the sole Finding creation path.  Its
-- payload deliberately has no taxonomy field yet, so a single stable default
-- records the honest `unclassified` state rather than breaking the workflow
-- or fabricating a category.
create or replace function focus.esh_unclassified_hazard_category_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.esh_hazard_categories where code = 'unclassified';
$$;

create table public.esh_problem_tags (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  label text not null check (length(btrim(label)) between 2 and 120),
  aliases jsonb not null default '[]'::jsonb check (jsonb_typeof(aliases) = 'array'),
  sort_order integer not null check (sort_order >= 0),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.esh_findings
  add column hazard_category_id uuid default focus.esh_unclassified_hazard_category_id()
    references public.esh_hazard_categories (id),
  add column problem_tag_id uuid references public.esh_problem_tags (id);

-- No historical Finding is assigned from title text, risk, source or location.
-- Every existing record is explicitly represented as unclassified instead.
update public.esh_findings
   set hazard_category_id = (
     select id from public.esh_hazard_categories where code = 'unclassified'
   )
 where hazard_category_id is null;

alter table public.esh_findings
  alter column hazard_category_id set not null;

create index esh_findings_category_idx
  on public.esh_findings (organization_id, hazard_category_id, reported_on desc);

create table public.esh_finding_classification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  finding_id uuid not null,
  old_hazard_category_id uuid not null references public.esh_hazard_categories (id),
  new_hazard_category_id uuid not null references public.esh_hazard_categories (id),
  old_problem_tag_id uuid references public.esh_problem_tags (id),
  new_problem_tag_id uuid references public.esh_problem_tags (id),
  rationale text not null check (length(btrim(rationale)) between 3 and 1000),
  decided_by uuid not null references public.user_profiles (id),
  decided_at timestamptz not null default now(),
  foreign key (organization_id, finding_id)
    references public.esh_findings (organization_id, id)
);

create index esh_classification_events_finding_idx
  on public.esh_finding_classification_events (finding_id, decided_at desc);

create table public.esh_finding_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- For recurrence this direction matters: previous closed Finding -> new one.
  -- For related_pattern the procedure stores the UUIDs in canonical order.
  source_finding_id uuid not null,
  target_finding_id uuid not null,
  relation_code text not null check (relation_code in ('recurrence', 'related_pattern')),
  rationale text not null check (length(btrim(rationale)) between 3 and 1000),
  state text not null default 'active' check (state in ('active', 'reversed')),
  confirmed_by uuid not null references public.user_profiles (id),
  confirmed_at timestamptz not null default now(),
  reversed_by uuid references public.user_profiles (id),
  reversed_at timestamptz,
  reversal_reason text,
  row_version integer not null default 1,
  check (source_finding_id <> target_finding_id),
  check (
    (state = 'active' and reversed_by is null and reversed_at is null and reversal_reason is null)
    or
    (state = 'reversed' and reversed_by is not null and reversed_at is not null
      and length(btrim(coalesce(reversal_reason, ''))) between 3 and 1000)
  ),
  check (relation_code <> 'related_pattern' or source_finding_id < target_finding_id),
  foreign key (organization_id, source_finding_id)
    references public.esh_findings (organization_id, id),
  foreign key (organization_id, target_finding_id)
    references public.esh_findings (organization_id, id)
);

create unique index esh_finding_relationship_active_unique
  on public.esh_finding_relationships
    (organization_id, source_finding_id, target_finding_id, relation_code)
  where state = 'active';

create index esh_finding_relationships_source_idx
  on public.esh_finding_relationships (source_finding_id, confirmed_at desc)
  where state = 'active';

create index esh_finding_relationships_target_idx
  on public.esh_finding_relationships (target_finding_id, confirmed_at desc)
  where state = 'active';

alter table public.esh_hazard_categories enable row level security;
alter table public.esh_problem_tags enable row level security;
alter table public.esh_finding_classification_events enable row level security;
alter table public.esh_finding_relationships enable row level security;

create policy esh_hazard_categories_esh_select on public.esh_hazard_categories
  as permissive for select to authenticated
  using ((select focus.esh_can('view')));

create policy esh_problem_tags_esh_select on public.esh_problem_tags
  as permissive for select to authenticated
  using ((select focus.esh_can('view')));

create policy esh_classification_events_select on public.esh_finding_classification_events
  as permissive for select to authenticated
  using (finding_id in (select f.id from public.esh_findings f));

-- A relationship must not disclose even the existence of a Finding outside the
-- reader's current department scope.
create policy esh_finding_relationships_select on public.esh_finding_relationships
  as permissive for select to authenticated
  using (
    source_finding_id in (select f.id from public.esh_findings f)
    and target_finding_id in (select f.id from public.esh_findings f)
  );

revoke all on public.esh_hazard_categories, public.esh_problem_tags,
  public.esh_finding_classification_events, public.esh_finding_relationships
  from anon, authenticated;

grant select on public.esh_hazard_categories, public.esh_problem_tags,
  public.esh_finding_classification_events, public.esh_finding_relationships
  to authenticated;

create or replace function public.esh_set_finding_classification(
  p_finding_id uuid,
  p_hazard_category_code text,
  p_problem_tag_code text,
  p_rationale text
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
  finding public.esh_findings%rowtype;
  category public.esh_hazard_categories%rowtype;
  tag public.esh_problem_tags%rowtype;
  v_category_code text := lower(nullif(btrim(coalesce(p_hazard_category_code, '')), ''));
  v_tag_code text := lower(nullif(btrim(coalesce(p_problem_tag_code, '')), ''));
  v_rationale text := nullif(btrim(coalesce(p_rationale, '')), '');
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if v_category_code is null or v_rationale is null
     or length(v_rationale) < 3 or length(v_rationale) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into finding from public.esh_findings
   where id = p_finding_id and organization_id = org for update;
  if not found or finding.status = 'draft'
     or not (focus.esh_scope_all()
       or finding.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'finding_not_found');
  end if;

  select * into category from public.esh_hazard_categories
   where code = v_category_code and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'category_not_available');
  end if;

  if v_tag_code is not null then
    select * into tag from public.esh_problem_tags
     where code = v_tag_code and is_active;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'tag_not_available');
    end if;
  end if;

  if finding.hazard_category_id = category.id
     and finding.problem_tag_id is not distinct from tag.id then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'finding_id', finding.id);
  end if;

  update public.esh_findings
     set hazard_category_id = category.id,
         problem_tag_id = tag.id,
         updated_at = now(),
         row_version = row_version + 1
   where id = finding.id;

  insert into public.esh_finding_classification_events
    (organization_id, finding_id, old_hazard_category_id, new_hazard_category_id,
     old_problem_tag_id, new_problem_tag_id, rationale, decided_by)
  values
    (org, finding.id, finding.hazard_category_id, category.id,
     finding.problem_tag_id, tag.id, v_rationale, actor);

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values
    (org, 'staff', actor, 'finding_classification_changed', finding.id,
     jsonb_build_object(
       'old_hazard_category_id', finding.hazard_category_id,
       'new_hazard_category_id', category.id,
       'old_problem_tag_id', finding.problem_tag_id,
       'new_problem_tag_id', tag.id,
       'rationale', v_rationale
     ));

  return jsonb_build_object(
    'ok', true,
    'code', 'classification_saved',
    'finding_id', finding.id,
    'hazard_category_code', category.code,
    'problem_tag_code', tag.code
  );
end;
$$;

create or replace function public.esh_link_findings(
  p_source_finding_id uuid,
  p_target_finding_id uuid,
  p_relation_code text,
  p_rationale text
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
  source_finding public.esh_findings%rowtype;
  target_finding public.esh_findings%rowtype;
  first_locked public.esh_findings%rowtype;
  second_locked public.esh_findings%rowtype;
  v_relation text := lower(nullif(btrim(coalesce(p_relation_code, '')), ''));
  v_rationale text := nullif(btrim(coalesce(p_rationale, '')), '');
  v_source uuid := p_source_finding_id;
  v_target uuid := p_target_finding_id;
  v_id uuid;
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if v_relation is null or v_relation not in ('recurrence', 'related_pattern') or v_rationale is null
     or length(v_rationale) < 3 or length(v_rationale) > 1000
     or v_source is null or v_target is null or v_source = v_target then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  -- Take both locks in UUID order, then restore the caller's intended roles.
  if v_source < v_target then
    select * into first_locked from public.esh_findings
     where id = v_source and organization_id = org for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    select * into second_locked from public.esh_findings
     where id = v_target and organization_id = org for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    source_finding := first_locked;
    target_finding := second_locked;
  else
    select * into first_locked from public.esh_findings
     where id = v_target and organization_id = org for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    select * into second_locked from public.esh_findings
     where id = v_source and organization_id = org for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    source_finding := second_locked;
    target_finding := first_locked;
  end if;
  if not (focus.esh_scope_all()
       or source_finding.accountable_department_id = any (focus.esh_visible_department_ids()))
     or not (focus.esh_scope_all()
       or target_finding.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'finding_not_found');
  end if;

  if v_relation = 'related_pattern' and v_source > v_target then
    v_source := p_target_finding_id;
    v_target := p_source_finding_id;
    source_finding := first_locked;
    target_finding := second_locked;
  elsif v_relation = 'recurrence' then
    if source_finding.status <> 'closed'
       or target_finding.status not in ('new', 'open') then
      return jsonb_build_object('ok', false, 'code', 'invalid_recurrence_state');
    end if;
    if exists (
      with recursive route(id, path) as (
        select r.target_finding_id, array[r.source_finding_id, r.target_finding_id]
          from public.esh_finding_relationships r
         where r.organization_id = org
           and r.state = 'active'
           and r.relation_code = 'recurrence'
           and r.source_finding_id = v_target
        union all
        select r.target_finding_id, route.path || r.target_finding_id
          from public.esh_finding_relationships r
          join route on r.source_finding_id = route.id
         where r.organization_id = org
           and r.state = 'active'
           and r.relation_code = 'recurrence'
           and not r.target_finding_id = any(route.path)
      )
      select 1 from route where id = v_source
    ) then
      return jsonb_build_object('ok', false, 'code', 'relationship_cycle');
    end if;
  end if;

  insert into public.esh_finding_relationships
    (organization_id, source_finding_id, target_finding_id, relation_code,
     rationale, confirmed_by)
  values (org, v_source, v_target, v_relation, v_rationale, actor)
  on conflict (organization_id, source_finding_id, target_finding_id, relation_code)
    where state = 'active'
  do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'relationship_exists');
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values
    (org, 'staff', actor, 'finding_relationship_confirmed', v_source,
     jsonb_build_object('relationship_id', v_id, 'relation_code', v_relation,
                        'other_finding_id', v_target, 'rationale', v_rationale)),
    (org, 'staff', actor, 'finding_relationship_confirmed', v_target,
     jsonb_build_object('relationship_id', v_id, 'relation_code', v_relation,
                        'other_finding_id', v_source, 'rationale', v_rationale));

  return jsonb_build_object('ok', true, 'code', 'relationship_created', 'relationship_id', v_id);
end;
$$;

create or replace function public.esh_reverse_finding_relationship(
  p_relationship_id uuid,
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
  relationship public.esh_finding_relationships%rowtype;
  source_finding public.esh_findings%rowtype;
  target_finding public.esh_findings%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into relationship from public.esh_finding_relationships
   where id = p_relationship_id and organization_id = org for update;
  if not found or relationship.state <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'relationship_not_found');
  end if;
  select * into source_finding from public.esh_findings
   where id = relationship.source_finding_id and organization_id = org;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'relationship_not_found');
  end if;
  select * into target_finding from public.esh_findings
   where id = relationship.target_finding_id and organization_id = org;
  if not found
     or not (focus.esh_scope_all()
       or source_finding.accountable_department_id = any (focus.esh_visible_department_ids()))
     or not (focus.esh_scope_all()
       or target_finding.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'relationship_not_found');
  end if;

  update public.esh_finding_relationships
     set state = 'reversed',
         reversed_by = actor,
         reversed_at = now(),
         reversal_reason = v_reason,
         row_version = row_version + 1
   where id = relationship.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values
    (org, 'staff', actor, 'finding_relationship_reversed', relationship.source_finding_id,
     jsonb_build_object('relationship_id', relationship.id, 'reason', v_reason,
                        'other_finding_id', relationship.target_finding_id)),
    (org, 'staff', actor, 'finding_relationship_reversed', relationship.target_finding_id,
     jsonb_build_object('relationship_id', relationship.id, 'reason', v_reason,
                        'other_finding_id', relationship.source_finding_id));

  return jsonb_build_object('ok', true, 'code', 'relationship_reversed', 'relationship_id', relationship.id);
end;
$$;

revoke all on function public.esh_set_finding_classification(uuid, text, text, text) from public, anon;
revoke all on function public.esh_link_findings(uuid, uuid, text, text) from public, anon;
revoke all on function public.esh_reverse_finding_relationship(uuid, text) from public, anon;

grant execute on function public.esh_set_finding_classification(uuid, text, text, text)
  to authenticated, service_role;
grant execute on function public.esh_link_findings(uuid, uuid, text, text)
  to authenticated, service_role;
grant execute on function public.esh_reverse_finding_relationship(uuid, text)
  to authenticated, service_role;

revoke all on function focus.esh_unclassified_hazard_category_id() from public, anon;
grant execute on function focus.esh_unclassified_hazard_category_id() to authenticated, service_role;

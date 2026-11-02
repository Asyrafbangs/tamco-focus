-- ============================================================================
-- v279 — related findings
--
-- Two directed finding-to-finding links already exist and neither is replaced
-- here. `esh_findings.duplicate_of_finding_id` (v209) says what a finding
-- repeats, and its check constraint ties it to `resolved_outcome = 'duplicate'`
-- so the register cannot claim a duplicate without saying what of.
-- `esh_effectiveness_checks.follow_up_finding_id` (v267) says what a failed
-- check raised, and v267 is deliberate that a failure must not reopen the
-- original: the original closure was a true statement about the month it was
-- made in. Moving either into this table would trade a database-enforced
-- invariant for tidiness and leave two answers to one question.
--
-- What neither can express is the undirected case: two findings that inform
-- each other without one repeating or replacing the other — the same guard on
-- a different machine, two reports from one walk, a corrective action whose
-- scope turned out to cover both. That relation is symmetric, so storing it
-- twice in opposite directions would let the two copies disagree. One row per
-- pair, ordered, with the ordering enforced.
--
-- No hazard taxonomy is introduced. Categories are an open decision for ESH
-- and the plant, and Stage 0 is explicit that historical categories must not
-- be inferred.
-- ============================================================================

create table public.esh_finding_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- Ordered, so one pair is one row whichever end it was created from.
  finding_id uuid not null,
  related_finding_id uuid not null,
  -- Why they are related. A link with no reason is a line nobody can act on,
  -- but a short one is normal here, so this is not the 3-character floor the
  -- effectiveness criteria carry.
  note text check (note is null or length(btrim(note)) > 0),
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, finding_id)
    references public.esh_findings (organization_id, id),
  foreign key (organization_id, related_finding_id)
    references public.esh_findings (organization_id, id),
  constraint esh_finding_links_ordered check (finding_id < related_finding_id)
);

-- The ordering constraint makes this the whole uniqueness rule: a pair cannot
-- be stored twice, and cannot be stored once each way.
create unique index esh_finding_links_pair_idx
  on public.esh_finding_links (organization_id, finding_id, related_finding_id);

-- Read from either end.
create index esh_finding_links_finding_idx
  on public.esh_finding_links (finding_id);
create index esh_finding_links_related_idx
  on public.esh_finding_links (related_finding_id);

comment on table public.esh_finding_links is
  'Symmetric related links between findings. Duplicate and recurrence links are not stored here: see esh_findings.duplicate_of_finding_id (v209) and esh_effectiveness_checks.follow_up_finding_id (v267).';

alter table public.esh_finding_links enable row level security;

-- Both ends must be visible. A link is a statement about two findings, so one
-- readable end is not enough to read it: a reader in one department would
-- otherwise learn the reference of a finding in a department they cannot see.
-- `esh_findings` carries its own scope policy, so delegating to it keeps one
-- definition of visible.
create policy esh_finding_links_select on public.esh_finding_links
  as permissive for select to authenticated
  using (
    finding_id in (select f.id from public.esh_findings f)
    and related_finding_id in (select f.id from public.esh_findings f)
  );

revoke all on public.esh_finding_links from anon, authenticated;
grant select on public.esh_finding_links to authenticated;

-- ---------------------------------------------------------------------------
-- Linking two findings
-- ---------------------------------------------------------------------------

create or replace function public.esh_link_related_findings(
  p_finding_id uuid,
  p_related_finding_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  low_id uuid := least(p_finding_id, p_related_finding_id);
  high_id uuid := greatest(p_finding_id, p_related_finding_id);
  subject_finding public.esh_findings%rowtype;
  other_finding public.esh_findings%rowtype;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  link_id uuid;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if p_finding_id is null or p_related_finding_id is null then
    return jsonb_build_object('ok', false, 'code', 'finding_required');
  end if;
  if p_finding_id = p_related_finding_id then
    return jsonb_build_object('ok', false, 'code', 'same_finding');
  end if;

  -- Checked in the order the caller passed them, not in stored order: which
  -- of the two is `low_id` depends on how the identifiers happen to sort, so
  -- keying the codes off that would make the refusal nondeterministic for an
  -- unchanged call.
  select * into subject_finding from public.esh_findings
   where id = p_finding_id and organization_id = org;
  -- Negated scope checks are `<> all`, never `<> any`: 'a' <> any {a,b} is
  -- true, so `any` would refuse every coordinator covering more than one
  -- department. The null branch is explicit because `<> all` on null yields
  -- null, which an `if` does not take.
  if not found
     or (not focus.esh_scope_all()
         and (subject_finding.accountable_department_id is null
              or subject_finding.accountable_department_id
                 <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into other_finding from public.esh_findings
   where id = p_related_finding_id and organization_id = org;
  if not found
     or (not focus.esh_scope_all()
         and (other_finding.accountable_department_id is null
              or other_finding.accountable_department_id
                 <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'related_not_found');
  end if;

  -- Linking the same pair again updates the reason rather than failing: the
  -- second attempt is somebody saying it better, not a mistake.
  insert into public.esh_finding_links
    (organization_id, finding_id, related_finding_id, note, created_by)
  values (org, low_id, high_id, note, actor)
  on conflict (organization_id, finding_id, related_finding_id)
    do update set note = excluded.note
  returning id into link_id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'finding_related_linked', p_finding_id,
    jsonb_build_object('related_finding_id', p_related_finding_id, 'note', note));

  return jsonb_build_object('ok', true, 'id', link_id);
end;
$$;

revoke all on function public.esh_link_related_findings(uuid, uuid, text) from public, anon;
grant execute on function public.esh_link_related_findings(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Removing a link
-- ---------------------------------------------------------------------------

create or replace function public.esh_unlink_related_findings(
  p_finding_id uuid,
  p_related_finding_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  low_id uuid := least(p_finding_id, p_related_finding_id);
  high_id uuid := greatest(p_finding_id, p_related_finding_id);
  link public.esh_finding_links%rowtype;
  subject public.esh_findings%rowtype;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  select * into link from public.esh_finding_links
   where organization_id = org and finding_id = low_id and related_finding_id = high_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Removing a link is a change to both findings, so both ends are checked the
  -- same way linking them was. This function is SECURITY DEFINER and so reads
  -- the link row past RLS; the scope check has to be explicit.
  select * into subject from public.esh_findings where id = low_id and organization_id = org;
  if not found
     or (not focus.esh_scope_all()
         and (subject.accountable_department_id is null
              or subject.accountable_department_id
                 <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into subject from public.esh_findings where id = high_id and organization_id = org;
  if not found
     or (not focus.esh_scope_all()
         and (subject.accountable_department_id is null
              or subject.accountable_department_id
                 <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  delete from public.esh_finding_links where id = link.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'finding_related_unlinked', p_finding_id,
    jsonb_build_object('related_finding_id', p_related_finding_id));

  return jsonb_build_object('ok', true, 'id', link.id);
end;
$$;

revoke all on function public.esh_unlink_related_findings(uuid, uuid) from public, anon;
grant execute on function public.esh_unlink_related_findings(uuid, uuid) to authenticated;

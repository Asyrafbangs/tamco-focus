-- ============================================================================
-- v205 ESH Finding Management: the existing backlog, reviewed once.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §38, §39
-- and §42; FM83-FM89, FM100.
--
-- Ninety-odd unresolved items live in somebody's workbook. Retyping them is
-- how half of them would be lost, so they are imported — but an import that
-- writes straight into live findings would also send ninety emails, reset
-- ninety deadlines and call every "Done" in that file verified. So the file
-- lands in staging: every row keeps its original values, every row reaches an
-- explicit outcome, and nothing is live, counted or notified until somebody
-- releases the rows they have actually reviewed.
--
-- The workbook itself has not been supplied. Nothing here assumes its columns:
-- the mapping is chosen by the person importing, against the headers their own
-- file has, and is stored with the batch so the reading can be explained later.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The file, and how it was read
-- ---------------------------------------------------------------------------

create table public.esh_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  source_name text not null check (length(btrim(source_name)) between 1 and 200),
  -- sha256 of the bytes, so the same file uploaded twice is recognised.
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  -- Which register these references belong to, with the original reference,
  -- is the import identity: a system reference stays separate (§38.1).
  source_register text not null check (length(btrim(source_register)) between 1 and 80),
  storage_path text,
  sheet_name text,
  sheet_path text,
  header_line integer check (header_line between 1 and 10000),
  -- 04/05/2026 is two different days; the reading is chosen, not guessed.
  date_convention text not null default 'dmy'
    check (date_convention in ('dmy', 'mdy', 'iso')),
  mapping jsonb not null default '{}'::jsonb,
  mapping_version integer not null default 1 check (mapping_version > 0),
  state text not null default 'mapping'
    check (state in ('mapping', 'staged', 'released', 'discarded')),
  source_rows integer not null default 0,
  ignored_rows integer not null default 0,
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  staged_at timestamptz,
  released_at timestamptz,
  released_by uuid references public.user_profiles (id),
  discarded_at timestamptz,
  discarded_by uuid references public.user_profiles (id),
  discard_reason text,
  unique (organization_id, id)
);

-- The same file, uploaded again, is one import: a second batch for it would be
-- ninety duplicate findings with nothing to link them back to (§38.2).
create unique index esh_import_batch_hash_idx
  on public.esh_import_batches (organization_id, source_hash)
  where state <> 'discarded';
create index esh_import_batch_state_idx
  on public.esh_import_batches (organization_id, state, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Every nonblank row, and what became of it
-- ---------------------------------------------------------------------------

create table public.esh_import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  batch_id uuid not null,
  source_line integer not null check (source_line > 0),
  -- The row as the workbook holds it, header to original text. Kept whatever
  -- happens to it, so a reading can be argued with afterwards (§38.2).
  raw jsonb not null,
  -- The same row against this organisation's own values.
  mapped jsonb not null default '{}'::jsonb,
  source_reference text,
  -- A normalised shape of reference, description and owner, for spotting a
  -- probable repeat where the file has no reference at all.
  fingerprint text,
  outcome text not null default 'blocked'
    check (outcome in ('ignored', 'ready', 'blocked', 'duplicate', 'linked', 'released')),
  problems text[] not null default '{}',
  needs_assignment boolean not null default false,
  duplicate_of_finding_id uuid,
  resolution text check (resolution in ('skip', 'link', 'update')),
  resolution_note text,
  resolved_by uuid references public.user_profiles (id),
  resolved_at timestamptz,
  finding_id uuid,
  action_id uuid,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, batch_id)
    references public.esh_import_batches (organization_id, id) on delete cascade,
  foreign key (organization_id, duplicate_of_finding_id)
    references public.esh_findings (organization_id, id),
  unique (batch_id, source_line),
  unique (organization_id, id),
  -- A row that produced something says what it produced.
  check ((outcome = 'released') = (finding_id is not null)),
  check ((outcome = 'released') = (released_at is not null))
);

create index esh_import_rows_batch_idx
  on public.esh_import_rows (batch_id, outcome, source_line);
create index esh_import_rows_reference_idx
  on public.esh_import_rows (organization_id, source_reference)
  where source_reference is not null;

-- A name in a spreadsheet is not an address. Where the file gives one without
-- the other, ESH decides once for the batch and every row it affects follows
-- (§38.2). A decision of "no address yet" is a decision, and is kept.
create table public.esh_import_owner_emails (
  batch_id uuid not null references public.esh_import_batches (id) on delete cascade,
  source_name text not null check (length(btrim(source_name)) between 1 and 200),
  canonical_email text,
  decided_by uuid not null references public.user_profiles (id),
  decided_at timestamptz not null default now(),
  primary key (batch_id, source_name)
);

-- Photographs in the file, and references to places this server will not go.
-- Nothing is fetched from a supplied URL and nothing is silently dropped: each
-- one has a visible outcome before the batch can be released (§38.1, FM87).
create table public.esh_import_evidence_refs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  batch_id uuid not null,
  row_id uuid references public.esh_import_rows (id) on delete cascade,
  kind text not null check (kind in ('embedded_image', 'link', 'local_path')),
  detail text not null check (length(btrim(detail)) between 1 and 2000),
  state text not null default 'unresolved'
    check (state in ('unresolved', 'imported', 'acknowledged', 'failed')),
  asset_id uuid references public.esh_evidence_assets (id),
  failure text,
  acknowledged_by uuid references public.user_profiles (id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, batch_id)
    references public.esh_import_batches (organization_id, id) on delete cascade,
  -- An image with no row is a floating one: it belongs to nobody until ESH
  -- says so, and is never given to the nearest finding (§38.1).
  check (kind <> 'embedded_image' or state <> 'imported' or row_id is not null)
);

create index esh_import_evidence_refs_batch_idx
  on public.esh_import_evidence_refs (batch_id, state);

-- ---------------------------------------------------------------------------
-- 3. What a finding remembers about where it came from
-- ---------------------------------------------------------------------------

-- v197 already kept `source` ('import' is one of its values) and the original
-- `source_reference`. What was missing is which register that reference
-- belongs to, and which import it arrived in.
alter table public.esh_findings
  add column source_register text,
  add column import_batch_id uuid references public.esh_import_batches (id),
  add column import_row_id uuid;

-- One register reference is one finding, so a re-import links rather than
-- creates (§38.2).
create unique index esh_findings_source_reference_idx
  on public.esh_findings (organization_id, source_register, source_reference)
  where source_register is not null and source_reference is not null;

alter table public.esh_import_rows
  add constraint esh_import_rows_finding_fk
  foreign key (organization_id, finding_id)
    references public.esh_findings (organization_id, id);
-- ---------------------------------------------------------------------------
-- 4. Who may see and do any of this
--
-- Staging is Finding work, not administration: the same coordinate authority
-- that creates a finding by hand imports a file of them, within the same
-- department scope. Nothing here is visible to an Action Owner: a staged row
-- has no owner yet, by definition.
-- ---------------------------------------------------------------------------

alter table public.esh_guest_session_escalations enable row level security;

alter table public.esh_import_batches enable row level security;
alter table public.esh_import_rows enable row level security;
alter table public.esh_import_owner_emails enable row level security;
alter table public.esh_import_evidence_refs enable row level security;

create policy esh_import_batches_select on public.esh_import_batches
  as permissive for select to authenticated
  using ((select focus.esh_enabled())
         and organization_id = (select focus.esh_organization_id())
         and (select focus.esh_can('coordinate')));
create policy esh_import_rows_select on public.esh_import_rows
  as permissive for select to authenticated
  using (batch_id in (select id from public.esh_import_batches));
create policy esh_import_owner_emails_select on public.esh_import_owner_emails
  as permissive for select to authenticated
  using (batch_id in (select id from public.esh_import_batches));
create policy esh_import_evidence_refs_select on public.esh_import_evidence_refs
  as permissive for select to authenticated
  using (batch_id in (select id from public.esh_import_batches));

revoke all on public.esh_import_batches, public.esh_import_rows,
  public.esh_import_owner_emails, public.esh_import_evidence_refs
  from anon, authenticated;
grant select on public.esh_import_batches, public.esh_import_rows,
  public.esh_import_owner_emails, public.esh_import_evidence_refs to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Follow-up does not start the moment a backlog lands
--
-- Ninety rows, most of them long overdue, would otherwise produce ninety
-- reminders and their escalations on the next daily run — for work nobody has
-- been told about yet. Release sets when following up begins; until then the
-- action is live and overdue on the register, and quiet by email (§38.3).
-- ---------------------------------------------------------------------------

alter table public.esh_finding_actions
  add column followup_active_from timestamptz;

comment on column public.esh_finding_actions.followup_active_from is
  'Reminders and escalation for this action begin at this moment (v205 import).';

-- ---------------------------------------------------------------------------
-- 6. Reading a staged row
-- ---------------------------------------------------------------------------

-- The organisation's own department, by code or by name, or nothing.
create or replace function focus.esh_import_department(p_value text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select department.id
    from public.departments department
   where department.status = 'active'
     and (lower(btrim(department.code)) = lower(btrim(p_value))
          or lower(btrim(department.name)) = lower(btrim(p_value)))
   order by case when lower(btrim(department.code)) = lower(btrim(p_value)) then 0 else 1 end
   limit 1;
$$;

/**
 * What a row is, once this organisation has looked at it.
 *
 * Returns the row's outcome and its problems. Deciding here rather than in the
 * browser is the point: the preview a person approves and the release that
 * follows are the same judgment, made twice by the same code, against the
 * departments and addresses as they are at that moment.
 */
create or replace function focus.esh_import_verdict(
  p_batch public.esh_import_batches,
  p_mapped jsonb,
  p_owner_decision text,
  out outcome text,
  out problems text[],
  out needs_assignment boolean,
  out duplicate_of uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_reference text := nullif(btrim(coalesce(p_mapped->>'reference', '')), '');
  v_description text := nullif(btrim(coalesce(p_mapped->>'description', '')), '');
  v_action text := nullif(btrim(coalesce(p_mapped->>'action', '')), '');
  v_department text := nullif(btrim(coalesce(p_mapped->>'department', '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_mapped->>'owner_email', '')), ''));
  v_due text := nullif(btrim(coalesce(p_mapped->>'due_on', '')), '');
  v_reported text := nullif(btrim(coalesce(p_mapped->>'reported_on', '')), '');
  v_priority text := lower(nullif(btrim(coalesce(p_mapped->>'priority', '')), ''));
  v_risk text := lower(nullif(btrim(coalesce(p_mapped->>'risk', '')), ''));
begin
  problems := '{}';
  needs_assignment := false;
  duplicate_of := null;

  if v_description is null and v_reference is null then
    outcome := 'ignored';
    return;
  end if;

  if v_description is null then problems := array_append(problems, 'description_missing'); end if;
  if v_action is null then problems := array_append(problems, 'action_missing'); end if;
  if v_department is null then
    problems := array_append(problems, 'department_missing');
  elsif focus.esh_import_department(v_department) is null then
    problems := array_append(problems, 'department_unknown');
  end if;

  if p_owner_decision is not null then v_email := lower(btrim(p_owner_decision)); end if;
  if v_email is null then
    needs_assignment := true;
    problems := array_append(problems, 'owner_unassigned');
  elsif v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]+$' then
    problems := array_append(problems, 'owner_email_invalid');
  end if;

  if v_due is null then
    problems := array_append(problems, 'due_missing');
  else
    begin
      if v_due::date > (current_date + interval '10 years') then
        problems := array_append(problems, 'due_far_future');
      end if;
    exception when others then
      problems := array_append(problems, 'due_unreadable');
    end;
  end if;

  -- A finding says when it was found. The file's own date is used, or ESH
  -- writes one; today's date is never quietly put in its place (§38.1).
  if v_reported is null then
    problems := array_append(problems, 'reported_missing');
  else
    begin
      perform v_reported::date;
    exception when others then
      problems := array_append(problems, 'reported_unreadable');
    end;
  end if;

  -- Priority organises somebody's week, so it is reviewed rather than
  -- defaulted to Normal for a whole backlog (§39).
  if v_priority is null or v_priority not in ('urgent', 'high', 'normal') then
    problems := array_append(problems, 'priority_unreviewed');
  end if;

  -- Risk is an assessment, not a column to be mapped by arithmetic: anything
  -- unrecognised reads Not assessed, and says so rather than blocking (§39).
  if v_risk is not null and v_risk not in ('low', 'medium', 'high', 'critical') then
    problems := array_append(problems, 'risk_not_assessed');
  end if;

  if v_reference is not null then
    select finding.id into duplicate_of
      from public.esh_findings finding
     where finding.organization_id = p_batch.organization_id
       and finding.source_register = p_batch.source_register
       and finding.source_reference = v_reference
     limit 1;
  end if;

  if duplicate_of is not null then
    outcome := 'duplicate';
  elsif array_length(array_remove(problems, 'risk_not_assessed'), 1) is null then
    outcome := 'ready';
  else
    outcome := 'blocked';
  end if;
end;
$$;
-- ---------------------------------------------------------------------------
-- 7. Uploading a workbook, and reading it into staging
-- ---------------------------------------------------------------------------

/**
 * A file arrives.
 *
 * The bytes are already in the private store; this records what was uploaded
 * and how it is being read. The same file twice is the same import: the second
 * upload is told which batch already has it rather than quietly making a
 * second one (§38.2).
 */
create or replace function public.esh_import_start(
  p_source_name text,
  p_source_hash text,
  p_source_register text,
  p_storage_path text,
  p_sheet_name text,
  p_sheet_path text,
  p_header_line integer,
  p_date_convention text,
  p_mapping jsonb,
  p_source_rows integer
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
  existing public.esh_import_batches;
  batch public.esh_import_batches;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if coalesce(p_source_hash, '') !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_source_name, ''))) not between 1 and 200
     or length(btrim(coalesce(p_source_register, ''))) not between 1 and 80
     or coalesce(p_date_convention, '') not in ('dmy', 'mdy', 'iso')
     or coalesce(p_header_line, 0) < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into existing from public.esh_import_batches
   where organization_id = org and source_hash = p_source_hash and state <> 'discarded';
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_imported',
                              'batch_id', existing.id, 'state', existing.state);
  end if;

  insert into public.esh_import_batches
    (organization_id, source_name, source_hash, source_register, storage_path,
     sheet_name, sheet_path, header_line, date_convention, mapping, source_rows, created_by)
  values
    (org, btrim(p_source_name), p_source_hash, btrim(p_source_register), p_storage_path,
     p_sheet_name, p_sheet_path, p_header_line, p_date_convention,
     coalesce(p_mapping, '{}'::jsonb), greatest(coalesce(p_source_rows, 0), 0), actor)
  returning * into batch;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'import_started',
          jsonb_build_object('batch_id', batch.id, 'source_name', batch.source_name,
                             'source_register', batch.source_register,
                             'sheet', batch.sheet_name, 'header_line', batch.header_line,
                             'date_convention', batch.date_convention));

  return jsonb_build_object('ok', true, 'batch_id', batch.id);
end;
$$;

/**
 * The rows, as read, with what this organisation makes of each one.
 *
 * Sent again whenever the mapping changes, which replaces everything not yet
 * released and leaves what is. Nothing here is live: a staged row is not a
 * finding, has no owner, is in no count and starts no timer (§38.2).
 */
create or replace function public.esh_import_stage(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  batch public.esh_import_batches;
  entry jsonb;
  v_mapped jsonb;
  v_decision text;
  v_verdict record;
  v_reference text;
  v_ignored integer := 0;
  v_line integer;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into batch from public.esh_import_batches
   where id = p_batch_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if batch.state not in ('mapping', 'staged') then
    return jsonb_build_object('ok', false, 'code', 'not_staging', 'state', batch.state);
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  -- A backlog is bounded work, and an unbounded one is somebody's mistake.
  if jsonb_array_length(p_rows) > 5000 then
    return jsonb_build_object('ok', false, 'code', 'too_many_rows');
  end if;

  delete from public.esh_import_rows
   where batch_id = batch.id and outcome <> 'released';

  for entry in select value from jsonb_array_elements(p_rows) loop
    v_line := (entry->>'line')::integer;
    if v_line is null or v_line < 1 then continue; end if;
    if exists (select 1 from public.esh_import_rows
                where batch_id = batch.id and source_line = v_line) then
      continue;
    end if;
    v_mapped := coalesce(entry->'mapped', '{}'::jsonb);
    v_reference := nullif(btrim(coalesce(v_mapped->>'reference', '')), '');
    select canonical_email into v_decision from public.esh_import_owner_emails
     where batch_id = batch.id
       and lower(source_name) = lower(btrim(coalesce(v_mapped->>'owner_name', '')));

    select * into v_verdict from focus.esh_import_verdict(batch, v_mapped, v_decision);
    if v_verdict.outcome = 'ignored' then v_ignored := v_ignored + 1; end if;

    insert into public.esh_import_rows
      (organization_id, batch_id, source_line, raw, mapped, source_reference, fingerprint,
       outcome, problems, needs_assignment, duplicate_of_finding_id)
    values
      (org, batch.id, v_line, coalesce(entry->'raw', '{}'::jsonb), v_mapped, v_reference,
       -- Where a file has no references at all, a repeat still looks like one.
       md5(lower(regexp_replace(
         coalesce(v_reference, '') || '|' || coalesce(v_mapped->>'description', '') || '|'
           || coalesce(v_mapped->>'owner_email', ''), '\s+', ' ', 'g'))),
       v_verdict.outcome, v_verdict.problems, v_verdict.needs_assignment, v_verdict.duplicate_of);
  end loop;

  update public.esh_import_batches set
    state = 'staged',
    staged_at = now(),
    ignored_rows = v_ignored,
    source_rows = greatest(source_rows, jsonb_array_length(p_rows))
   where id = batch.id;

  return public.esh_import_reconciliation(batch.id);
end;
$$;

/** Source rows in, and what each of them became. Every one is accounted for. */
create or replace function public.esh_import_reconciliation(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  batch public.esh_import_batches;
  counts jsonb;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into batch from public.esh_import_batches
   where id = p_batch_id and organization_id = focus.esh_organization_id();
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select jsonb_object_agg(outcome, total) into counts
    from (select outcome, count(*)::integer as total
            from public.esh_import_rows where batch_id = batch.id group by outcome) totals;

  return jsonb_build_object(
    'ok', true,
    'batch_id', batch.id,
    'state', batch.state,
    'source_rows', batch.source_rows,
    'ignored', batch.ignored_rows,
    'counts', coalesce(counts, '{}'::jsonb),
    'needs_assignment', (select count(*)::integer from public.esh_import_rows
                          where batch_id = batch.id and needs_assignment),
    'unresolved_evidence', (select count(*)::integer from public.esh_import_evidence_refs
                             where batch_id = batch.id and state = 'unresolved'));
end;
$$;
-- ---------------------------------------------------------------------------
-- 8. The decisions a person makes about a staged row
-- ---------------------------------------------------------------------------

/** Re-reads every row of a batch against the decisions made since staging. */
create or replace function focus.esh_import_revalidate(p_batch_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  batch public.esh_import_batches;
  row_record public.esh_import_rows;
  v_decision text;
  v_verdict record;
begin
  select * into batch from public.esh_import_batches where id = p_batch_id;
  for row_record in
    select * from public.esh_import_rows
     where batch_id = p_batch_id and outcome not in ('released', 'ignored')
  loop
    select canonical_email into v_decision from public.esh_import_owner_emails
     where batch_id = batch.id
       and lower(source_name) = lower(btrim(coalesce(row_record.mapped->>'owner_name', '')));
    select * into v_verdict from focus.esh_import_verdict(batch, row_record.mapped, v_decision);
    update public.esh_import_rows set
      outcome = case
                  -- A decision already taken about a repeat is not overwritten
                  -- by rereading the file.
                  when row_record.resolution = 'skip' then 'duplicate'
                  when row_record.resolution = 'link' then 'linked'
                  else v_verdict.outcome
                end,
      problems = v_verdict.problems,
      needs_assignment = v_verdict.needs_assignment,
      duplicate_of_finding_id = coalesce(row_record.duplicate_of_finding_id, v_verdict.duplicate_of),
      updated_at = now()
     where id = row_record.id;
  end loop;
end;
$$;

/** One name, one address, for this batch and every row it appears in (§38.2). */
create or replace function public.esh_import_set_owner_email(
  p_batch_id uuid, p_source_name text, p_email text
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
  batch public.esh_import_batches;
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into batch from public.esh_import_batches
   where id = p_batch_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if batch.state <> 'staged' then
    return jsonb_build_object('ok', false, 'code', 'not_staging', 'state', batch.state);
  end if;
  if length(btrim(coalesce(p_source_name, ''))) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  -- An address is entered, never guessed from a name (§38.1).
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'code', 'owner_email_invalid');
  end if;

  insert into public.esh_import_owner_emails (batch_id, source_name, canonical_email, decided_by)
  values (batch.id, btrim(p_source_name), v_email, actor)
  on conflict (batch_id, source_name) do update
    set canonical_email = excluded.canonical_email,
        decided_by = excluded.decided_by,
        decided_at = now();

  perform focus.esh_import_revalidate(batch.id);
  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'import_owner_decided',
          jsonb_build_object('batch_id', batch.id, 'source_name', btrim(p_source_name),
                             'assigned', v_email is not null));
  return public.esh_import_reconciliation(batch.id);
end;
$$;

/**
 * ESH completes what the file left out.
 *
 * The patch changes the mapped reading, never the original: `raw` is what the
 * workbook said and stays that way, so a corrected due date can always be told
 * apart from the one that was imported (§38.1).
 */
create or replace function public.esh_import_amend_row(p_row_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  row_record public.esh_import_rows;
  batch public.esh_import_batches;
  v_decision text;
  v_verdict record;
  v_mapped jsonb;
  v_key text;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into row_record from public.esh_import_rows
   where id = p_row_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if row_record.outcome = 'released' then
    return jsonb_build_object('ok', false, 'code', 'already_released');
  end if;
  if jsonb_typeof(coalesce(p_patch, 'null'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('title', 'description', 'action', 'department', 'location', 'owner_email',
                     'reported_on', 'due_on', 'risk', 'priority', 'remarks') then
      return jsonb_build_object('ok', false, 'code', 'unknown_field', 'field', v_key);
    end if;
  end loop;

  select * into batch from public.esh_import_batches where id = row_record.batch_id;
  v_mapped := row_record.mapped || p_patch;
  select canonical_email into v_decision from public.esh_import_owner_emails
   where batch_id = batch.id
     and lower(source_name) = lower(btrim(coalesce(v_mapped->>'owner_name', '')));
  select * into v_verdict from focus.esh_import_verdict(batch, v_mapped, v_decision);

  update public.esh_import_rows set
    mapped = v_mapped,
    outcome = case when resolution in ('skip', 'link') then outcome else v_verdict.outcome end,
    problems = v_verdict.problems,
    needs_assignment = v_verdict.needs_assignment,
    updated_at = now()
   where id = row_record.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'import_row_amended',
          jsonb_build_object('batch_id', batch.id, 'row_id', row_record.id,
                             'fields', (select jsonb_agg(key) from jsonb_object_keys(p_patch) key)));
  return jsonb_build_object('ok', true, 'outcome', v_verdict.outcome,
                            'problems', to_jsonb(v_verdict.problems));
end;
$$;

/** Skip it, link it to the finding that already exists, or review an update. */
create or replace function public.esh_import_resolve_row(
  p_row_id uuid, p_resolution text, p_note text
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
  row_record public.esh_import_rows;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if coalesce(p_resolution, '') not in ('skip', 'link', 'update') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into row_record from public.esh_import_rows
   where id = p_row_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if row_record.outcome = 'released' then
    return jsonb_build_object('ok', false, 'code', 'already_released');
  end if;
  if p_resolution in ('skip', 'link') and row_record.duplicate_of_finding_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_duplicate');
  end if;

  update public.esh_import_rows set
    resolution = p_resolution,
    resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
    resolved_by = actor,
    resolved_at = now(),
    -- Linking records that this row is that finding. It does not rewrite the
    -- finding's conversation, evidence or deadline (§38.2); a proposed update
    -- stays a proposal until somebody makes it by hand.
    outcome = case p_resolution
                when 'skip' then 'duplicate'
                when 'link' then 'linked'
                else 'duplicate'
              end,
    finding_id = case when p_resolution = 'link' then duplicate_of_finding_id else finding_id end,
    updated_at = now()
   where id = row_record.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'import_row_resolved', row_record.duplicate_of_finding_id,
          jsonb_build_object('batch_id', row_record.batch_id, 'row_id', row_record.id,
                             'resolution', p_resolution));
  return public.esh_import_reconciliation(row_record.batch_id);
end;
$$;

/** A photograph or a link the import could not bring in, answered for. */
create or replace function public.esh_import_acknowledge_evidence(p_ref_id uuid, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  reference public.esh_import_evidence_refs;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into reference from public.esh_import_evidence_refs
   where id = p_ref_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if reference.state = 'imported' then
    return jsonb_build_object('ok', false, 'code', 'already_imported');
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  update public.esh_import_evidence_refs set
    state = 'acknowledged',
    failure = btrim(p_note),
    acknowledged_by = actor,
    acknowledged_at = now()
   where id = reference.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'import_evidence_acknowledged',
          jsonb_build_object('batch_id', reference.batch_id, 'reference_id', reference.id,
                             'kind', reference.kind));
  return jsonb_build_object('ok', true);
end;
$$;
-- ---------------------------------------------------------------------------
-- 9. Release: the moment staged rows become work somebody owns
-- ---------------------------------------------------------------------------

-- One letter per owner per released batch, rather than one per action: a
-- person handed eleven backlog items should receive eleven items, once (§41).
alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_event_type_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_event_type_check
  check (event_type in ('owner_assignment', 'esh_reply', 'access_link',
                        'submission_received', 'submission_withdrawn',
                        'changes_requested', 'due_changed', 'finding_closed',
                        'finding_reopened', 'reassigned_away',
                        'owner_reminder', 'escalation', 'review_reminder',
                        'escalation_exhausted', 'owner_reply',
                        'escalation_reply', 'import_assignment'));
alter table public.esh_notification_outbox
  add column import_batch_id uuid references public.esh_import_batches (id);

-- A batch summary belongs to a dozen findings rather than one, so the policy
-- that shows ESH what is waiting to go out has to recognise it too. Without
-- this, a summary held because a contact's access is off would be waiting
-- where nobody could see it.
drop policy esh_notification_outbox_select on public.esh_notification_outbox;
create policy esh_notification_outbox_select on public.esh_notification_outbox
  as permissive for select to authenticated
  using (finding_id in (select f.id from public.esh_findings f)
         or import_batch_id in (select b.id from public.esh_import_batches b));

/**
 * Release the rows somebody has actually reviewed.
 *
 * Findings are created through the same routine the New finding screen uses,
 * so an imported finding is not a second kind of finding: same reference
 * series, same assignment record, same audit. Three things are this routine's
 * own. The owner's letter is one summary for the batch rather than one email
 * per row. The due date in the file is kept, however old — import is not a way
 * to make ninety late items look on time (§38.3). And following up starts when
 * this says it starts, so the first daily run after a backlog release does not
 * escalate ninety items that nobody has been told about yet.
 */
create or replace function public.esh_import_release(
  p_batch_id uuid,
  p_row_ids uuid[],
  p_followup_from timestamptz,
  p_idempotency_key text default null
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
  replay jsonb;
  batch public.esh_import_batches;
  row_record public.esh_import_rows;
  saved jsonb;
  v_payload jsonb;
  v_created integer := 0;
  v_owners integer := 0;
  v_followup timestamptz := coalesce(p_followup_from, now());
  v_result jsonb;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  replay := focus.replay_operation(actor, p_idempotency_key);
  if replay is not null then return replay; end if;

  select * into batch from public.esh_import_batches
   where id = p_batch_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if batch.state <> 'staged' then
    return jsonb_build_object('ok', false, 'code', 'not_staging', 'state', batch.state);
  end if;
  if coalesce(cardinality(p_row_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_selected');
  end if;
  -- Following up cannot be pushed into next year to hide a late backlog.
  if v_followup > now() + interval '30 days' then
    return jsonb_build_object('ok', false, 'code', 'followup_too_far');
  end if;

  if exists (select 1 from public.esh_import_rows
              where batch_id = batch.id and id = any(p_row_ids) and outcome <> 'ready') then
    return jsonb_build_object('ok', false, 'code', 'row_not_ready');
  end if;
  if exists (select 1 from public.esh_import_evidence_refs
              where batch_id = batch.id and state = 'unresolved'
                and (row_id is null or row_id = any(p_row_ids))) then
    return jsonb_build_object('ok', false, 'code', 'evidence_unresolved');
  end if;

  for row_record in
    select * from public.esh_import_rows
     where batch_id = batch.id and id = any(p_row_ids) and outcome = 'ready'
     order by source_line
     for update
  loop
    v_payload := jsonb_build_object(
      'title', left(coalesce(nullif(btrim(coalesce(row_record.mapped->>'title', '')), ''),
                             btrim(row_record.mapped->>'description')), 200),
      'description', row_record.mapped->>'description',
      'reported_on', nullif(btrim(coalesce(row_record.mapped->>'reported_on', '')), ''),
      'location', nullif(btrim(coalesce(row_record.mapped->>'location', '')), ''),
      'accountable_department_id',
        focus.esh_import_department(row_record.mapped->>'department'),
      'risk_level', case
                      when lower(coalesce(row_record.mapped->>'risk', ''))
                           in ('low', 'medium', 'high', 'critical')
                      then lower(row_record.mapped->>'risk') else 'not_assessed' end,
      'source', 'import',
      'source_reference', row_record.source_reference,
      'source_register', batch.source_register,
      'import_batch_id', batch.id,
      'import_row_id', row_record.id,
      'followup_active_from', v_followup,
      'required_outcome', row_record.mapped->>'action',
      'action_title', left(coalesce(nullif(btrim(coalesce(row_record.mapped->>'title', '')), ''),
                                    btrim(row_record.mapped->>'description')), 200),
      'priority', lower(row_record.mapped->>'priority'),
      'owner_email', coalesce(
        (select canonical_email from public.esh_import_owner_emails
          where batch_id = batch.id
            and lower(source_name) = lower(btrim(coalesce(row_record.mapped->>'owner_name', '')))),
        lower(btrim(row_record.mapped->>'owner_email'))),
      'due_date', row_record.mapped->>'due_on',
      'escalation', '[]'::jsonb,
      'no_further_escalation_reason',
        'Imported backlog: the escalation route is set on review.');

    saved := public.esh_save_finding(null, v_payload, true,
                                     'import:' || batch.id || ':' || row_record.id);
    if not coalesce((saved->>'ok')::boolean, false) then
      -- One row that will not save stops the release rather than leaving half a
      -- backlog live with no way to tell which half.
      raise exception 'import row % could not be released: %', row_record.source_line, saved
        using errcode = 'data_exception';
    end if;

    update public.esh_import_rows set
      outcome = 'released',
      finding_id = (saved->>'finding_id')::uuid,
      action_id = (saved->>'action_id')::uuid,
      released_at = now(),
      updated_at = now()
     where id = row_record.id;

    -- The file's own remarks are history, recorded as provenance. They are
    -- never presented as something the owner wrote (§38.1).
    if nullif(btrim(coalesce(row_record.mapped->>'remarks', '')), '') is not null then
      insert into public.esh_audit_events
        (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
      values
        (org, 'staff', actor, 'import_note', (saved->>'finding_id')::uuid,
         (saved->>'action_id')::uuid,
         jsonb_build_object('batch_id', batch.id, 'source_line', row_record.source_line,
                            'source_status', row_record.mapped->>'status',
                            'remarks', left(btrim(row_record.mapped->>'remarks'), 4000)));
    end if;

    v_created := v_created + 1;
  end loop;

  -- One delivery per owner in this release, held where that contact's access
  -- is off, exactly as a single assignment would be (§43.4).
  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, import_batch_id, state,
     link_intents, idempotency_key, next_attempt_at)
  select org, 'import_assignment', action.owner_principal_id, batch.id,
         case when focus.esh_contact_usable(action.owner_principal_id)
              then 'queued' else 'held_rollout' end,
         '["owner_inbox"]'::jsonb,
         'import_assignment:' || batch.id || ':' || action.owner_principal_id,
         case when focus.esh_contact_usable(action.owner_principal_id) then now() end
    from public.esh_import_rows imported
    join public.esh_finding_actions action on action.id = imported.action_id
   where imported.batch_id = batch.id and imported.id = any(p_row_ids)
     and imported.outcome = 'released'
   group by action.owner_principal_id
  on conflict (idempotency_key) do nothing;
  get diagnostics v_owners = row_count;

  update public.esh_import_batches set
    state = case when exists (select 1 from public.esh_import_rows
                               where batch_id = batch.id and outcome in ('ready', 'blocked'))
                 then 'staged' else 'released' end,
    released_at = coalesce(released_at, now()),
    released_by = coalesce(released_by, actor)
   where id = batch.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'import_released',
          jsonb_build_object('batch_id', batch.id, 'findings', v_created,
                             'owners_notified', v_owners,
                             'followup_from', v_followup));

  v_result := jsonb_build_object('ok', true, 'released', v_created, 'owners', v_owners,
                                 'followup_from', v_followup);
  return focus.remember_operation(actor, p_idempotency_key, 'esh_import_release', v_result);
end;
$$;

/** Before anything is live, a batch can be put down entirely. */
create or replace function public.esh_import_discard(p_batch_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  batch public.esh_import_batches;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  select * into batch from public.esh_import_batches
   where id = p_batch_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  -- After a release there is live work and somebody may already have replied:
  -- that is corrected by the ordinary audited operations, not by erasing the
  -- batch it came from (§38.3).
  if exists (select 1 from public.esh_import_rows
              where batch_id = batch.id and outcome = 'released') then
    return jsonb_build_object('ok', false, 'code', 'already_released');
  end if;

  update public.esh_import_batches set
    state = 'discarded', discarded_at = now(), discarded_by = actor,
    discard_reason = btrim(p_reason)
   where id = batch.id;
  delete from public.esh_import_rows where batch_id = batch.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'import_discarded',
          jsonb_build_object('batch_id', batch.id, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Function privileges
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_import_department(text) from public, anon, authenticated;
revoke all on function focus.esh_import_verdict(public.esh_import_batches, jsonb, text)
  from public, anon, authenticated;
revoke all on function focus.esh_import_revalidate(uuid) from public, anon, authenticated;
revoke all on function public.esh_import_start(text, text, text, text, text, text, integer, text, jsonb, integer)
  from public, anon;
revoke all on function public.esh_import_stage(uuid, jsonb) from public, anon;
revoke all on function public.esh_import_reconciliation(uuid) from public, anon;
revoke all on function public.esh_import_set_owner_email(uuid, text, text) from public, anon;
revoke all on function public.esh_import_amend_row(uuid, jsonb) from public, anon;
revoke all on function public.esh_import_resolve_row(uuid, text, text) from public, anon;
revoke all on function public.esh_import_acknowledge_evidence(uuid, text) from public, anon;
revoke all on function public.esh_import_release(uuid, uuid[], timestamptz, text) from public, anon;
revoke all on function public.esh_import_discard(uuid, text) from public, anon;

grant execute on function public.esh_import_start(text, text, text, text, text, text, integer, text, jsonb, integer)
  to authenticated;
grant execute on function public.esh_import_stage(uuid, jsonb) to authenticated;
grant execute on function public.esh_import_reconciliation(uuid) to authenticated;
grant execute on function public.esh_import_set_owner_email(uuid, text, text) to authenticated;
grant execute on function public.esh_import_amend_row(uuid, jsonb) to authenticated;
grant execute on function public.esh_import_resolve_row(uuid, text, text) to authenticated;
grant execute on function public.esh_import_acknowledge_evidence(uuid, text) to authenticated;
grant execute on function public.esh_import_release(uuid, uuid[], timestamptz, text) to authenticated;
grant execute on function public.esh_import_discard(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The one routine that creates a finding now knows about imports
--
-- An imported finding is not a second kind of finding: same reference series,
-- same assignment record, same audit trail. Three things differ, and they are
-- the import's, not a copy of this routine's: where it came from, when
-- following it up begins, and that its owner hears once for the batch rather
-- than once per row.
-- ---------------------------------------------------------------------------

create or replace function public.esh_save_finding(
  p_finding_id uuid,
  p_payload jsonb,
  p_assign boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  prior jsonb;
  existing public.esh_findings%rowtype;
  existing_action public.esh_finding_actions%rowtype;
  v_finding_id uuid;
  v_action_id uuid;
  v_reference text;
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_description text := nullif(btrim(coalesce(p_payload->>'description', '')), '');
  v_source text := coalesce(nullif(p_payload->>'source', ''), 'esh_inspection');
  v_source_reference text := nullif(btrim(coalesce(p_payload->>'source_reference', '')), '');
  v_location text := nullif(btrim(coalesce(p_payload->>'location', '')), '');
  v_department uuid;
  v_risk text := coalesce(nullif(p_payload->>'risk_level', ''), 'not_assessed');
  v_restricted boolean := coalesce((p_payload->>'is_restricted')::boolean, false);
  -- v205: where this came from, and when following it up starts.
  v_source_register text := nullif(btrim(coalesce(p_payload->>'source_register', '')), '');
  v_import_batch uuid := nullif(p_payload->>'import_batch_id', '')::uuid;
  v_import_row uuid := nullif(p_payload->>'import_row_id', '')::uuid;
  v_followup_from timestamptz := nullif(p_payload->>'followup_active_from', '')::timestamptz;
  v_action_title text := nullif(btrim(coalesce(p_payload->>'action_title', '')), '');
  v_outcome text := nullif(btrim(coalesce(p_payload->>'required_outcome', '')), '');
  v_instruction text := nullif(btrim(coalesce(p_payload->>'evidence_instruction', '')), '');
  v_priority text := nullif(p_payload->>'priority', '');
  v_owner_email text := nullif(btrim(coalesce(p_payload->>'owner_email', '')), '');
  v_reviewer uuid;
  v_no_escalation text := nullif(btrim(coalesce(p_payload->>'no_further_escalation_reason', '')), '');
  v_escalation jsonb := coalesce(p_payload->'escalation', '[]'::jsonb);
  v_reported_on date;
  v_due_date date;
  v_due_time time;
  v_due timestamptz;
  owner_principal uuid;
  owner_contact public.esh_email_principals%rowtype;
  problems text[] := '{}';
  warnings text[] := '{}';
  entry jsonb;
  seen text[] := '{}';
  entry_key text;
  levels int[] := '{}';
  level_no int;
  esc_principal uuid;
  reviewer_profile public.user_profiles%rowtype;
  outbox_state text;
  v_result jsonb;
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  if p_idempotency_key is not null then
    select l.result into prior from public.operation_log l
     where l.actor_id = actor and l.idempotency_key = p_idempotency_key;
    if found then
      return prior;
    end if;
  end if;

  -- Parse what arrived, recording what did not parse rather than raising.
  begin
    v_department := nullif(p_payload->>'accountable_department_id', '')::uuid;
  exception when others then
    problems := array_append(problems, 'department_invalid');
  end;
  begin
    v_reviewer := nullif(p_payload->>'reviewer_user_id', '')::uuid;
  exception when others then
    problems := array_append(problems, 'reviewer_invalid');
  end;
  begin
    v_reported_on := nullif(p_payload->>'reported_on', '')::date;
  exception when others then
    problems := array_append(problems, 'reported_on_invalid');
  end;
  begin
    v_due_date := nullif(p_payload->>'due_date', '')::date;
  exception when others then
    problems := array_append(problems, 'due_date_invalid');
  end;
  begin
    v_due_time := nullif(p_payload->>'due_time', '')::time;
  exception when others then
    problems := array_append(problems, 'due_time_invalid');
  end;

  if length(v_title) = 0 then
    problems := array_append(problems, 'title_required');
  end if;
  -- v205: 'import' is a source the import creates, and only the import: a
  -- finding typed in by hand cannot claim to have come out of a register.
  if v_source not in ('esh_inspection', 'audit', 'incident', 'observation', 'other')
     and not (v_source = 'import' and v_import_batch is not null) then
    problems := array_append(problems, 'source_invalid');
  end if;
  if v_risk not in ('not_assessed', 'low', 'medium', 'high', 'critical') then
    problems := array_append(problems, 'risk_invalid');
  end if;
  if v_priority is not null and v_priority not in ('urgent', 'high', 'normal') then
    problems := array_append(problems, 'priority_invalid');
  end if;
  if v_owner_email is not null and not focus.esh_email_is_valid(v_owner_email) then
    problems := array_append(problems, 'owner_email_invalid');
  end if;
  if jsonb_typeof(v_escalation) <> 'array' then
    problems := array_append(problems, 'escalation_invalid');
    v_escalation := '[]'::jsonb;
  end if;

  -- Scope: a coordinator files work only in departments they may read.
  if v_department is not null then
    if not exists (select 1 from public.departments d where d.id = v_department) then
      problems := array_append(problems, 'department_not_found');
    elsif not (v_department = any (focus.esh_visible_department_ids())) then
      problems := array_append(problems, 'department_out_of_scope');
    end if;
  end if;

  -- The escalation route: valid addresses, levels from 1 without gaps,
  -- duplicates at one level dropped.
  for entry in select value from jsonb_array_elements(v_escalation) loop
    begin
      level_no := (entry->>'level')::int;
    exception when others then
      level_no := null;
    end;
    if level_no is null or level_no < 1 or level_no > 9 then
      problems := array_append(problems, 'escalation_level_invalid');
      continue;
    end if;
    if not focus.esh_email_is_valid(entry->>'email') then
      problems := array_append(problems, 'escalation_email_invalid');
      continue;
    end if;
    entry_key := level_no::text || ':' || focus.esh_canonical_email(entry->>'email');
    if entry_key = any (seen) then
      continue;
    end if;
    seen := seen || entry_key;
    if not (level_no = any (levels)) then
      levels := levels || level_no;
    end if;
    if v_owner_email is not null
       and focus.esh_canonical_email(entry->>'email') = focus.esh_canonical_email(v_owner_email) then
      warnings := array_append(warnings, 'owner_is_escalation_recipient');
    end if;
  end loop;
  if cardinality(levels) > 0 and (select max(l) from unnest(levels) l) <> cardinality(levels) then
    problems := array_append(problems, 'escalation_levels_have_gaps');
  end if;

  if v_reviewer is not null then
    select p.* into reviewer_profile
      from public.user_profiles p
      join public.esh_staff_access a on a.user_id = p.id and a.organization_id = org
     where p.id = v_reviewer and p.status = 'active' and a.enabled and a.preset = 'verifier';
    if not found then
      problems := array_append(problems, 'reviewer_not_verifier');
    elsif v_owner_email is not null
          and focus.esh_canonical_email(reviewer_profile.email) = focus.esh_canonical_email(v_owner_email) then
      -- An owner never verifies their own correction (§5).
      problems := array_append(problems, 'reviewer_is_owner');
    end if;
  end if;

  if p_assign then
    if v_description is null then problems := array_append(problems, 'description_required'); end if;
    if v_department is null then problems := array_append(problems, 'department_required'); end if;
    if v_reported_on is null then problems := array_append(problems, 'reported_on_required'); end if;
    if v_outcome is null then problems := array_append(problems, 'required_outcome_required'); end if;
    if v_priority is null then problems := array_append(problems, 'priority_required'); end if;
    if v_owner_email is null then problems := array_append(problems, 'owner_email_required'); end if;
    if v_due_date is null then problems := array_append(problems, 'due_date_required'); end if;
    if cardinality(levels) = 0 and v_no_escalation is null then
      problems := array_append(problems, 'escalation_decision_required');
    end if;
    if v_due_date is not null and v_reported_on is not null and v_due_date < v_reported_on then
      problems := array_append(problems, 'due_before_reported');
    end if;
  end if;

  if cardinality(problems) > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid',
      'problems', to_jsonb((select array_agg(distinct x) from unnest(problems) x)));
  end if;

  -- An existing draft: only a draft is edited here, and only by someone who
  -- can see it.
  if p_finding_id is not null then
    select * into existing from public.esh_findings
     where id = p_finding_id and organization_id = org
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    if existing.status <> 'draft' then
      return jsonb_build_object('ok', false, 'code', 'not_a_draft');
    end if;
    if not (existing.created_by = actor or focus.esh_scope_all()
            or existing.accountable_department_id = any (focus.esh_visible_department_ids())) then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    select * into existing_action from public.esh_finding_actions
     where finding_id = existing.id and sequence = 1
     for update;
  end if;

  if v_due_date is not null then
    v_due := focus.esh_due_instant(org, v_due_date, v_due_time);
  end if;

  if existing.id is null then
    v_reference := focus.esh_next_reference(org);
    insert into public.esh_findings
      (organization_id, reference, title, description, source, source_reference, reported_on,
       location, accountable_department_id, risk_level, is_restricted, status, created_by,
       risk_assessed_by, risk_assessed_at, source_register, import_batch_id, import_row_id)
    values
      (org, v_reference, v_title, v_description, v_source, v_source_reference, v_reported_on,
       v_location, v_department, v_risk, v_restricted, 'draft', actor,
       case when v_risk <> 'not_assessed' then actor end,
       case when v_risk <> 'not_assessed' then now() end,
       v_source_register, v_import_batch, v_import_row)
    returning id into v_finding_id;

    insert into public.esh_finding_actions
      (organization_id, finding_id, sequence, title, required_outcome, evidence_instruction,
       priority, due_at, due_is_date_only, reviewer_user_id, no_further_escalation_reason,
       draft_owner_email, draft_escalation, created_by, followup_active_from)
    values
      (org, v_finding_id, 1, coalesce(v_action_title, v_title), v_outcome, v_instruction,
       v_priority, v_due, v_due_time is null, v_reviewer, v_no_escalation,
       v_owner_email, v_escalation, actor, v_followup_from)
    returning id into v_action_id;

    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
    values
      (org, 'staff', actor, 'finding_created', v_finding_id, v_action_id,
       jsonb_build_object('reference', v_reference, 'title', v_title));
  else
    v_finding_id := existing.id;
    v_reference := existing.reference;
    update public.esh_findings set
      title = v_title,
      description = v_description,
      source = v_source,
      source_reference = v_source_reference,
      reported_on = v_reported_on,
      location = v_location,
      accountable_department_id = v_department,
      risk_level = v_risk,
      risk_assessed_by = case when v_risk <> risk_level then
                           case when v_risk = 'not_assessed' then null else actor end
                         else risk_assessed_by end,
      risk_assessed_at = case when v_risk <> risk_level then
                           case when v_risk = 'not_assessed' then null else now() end
                         else risk_assessed_at end,
      is_restricted = v_restricted,
      updated_at = now(),
      row_version = row_version + 1
     where id = existing.id;

    update public.esh_finding_actions set
      title = coalesce(v_action_title, v_title),
      required_outcome = v_outcome,
      evidence_instruction = v_instruction,
      priority = v_priority,
      due_at = v_due,
      due_is_date_only = v_due_time is null,
      reviewer_user_id = v_reviewer,
      no_further_escalation_reason = v_no_escalation,
      draft_owner_email = v_owner_email,
      draft_escalation = v_escalation,
      updated_at = now(),
      row_version = row_version + 1
     where id = existing_action.id
    returning id into v_action_id;

    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
    values
      (org, 'staff', actor, 'finding_draft_saved', v_finding_id, v_action_id, '{}'::jsonb);
  end if;

  if not p_assign then
    v_result := jsonb_build_object(
      'ok', true, 'finding_id', v_finding_id, 'action_id', v_action_id,
      'reference', v_reference, 'status', 'draft',
      'warnings', to_jsonb((select coalesce(array_agg(distinct x), '{}') from unnest(warnings) x)));
    return focus.remember_operation(actor, p_idempotency_key, 'esh_save_finding', v_result);
  end if;

  -- Assign: the contact, the ownership interval, the route, the promise to
  -- notify — together, or not at all.
  owner_principal := focus.esh_principal_for(org, v_owner_email, actor);
  select * into owner_contact from public.esh_email_principals where id = owner_principal;

  update public.esh_findings set status = 'open', updated_at = now(), row_version = row_version + 1
   where id = v_finding_id;

  update public.esh_finding_actions set
    state = 'assigned',
    owner_principal_id = owner_principal,
    assignment_version = 1,
    baseline_due_at = v_due,
    due_at = v_due,
    assigned_at = now(),
    draft_owner_email = null,
    draft_escalation = '[]'::jsonb,
    updated_at = now(),
    row_version = row_version + 1
   where id = v_action_id;

  insert into public.esh_action_assignments
    (organization_id, action_id, principal_id, version, assigned_by)
  values (org, v_action_id, owner_principal, 1, actor);

  for entry in select value from jsonb_array_elements(v_escalation) loop
    esc_principal := focus.esh_principal_for(org, entry->>'email', actor);
    insert into public.esh_action_escalation_recipients
      (organization_id, action_id, level, principal_id, added_by)
    values (org, v_action_id, (entry->>'level')::smallint, esc_principal, actor)
    on conflict (action_id, level, principal_id) where removed_at is null do nothing;
  end loop;

  -- Held while this contact's access is off (§43.4): the rollout, not the
  -- owner, is why nothing was sent.
  outbox_state := case
                    when v_import_batch is not null then 'import_summary'
                    when owner_contact.status = 'active' and owner_contact.access_enabled then 'queued'
                    else 'held_rollout'
                  end;
  -- A backlog release writes one summary per owner instead (§41), so this
  -- assignment queues nothing of its own.
  if v_import_batch is null then
  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
     link_intents, idempotency_key, next_attempt_at)
  values
    (org, 'owner_assignment', owner_principal, v_finding_id, v_action_id, outbox_state,
     '["owner_action", "owner_inbox"]'::jsonb,
     'owner_assignment:' || v_action_id || ':1',
     case when outbox_state = 'queued' then now() end);
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id,
     subject_principal_id, detail)
  values
    (org, 'staff', actor, 'action_assigned', v_finding_id, v_action_id, owner_principal,
     jsonb_build_object(
       'owner_email', owner_contact.display_email,
       'due_at', v_due,
       'priority', v_priority,
       'escalation_levels', to_jsonb(levels),
       'no_further_escalation_reason', v_no_escalation,
       'notification', outbox_state));

  v_result := jsonb_build_object(
    'ok', true, 'finding_id', v_finding_id, 'action_id', v_action_id,
    'reference', v_reference, 'status', 'open', 'notification', outbox_state,
    'warnings', to_jsonb((select coalesce(array_agg(distinct x), '{}') from unnest(warnings) x)));
  return focus.remember_operation(actor, p_idempotency_key, 'esh_save_finding', v_result);
end;
$$;

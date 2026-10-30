-- ============================================================================
-- v271 — the photograph that came off the camera is kept, and sent evidence
--        can be scanned at all
--
-- Two things, and the first is a defect in v270.
--
-- 1. **v270 could not scan a single real file.** `esh_evidence_assets` has
--    carried a trigger since v199 that refuses *any* update to a row whose
--    `message_id` is set, because a file sent in a message is part of the
--    record. Every file that matters is sent. So `esh_scan_claim` raised
--    "a file sent in a message is part of the record and cannot change" on
--    the first row it tried to mark `pending`, and the worker died. v270's
--    own test never set `message_id`, so the suite was green and the feature
--    was inert. The guard now distinguishes the record from what we have
--    since learned *about* the record.
--
-- 2. **A compressed copy is no longer the only copy.** v270 shrinks a
--    photograph in the browser before it is sent, which costs the EXIF block
--    and every pixel beyond 2000px. That is the right trade for getting work
--    reported from a plant floor and the wrong trade for the one photograph
--    somebody later has to argue about. So both are kept: the compressed copy
--    is what the asset is and what everybody views, and the file as it came
--    off the camera is preserved beside it in the same private bucket.
--
--    The copy is uploaded first and the owner is never waiting on the second
--    upload -- they attach, they submit, and the source file follows in the
--    background. If it never arrives, `source_state` says so rather than
--    implying an original exists; the same principle as `unavailable` versus
--    `clean`, for the same reason.
--
--    Named `source_*` and not `original_*` on purpose: `purpose = 'original'`
--    already means the finding's own evidence, which is a different thing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The file as it came off the camera
-- ---------------------------------------------------------------------------

alter table public.esh_evidence_assets
  -- 26214400 is v226's limit, spelled out because a CHECK cannot call
  -- focus.esh_evidence_max_bytes(). The two move together.
  add column source_object_key text unique,
  add column source_file_name text
    check (source_file_name is null or length(source_file_name) between 1 and 120),
  add column source_size_bytes bigint
    check (source_size_bytes is null
           or (source_size_bytes >= 1 and source_size_bytes <= 26214400)),
  add column source_sha256 text
    check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  add column source_state text not null default 'none'
    check (source_state in ('none', 'pending', 'kept', 'unavailable')),
  add column source_kept_at timestamptz,
  -- When the second upload began, so one that never finishes -- a phone put
  -- in a pocket mid-upload -- stops being 'pending' at some point instead of
  -- holding the row out of the scan queue for ever.
  add column source_started_at timestamptz;

/*
 * `kept` is a claim about bytes that exist, so it may not be said without
 * them. Nothing may claim a source file was preserved when it was not --
 * the same rule scan_state lives under.
 */
alter table public.esh_evidence_assets
  add constraint esh_evidence_source_kept_check
  check (source_state <> 'kept'
         or (source_object_key is not null and source_size_bytes is not null
             and source_sha256 is not null and source_kept_at is not null));

/*
 * The second half of the same defect. v199 also holds that a sent file is a
 * readable file -- `message_id is null or (purpose = 'message' and state =
 * 'ready')` -- so v270's quarantine, which works by moving a file out of
 * 'ready', could not reach a sent file either. Both halves were invisible
 * because v270's fixture never sent anything.
 *
 * 'rejected' is the one further state a sent file may reach, and only by the
 * route section 2 allows. What the constraint was written to prevent -- a
 * draft or a half-finished upload appearing in somebody's conversation --
 * still cannot happen, and every read still filters on 'ready', so a
 * quarantined file leaves every page at once.
 *
 * Dropped by lookup rather than by name: the original is a system-generated
 * `..._check3`, and a migration that hard-codes that is a migration betting
 * on two databases having numbered their constraints identically.
 */
do $$
declare
  v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
   where con.conrelid = 'public.esh_evidence_assets'::regclass
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%message_id IS NULL%';
  if v_name is null then
    raise exception 'v271: the sent-file state constraint was not found';
  end if;
  execute format('alter table public.esh_evidence_assets drop constraint %I', v_name);
end;
$$;

alter table public.esh_evidence_assets
  add constraint esh_evidence_sent_state_check
  check (message_id is null or (purpose = 'message' and state in ('ready', 'rejected')));

comment on column public.esh_evidence_assets.source_state is
  'v271. none means the stored object IS what was chosen (nothing was '
  'compressed). kept means a larger source file is preserved beside it. '
  'pending and unavailable both mean there is only the compressed copy.';

-- For the sweep at the top of esh_scan_claim, which writes off a source upload
-- that never finished. Partial, because in a healthy system almost nothing is
-- 'pending' at any moment.
create index esh_evidence_source_pending_idx
  on public.esh_evidence_assets (organization_id, created_at)
  where source_state = 'pending';

-- ---------------------------------------------------------------------------
-- 2. The guard that stopped v270 working
--
-- A sent file is part of the record: what it is, where it lives, who sent it
-- and when cannot change, and it can never be deleted or quietly marked
-- removed. What a scanner found, and whether a source file was preserved, are
-- not the record changing -- they are things learned afterwards about a row
-- that itself stands still.
--
-- Listing the mutable columns rather than the immutable ones is deliberate: a
-- column added later is immutable until somebody names it here, so the
-- failure mode of forgetting is a refused update rather than a silently
-- editable record.
-- ---------------------------------------------------------------------------

create or replace function focus.esh_reject_sent_evidence_change()
returns trigger
language plpgsql
as $$
declare
  learned constant text[] := array[
    'scan_state', 'scanned_at', 'scan_detail', 'scan_attempts',
    'source_object_key', 'source_file_name', 'source_size_bytes',
    'source_sha256', 'source_state', 'source_kept_at', 'source_started_at',
    'state', 'rejected_reason'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'evidence records are kept; mark one removed instead';
  end if;
  if old.message_id is not null then
    if (to_jsonb(new) - learned) is distinct from (to_jsonb(old) - learned) then
      raise exception 'a file sent in a message is part of the record and cannot change';
    end if;
    /*
     * `state` is in that list for exactly one move: ready -> rejected, with
     * an infection to show for it. Without this line 'removed' would be
     * reachable on a sent file and §23's rule -- a later deletion must not
     * silently remove proof -- would be a comment rather than a constraint.
     */
    if (new.state, new.rejected_reason) is distinct from (old.state, old.rejected_reason)
       and not (old.state = 'ready' and new.state = 'rejected'
                and new.scan_state = 'infected') then
      raise exception 'a sent file changes state only when a scanner quarantines it';
    end if;
  end if;
  return new;
end;
$$;

comment on function focus.esh_reject_sent_evidence_change is
  'v271. Sent evidence does not change; what we learn about it does. The '
  'mutable columns are listed, so a new column is immutable until named.';

-- ---------------------------------------------------------------------------
-- 3. Whether a source file may be kept, and where it goes
--
-- Defined ahead of its callers because a `language sql` body is checked when
-- it is created, not when it is first run.
-- ---------------------------------------------------------------------------

/*
 * Why a source file may not be kept, as one of the codes the browser already
 * knows how to say out loud.
 *
 * The size test is the interesting one. A source file no larger than the copy
 * made from it is not a source file: either nothing was compressed, or the
 * browser is offering the same bytes twice, and storing it would double the
 * bucket for nothing while implying a fidelity that is not there.
 */
create or replace function focus.esh_source_problem(
  e public.esh_evidence_assets,
  p_name text,
  p_size bigint
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when e.state <> 'ready' then 'not_available'
    when e.source_state = 'kept' then 'already_kept'
    when p_name is null or length(p_name) not between 1 and 120
      or not focus.esh_evidence_extension_ok(p_name) then 'type_not_allowed'
    when p_size is null or p_size < 1 or p_size > 26214400 then 'too_large'
    when p_size <= coalesce(e.size_bytes, 0) then 'not_larger'
    else null
  end;
$$;

/*
 * The object a source file goes to, or null when it may not be kept at all.
 * Derived from the copy's own key, so a retry after a dropped connection
 * writes to the same place instead of leaving an orphan behind.
 */
create or replace function focus.esh_source_key(
  e public.esh_evidence_assets,
  p_name text,
  p_size bigint
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when focus.esh_source_problem(e, p_name, p_size) is not null then null
    else e.object_key || '.source.'
         || lower(substring(p_name from '\.([A-Za-z0-9]{1,8})$'))
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Keeping the source file: an owner, through their email link
--
-- Three calls, mirroring an ordinary upload, because the bytes take the same
-- route: a procedure agrees and names the object, the browser puts it there
-- with a one-time URL, and the server reads it back and says what it found.
--
-- Only the person who uploaded the copy, only onto their own asset, and only
-- while their session still reaches the action. A source file may be started
-- after the message has been sent -- that is the normal case, since the point
-- is not to make anybody wait for it.
-- ---------------------------------------------------------------------------

create or replace function public.esh_guest_start_source(
  p_session text,
  p_asset_id uuid,
  p_name text,
  p_size bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  e public.esh_evidence_assets;
  v_key text;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id for update;
  if not found or e.uploader_principal_id is distinct from s.principal_id
     or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, e.action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  v_key := focus.esh_source_key(e, p_name, p_size);
  if v_key is null then
    return jsonb_build_object('ok', false, 'code', focus.esh_source_problem(e, p_name, p_size));
  end if;
  update public.esh_evidence_assets set
    source_object_key = v_key, source_file_name = p_name,
    source_size_bytes = null, source_sha256 = null,
    source_state = 'pending', source_kept_at = null, source_started_at = now()
   where id = e.id;
  return jsonb_build_object('ok', true, 'object_key', v_key);
end;
$$;

/*
 * Which object the server should read back. Asked before it touches any
 * bytes, so a guessed id can never make it read somebody else's file.
 */
create or replace function public.esh_guest_source_target(p_session text, p_asset_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  e public.esh_evidence_assets;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id;
  if not found or e.uploader_principal_id is distinct from s.principal_id
     or e.source_state <> 'pending' or e.source_object_key is null
     or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, e.action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  return jsonb_build_object('ok', true, 'object_key', e.source_object_key,
                            'name', e.source_file_name);
end;
$$;

create or replace function public.esh_guest_record_source(
  p_session text,
  p_asset_id uuid,
  p_ok boolean,
  p_size bigint,
  p_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  e public.esh_evidence_assets;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id for update;
  if not found or e.uploader_principal_id is distinct from s.principal_id
     or e.source_state <> 'pending'
     or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, e.action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  return focus.esh_keep_source(e, p_ok, p_size, p_sha256);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. And for ESH's own uploads
--
-- Same two steps; the target needs no procedure because the row is readable
-- under the table's own policy. Restricted to the person who uploaded the
-- copy, which is the only person whose browser is holding the source file.
-- ---------------------------------------------------------------------------

create or replace function public.esh_start_source(
  p_asset_id uuid,
  p_name text,
  p_size bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  e public.esh_evidence_assets;
  v_key text;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id for update;
  if not found or e.uploader_user_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  v_key := focus.esh_source_key(e, p_name, p_size);
  if v_key is null then
    return jsonb_build_object('ok', false, 'code', focus.esh_source_problem(e, p_name, p_size));
  end if;
  update public.esh_evidence_assets set
    source_object_key = v_key, source_file_name = p_name,
    source_size_bytes = null, source_sha256 = null,
    source_state = 'pending', source_kept_at = null, source_started_at = now()
   where id = e.id;
  return jsonb_build_object('ok', true, 'object_key', v_key);
end;
$$;

create or replace function public.esh_record_source(
  p_asset_id uuid,
  p_ok boolean,
  p_size bigint,
  p_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  e public.esh_evidence_assets;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id for update;
  if not found or e.uploader_user_id is distinct from actor or e.source_state <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  return focus.esh_keep_source(e, p_ok, p_size, p_sha256);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. What both sides share
-- ---------------------------------------------------------------------------

/*
 * Record what the server found in the source file's bytes.
 *
 * Keeping one resets the scan. The copy may already have been scanned, but a
 * canvas re-encode cannot carry what the camera's own file carried, so the
 * bytes a scanner has actually looked at are no longer the bytes most worth
 * looking at. Leaving the row `clean` would be the lie this column exists to
 * prevent, so the worker is sent back to it -- and scans the source file,
 * which is what `esh_scan_claim` now hands over.
 */
create or replace function focus.esh_keep_source(
  e public.esh_evidence_assets,
  p_ok boolean,
  p_size bigint,
  p_sha256 text
)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  if not coalesce(p_ok, false) or p_size is null or p_size < 1
     or coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    update public.esh_evidence_assets set
      source_state = 'unavailable', source_size_bytes = null, source_sha256 = null,
      source_kept_at = null
     where id = e.id;
    return jsonb_build_object('ok', true, 'state', 'unavailable');
  end if;
  if p_size <= coalesce(e.size_bytes, 0) then
    update public.esh_evidence_assets set source_state = 'unavailable' where id = e.id;
    return jsonb_build_object('ok', false, 'code', 'not_larger');
  end if;
  update public.esh_evidence_assets set
    source_state = 'kept', source_size_bytes = p_size, source_sha256 = p_sha256,
    source_kept_at = now(),
    scan_state = case when e.state = 'ready' then 'not_scanned' else e.scan_state end,
    scanned_at = case when e.state = 'ready' then null else e.scanned_at end,
    scan_detail = case when e.state = 'ready' then null else e.scan_detail end,
    scan_attempts = case when e.state = 'ready' then 0 else e.scan_attempts end
   where id = e.id;
  return jsonb_build_object('ok', true, 'state', 'kept');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Removing a draft file now takes its source file with it
--
-- Both procedures return the objects the server should delete. A draft that is
-- dropped and leaves its source file in the bucket is a file nothing points
-- at and nobody can reach -- it just costs storage forever.
-- ---------------------------------------------------------------------------

create or replace function public.esh_guest_remove_upload(p_session text, p_asset_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  e public.esh_evidence_assets;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id for update;
  if not found or e.uploader_principal_id is distinct from s.principal_id
     or e.message_id is not null or e.state = 'removed' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  update public.esh_evidence_assets set state = 'removed', removed_at = now() where id = e.id;
  return jsonb_build_object('ok', true, 'object_key', e.object_key,
                            'source_object_key', e.source_object_key);
end;
$$;

create or replace function public.esh_remove_upload(p_asset_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  e public.esh_evidence_assets;
  f public.esh_findings;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id for update;
  if not found or e.message_id is not null or e.state = 'removed' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select * into f from public.esh_findings where id = e.finding_id;
  if not (focus.esh_scope_all() or f.accountable_department_id = any (focus.esh_visible_department_ids())
          or (f.status = 'draft' and f.created_by = actor)) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if e.purpose = 'message' and e.uploader_user_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  update public.esh_evidence_assets set state = 'removed', removed_at = now(), removed_by = actor
   where id = e.id;
  if e.purpose = 'original' and e.state = 'ready' then
    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
    values
      (e.organization_id, 'staff', actor, 'original_evidence_removed', e.finding_id,
       jsonb_build_object('asset_id', e.id, 'name', e.original_name));
  end if;
  return jsonb_build_object('ok', true, 'object_key', e.object_key,
                            'source_object_key', e.source_object_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The scanner looks at the source file when there is one
--
-- The compressed copy is pixels a canvas drew; it cannot carry what came in
-- with the camera's file. The source file can, and it is the one being kept
-- for years, so it is the one worth a scanner's time. Quarantine still marks
-- the asset, which hides both.
--
-- `source_state = 'pending'` is deliberately not claimable: a file whose
-- source copy is still on its way would be scanned now and never again.
-- ---------------------------------------------------------------------------

create or replace function public.esh_scan_claim(p_limit integer default 20)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  /*
   * A source upload that never finished. The browser marks its own failures,
   * but a phone that goes into a pocket mid-upload marks nothing, and a row
   * left 'pending' is a row held out of the queue below for ever. An hour is
   * long enough that no real upload is cut short by it.
   */
  update public.esh_evidence_assets set source_state = 'unavailable'
   where source_state = 'pending'
     and source_started_at < now() - interval '1 hour';

  with picked as (
    select e.id
      from public.esh_evidence_assets e
     where e.state = 'ready'
       and e.source_state <> 'pending'
       and (e.scan_state = 'not_scanned'
            or (e.scan_state = 'pending' and e.scanned_at < now() - interval '1 hour'))
       and e.scan_attempts < 5
     order by e.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  ),
  marked as (
    update public.esh_evidence_assets e
       set scan_state = 'pending',
           scanned_at = now(),
           scan_attempts = e.scan_attempts + 1
      from picked
     where e.id = picked.id
     returning e.id, e.object_key, e.source_object_key, e.source_state,
               e.original_name, e.source_file_name, e.content_type, e.size_bytes,
               e.source_size_bytes
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'object_key', case when source_state = 'kept' then source_object_key
                              else object_key end,
           'name', case when source_state = 'kept' then source_file_name
                        else original_name end,
           'type', content_type,
           'size', case when source_state = 'kept' then source_size_bytes
                        else size_bytes end,
           'source', source_state = 'kept')), '[]'::jsonb)
    into v_rows from marked;

  return jsonb_build_object('ok', true, 'files', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Reach
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_source_key(public.esh_evidence_assets, text, bigint)
  from public, anon, authenticated;
revoke all on function focus.esh_source_problem(public.esh_evidence_assets, text, bigint)
  from public, anon, authenticated;
revoke all on function focus.esh_keep_source(public.esh_evidence_assets, boolean, bigint, text)
  from public, anon, authenticated;

revoke all on function public.esh_guest_start_source(text, uuid, text, bigint)
  from public, anon, authenticated;
revoke all on function public.esh_guest_source_target(text, uuid)
  from public, anon, authenticated;
revoke all on function public.esh_guest_record_source(text, uuid, boolean, bigint, text)
  from public, anon, authenticated;
grant execute on function public.esh_guest_start_source(text, uuid, text, bigint) to service_role;
grant execute on function public.esh_guest_source_target(text, uuid) to service_role;
grant execute on function public.esh_guest_record_source(text, uuid, boolean, bigint, text)
  to service_role;

revoke all on function public.esh_start_source(uuid, text, bigint) from public, anon;
revoke all on function public.esh_record_source(uuid, boolean, bigint, text) from public, anon;
grant execute on function public.esh_start_source(uuid, text, bigint) to authenticated;
grant execute on function public.esh_record_source(uuid, boolean, bigint, text) to authenticated;

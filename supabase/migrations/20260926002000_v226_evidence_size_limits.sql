-- ============================================================================
-- v226 — Evidence at the size the specification asks for
--
-- §23 sets the implementation defaults at 25 MB per file, 10 files per message
-- and 100 MB per message, "configurable within actual infrastructure limits".
-- This deployment shipped at 10 MB because that is what the local Supabase
-- storage ceiling allowed, and 10 MB is a real constraint on a real owner: a
-- photograph from a current phone, taken in a dark plant room and therefore
-- large, goes over it. The owner then cannot send the proof the action asks for
-- and has no idea why.
--
-- Three numbers move together or not at all — the constraint, the bucket and
-- the domain constant — because each of them refuses on its own and each gives
-- a different, worse answer when it is the one that refuses: a CHECK violation
-- reads as a fault in the application, a bucket refusal happens after the bytes
-- have been sent, and only the domain check can say so before anything moves.
--
-- The per-message total is added at the same time, and for the same reason it is
-- in the specification: ten files at the new limit is 250 MB, which is not a
-- message, and nothing before now put a ceiling on the total at all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. What one file may be (§23)
-- ---------------------------------------------------------------------------

alter table public.esh_evidence_assets
  drop constraint esh_evidence_assets_declared_size_check,
  drop constraint esh_evidence_assets_size_bytes_check;

alter table public.esh_evidence_assets
  -- 25 MiB. The declared size is what the browser claimed before uploading;
  -- `size_bytes` is what the server counted afterwards. Both are held to it.
  add constraint esh_evidence_assets_declared_size_check
    check (declared_size >= 1 and declared_size <= 26214400),
  add constraint esh_evidence_assets_size_bytes_check
    check (size_bytes is null or (size_bytes >= 1 and size_bytes <= 26214400));

-- The bucket refuses on its own, after the bytes have travelled. It has to
-- agree with the constraint above or a file that passes every check in the
-- application still fails at the last step.
update storage.buckets set file_size_limit = 26214400 where id = 'finding-evidence';

-- ---------------------------------------------------------------------------
-- 2. What one message may carry (§23)
-- ---------------------------------------------------------------------------

/*
 * The files a message may be sent with: at most ten, all of them this action's,
 * this person's, finished and not already sent — and now 100 MB between them.
 *
 * Unchanged but for the total. Ten files were harmless at 10 MB each and are
 * not at 25: a quarter of a gigabyte in one message is a mailbox nobody can
 * open and a bill nobody agreed to.
 */
create or replace function focus.esh_files_problem(
  p_action_id uuid,
  p_principal_id uuid,
  p_user_id uuid,
  p_asset_ids uuid[]
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when coalesce(cardinality(p_asset_ids), 0) = 0 then null
    when cardinality(p_asset_ids) > 10 then 'too_many_files'
    when (select count(distinct e.id) from public.esh_evidence_assets e
           where e.id = any (p_asset_ids)
             and e.action_id = p_action_id
             and e.purpose = 'message'
             and e.message_id is null
             and e.state = 'ready'
             and (e.uploader_principal_id = p_principal_id or e.uploader_user_id = p_user_id))
         <> (select count(distinct x) from unnest(p_asset_ids) x) then 'files_not_ready'
    -- 100 MiB across the message. Counted from what the server measured, not
    -- from what the browser said it was sending.
    when (select coalesce(sum(e.size_bytes), 0) from public.esh_evidence_assets e
           where e.id = any (p_asset_ids)) > 104857600 then 'message_too_large'
    else null
  end;
$$;

comment on function focus.esh_files_problem is
  'Whether these files may go with a message (§23): ten at most, this action''s and this person''s, finished, unsent, and 100 MB between them.';

-- ---------------------------------------------------------------------------
-- 3. The limit, in one place
--
-- Both upload procedures carried the number themselves, which is how the
-- application came to refuse at 10 MB while three other places had been raised.
-- They now ask, and there is one number left to change.
-- ---------------------------------------------------------------------------

/*
 * The largest single evidence file, in bytes (§23).
 *
 * The same number as `EVIDENCE_MAX_BYTES` in the domain layer, the two CHECK
 * constraints above and the bucket. It is immutable, so the planner folds it and
 * asking costs nothing.
 */
create or replace function focus.esh_evidence_max_bytes()
returns bigint
language sql
immutable
set search_path = pg_catalog
as $$
  select 26214400::bigint;
$$;

revoke all on function focus.esh_evidence_max_bytes() from public, anon, authenticated;
grant execute on function focus.esh_evidence_max_bytes() to service_role;

/* An Action Owner's upload, from an email link (§23). */
CREATE OR REPLACE FUNCTION public.esh_guest_start_upload(p_session text, p_action_id uuid, p_name text, p_size bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s public.esh_guest_sessions;
  a public.esh_finding_actions;
  v_id uuid := gen_random_uuid();
  v_key text;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if p_name is null or length(p_name) not between 1 and 120 or not focus.esh_evidence_extension_ok(p_name) then
    return jsonb_build_object('ok', false, 'code', 'type_not_allowed');
  end if;
  if p_size is null or p_size not between 1 and focus.esh_evidence_max_bytes() then
    return jsonb_build_object('ok', false, 'code', 'too_large');
  end if;
  if (select count(*) from public.esh_evidence_assets e
       where e.action_id = p_action_id and e.uploader_principal_id = s.principal_id
         and e.message_id is null and e.state in ('uploading', 'ready')) >= 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many_files');
  end if;
  if (select count(*) from public.esh_evidence_assets e
       where e.uploader_principal_id = s.principal_id
         and e.created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('ok', false, 'code', 'slow_down');
  end if;

  select * into a from public.esh_finding_actions where id = p_action_id;
  v_key := a.finding_id || '/' || a.id || '/' || v_id || '.'
           || lower(substring(p_name from '\.([A-Za-z0-9]{1,8})$'));
  insert into public.esh_evidence_assets
    (id, organization_id, finding_id, action_id, purpose, object_key, original_name,
     declared_size, uploader_kind, uploader_principal_id)
  values
    (v_id, a.organization_id, a.finding_id, a.id, 'message', v_key, p_name, p_size, 'owner',
     s.principal_id);
  return jsonb_build_object('ok', true, 'asset_id', v_id, 'object_key', v_key);
end;
$function$;

/* ESH's own upload (§23). */
CREATE OR REPLACE FUNCTION public.esh_start_upload(p_finding_id uuid, p_action_id uuid, p_purpose text, p_name text, p_size bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  f public.esh_findings;
  a public.esh_finding_actions;
  v_id uuid := gen_random_uuid();
  v_key text;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into f from public.esh_findings where id = p_finding_id and organization_id = org;
  if not found or not (focus.esh_scope_all()
                       or f.accountable_department_id = any (focus.esh_visible_department_ids())
                       or (f.status = 'draft' and f.created_by = actor)) then
    return jsonb_build_object('ok', false, 'code', 'finding_not_found');
  end if;
  if p_purpose not in ('original', 'message') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_purpose = 'message' then
    select * into a from public.esh_finding_actions
     where id = p_action_id and finding_id = f.id;
    if not found or f.status <> 'open'
       or a.state not in ('assigned', 'in_progress', 'awaiting_verification') then
      return jsonb_build_object('ok', false, 'code', 'action_closed');
    end if;
  elsif f.status not in ('draft', 'new', 'open') then
    return jsonb_build_object('ok', false, 'code', 'finding_closed');
  end if;
  if p_name is null or length(p_name) not between 1 and 120 or not focus.esh_evidence_extension_ok(p_name) then
    return jsonb_build_object('ok', false, 'code', 'type_not_allowed');
  end if;
  if p_size is null or p_size not between 1 and focus.esh_evidence_max_bytes() then
    return jsonb_build_object('ok', false, 'code', 'too_large');
  end if;
  if (select count(*) from public.esh_evidence_assets e
       where e.uploader_user_id = actor and e.created_at > now() - interval '1 hour') >= 120 then
    return jsonb_build_object('ok', false, 'code', 'slow_down');
  end if;

  v_key := f.id || '/' || coalesce(a.id::text, 'original') || '/' || v_id || '.'
           || lower(substring(p_name from '\.([A-Za-z0-9]{1,8})$'));
  insert into public.esh_evidence_assets
    (id, organization_id, finding_id, action_id, purpose, object_key, original_name,
     declared_size, uploader_kind, uploader_user_id)
  values
    (v_id, f.organization_id, f.id, a.id, p_purpose, v_key, p_name, p_size, 'staff', actor);
  return jsonb_build_object('ok', true, 'asset_id', v_id, 'object_key', v_key);
end;
$function$;

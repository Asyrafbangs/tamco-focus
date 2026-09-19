-- ============================================================================
-- v199 ESH Finding Management: evidence and submissions.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §11,
-- §12, §21-§23; FM16-FM22, FM46-FM50.
--
--   * a private `finding-evidence` bucket that nobody reads or writes
--     directly: the server uploads through one-time signed URLs after a
--     procedure has checked the request, and hands out five-minute download
--     links the same way;
--   * evidence records, each checked on the server for what it really is, and
--     honestly marked Not scanned (no scanner exists in this deployment);
--   * files on conversation messages, and original evidence on the finding;
--   * immutable submissions: Submit for review snapshots one message and its
--     files; one can be pending at a time; a withdrawn one stays in history;
--   * ESH told of a submission, and of a withdrawal, by email.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Private storage (§23)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finding-evidence',
  'finding-evidence',
  false,
  10485760,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policy mentions this bucket, so signed-in and anonymous
-- callers alike reach nothing in it. Only the server's service role, after a
-- procedure below has said yes, signs an upload or a download.

-- ---------------------------------------------------------------------------
-- 2. Evidence (§21 evidence_assets, evidence_links; §23)
--
-- One row per file. `message` files belong to an action's conversation once
-- sent; until then they are the uploader's draft and can be removed.
-- `original` files are the finding's own evidence, added by ESH. A file sent
-- in a message is part of the record from then on and cannot be removed
-- (§23: a later deletion must not silently remove proof).
-- ---------------------------------------------------------------------------

create table public.esh_evidence_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  finding_id uuid not null,
  action_id uuid,
  purpose text not null check (purpose in ('original', 'message')),
  object_key text not null unique,
  original_name text not null check (length(original_name) between 1 and 120),
  declared_size bigint not null check (declared_size between 1 and 10485760),
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 10485760),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'uploading'
    check (state in ('uploading', 'ready', 'rejected', 'removed')),
  rejected_reason text,
  -- There is no scanner. The column exists so that one day there can be, and
  -- so that nothing ever claims a file was checked when it was not.
  scan_state text not null default 'not_scanned' check (scan_state = 'not_scanned'),
  uploader_kind text not null check (uploader_kind in ('owner', 'staff')),
  uploader_principal_id uuid,
  uploader_user_id uuid references public.user_profiles (id),
  message_id uuid references public.esh_action_messages (id),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.user_profiles (id),
  foreign key (organization_id, finding_id) references public.esh_findings (organization_id, id),
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  foreign key (organization_id, uploader_principal_id)
    references public.esh_email_principals (organization_id, id),
  check ((purpose = 'message') = (action_id is not null)),
  check ((uploader_kind = 'owner') = (uploader_principal_id is not null and uploader_user_id is null)),
  check (state <> 'ready' or (content_type is not null and size_bytes is not null
                              and content_sha256 is not null)),
  check (message_id is null or (purpose = 'message' and state = 'ready'))
);

create index esh_evidence_action_idx on public.esh_evidence_assets (action_id, message_id);
create index esh_evidence_finding_idx on public.esh_evidence_assets (finding_id, purpose);

-- Sent files do not change. (Draft and original files may be removed, which
-- is a state change recorded with who and when, never a deleted row.)
create or replace function focus.esh_reject_sent_evidence_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'evidence records are kept; mark one removed instead';
  end if;
  if old.message_id is not null then
    raise exception 'a file sent in a message is part of the record and cannot change';
  end if;
  return new;
end;
$$;

create trigger esh_evidence_assets_guard
  before update or delete on public.esh_evidence_assets
  for each row execute function focus.esh_reject_sent_evidence_change();

-- A message may now be files alone (§11: text, attachments, or both).
alter table public.esh_action_messages drop constraint esh_action_messages_body_check;
alter table public.esh_action_messages
  add constraint esh_action_messages_body_check check (length(body) <= 4000);

-- ---------------------------------------------------------------------------
-- 3. Submissions (§12, §21 action_submissions)
--
-- A snapshot, never edited: which message, its text, which files, whose, at
-- which due date. State moves once, out of pending. One pending per action.
-- ---------------------------------------------------------------------------

create table public.esh_action_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  version integer not null check (version > 0),
  assignment_version integer not null,
  principal_id uuid not null,
  owner_email text not null,
  message_id uuid not null references public.esh_action_messages (id),
  result_text text not null,
  evidence_asset_ids uuid[] not null default '{}',
  due_at_snapshot timestamptz,
  baseline_due_at_snapshot timestamptz,
  state text not null default 'pending'
    check (state in ('pending', 'withdrawn', 'accepted', 'changes_requested')),
  submitted_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_reason text,
  -- The Submit press it came from: a second press is the same submission.
  client_key text not null check (length(client_key) between 8 and 80),
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  foreign key (organization_id, principal_id)
    references public.esh_email_principals (organization_id, id),
  unique (action_id, version),
  unique (action_id, client_key)
);

create unique index esh_one_pending_submission
  on public.esh_action_submissions (action_id) where state = 'pending';

create or replace function focus.esh_guard_submission()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'submissions are kept';
  end if;
  if old.state <> 'pending' then
    raise exception 'a closed submission cannot change';
  end if;
  if (new.action_id, new.version, new.assignment_version, new.principal_id, new.owner_email,
      new.message_id, new.result_text, new.evidence_asset_ids, new.due_at_snapshot,
      new.baseline_due_at_snapshot, new.submitted_at, new.client_key)
     is distinct from
     (old.action_id, old.version, old.assignment_version, old.principal_id, old.owner_email,
      old.message_id, old.result_text, old.evidence_asset_ids, old.due_at_snapshot,
      old.baseline_due_at_snapshot, old.submitted_at, old.client_key) then
    raise exception 'a submission is a snapshot and cannot be edited';
  end if;
  return new;
end;
$$;

create trigger esh_action_submissions_guard
  before update or delete on public.esh_action_submissions
  for each row execute function focus.esh_guard_submission();

alter table public.esh_finding_actions
  add column current_submission_id uuid references public.esh_action_submissions (id);

-- ---------------------------------------------------------------------------
-- 4. The outbox can tell staff, too
--
-- A submission and a withdrawal go to ESH people, by their account's email:
-- no link secret, just the finding's address in the application, where they
-- sign in as usual. Exactly one of contact or staff member per row.
-- ---------------------------------------------------------------------------

alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_event_type_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_event_type_check
  check (event_type in ('owner_assignment', 'esh_reply', 'access_link',
                        'submission_received', 'submission_withdrawn'));
alter table public.esh_notification_outbox
  add column recipient_user_id uuid references public.user_profiles (id),
  add column submission_id uuid references public.esh_action_submissions (id);
alter table public.esh_notification_outbox
  add constraint esh_outbox_one_recipient
  check (num_nonnulls(recipient_principal_id, recipient_user_id) = 1);

-- ---------------------------------------------------------------------------
-- 5. Read policies
-- ---------------------------------------------------------------------------

alter table public.esh_evidence_assets enable row level security;
alter table public.esh_action_submissions enable row level security;

-- Staff see a finding's files when they can see the finding: ready ones, and
-- their own uploads still in progress.
create policy esh_evidence_assets_select on public.esh_evidence_assets
  as permissive for select to authenticated
  using (
    finding_id in (select f.id from public.esh_findings f)
    and (state = 'ready' or uploader_user_id = (select auth.uid()))
  );

create policy esh_action_submissions_select on public.esh_action_submissions
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));

revoke all on public.esh_evidence_assets, public.esh_action_submissions from anon, authenticated;
grant select on public.esh_evidence_assets, public.esh_action_submissions to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The register: a submission is ESH's move (§24)
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
       coalesce(p.status = 'active' and p.access_enabled, false) as owner_access_enabled
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
    select true as any_failed
      from public.esh_notification_outbox o
     where o.action_id = a.id and o.state = 'failed' and o.next_attempt_at is null
     limit 1
  ) failed on true
  left join lateral (
    select e.occurred_at, e.event_type
      from public.esh_audit_events e
     where e.finding_id = f.id
       and e.event_type in ('finding_created', 'action_assigned', 'action_started',
                            'owner_message', 'esh_message', 'submission_created',
                            'submission_withdrawn')
     order by e.occurred_at desc,
              array_position(array['submission_created', 'submission_withdrawn', 'owner_message',
                                   'esh_message', 'action_started', 'action_assigned',
                                   'finding_created'], e.event_type)
     limit 1
  ) latest on true;

revoke all on public.esh_register_rows from anon, authenticated;
grant select on public.esh_register_rows to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Helpers
-- ---------------------------------------------------------------------------

-- The extensions a file may carry (§23); the server checks the bytes too.
create or replace function focus.esh_evidence_extension_ok(p_name text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select lower(substring(p_name from '\.([A-Za-z0-9]{1,8})$')) = any (array[
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'pdf', 'txt', 'csv',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);
$$;

/*
 * Whether a staff member may still review this finding: Finding access on, a
 * Coordinator or Verifier, and the finding's department in their scope. The
 * same rule as `esh_visible_department_ids`, for a named person rather than
 * the one signed in — the worker has nobody signed in.
 */
create or replace function focus.esh_user_can_coordinate(p_user_id uuid, p_finding_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive access as (
    select a.id, a.scope_all_departments, a.organization_id
      from public.esh_staff_access a
      join public.esh_rollout_settings r on r.organization_id = a.organization_id
      join public.user_profiles u on u.id = a.user_id
     where a.user_id = p_user_id
       and a.enabled
       and a.preset in ('coordinator', 'verifier')
       and u.status = 'active'
  ),
  tree (id, descend) as (
    select d.department_id, d.include_descendants
      from public.esh_staff_access_departments d
      join access on access.id = d.access_id
    union
    select child.id, true
      from public.departments child
      join tree on child.parent_id = tree.id
     where tree.descend
  )
  select exists (
    select 1
      from access
      join public.esh_findings f on f.id = p_finding_id and f.organization_id = access.organization_id
     where access.scope_all_departments
        or f.accountable_department_id in (select tree.id from tree)
  );
$$;

/*
 * Tell ESH about a submission or a withdrawal: the named reviewer when there
 * is one and they can still act, otherwise every Verifier who covers the
 * finding (at most twenty). One row each, keyed so a retry adds nothing.
 */
create or replace function focus.esh_notify_reviewers(
  p_submission_id uuid,
  p_event text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_action_submissions;
  a public.esh_finding_actions;
  v_count integer := 0;
  v_user uuid;
begin
  select * into s from public.esh_action_submissions where id = p_submission_id;
  select * into a from public.esh_finding_actions where id = s.action_id;
  for v_user in
    select candidate from (
      select a.reviewer_user_id as candidate, 0 as rank
       where a.reviewer_user_id is not null
         and focus.esh_user_can_coordinate(a.reviewer_user_id, a.finding_id)
      union all
      select x.user_id, 1
        from public.esh_staff_access x
       where a.reviewer_user_id is null
         and x.organization_id = a.organization_id
         and x.enabled
         and x.preset = 'verifier'
         and focus.esh_user_can_coordinate(x.user_id, a.finding_id)
    ) people
    order by rank
    limit 20
  loop
    insert into public.esh_notification_outbox
      (organization_id, event_type, recipient_user_id, finding_id, action_id, submission_id,
       state, link_intents, idempotency_key, next_attempt_at)
    values
      (a.organization_id, p_event, v_user, a.finding_id, a.id, s.id, 'queued', '[]'::jsonb,
       p_event || ':' || s.id || ':' || v_user, now())
    on conflict (idempotency_key) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The attachments of some messages, as the conversation shows them.
create or replace function focus.esh_message_files(p_message_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(message_id, files), '{}'::jsonb)
    from (
      select e.message_id,
             jsonb_agg(jsonb_build_object(
               'id', e.id, 'name', e.original_name, 'type', e.content_type,
               'size', e.size_bytes) order by e.created_at, e.id) as files
        from public.esh_evidence_assets e
       where e.message_id = any (p_message_ids)
         and e.state = 'ready'
       group by e.message_id
    ) grouped;
$$;

-- ---------------------------------------------------------------------------
-- 8. Uploading, for an owner (§23)
-- ---------------------------------------------------------------------------

/*
 * Start an upload: check the owner may add a file here, record it as
 * uploading, and name the object the server will sign an upload for. The
 * object's name is ours — the finding, the action, the file's id — never the
 * person's file name, which is kept only for display.
 */
create or replace function public.esh_guest_start_upload(
  p_session text,
  p_action_id uuid,
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
  if p_size is null or p_size not between 1 and 10485760 then
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
$$;

/*
 * Which object the server should read back, and only if it is this owner's
 * upload still in progress. Asked before the server touches any bytes, so a
 * guessed id can never make it read, or discard, somebody else's file.
 */
create or replace function public.esh_guest_upload_target(p_session text, p_asset_id uuid)
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
  if not found or e.uploader_principal_id is distinct from s.principal_id or e.state <> 'uploading'
     or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, e.action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  return jsonb_build_object('ok', true, 'object_key', e.object_key, 'name', e.original_name);
end;
$$;

/*
 * Record what the server found in the uploaded bytes. Only the uploader, in a
 * session that still reaches the action, and only while it is uploading.
 */
create or replace function public.esh_guest_finish_upload(
  p_session text,
  p_asset_id uuid,
  p_ok boolean,
  p_type text,
  p_size bigint,
  p_sha256 text,
  p_reason text
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
  if not found or e.uploader_principal_id is distinct from s.principal_id or e.state <> 'uploading'
     or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, e.action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if p_ok then
    update public.esh_evidence_assets set
      state = 'ready', content_type = p_type, size_bytes = p_size, content_sha256 = p_sha256,
      ready_at = now()
     where id = e.id;
    return jsonb_build_object('ok', true, 'state', 'ready');
  end if;
  update public.esh_evidence_assets set state = 'rejected', rejected_reason = left(p_reason, 200)
   where id = e.id;
  return jsonb_build_object('ok', true, 'state', 'rejected');
end;
$$;

-- Remove a file not yet sent. Its object is deleted by the server.
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
  return jsonb_build_object('ok', true, 'object_key', e.object_key);
end;
$$;

/*
 * A file the owner may open (§20.4): a file on their action's conversation,
 * or their finding's original evidence. Nothing else, whatever id is asked.
 */
create or replace function public.esh_guest_file(p_session text, p_asset_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  e public.esh_evidence_assets;
  v_allowed boolean := false;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id;
  if not found or e.state <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if e.purpose = 'message' then
    v_allowed := focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, e.action_id)
                 and (e.message_id is not null or e.uploader_principal_id = s.principal_id);
  else
    v_allowed := exists (
      select 1 from public.esh_finding_actions a
       where a.finding_id = e.finding_id
         and focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, a.id));
  end if;
  if not v_allowed then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  return jsonb_build_object('ok', true, 'object_key', e.object_key, 'name', e.original_name,
                            'type', e.content_type);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The owner's message, now with files (replaces v198's)
-- ---------------------------------------------------------------------------

drop function public.esh_guest_send_message(text, uuid, text, text);

/*
 * Checks, in one place, that a set of files can go on a message: all this
 * uploader's, on this action, ready, not already sent, at most ten. Returns
 * a problem code or null.
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
    else null
  end;
$$;

create or replace function public.esh_guest_send_message(
  p_session text,
  p_action_id uuid,
  p_body text,
  p_client_key text,
  p_asset_ids uuid[] default '{}'
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
  v_principal public.esh_email_principals;
  v_body text := btrim(coalesce(p_body, ''));
  v_files uuid[] := coalesce(p_asset_ids, '{}');
  v_existing uuid;
  v_message_id uuid;
  v_problem text;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;

  select * into a from public.esh_finding_actions where id = p_action_id for update;
  if not found or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if p_client_key is null or length(p_client_key) not between 8 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select id into v_existing from public.esh_action_messages
   where action_id = a.id and client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'message_id', v_existing, 'duplicate', true, 'state', a.state);
  end if;

  if v_body = '' and cardinality(v_files) = 0 then
    return jsonb_build_object('ok', false, 'code', 'body_required');
  end if;
  if length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'body_too_long');
  end if;
  v_problem := focus.esh_files_problem(a.id, s.principal_id, null, v_files);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'code', v_problem);
  end if;
  if (select count(*) from public.esh_action_messages m
       where m.action_id = a.id and m.author_principal_id = s.principal_id
         and m.sent_at > now() - interval '10 minutes') >= 20 then
    return jsonb_build_object('ok', false, 'code', 'slow_down');
  end if;

  select * into v_principal from public.esh_email_principals where id = s.principal_id;

  insert into public.esh_action_messages
    (organization_id, action_id, author_kind, author_principal_id, author_email, author_name,
     body, client_key)
  values
    (a.organization_id, a.id, 'owner', s.principal_id, v_principal.display_email,
     v_principal.display_name, v_body, p_client_key)
  returning id into v_message_id;

  if cardinality(v_files) > 0 then
    update public.esh_evidence_assets set message_id = v_message_id where id = any (v_files);
  end if;

  if a.state = 'assigned' then
    update public.esh_finding_actions set
      state = 'in_progress',
      updated_at = now(),
      row_version = row_version + 1
     where id = a.id;
    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id, detail)
    values
      (a.organization_id, 'principal', s.principal_id, 'action_started', a.finding_id, a.id,
       jsonb_build_object('message_id', v_message_id));
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'principal', s.principal_id, 'owner_message', a.finding_id, a.id,
     jsonb_build_object('message_id', v_message_id, 'files', cardinality(v_files)));

  return jsonb_build_object(
    'ok', true, 'message_id', v_message_id,
    'state', case when a.state = 'assigned' then 'in_progress' else a.state end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Submit for review, and withdraw (§12)
-- ---------------------------------------------------------------------------

/*
 * Submit for review. Either the composer's draft, sent now as the final
 * update, or one update the owner already sent and chose — never both, and
 * never a guess at "the latest message" (§12, FM18, FM19).
 *
 * Everything is checked before anything is written: the evidence rule (a
 * result and at least one file, unless ESH made an exception), the files
 * themselves, and that nothing is already waiting for review. Then, in one
 * transaction: the message (if new), the immutable snapshot, the action
 * Awaiting verification, the audit, and ESH told.
 */
create or replace function public.esh_guest_submit(
  p_session text,
  p_action_id uuid,
  p_body text,
  p_asset_ids uuid[],
  p_reuse_message_id uuid,
  p_client_key text
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
  v_principal public.esh_email_principals;
  v_body text := btrim(coalesce(p_body, ''));
  v_files uuid[] := coalesce(p_asset_ids, '{}');
  v_message public.esh_action_messages;
  v_message_id uuid;
  v_result text;
  v_evidence uuid[];
  v_problem text;
  v_problems text[] := '{}';
  v_assignment_start timestamptz;
  v_version integer;
  v_submission_id uuid;
  v_existing uuid;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select * into a from public.esh_finding_actions where id = p_action_id for update;
  if not found or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if p_client_key is null or length(p_client_key) not between 8 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  -- A second press of the same Submit: the same answer, nothing new (FM51).
  select x.id into v_existing from public.esh_action_submissions x
   where x.action_id = a.id and x.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'submission_id', v_existing);
  end if;

  if a.state = 'awaiting_verification' then
    return jsonb_build_object('ok', false, 'code', 'already_submitted');
  end if;
  if a.state not in ('assigned', 'in_progress') then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;

  select started_at into v_assignment_start from public.esh_action_assignments
   where action_id = a.id and version = a.assignment_version;

  if exists (select 1 from public.esh_action_messages m
              where m.action_id = a.id and m.client_key = p_client_key) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if p_reuse_message_id is not null then
    if v_body <> '' or cardinality(v_files) > 0 then
      return jsonb_build_object('ok', false, 'code', 'reuse_or_new');
    end if;
    select * into v_message from public.esh_action_messages
     where id = p_reuse_message_id and action_id = a.id
       and author_principal_id = s.principal_id
       and sent_at >= coalesce(v_assignment_start, a.assigned_at);
    if not found then
      return jsonb_build_object('ok', false, 'code', 'message_not_yours');
    end if;
    v_result := btrim(v_message.body);
    select coalesce(array_agg(e.id order by e.created_at, e.id), '{}') into v_evidence
      from public.esh_evidence_assets e
     where e.message_id = v_message.id and e.state = 'ready';
  else
    if length(v_body) > 4000 then
      return jsonb_build_object('ok', false, 'code', 'body_too_long');
    end if;
    v_problem := focus.esh_files_problem(a.id, s.principal_id, null, v_files);
    if v_problem is not null then
      return jsonb_build_object('ok', false, 'code', v_problem);
    end if;
    v_result := v_body;
    v_evidence := v_files;
  end if;

  -- The action's evidence rule (§12): the owner cannot type "Done" past it.
  if v_result = '' then
    v_problems := array_append(v_problems, 'result_required');
  end if;
  if a.evidence_rule = 'file_required' and cardinality(v_evidence) = 0 then
    v_problems := array_append(v_problems, 'file_required');
  end if;
  if cardinality(v_problems) > 0 then
    return jsonb_build_object('ok', false, 'code', 'evidence_incomplete', 'problems', to_jsonb(v_problems));
  end if;

  select * into v_principal from public.esh_email_principals where id = s.principal_id;

  if p_reuse_message_id is not null then
    v_message_id := v_message.id;
  else
    insert into public.esh_action_messages
      (organization_id, action_id, author_kind, author_principal_id, author_email, author_name,
       body, client_key)
    values
      (a.organization_id, a.id, 'owner', s.principal_id, v_principal.display_email,
       v_principal.display_name, v_body, p_client_key)
    returning id into v_message_id;
    if cardinality(v_files) > 0 then
      update public.esh_evidence_assets set message_id = v_message_id where id = any (v_files);
    end if;
    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id, detail)
    values
      (a.organization_id, 'principal', s.principal_id, 'owner_message', a.finding_id, a.id,
       jsonb_build_object('message_id', v_message_id, 'files', cardinality(v_files)));
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.esh_action_submissions where action_id = a.id;

  insert into public.esh_action_submissions
    (organization_id, action_id, version, assignment_version, principal_id, owner_email,
     message_id, result_text, evidence_asset_ids, due_at_snapshot, baseline_due_at_snapshot,
     client_key)
  values
    (a.organization_id, a.id, v_version, a.assignment_version, s.principal_id,
     v_principal.display_email, v_message_id, v_result, v_evidence, a.due_at, a.baseline_due_at,
     p_client_key)
  returning id into v_submission_id;

  update public.esh_finding_actions set
    state = 'awaiting_verification',
    current_submission_id = v_submission_id,
    updated_at = now(),
    row_version = row_version + 1
   where id = a.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'principal', s.principal_id, 'submission_created', a.finding_id, a.id,
     jsonb_build_object('submission_id', v_submission_id, 'version', v_version,
                        'message_id', v_message_id, 'files', cardinality(v_evidence),
                        'reused_message', p_reuse_message_id is not null));

  perform focus.esh_notify_reviewers(v_submission_id, 'submission_received');

  return jsonb_build_object('ok', true, 'submission_id', v_submission_id, 'version', v_version,
                            'message_id', v_message_id);
end;
$$;

/*
 * Withdraw a pending submission to revise it (§12, FM22). The snapshot stays
 * in history, marked withdrawn, so it can never be accepted; the action goes
 * back to the owner, and ESH is told.
 */
create or replace function public.esh_guest_withdraw(
  p_session text,
  p_action_id uuid,
  p_reason text
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
  v_submission public.esh_action_submissions;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select * into a from public.esh_finding_actions where id = p_action_id for update;
  if not found or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select * into v_submission from public.esh_action_submissions
   where action_id = a.id and state = 'pending'
   for update;
  if not found or a.state <> 'awaiting_verification' then
    return jsonb_build_object('ok', false, 'code', 'nothing_pending');
  end if;

  update public.esh_action_submissions set
    state = 'withdrawn',
    closed_at = now(),
    closed_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = v_submission.id;
  update public.esh_finding_actions set
    state = 'in_progress',
    current_submission_id = null,
    updated_at = now(),
    row_version = row_version + 1
   where id = a.id;
  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'principal', s.principal_id, 'submission_withdrawn', a.finding_id, a.id,
     jsonb_build_object('submission_id', v_submission.id, 'version', v_submission.version));
  perform focus.esh_notify_reviewers(v_submission.id, 'submission_withdrawn');
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. The owner's action, with files and submissions (replaces v198's)
-- ---------------------------------------------------------------------------

create or replace function public.esh_guest_action(
  p_session text,
  p_action_id uuid,
  p_before timestamptz default null
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
  f public.esh_findings;
  v_principal public.esh_email_principals;
  v_creator public.user_profiles;
  v_department text;
  v_messages jsonb;
  v_more boolean;
  v_message_ids uuid[];
  v_assignment_start timestamptz;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null
     or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available', 'inbox_scope', s.inbox_scope);
  end if;

  select * into a from public.esh_finding_actions where id = p_action_id;
  select * into f from public.esh_findings where id = a.finding_id;
  select * into v_principal from public.esh_email_principals where id = s.principal_id;
  select * into v_creator from public.user_profiles where id = f.created_by;
  select name into v_department from public.departments where id = f.accountable_department_id;
  select started_at into v_assignment_start from public.esh_action_assignments
   where action_id = a.id and version = a.assignment_version;

  with recent as (
    select m.id, m.author_kind, m.author_name, m.author_email, m.author_principal_id, m.body,
           m.sent_at
      from public.esh_action_messages m
     where m.action_id = a.id
       and (p_before is null or m.sent_at < p_before)
     order by m.sent_at desc, m.id desc
     limit 51
  ),
  ranked as (
    select recent.*, row_number() over (order by sent_at desc, id desc) as rn from recent
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'author_kind', r.author_kind,
           'author_name', case when r.author_kind = 'staff' then r.author_name else null end,
           'author_email', case when r.author_kind = 'owner' then r.author_email else null end,
           'body', r.body,
           'sent_at', r.sent_at,
           -- The owner may submit an update they sent under this assignment.
           'submittable', r.author_principal_id = s.principal_id
                          and r.sent_at >= coalesce(v_assignment_start, a.assigned_at))
           order by r.sent_at, r.id) filter (where r.rn <= 50), '[]'::jsonb),
         count(*) > 50,
         coalesce(array_agg(r.id) filter (where r.rn <= 50), '{}')
    into v_messages, v_more, v_message_ids
    from ranked r;

  return jsonb_build_object(
    'ok', true,
    'email', v_principal.display_email,
    'display_name', v_principal.display_name,
    'principal_id', v_principal.id,
    'inbox_scope', s.inbox_scope,
    'action', jsonb_build_object(
      'id', a.id,
      'title', a.title,
      'state', a.state,
      'priority', a.priority,
      'required_outcome', a.required_outcome,
      'evidence_instruction', a.evidence_instruction,
      'evidence_rule', a.evidence_rule,
      'due_at', a.due_at,
      'due_is_date_only', a.due_is_date_only,
      'assigned_at', a.assigned_at),
    'finding', jsonb_build_object(
      'reference', f.reference,
      'title', f.title,
      'description', f.description,
      'location', f.location,
      'department', v_department,
      'reported_on', f.reported_on),
    'esh_contact', jsonb_build_object('name', v_creator.full_name, 'email', v_creator.email),
    'messages', v_messages,
    'files', focus.esh_message_files(v_message_ids),
    'has_more', v_more,
    'original_evidence', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.original_name,
                                          'type', e.content_type, 'size', e.size_bytes)
                       order by e.created_at, e.id)
        from public.esh_evidence_assets e
       where e.finding_id = f.id and e.purpose = 'original' and e.state = 'ready'), '[]'::jsonb),
    -- Files this owner uploaded and has not sent yet, so a reload keeps them.
    'drafts', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.original_name,
                                          'type', e.content_type, 'size', e.size_bytes)
                       order by e.created_at, e.id)
        from public.esh_evidence_assets e
       where e.action_id = a.id and e.uploader_principal_id = s.principal_id
         and e.message_id is null and e.state = 'ready'), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'version', x.version, 'state', x.state, 'message_id', x.message_id,
               'submitted_at', x.submitted_at, 'closed_at', x.closed_at,
               'files', cardinality(x.evidence_asset_ids))
             order by x.version)
        from public.esh_action_submissions x
       where x.action_id = a.id and x.assignment_version = a.assignment_version), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Staff: files and messages
-- ---------------------------------------------------------------------------

/*
 * ESH adds a file: original evidence on the finding, or a file for a message
 * to the owner. Coordinators and Verifiers in scope.
 */
create or replace function public.esh_start_upload(
  p_finding_id uuid,
  p_action_id uuid,
  p_purpose text,
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
  if p_size is null or p_size not between 1 and 10485760 then
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
$$;

create or replace function public.esh_finish_upload(
  p_asset_id uuid,
  p_ok boolean,
  p_type text,
  p_size bigint,
  p_sha256 text,
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
  e public.esh_evidence_assets;
begin
  select * into e from public.esh_evidence_assets where id = p_asset_id for update;
  if not found or e.uploader_user_id is distinct from actor or e.state <> 'uploading'
     or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if not p_ok then
    update public.esh_evidence_assets set state = 'rejected', rejected_reason = left(p_reason, 200)
     where id = e.id;
    return jsonb_build_object('ok', true, 'state', 'rejected');
  end if;
  update public.esh_evidence_assets set
    state = 'ready', content_type = p_type, size_bytes = p_size, content_sha256 = p_sha256,
    ready_at = now()
   where id = e.id;
  if e.purpose = 'original' then
    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
    values
      (e.organization_id, 'staff', actor, 'original_evidence_added', e.finding_id,
       jsonb_build_object('asset_id', e.id, 'name', e.original_name));
  end if;
  return jsonb_build_object('ok', true, 'state', 'ready');
end;
$$;

/*
 * Remove a file: an unsent draft of one's own, or a finding's original
 * evidence. Original evidence is marked removed with who and when, and the
 * audit keeps its name; a file sent in a message is never removable.
 */
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
  return jsonb_build_object('ok', true, 'object_key', e.object_key);
end;
$$;

-- ESH's message, now with files (replaces v198's).
drop function public.esh_post_message(uuid, text, text);

create or replace function public.esh_post_message(
  p_action_id uuid,
  p_body text,
  p_client_key text,
  p_asset_ids uuid[] default '{}'
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
  v_actor public.user_profiles;
  v_body text := btrim(coalesce(p_body, ''));
  v_files uuid[] := coalesce(p_asset_ids, '{}');
  v_existing uuid;
  v_message_id uuid;
  v_state text;
  v_problem text;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into a from public.esh_finding_actions
   where id = p_action_id and organization_id = org
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'action_not_found');
  end if;
  select * into f from public.esh_findings where id = a.finding_id;
  if not (focus.esh_scope_all()
          or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'action_not_found');
  end if;
  if f.status <> 'open' or a.state not in ('assigned', 'in_progress', 'awaiting_verification') then
    return jsonb_build_object('ok', false, 'code', 'action_closed');
  end if;
  if p_client_key is null or length(p_client_key) not between 8 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select id into v_existing from public.esh_action_messages
   where action_id = a.id and client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'message_id', v_existing, 'duplicate', true);
  end if;
  if v_body = '' and cardinality(v_files) = 0 then
    return jsonb_build_object('ok', false, 'code', 'body_required');
  end if;
  if length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'body_too_long');
  end if;
  v_problem := focus.esh_files_problem(a.id, null, actor, v_files);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'code', v_problem);
  end if;

  select * into v_actor from public.user_profiles where id = actor;

  insert into public.esh_action_messages
    (organization_id, action_id, author_kind, author_user_id, author_email, author_name, body,
     client_key)
  values
    (a.organization_id, a.id, 'staff', actor, v_actor.email, v_actor.full_name, v_body,
     p_client_key)
  returning id into v_message_id;
  if cardinality(v_files) > 0 then
    update public.esh_evidence_assets set message_id = v_message_id where id = any (v_files);
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'staff', actor, 'esh_message', a.finding_id, a.id,
     jsonb_build_object('message_id', v_message_id, 'files', cardinality(v_files)));

  -- Held too while the assignment email is still held (v198).
  v_state := case when focus.esh_contact_usable(a.owner_principal_id)
                       and not exists (
                         select 1 from public.esh_notification_outbox held
                          where held.action_id = a.id
                            and held.recipient_principal_id = a.owner_principal_id
                            and held.event_type = 'owner_assignment'
                            and held.state = 'held_rollout')
                  then 'queued' else 'held_rollout' end;
  if not exists (
       select 1 from public.esh_notification_outbox o
        where o.action_id = a.id
          and o.recipient_principal_id = a.owner_principal_id
          and o.event_type = 'esh_reply'
          and o.state in ('queued', 'held_rollout')) then
    insert into public.esh_notification_outbox
      (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
       link_intents, idempotency_key, next_attempt_at)
    values
      (a.organization_id, 'esh_reply', a.owner_principal_id, a.finding_id, a.id, v_state,
       '["owner_action"]'::jsonb, 'esh_reply:' || v_message_id,
       case when v_state = 'queued' then now() end);
  end if;

  return jsonb_build_object('ok', true, 'message_id', v_message_id, 'notification', v_state);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Dispatch, for staff recipients too (replaces v198's claim)
-- ---------------------------------------------------------------------------

/*
 * Claim one outbox row for sending (v198), now also for a staff member told
 * of a submission (v199). Everything is re-checked at send time.
 */
create or replace function public.esh_dispatch_claim(p_outbox_id uuid, p_secrets jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o public.esh_notification_outbox;
  v_principal public.esh_email_principals;
  v_action public.esh_finding_actions;
  v_finding public.esh_findings;
  v_creator public.user_profiles;
  v_timezone text;
  v_ttl interval;
  v_intent text;
  v_secret text;
  v_version integer;
  v_staff public.user_profiles;
  v_submission public.esh_action_submissions;
begin
  select * into o from public.esh_notification_outbox
   where id = p_outbox_id
   for update skip locked;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;
  if not (o.state = 'queued'
          or (o.state = 'failed' and o.next_attempt_at is not null and o.next_attempt_at <= now())
          or (o.state = 'processing' and o.updated_at < now() - interval '15 minutes')) then
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;

  -- v199: a staff member told of a submission. They sign in as usual, so no
  -- link is minted; they must still be able to review this finding, and the
  -- submission must still be the one it was about.
  if o.recipient_user_id is not null then
    select * into v_submission from public.esh_action_submissions where id = o.submission_id;
    if not focus.esh_user_can_coordinate(o.recipient_user_id, o.finding_id)
       or (o.event_type = 'submission_received' and v_submission.state is distinct from 'pending') then
      update public.esh_notification_outbox set
        state = 'suppressed',
        state_reason = case when v_submission.state is distinct from 'pending'
                                 and o.event_type = 'submission_received'
                            then 'no_longer_pending' else 'no_longer_esh' end,
        next_attempt_at = null,
        updated_at = now()
       where id = o.id;
      return jsonb_build_object('ok', false, 'code', 'suppressed');
    end if;
    select * into v_staff from public.user_profiles where id = o.recipient_user_id;
    select * into v_action from public.esh_finding_actions where id = o.action_id;
    select * into v_finding from public.esh_findings where id = o.finding_id;
    select timezone into v_timezone from public.organizations where id = o.organization_id;
    update public.esh_notification_outbox set
      state = 'processing',
      attempts = attempts + 1,
      updated_at = now()
     where id = o.id;
    return jsonb_build_object(
      'ok', true,
      'event_type', o.event_type,
      'to', v_staff.email,
      'recipient_name', v_staff.full_name,
      'intents', '[]'::jsonb,
      'finding_id', o.finding_id,
      'action_id', o.action_id,
      'reference', v_finding.reference,
      'finding_title', v_finding.title,
      'action_title', v_action.title,
      'location', v_finding.location,
      'owner_email', v_submission.owner_email,
      'submission_version', v_submission.version,
      'due_at', v_action.due_at,
      'due_is_date_only', v_action.due_is_date_only,
      'timezone', coalesce(v_timezone, 'Asia/Kuala_Lumpur'),
      'expires_minutes', 0);
  end if;

  if not focus.esh_contact_usable(o.recipient_principal_id) then
    update public.esh_notification_outbox set
      state = case when o.event_type = 'access_link' then 'suppressed' else 'held_rollout' end,
      state_reason = 'access_not_enabled',
      next_attempt_at = null,
      updated_at = now()
     where id = o.id;
    return jsonb_build_object('ok', false, 'code', 'held');
  end if;

  -- A reply notice waits for the assignment email it follows.
  if o.event_type = 'esh_reply' and exists (
       select 1 from public.esh_notification_outbox held
        where held.action_id = o.action_id
          and held.recipient_principal_id = o.recipient_principal_id
          and held.event_type = 'owner_assignment'
          and held.state = 'held_rollout') then
    update public.esh_notification_outbox set
      state = 'held_rollout',
      state_reason = 'assignment_not_released',
      next_attempt_at = null,
      updated_at = now()
     where id = o.id;
    return jsonb_build_object('ok', false, 'code', 'held');
  end if;

  if o.action_id is not null then
    select * into v_action from public.esh_finding_actions where id = o.action_id;
    select * into v_finding from public.esh_findings where id = v_action.finding_id;
    if not focus.esh_owner_holds(o.action_id, o.recipient_principal_id, null) then
      update public.esh_notification_outbox set
        state = 'suppressed',
        state_reason = 'no_longer_the_owner',
        next_attempt_at = null,
        updated_at = now()
       where id = o.id;
      return jsonb_build_object('ok', false, 'code', 'suppressed');
    end if;
    select * into v_creator from public.user_profiles where id = v_finding.created_by;
  end if;

  select * into v_principal from public.esh_email_principals where id = o.recipient_principal_id;
  select timezone into v_timezone from public.organizations where id = o.organization_id;
  v_version := v_action.assignment_version;

  update public.esh_notification_outbox set
    state = 'processing',
    attempts = attempts + 1,
    updated_at = now()
   where id = o.id;

  v_ttl := case when o.event_type = 'access_link' then interval '30 minutes'
                else interval '24 hours' end;

  for v_intent in select jsonb_array_elements_text(o.link_intents) loop
    v_secret := p_secrets ->> v_intent;
    if v_secret is null or length(v_secret) < 40 then
      raise exception 'esh_dispatch_claim: no secret for %', v_intent;
    end if;
    insert into public.esh_access_grants
      (organization_id, principal_id, purpose, action_id, assignment_version, token_hash,
       issued_reason, outbox_id, expires_at)
    values
      (o.organization_id, o.recipient_principal_id, v_intent,
       case when v_intent = 'owner_action' then o.action_id end,
       case when v_intent = 'owner_action' then v_version end,
       focus.esh_secret_hash(v_secret),
       case when o.event_type = 'access_link' then 'recovery' else 'notification' end,
       o.id, now() + v_ttl);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'event_type', o.event_type,
    'to', v_principal.display_email,
    'intents', o.link_intents,
    'action_id', o.action_id,
    'reference', v_finding.reference,
    'finding_title', v_finding.title,
    'action_title', v_action.title,
    'location', v_finding.location,
    'required_outcome', v_action.required_outcome,
    'due_at', v_action.due_at,
    'due_is_date_only', v_action.due_is_date_only,
    'priority', v_action.priority,
    'timezone', coalesce(v_timezone, 'Asia/Kuala_Lumpur'),
    'esh_contact_name', v_creator.full_name,
    'esh_contact_email', v_creator.email,
    'expires_minutes', (extract(epoch from v_ttl) / 60)::int);
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Grants
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_evidence_extension_ok(text) from public, anon, authenticated;
revoke all on function focus.esh_user_can_coordinate(uuid, uuid) from public, anon, authenticated;
revoke all on function focus.esh_notify_reviewers(uuid, text) from public, anon, authenticated;
revoke all on function focus.esh_message_files(uuid[]) from public, anon, authenticated;
revoke all on function focus.esh_files_problem(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function focus.esh_reject_sent_evidence_change() from public, anon, authenticated;
revoke all on function focus.esh_guard_submission() from public, anon, authenticated;
revoke all on function public.esh_guest_start_upload(text, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.esh_guest_finish_upload(text, uuid, boolean, text, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.esh_guest_remove_upload(text, uuid) from public, anon, authenticated;
revoke all on function public.esh_guest_upload_target(text, uuid) from public, anon, authenticated;
revoke all on function public.esh_guest_file(text, uuid) from public, anon, authenticated;
revoke all on function public.esh_guest_send_message(text, uuid, text, text, uuid[])
  from public, anon, authenticated;
revoke all on function public.esh_guest_submit(text, uuid, text, uuid[], uuid, text)
  from public, anon, authenticated;
revoke all on function public.esh_guest_withdraw(text, uuid, text) from public, anon, authenticated;
revoke all on function public.esh_guest_action(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.esh_dispatch_claim(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.esh_start_upload(uuid, uuid, text, text, bigint) from public, anon;
revoke all on function public.esh_finish_upload(uuid, boolean, text, bigint, text, text) from public, anon;
revoke all on function public.esh_remove_upload(uuid) from public, anon;
revoke all on function public.esh_post_message(uuid, text, text, uuid[]) from public, anon;

grant execute on function public.esh_guest_start_upload(text, uuid, text, bigint) to service_role;
grant execute on function public.esh_guest_finish_upload(text, uuid, boolean, text, bigint, text, text)
  to service_role;
grant execute on function public.esh_guest_remove_upload(text, uuid) to service_role;
grant execute on function public.esh_guest_upload_target(text, uuid) to service_role;
grant execute on function public.esh_guest_file(text, uuid) to service_role;
grant execute on function public.esh_guest_send_message(text, uuid, text, text, uuid[]) to service_role;
grant execute on function public.esh_guest_submit(text, uuid, text, uuid[], uuid, text) to service_role;
grant execute on function public.esh_guest_withdraw(text, uuid, text) to service_role;
grant execute on function public.esh_guest_action(text, uuid, timestamptz) to service_role;
grant execute on function public.esh_dispatch_claim(uuid, jsonb) to service_role;
grant execute on function public.esh_start_upload(uuid, uuid, text, text, bigint) to authenticated;
grant execute on function public.esh_finish_upload(uuid, boolean, text, bigint, text, text) to authenticated;
grant execute on function public.esh_remove_upload(uuid) to authenticated;
grant execute on function public.esh_post_message(uuid, text, text, uuid[]) to authenticated;

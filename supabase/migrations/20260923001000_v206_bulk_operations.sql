-- ============================================================================
-- v206 ESH Finding Management: several actions at once, each one still its own.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §40;
-- FM91-FM96.
--
-- An owner with eleven backlog items should not have to type the same progress
-- note eleven times. What they must not be able to do is finish eleven actions
-- with one press: a common update is a message on each action, a shared file is
-- an authorised association on each action, and a batch submission is eleven
-- separate immutable submissions that ESH verifies one at a time.
--
-- So everything here is a wrapper, not a second implementation. Each item goes
-- through the same single-action routine the chat uses, with its own
-- idempotency key, and comes back Succeeded, Failed or Skipped. A partial
-- failure keeps what succeeded and says what did not; nothing ever reports
-- whole-batch success.
-- ============================================================================

create table public.esh_bulk_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  principal_id uuid not null,
  session_id uuid references public.esh_guest_sessions (id),
  purpose text not null check (purpose in ('update', 'extension', 'evidence', 'submit')),
  operation_key text not null,
  requested integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (organization_id, principal_id)
    references public.esh_email_principals (organization_id, id),
  unique (principal_id, operation_key),
  unique (organization_id, id)
);

create table public.esh_bulk_operation_items (
  operation_id uuid not null references public.esh_bulk_operations (id) on delete cascade,
  action_id uuid not null,
  state text not null check (state in ('succeeded', 'failed', 'skipped')),
  code text,
  message_id uuid references public.esh_action_messages (id),
  submission_id uuid references public.esh_action_submissions (id),
  asset_id uuid references public.esh_evidence_assets (id),
  created_at timestamptz not null default now(),
  primary key (operation_id, action_id)
);

create index esh_bulk_operations_principal_idx
  on public.esh_bulk_operations (principal_id, created_at desc);

-- A record of what somebody did is not theirs to rewrite afterwards. The
-- operation counts what it did as it does it, so those four numbers are the
-- only part of the row that may ever be written a second time.
create or replace function focus.esh_bulk_is_written_once()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a bulk operation cannot be deleted' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.principal_id is distinct from old.principal_id
     or new.session_id is distinct from old.session_id
     or new.purpose is distinct from old.purpose
     or new.operation_key is distinct from old.operation_key
     or new.created_at is distinct from old.created_at then
    raise exception 'a bulk operation cannot be rewritten' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger esh_bulk_operations_written_once
  before update or delete on public.esh_bulk_operations
  for each row execute function focus.esh_bulk_is_written_once();
create trigger esh_bulk_operation_items_written_once
  before update or delete on public.esh_bulk_operation_items
  for each row execute function focus.reject_audit_mutation();

alter table public.esh_bulk_operations enable row level security;
alter table public.esh_bulk_operation_items enable row level security;

-- Staff read them where they can already read the finding's history; guests
-- reach them only through the procedures below.
create policy esh_bulk_operations_select on public.esh_bulk_operations
  as permissive for select to authenticated
  using ((select focus.esh_enabled())
         and organization_id = (select focus.esh_organization_id())
         and (select focus.esh_can('coordinate')));
create policy esh_bulk_operation_items_select on public.esh_bulk_operation_items
  as permissive for select to authenticated
  using (operation_id in (select id from public.esh_bulk_operations));

revoke all on public.esh_bulk_operations, public.esh_bulk_operation_items
  from anon, authenticated;
grant select on public.esh_bulk_operations, public.esh_bulk_operation_items to authenticated;

-- An extension is a request, and a request is a message plus a proposed date
-- on the record. Official deadlines still change only through ESH (§40).
alter table public.esh_action_messages
  add column proposed_due_date date,
  add column bulk_operation_id uuid references public.esh_bulk_operations (id);
-- ---------------------------------------------------------------------------
-- 2. The wrapper every bulk operation shares
-- ---------------------------------------------------------------------------

/**
 * Start (or recognise) one bulk operation for this owner.
 *
 * The same press twice is the same operation: its key is the caller's, and a
 * repeat returns what the first one did rather than doing it again.
 */
create or replace function focus.esh_bulk_begin(
  p_session public.esh_guest_sessions,
  p_purpose text,
  p_key text,
  p_requested integer,
  out operation_id uuid,
  out replayed boolean
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.esh_bulk_operations;
begin
  select * into existing from public.esh_bulk_operations
   where principal_id = p_session.principal_id and operation_key = p_key;
  if found then
    operation_id := existing.id;
    replayed := true;
    return;
  end if;
  insert into public.esh_bulk_operations
    (organization_id, principal_id, session_id, purpose, operation_key, requested)
  values
    (p_session.organization_id, p_session.principal_id, p_session.id, p_purpose, p_key,
     greatest(coalesce(p_requested, 0), 0))
  returning id into operation_id;
  replayed := false;
end;
$$;

/** What an operation did, item by item, for the answer the screen shows. */
create or replace function focus.esh_bulk_result(p_operation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ok', true,
    'operation_id', operation.id,
    'requested', operation.requested,
    'succeeded', operation.succeeded,
    'failed', operation.failed,
    'skipped', operation.skipped,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action_id', item.action_id, 'state', item.state, 'code', item.code)
        order by item.created_at)
        from public.esh_bulk_operation_items item
       where item.operation_id = operation.id), '[]'::jsonb))
    from public.esh_bulk_operations operation
   where operation.id = p_operation_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. The operations themselves
-- ---------------------------------------------------------------------------

/**
 * One progress update, posted to each selected action in the owner's own name.
 *
 * It is a message on each action and nothing more: it does not submit, it does
 * not finish anything, and an action that is with ESH for review is skipped
 * rather than written into (§40).
 */
create or replace function public.esh_guest_bulk_update(
  p_session text,
  p_action_ids uuid[],
  p_body text,
  p_operation_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  session public.esh_guest_sessions;
  begun record;
  v_action uuid;
  outcome jsonb;
  v_state text;
  v_code text;
  v_succeeded integer := 0;
  v_failed integer := 0;
  v_skipped integer := 0;
begin
  session := focus.esh_guest_resolve(p_session, true);
  if session.id is null then return jsonb_build_object('ok', false, 'code', 'no_session'); end if;
  -- Bulk is inbox work. An action-only link does not widen itself into one
  -- (§40): the owner follows their own My Actions link.
  if session.inbox_scope is not true then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if coalesce(cardinality(p_action_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_selected');
  end if;
  if cardinality(p_action_ids) > 100 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  if length(btrim(coalesce(p_operation_key, ''))) not between 8 and 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into begun from focus.esh_bulk_begin(session, 'update', p_operation_key,
                                                cardinality(p_action_ids));
  if begun.replayed then return focus.esh_bulk_result(begun.operation_id); end if;

  foreach v_action in array p_action_ids loop
    -- The same routine the single-action chat uses, so one message cannot obey
    -- different rules because it arrived in a batch.
    outcome := public.esh_guest_send_message(p_session, v_action, p_body,
                                             p_operation_key || ':' || v_action, '{}',
                                             null, begun.operation_id);
    if coalesce((outcome->>'ok')::boolean, false) then
      v_state := 'succeeded';
      v_code := null;
      v_succeeded := v_succeeded + 1;
    elsif outcome->>'code' in ('not_available', 'no_session') then
      v_state := 'skipped';
      v_code := outcome->>'code';
      v_skipped := v_skipped + 1;
    else
      v_state := 'failed';
      v_code := outcome->>'code';
      v_failed := v_failed + 1;
    end if;

    insert into public.esh_bulk_operation_items
      (operation_id, action_id, state, code, message_id)
    values
      (begun.operation_id, v_action, v_state, v_code,
       nullif(outcome->>'message_id', '')::uuid)
    on conflict (operation_id, action_id) do nothing;

  end loop;

  update public.esh_bulk_operations
     set succeeded = v_succeeded, failed = v_failed, skipped = v_skipped
   where id = begun.operation_id;
  return focus.esh_bulk_result(begun.operation_id);
end;
$$;

/**
 * One explanation and a proposed date, asked of ESH for several actions.
 *
 * Nothing here changes a deadline. The proposal is recorded on each action's
 * message so ESH can approve it one action at a time, with its own reason and
 * its own audited change (§40).
 */
create or replace function public.esh_guest_bulk_extension(
  p_session text,
  p_action_ids uuid[],
  p_body text,
  p_proposed_date date,
  p_operation_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  session public.esh_guest_sessions;
  begun record;
  v_action uuid;
  outcome jsonb;
  v_succeeded integer := 0;
  v_failed integer := 0;
  v_skipped integer := 0;
  v_state text;
begin
  session := focus.esh_guest_resolve(p_session, true);
  if session.id is null then return jsonb_build_object('ok', false, 'code', 'no_session'); end if;
  if session.inbox_scope is not true then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if coalesce(cardinality(p_action_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_selected');
  end if;
  if p_proposed_date is null or p_proposed_date < current_date then
    return jsonb_build_object('ok', false, 'code', 'date_required');
  end if;
  if p_proposed_date > current_date + interval '2 years' then
    return jsonb_build_object('ok', false, 'code', 'date_too_far');
  end if;

  select * into begun from focus.esh_bulk_begin(session, 'extension', p_operation_key,
                                                cardinality(p_action_ids));
  if begun.replayed then return focus.esh_bulk_result(begun.operation_id); end if;

  foreach v_action in array p_action_ids loop
    outcome := public.esh_guest_send_message(p_session, v_action, p_body,
                                             p_operation_key || ':' || v_action, '{}',
                                             p_proposed_date, begun.operation_id);
    if coalesce((outcome->>'ok')::boolean, false) then
      v_state := 'succeeded';
      v_succeeded := v_succeeded + 1;
    elsif outcome->>'code' in ('not_available', 'no_session') then
      v_state := 'skipped';
      v_skipped := v_skipped + 1;
    else
      v_state := 'failed';
      v_failed := v_failed + 1;
    end if;
    insert into public.esh_bulk_operation_items
      (operation_id, action_id, state, code, message_id)
    values
      (begun.operation_id, v_action, v_state, outcome->>'code',
       nullif(outcome->>'message_id', '')::uuid)
    on conflict (operation_id, action_id) do nothing;
  end loop;

  update public.esh_bulk_operations
     set succeeded = v_succeeded, failed = v_failed, skipped = v_skipped
   where id = begun.operation_id;
  return focus.esh_bulk_result(begun.operation_id);
end;
$$;
-- ---------------------------------------------------------------------------
-- 4. One file, several actions, still separately authorised
--
-- A photograph of the same corrected walkway may answer three actions. Sharing
-- it must not become a link one action can follow into another's conversation,
-- so each action receives its own copy, its own authorisation and its own
-- history — and removing one cannot take another's evidence, or the evidence
-- inside an immutable submission, with it (§40).
-- ---------------------------------------------------------------------------

alter table public.esh_evidence_assets
  add column shared_from_asset_id uuid references public.esh_evidence_assets (id),
  add column shared_operation_id uuid references public.esh_bulk_operations (id);

/**
 * Reserve a copy of one of the owner's own files against each chosen action.
 *
 * Returns the object keys the server then copies. Nothing is readable until
 * `esh_guest_share_finish` has confirmed each copy arrived.
 */
create or replace function public.esh_guest_share_prepare(
  p_session text,
  p_asset_id uuid,
  p_action_ids uuid[],
  p_operation_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  session public.esh_guest_sessions;
  begun record;
  source public.esh_evidence_assets;
  v_action uuid;
  a public.esh_finding_actions;
  v_new uuid;
  v_key text;
  v_copies jsonb := '[]'::jsonb;
  v_skipped integer := 0;
begin
  session := focus.esh_guest_resolve(p_session, true);
  if session.id is null then return jsonb_build_object('ok', false, 'code', 'no_session'); end if;
  if session.inbox_scope is not true then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if coalesce(cardinality(p_action_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_selected');
  end if;
  if cardinality(p_action_ids) > 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  select * into source from public.esh_evidence_assets where id = p_asset_id;
  -- Their own file, ready, and theirs under the assignment they hold now.
  if not found or source.state <> 'ready'
     or source.uploader_kind <> 'owner'
     or source.uploader_principal_id is distinct from session.principal_id then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;

  select * into begun from focus.esh_bulk_begin(session, 'evidence', p_operation_key,
                                                cardinality(p_action_ids));
  if begun.replayed then return focus.esh_bulk_result(begun.operation_id); end if;

  foreach v_action in array p_action_ids loop
    select * into a from public.esh_finding_actions where id = v_action;
    if not found
       or not focus.esh_guest_covers(session.id, session.principal_id, session.inbox_scope, v_action)
       or a.state not in ('assigned', 'in_progress') then
      insert into public.esh_bulk_operation_items (operation_id, action_id, state, code)
      values (begun.operation_id, v_action, 'skipped', 'not_available')
      on conflict (operation_id, action_id) do nothing;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_new := gen_random_uuid();
    v_key := a.finding_id || '/' || a.id || '/' || v_new || '.'
             || coalesce(nullif(regexp_replace(source.original_name, '^.*\.', ''), source.original_name), 'dat');
    insert into public.esh_evidence_assets
      (id, organization_id, finding_id, action_id, purpose, object_key, original_name,
       declared_size, content_type, state, uploader_kind, uploader_principal_id,
       shared_from_asset_id, shared_operation_id)
    values
      (v_new, a.organization_id, a.finding_id, a.id, 'message', v_key, source.original_name,
       source.declared_size, source.content_type, 'uploading', 'owner', session.principal_id,
       source.id, begun.operation_id);
    v_copies := v_copies || jsonb_build_object('asset_id', v_new, 'object_key', v_key,
                                               'action_id', a.id);
  end loop;

  update public.esh_bulk_operations set skipped = v_skipped where id = begun.operation_id;
  return jsonb_build_object('ok', true, 'operation_id', begun.operation_id,
                            'source_key', source.object_key, 'copies', v_copies);
end;
$$;

/** The copies that arrived become readable; the ones that did not are failures. */
create or replace function public.esh_guest_share_finish(
  p_session text,
  p_operation_id uuid,
  p_arrived uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  session public.esh_guest_sessions;
  operation public.esh_bulk_operations;
  source public.esh_evidence_assets;
  copy_row public.esh_evidence_assets;
  v_succeeded integer := 0;
  v_failed integer := 0;
begin
  session := focus.esh_guest_resolve(p_session, true);
  if session.id is null then return jsonb_build_object('ok', false, 'code', 'no_session'); end if;
  select * into operation from public.esh_bulk_operations
   where id = p_operation_id and principal_id = session.principal_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_available'); end if;

  for copy_row in
    select * from public.esh_evidence_assets
     where shared_operation_id = operation.id and state = 'uploading'
  loop
    select * into source from public.esh_evidence_assets where id = copy_row.shared_from_asset_id;
    if copy_row.id = any(coalesce(p_arrived, '{}')) then
      update public.esh_evidence_assets set
        state = 'ready', ready_at = now(),
        size_bytes = source.size_bytes, content_sha256 = source.content_sha256
       where id = copy_row.id;
      insert into public.esh_bulk_operation_items
        (operation_id, action_id, state, asset_id)
      values (operation.id, copy_row.action_id, 'succeeded', copy_row.id)
      on conflict (operation_id, action_id) do nothing;
      v_succeeded := v_succeeded + 1;
    else
      update public.esh_evidence_assets set
        state = 'rejected', rejected_reason = 'copy_failed'
       where id = copy_row.id;
      insert into public.esh_bulk_operation_items (operation_id, action_id, state, code)
      values (operation.id, copy_row.action_id, 'failed', 'copy_failed')
      on conflict (operation_id, action_id) do nothing;
      v_failed := v_failed + 1;
    end if;
  end loop;

  update public.esh_bulk_operations
     set succeeded = v_succeeded, failed = v_failed
   where id = operation.id;
  return focus.esh_bulk_result(operation.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Submitting several actions, each as its own immutable submission
-- ---------------------------------------------------------------------------

/**
 * A batch submission is a batch of submissions, not a batch submission.
 *
 * Each row carries its own result text and its own chosen files, is checked
 * against that action's own evidence rule, and becomes its own immutable
 * record for ESH to verify separately. Accepting one accepts nothing else
 * (§40). A row that cannot go leaves the others alone.
 */
create or replace function public.esh_guest_bulk_submit(
  p_session text,
  p_rows jsonb,
  p_operation_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  session public.esh_guest_sessions;
  begun record;
  entry jsonb;
  v_action uuid;
  outcome jsonb;
  v_state text;
  v_succeeded integer := 0;
  v_failed integer := 0;
  v_skipped integer := 0;
  v_count integer;
begin
  session := focus.esh_guest_resolve(p_session, true);
  if session.id is null then return jsonb_build_object('ok', false, 'code', 'no_session'); end if;
  if session.inbox_scope is not true then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count = 0 then return jsonb_build_object('ok', false, 'code', 'nothing_selected'); end if;
  if v_count > 25 then return jsonb_build_object('ok', false, 'code', 'too_many'); end if;

  select * into begun from focus.esh_bulk_begin(session, 'submit', p_operation_key, v_count);
  if begun.replayed then return focus.esh_bulk_result(begun.operation_id); end if;

  for entry in select value from jsonb_array_elements(p_rows) loop
    v_action := (entry->>'action_id')::uuid;
    if v_action is null then continue; end if;
    outcome := public.esh_guest_submit(
      p_session, v_action, entry->>'result_text',
      coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(
                  coalesce(entry->'asset_ids', '[]'::jsonb)) value), '{}'),
      nullif(entry->>'reuse_message_id', '')::uuid,
      p_operation_key || ':' || v_action);
    if coalesce((outcome->>'ok')::boolean, false) then
      v_state := 'succeeded';
      v_succeeded := v_succeeded + 1;
    elsif outcome->>'code' in ('not_available', 'no_session', 'already_submitted') then
      v_state := 'skipped';
      v_skipped := v_skipped + 1;
    else
      v_state := 'failed';
      v_failed := v_failed + 1;
    end if;
    insert into public.esh_bulk_operation_items
      (operation_id, action_id, state, code, submission_id)
    values
      (begun.operation_id, v_action, v_state, outcome->>'code',
       nullif(outcome->>'submission_id', '')::uuid)
    on conflict (operation_id, action_id) do nothing;
  end loop;

  update public.esh_bulk_operations
     set succeeded = v_succeeded, failed = v_failed, skipped = v_skipped
   where id = begun.operation_id;
  return focus.esh_bulk_result(begun.operation_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_bulk_begin(public.esh_guest_sessions, text, text, integer)
  from public, anon, authenticated;
revoke all on function focus.esh_bulk_result(uuid) from public, anon, authenticated;
revoke all on function public.esh_guest_bulk_update(text, uuid[], text, text)
  from public, anon, authenticated;
revoke all on function public.esh_guest_bulk_extension(text, uuid[], text, date, text)
  from public, anon, authenticated;
revoke all on function public.esh_guest_share_prepare(text, uuid, uuid[], text)
  from public, anon, authenticated;
revoke all on function public.esh_guest_share_finish(text, uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.esh_guest_bulk_submit(text, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.esh_guest_bulk_update(text, uuid[], text, text) to service_role;
grant execute on function public.esh_guest_bulk_extension(text, uuid[], text, date, text)
  to service_role;
grant execute on function public.esh_guest_share_prepare(text, uuid, uuid[], text) to service_role;
grant execute on function public.esh_guest_share_finish(text, uuid, uuid[]) to service_role;
grant execute on function public.esh_guest_bulk_submit(text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The one routine that writes an owner's message learns two more facts
--
-- A conversation is append-only, so a message that belongs to a batch, or one
-- that carries a date being asked for, has to say so as it is written. The
-- routine is otherwise the v201 one, unchanged.
-- ---------------------------------------------------------------------------

drop function public.esh_guest_send_message(text, uuid, text, text, uuid[]);

create or replace function public.esh_guest_send_message(
  p_session text,
  p_action_id uuid,
  p_body text,
  p_client_key text,
  p_asset_ids uuid[] default '{}',
  -- v206: a message written as part of a batch says which one, and a request
  -- for more time carries the date being asked for. Both are written when the
  -- message is written, because the conversation is append-only.
  p_proposed_due_date date default null,
  p_bulk_operation_id uuid default null
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
  v_author text;
  v_notifications integer := 0;
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
  -- v201: the owner writes, and so does an escalation recipient whose level
  -- is live — with no files, because evidence is the owner's to give (§15).
  if focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    v_author := 'owner';
  elsif focus.esh_escalation_covers(s.id, s.principal_id, p_action_id) then
    v_author := 'escalation';
    if cardinality(v_files) > 0 then
      return jsonb_build_object('ok', false, 'code', 'not_available');
    end if;
  else
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
     body, client_key, proposed_due_date, bulk_operation_id)
  values
    (a.organization_id, a.id, v_author, s.principal_id, v_principal.display_email,
     v_principal.display_name, v_body, p_client_key, p_proposed_due_date, p_bulk_operation_id)
  returning id into v_message_id;

  if cardinality(v_files) > 0 then
    update public.esh_evidence_assets set message_id = v_message_id where id = any (v_files);
  end if;

  -- Only the owner starting work moves the action on; a supervisor's
  -- comment does not (§6).
  if a.state = 'assigned' and v_author = 'owner' then
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
    (a.organization_id, 'principal', s.principal_id,
     case when v_author = 'owner' then 'owner_message' else 'escalation_message' end,
     a.finding_id, a.id,
     jsonb_build_object('message_id', v_message_id, 'files', cardinality(v_files)));

  v_notifications := focus.esh_notify_action_staff(
    a.id,
    case when v_author = 'owner' then 'owner_reply' else 'escalation_reply' end,
    v_message_id);

  return jsonb_build_object(
    'ok', true, 'message_id', v_message_id,
    'notifications', v_notifications,
    'state', case when a.state = 'assigned' and v_author = 'owner'
                  then 'in_progress' else a.state end);
end;
$$;

revoke all on function public.esh_guest_send_message(text, uuid, text, text, uuid[], date, uuid)
  from public, anon, authenticated;
grant execute on function
  public.esh_guest_send_message(text, uuid, text, text, uuid[], date, uuid) to service_role;

-- ============================================================================
-- v200 ESH Finding Management: verification, closure and changes.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §6,
-- §13, §14, §20, §24; FM23-FM29, FM51, FM52.
--
--   * a Verifier accepts the current submission — and for the last open
--     action, accepts and closes the finding in the same transaction — or
--     asks for more, saying why and deciding the due date explicitly;
--   * nobody verifies their own work (FM25), and only the pending, current
--     version can be decided (FM22);
--   * a closed finding reopens only by a Verifier, with a reason;
--   * the due date changes, and the owner changes, only through ESH's own
--     actions, each recorded with its reason and shown to the owner as an
--     event in the conversation (§14) — never from a chat message (FM28);
--   * an owner keeps a read-only receipt of an accepted action for 30 days.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Verification decisions (§21 verification_events)
-- ---------------------------------------------------------------------------

create table public.esh_verification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  submission_id uuid not null unique references public.esh_action_submissions (id),
  decision text not null check (decision in ('accepted', 'changes_requested')),
  method text check (method in ('document_review', 'site_verification', 'other')),
  note text check (note is null or length(note) <= 2000),
  due_decision text check (due_decision in ('kept', 'revised')),
  verifier_user_id uuid not null references public.user_profiles (id),
  verified_at timestamptz not null default now(),
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  -- Accepting says how it was verified; asking for more says what, and what
  -- happens to the due date (§13).
  check (decision <> 'accepted' or method is not null),
  check (decision <> 'changes_requested'
         or (length(btrim(coalesce(note, ''))) > 0 and due_decision is not null))
);

create index esh_verification_action_idx on public.esh_verification_events (action_id, verified_at);

-- ---------------------------------------------------------------------------
-- 2. Due-date changes (§14, §21 due_date_changes)
-- ---------------------------------------------------------------------------

create table public.esh_due_date_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  old_due_at timestamptz,
  new_due_at timestamptz not null,
  old_date_only boolean,
  new_date_only boolean not null,
  baseline_due_at timestamptz,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  cause text not null check (cause in ('changed', 'changes_requested', 'reopened')),
  changed_by uuid not null references public.user_profiles (id),
  changed_at timestamptz not null default now(),
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id)
);

create index esh_due_changes_action_idx on public.esh_due_date_changes (action_id, changed_at);

-- Both are history: written once, never edited or removed.
create trigger esh_verification_events_no_update
  before update or delete on public.esh_verification_events
  for each row execute function focus.reject_audit_mutation();
create trigger esh_due_date_changes_no_update
  before update or delete on public.esh_due_date_changes
  for each row execute function focus.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- 3. Closure and reopening on the finding (§13)
-- ---------------------------------------------------------------------------

alter table public.esh_findings
  add column closure_note text,
  add column reopened_at timestamptz,
  add column reopened_by uuid references public.user_profiles (id),
  add column reopen_reason text;

-- ---------------------------------------------------------------------------
-- 4. Events in the conversation (§14: "posts a system event visible to the
-- owner"). An event is written by ESH's action, not typed as a message.
-- ---------------------------------------------------------------------------

alter table public.esh_action_messages
  add column kind text not null default 'message' check (kind in ('message', 'event'));

-- ---------------------------------------------------------------------------
-- 5. More messages the outbox carries
-- ---------------------------------------------------------------------------

alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_event_type_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_event_type_check
  check (event_type in ('owner_assignment', 'esh_reply', 'access_link',
                        'submission_received', 'submission_withdrawn',
                        'changes_requested', 'due_changed', 'finding_closed',
                        'finding_reopened', 'reassigned_away'));

alter table public.esh_verification_events enable row level security;
alter table public.esh_due_date_changes enable row level security;

create policy esh_verification_events_select on public.esh_verification_events
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));
create policy esh_due_date_changes_select on public.esh_due_date_changes
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));

revoke all on public.esh_verification_events, public.esh_due_date_changes from anon, authenticated;
grant select on public.esh_verification_events, public.esh_due_date_changes to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Helpers
-- ---------------------------------------------------------------------------

-- A due date as the owner reads it: "15 Dec 2026", with the time when set.
create or replace function focus.esh_due_words(
  p_due timestamptz,
  p_date_only boolean,
  p_organization_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when p_due is null then 'no date'
           when p_date_only then
             to_char(p_due at time zone o.timezone, 'FMDD Mon YYYY')
           else to_char(p_due at time zone o.timezone, 'FMDD Mon YYYY, HH24:MI')
         end
    from public.organizations o
   where o.id = p_organization_id;
$$;

-- An event line in an action's conversation, by the staff member who acted.
create or replace function focus.esh_post_event(p_action_id uuid, p_actor uuid, p_text text)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.esh_action_messages
    (organization_id, action_id, author_kind, author_user_id, author_email, author_name, body,
     client_key, kind)
  select a.organization_id, a.id, 'staff', p_actor, u.email, u.full_name, left(p_text, 4000),
         'event:' || gen_random_uuid(), 'event'
    from public.esh_finding_actions a
    join public.user_profiles u on u.id = p_actor
   where a.id = p_action_id
  returning id;
$$;

/*
 * Tell an owner something (§17). Held while their access is off, like every
 * owner email; the links are minted at sending, never here.
 */
create or replace function focus.esh_tell_owner(
  p_action_id uuid,
  p_principal_id uuid,
  p_event text,
  p_intents jsonb,
  p_key text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a public.esh_finding_actions;
  v_state text;
begin
  select * into a from public.esh_finding_actions where id = p_action_id;
  -- A notice with links never goes ahead of a held assignment email (v198).
  v_state := case
               when not focus.esh_contact_usable(p_principal_id) then 'held_rollout'
               when p_intents <> '[]'::jsonb and p_event <> 'owner_assignment' and exists (
                 select 1 from public.esh_notification_outbox held
                  where held.action_id = p_action_id
                    and held.recipient_principal_id = p_principal_id
                    and held.event_type = 'owner_assignment'
                    and held.state = 'held_rollout') then 'held_rollout'
               else 'queued'
             end;
  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
     link_intents, idempotency_key, next_attempt_at)
  values
    (a.organization_id, p_event, p_principal_id, a.finding_id, a.id, v_state, p_intents, p_key,
     case when v_state = 'queued' then now() end)
  on conflict (idempotency_key) do nothing;
  return v_state;
end;
$$;

/*
 * Whether this person could be verifying their own correction (§5, FM25):
 * the owner's address is their account's, or the contact is linked to them.
 */
create or replace function focus.esh_is_own_work(p_user_id uuid, p_principal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.esh_email_principals p
      join public.user_profiles u on u.id = p_user_id
     where p.id = p_principal_id
       and (p.canonical_email = focus.esh_canonical_email(u.email) or p.staff_user_id = p_user_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. Verify (§13, FM22-FM27)
-- ---------------------------------------------------------------------------

/*
 * Decide a submission. Only the pending version that is the action's
 * current submission can be decided, so a withdrawn or superseded one never
 * is (FM22). A Verifier never decides their own correction (FM25).
 *
 * Accept records the method and note, accepts the action and — when every
 * action of the finding is now accepted — closes the finding in the same
 * transaction, with every action locked first so nothing slips in between
 * (§22, FM26). Asking for more needs an explanation and an explicit decision
 * about the due date: kept, or a new one (FM23); the owner reads the
 * explanation in the conversation and is emailed.
 */
create or replace function public.esh_verify_submission(
  p_submission_id uuid,
  p_decision text,
  p_method text,
  p_note text,
  p_keep_due boolean,
  p_due_date date,
  p_due_time time
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
  x public.esh_action_submissions;
  a public.esh_finding_actions;
  f public.esh_findings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_problems text[] := '{}';
  v_new_due timestamptz;
  v_closed boolean := false;
begin
  if not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into x from public.esh_action_submissions where id = p_submission_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into a from public.esh_finding_actions
   where id = x.action_id and organization_id = org
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into f from public.esh_findings where id = a.finding_id for update;
  if not (focus.esh_scope_all() or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if x.state <> 'pending' or a.current_submission_id is distinct from x.id
     or a.state <> 'awaiting_verification' then
    return jsonb_build_object('ok', false, 'code', 'stale_submission');
  end if;
  if focus.esh_is_own_work(actor, a.owner_principal_id) then
    return jsonb_build_object('ok', false, 'code', 'self_verification');
  end if;

  if p_decision = 'accepted' then
    if p_method is null or p_method not in ('document_review', 'site_verification', 'other') then
      v_problems := array_append(v_problems, 'method_required');
    end if;
    if p_method = 'other' and v_note is null then
      v_problems := array_append(v_problems, 'note_required');
    end if;
    if cardinality(v_problems) > 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'problems', to_jsonb(v_problems));
    end if;

    update public.esh_action_submissions set state = 'accepted', closed_at = now()
     where id = x.id;
    insert into public.esh_verification_events
      (organization_id, action_id, submission_id, decision, method, note, verifier_user_id)
    values (a.organization_id, a.id, x.id, 'accepted', p_method, v_note, actor);
    update public.esh_finding_actions set
      state = 'accepted', accepted_at = now(), updated_at = now(), row_version = row_version + 1
     where id = a.id;

    -- Close only when nothing else is open, with every action locked (§22).
    perform 1 from public.esh_finding_actions where finding_id = f.id for update;
    if not exists (select 1 from public.esh_finding_actions
                    where finding_id = f.id and state not in ('accepted', 'cancelled')) then
      update public.esh_findings set
        status = 'closed', closed_at = now(), closed_by = actor, closure_note = v_note,
        updated_at = now(), row_version = row_version + 1
       where id = f.id;
      v_closed := true;
    end if;

    perform focus.esh_post_event(a.id, actor,
      'ESH accepted version ' || x.version || '.'
      || case when v_closed then ' The finding is closed.' else '' end);
    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
    values
      (a.organization_id, 'staff', actor, 'submission_accepted', f.id, a.id,
       jsonb_build_object('submission_id', x.id, 'version', x.version, 'method', p_method,
                          'note', v_note));
    if v_closed then
      insert into public.esh_audit_events
        (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
      values
        (a.organization_id, 'staff', actor, 'finding_closed', f.id,
         jsonb_build_object('reference', f.reference));
      perform focus.esh_tell_owner(a.id, a.owner_principal_id, 'finding_closed', '[]'::jsonb,
                                   'finding_closed:' || x.id);
    end if;
    -- Nothing still waiting to go to the owner about open work applies now.
    update public.esh_notification_outbox set
      state = 'suppressed', state_reason = 'action_accepted', updated_at = now()
     where action_id = a.id
       and event_type in ('esh_reply', 'due_changed', 'changes_requested')
       and state in ('queued', 'held_rollout', 'failed');
    return jsonb_build_object('ok', true, 'decision', 'accepted', 'closed', v_closed);
  end if;

  if p_decision <> 'changes_requested' then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'problems', '["decision_required"]'::jsonb);
  end if;
  if v_note is null then
    v_problems := array_append(v_problems, 'note_required');
  end if;
  if p_keep_due is null then
    v_problems := array_append(v_problems, 'due_decision_required');
  elsif not p_keep_due and p_due_date is null then
    v_problems := array_append(v_problems, 'due_required');
  end if;
  if cardinality(v_problems) > 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'problems', to_jsonb(v_problems));
  end if;

  update public.esh_action_submissions set
    state = 'changes_requested', closed_at = now(), closed_reason = v_note
   where id = x.id;
  insert into public.esh_verification_events
    (organization_id, action_id, submission_id, decision, method, note, due_decision,
     verifier_user_id)
  values
    (a.organization_id, a.id, x.id, 'changes_requested', p_method, v_note,
     case when p_keep_due then 'kept' else 'revised' end, actor);
  update public.esh_finding_actions set
    state = 'in_progress', current_submission_id = null, updated_at = now(),
    row_version = row_version + 1
   where id = a.id;

  -- The explanation is a message the owner reads (§13); the deadline decision
  -- is said out loud either way, so it is never quietly restarted.
  insert into public.esh_action_messages
    (organization_id, action_id, author_kind, author_user_id, author_email, author_name, body,
     client_key)
  select a.organization_id, a.id, 'staff', actor, u.email, u.full_name, left(v_note, 4000),
         'changes:' || x.id
    from public.user_profiles u where u.id = actor;
  if p_keep_due then
    perform focus.esh_post_event(a.id, actor,
      'ESH asked for more on version ' || x.version || '. The due date stays '
      || focus.esh_due_words(a.due_at, a.due_is_date_only, a.organization_id) || '.');
  else
    v_new_due := focus.esh_due_instant(a.organization_id, p_due_date, p_due_time);
    insert into public.esh_due_date_changes
      (organization_id, action_id, old_due_at, new_due_at, old_date_only, new_date_only,
       baseline_due_at, reason, cause, changed_by)
    values
      (a.organization_id, a.id, a.due_at, v_new_due, a.due_is_date_only, p_due_time is null,
       a.baseline_due_at, 'More needed on version ' || x.version, 'changes_requested', actor);
    update public.esh_finding_actions set due_at = v_new_due, due_is_date_only = p_due_time is null
     where id = a.id;
    perform focus.esh_post_event(a.id, actor,
      'ESH asked for more on version ' || x.version || '. New due date: '
      || focus.esh_due_words(v_new_due, p_due_time is null, a.organization_id) || '.');
  end if;
  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'staff', actor, 'changes_requested', f.id, a.id,
     jsonb_build_object('submission_id', x.id, 'version', x.version, 'note', v_note,
                        'due', case when p_keep_due then 'kept' else 'revised' end,
                        'new_due_at', v_new_due));
  perform focus.esh_tell_owner(a.id, a.owner_principal_id, 'changes_requested',
                               '["owner_action"]'::jsonb, 'changes_requested:' || x.id);
  return jsonb_build_object('ok', true, 'decision', 'changes_requested');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Reopen (§13, FM52)
-- ---------------------------------------------------------------------------

/*
 * Reopen a closed finding, with a reason. The original closure, accepted
 * submission and verification stay in history; the accepted actions go back
 * to their owner, who is emailed fresh links (old ones are never revived).
 */
create or replace function public.esh_reopen_finding(
  p_finding_id uuid,
  p_reason text,
  p_due_date date,
  p_due_time time
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
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_due timestamptz;
begin
  if not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into f from public.esh_findings where id = p_finding_id and organization_id = org for update;
  if not found or not (focus.esh_scope_all()
                       or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if f.status <> 'closed' then
    return jsonb_build_object('ok', false, 'code', 'not_closed');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'problems', '["reason_required"]'::jsonb);
  end if;
  if p_due_date is not null then
    v_due := focus.esh_due_instant(f.organization_id, p_due_date, p_due_time);
  end if;

  update public.esh_findings set
    status = 'open', closed_at = null, closed_by = null, closure_note = null,
    reopened_at = now(), reopened_by = actor, reopen_reason = v_reason,
    updated_at = now(), row_version = row_version + 1
   where id = f.id;

  for a in select * from public.esh_finding_actions
            where finding_id = f.id and state = 'accepted'
            for update loop
    update public.esh_finding_actions set
      state = 'in_progress', accepted_at = null, current_submission_id = null,
      due_at = coalesce(v_due, due_at),
      due_is_date_only = case when v_due is null then due_is_date_only else p_due_time is null end,
      updated_at = now(), row_version = row_version + 1
     where id = a.id;
    if v_due is not null then
      insert into public.esh_due_date_changes
        (organization_id, action_id, old_due_at, new_due_at, old_date_only, new_date_only,
         baseline_due_at, reason, cause, changed_by)
      values
        (a.organization_id, a.id, a.due_at, v_due, a.due_is_date_only, p_due_time is null,
         a.baseline_due_at, v_reason, 'reopened', actor);
    end if;
    perform focus.esh_post_event(a.id, actor,
      'ESH reopened the finding: ' || v_reason
      || case when v_due is not null
              then ' New due date: ' || focus.esh_due_words(v_due, p_due_time is null, a.organization_id) || '.'
              else '' end);
    perform focus.esh_tell_owner(a.id, a.owner_principal_id, 'finding_reopened',
                                 '["owner_action", "owner_inbox"]'::jsonb,
                                 'finding_reopened:' || a.id || ':' || gen_random_uuid());
  end loop;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values
    (f.organization_id, 'staff', actor, 'finding_reopened', f.id,
     jsonb_build_object('reason', v_reason, 'previous_closed_at', f.closed_at,
                        'previous_closed_by', f.closed_by, 'new_due_at', v_due));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Change the due date (§14, FM28, FM29)
-- ---------------------------------------------------------------------------

/*
 * The official due date moves only here, by ESH, with a reason — never
 * because an owner asked in the chat (FM28). The baseline stays; the change is
 * recorded, shown to the owner as an event and emailed to them.
 */
create or replace function public.esh_change_due(
  p_action_id uuid,
  p_due_date date,
  p_due_time time,
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
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_due timestamptz;
  v_problems text[] := '{}';
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into a from public.esh_finding_actions where id = p_action_id and organization_id = org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into f from public.esh_findings where id = a.finding_id;
  if not (focus.esh_scope_all() or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if f.status <> 'open' or a.state not in ('assigned', 'in_progress', 'awaiting_verification') then
    return jsonb_build_object('ok', false, 'code', 'action_closed');
  end if;
  if p_due_date is null then
    v_problems := array_append(v_problems, 'due_required');
  end if;
  if v_reason is null then
    v_problems := array_append(v_problems, 'reason_required');
  end if;
  if cardinality(v_problems) > 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'problems', to_jsonb(v_problems));
  end if;
  v_due := focus.esh_due_instant(a.organization_id, p_due_date, p_due_time);
  if v_due = a.due_at and (p_due_time is null) = a.due_is_date_only then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  insert into public.esh_due_date_changes
    (organization_id, action_id, old_due_at, new_due_at, old_date_only, new_date_only,
     baseline_due_at, reason, cause, changed_by)
  values
    (a.organization_id, a.id, a.due_at, v_due, a.due_is_date_only, p_due_time is null,
     a.baseline_due_at, v_reason, 'changed', actor);
  update public.esh_finding_actions set
    due_at = v_due, due_is_date_only = p_due_time is null, updated_at = now(),
    row_version = row_version + 1
   where id = a.id;
  perform focus.esh_post_event(a.id, actor,
    'Due date changed from ' || focus.esh_due_words(a.due_at, a.due_is_date_only, a.organization_id)
    || ' to ' || focus.esh_due_words(v_due, p_due_time is null, a.organization_id) || ': ' || v_reason);
  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'staff', actor, 'due_changed', a.finding_id, a.id,
     jsonb_build_object('old_due_at', a.due_at, 'new_due_at', v_due, 'reason', v_reason,
                        'baseline_due_at', a.baseline_due_at));
  -- One pending notice at a time: a second change before it goes is the same news.
  if not exists (select 1 from public.esh_notification_outbox o
                  where o.action_id = a.id and o.event_type = 'due_changed'
                    and o.state in ('queued', 'held_rollout')) then
    perform focus.esh_tell_owner(a.id, a.owner_principal_id, 'due_changed',
                                 '["owner_action"]'::jsonb, 'due_changed:' || gen_random_uuid());
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Reassign (§14, FM13, FM14)
-- ---------------------------------------------------------------------------

/*
 * Give an action to another address, in one transaction: the old ownership
 * ends, a new one starts at the next version, the old owner's unspent links
 * for it are revoked and anything waiting to go to them about it is dropped;
 * their sessions stop reaching it because the version moved. The new owner
 * gets the assignment email (held while their access is off), the old one a
 * short note, and history keeps who said what (§14).
 *
 * Not while a submission waits: ESH decides it first, so nobody's work is
 * judged under somebody else's name.
 */
create or replace function public.esh_reassign_action(
  p_action_id uuid,
  p_owner_email text,
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
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new uuid;
  v_new_contact public.esh_email_principals;
  v_old_contact public.esh_email_principals;
  v_version integer;
  v_problems text[] := '{}';
  v_state text;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into a from public.esh_finding_actions where id = p_action_id and organization_id = org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into f from public.esh_findings where id = a.finding_id;
  if not (focus.esh_scope_all() or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if a.state = 'awaiting_verification' then
    return jsonb_build_object('ok', false, 'code', 'decide_submission_first');
  end if;
  if f.status <> 'open' or a.state not in ('assigned', 'in_progress') then
    return jsonb_build_object('ok', false, 'code', 'action_closed');
  end if;
  if p_owner_email is null or not focus.esh_email_is_valid(p_owner_email) then
    v_problems := array_append(v_problems, 'owner_email_invalid');
  end if;
  if v_reason is null then
    v_problems := array_append(v_problems, 'reason_required');
  end if;
  if cardinality(v_problems) > 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'problems', to_jsonb(v_problems));
  end if;

  v_new := focus.esh_principal_for(a.organization_id, p_owner_email, actor);
  if v_new = a.owner_principal_id then
    return jsonb_build_object('ok', false, 'code', 'same_owner');
  end if;
  select * into v_old_contact from public.esh_email_principals where id = a.owner_principal_id;
  select * into v_new_contact from public.esh_email_principals where id = v_new;
  v_version := a.assignment_version + 1;

  update public.esh_action_assignments set ended_at = now()
   where action_id = a.id and ended_at is null;
  insert into public.esh_action_assignments
    (organization_id, action_id, principal_id, version, assigned_by, reason)
  values (a.organization_id, a.id, v_new, v_version, actor, v_reason);
  update public.esh_finding_actions set
    owner_principal_id = v_new, assignment_version = v_version, state = 'assigned',
    updated_at = now(), row_version = row_version + 1
   where id = a.id;

  update public.esh_access_grants set revoked_at = now(), revoked_reason = 'reassigned'
   where action_id = a.id and consumed_at is null and revoked_at is null;
  update public.esh_notification_outbox set
    state = 'suppressed', state_reason = 'reassigned', next_attempt_at = null, updated_at = now()
   where action_id = a.id
     and recipient_principal_id = a.owner_principal_id
     and state in ('queued', 'held_rollout', 'failed');

  v_state := focus.esh_tell_owner(a.id, v_new, 'owner_assignment',
                                  '["owner_action", "owner_inbox"]'::jsonb,
                                  'owner_assignment:' || a.id || ':' || v_version);
  if focus.esh_contact_usable(a.owner_principal_id) then
    perform focus.esh_tell_owner(a.id, a.owner_principal_id, 'reassigned_away', '[]'::jsonb,
                                 'reassigned_away:' || a.id || ':' || v_version);
  end if;
  perform focus.esh_post_event(a.id, actor,
    'Reassigned from ' || v_old_contact.display_email || ' to ' || v_new_contact.display_email
    || ': ' || v_reason);
  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id,
     subject_principal_id, detail)
  values
    (a.organization_id, 'staff', actor, 'action_reassigned', a.finding_id, a.id, v_new,
     jsonb_build_object('from', v_old_contact.display_email, 'to', v_new_contact.display_email,
                        'reason', v_reason, 'version', v_version, 'notification', v_state));
  return jsonb_build_object('ok', true, 'notification', v_state);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_due_words(timestamptz, boolean, uuid) from public, anon, authenticated;
revoke all on function focus.esh_post_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function focus.esh_tell_owner(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function focus.esh_is_own_work(uuid, uuid) from public, anon, authenticated;
revoke all on function public.esh_verify_submission(uuid, text, text, text, boolean, date, time)
  from public, anon;
revoke all on function public.esh_reopen_finding(uuid, text, date, time) from public, anon;
revoke all on function public.esh_change_due(uuid, date, time, text) from public, anon;
revoke all on function public.esh_reassign_action(uuid, text, text) from public, anon;

grant execute on function public.esh_verify_submission(uuid, text, text, text, boolean, date, time)
  to authenticated;
grant execute on function public.esh_reopen_finding(uuid, text, date, time) to authenticated;
grant execute on function public.esh_change_due(uuid, date, time, text) to authenticated;
grant execute on function public.esh_reassign_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Dispatch knows the informational owner emails (replaces v199's claim)
-- ---------------------------------------------------------------------------

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
  if o.event_type in ('esh_reply', 'changes_requested', 'due_changed', 'finding_reopened') and exists (
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
    -- v200: a closure or a reassignment note is news about work that is no
    -- longer theirs by design; it carries no link, so nothing is re-checked
    -- beyond the contact's own access.
    if o.event_type not in ('finding_closed', 'reassigned_away')
       and not focus.esh_owner_holds(o.action_id, o.recipient_principal_id, null) then
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

revoke all on function public.esh_dispatch_claim(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.esh_dispatch_claim(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 13. The owner's receipt of accepted work (§20)
-- ---------------------------------------------------------------------------

/*
 * Whether a session may still read an action ESH accepted: for 30 days, by
 * the owner it was accepted from, through the same scope that reached it.
 * Read only — nothing that writes asks this.
 */
create or replace function focus.esh_guest_receipt(
  p_session_id uuid,
  p_principal_id uuid,
  p_inbox boolean,
  p_action_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.esh_finding_actions a
     where a.id = p_action_id
       and a.owner_principal_id = p_principal_id
       and a.state = 'accepted'
       and a.accepted_at > now() - interval '30 days'
       and (p_inbox or exists (
         select 1 from public.esh_guest_session_actions x
          where x.session_id = p_session_id
            and x.action_id = a.id
            and x.assignment_version = a.assignment_version)));
$$;

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
  v_read_only boolean := false;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_available', 'inbox_scope', s.inbox_scope);
  end if;
  -- v200: an action ESH accepted stays readable to its owner for 30 days, as
  -- a receipt, and nothing more (§20).
  if not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    if not focus.esh_guest_receipt(s.id, s.principal_id, s.inbox_scope, p_action_id) then
      return jsonb_build_object('ok', false, 'code', 'not_available', 'inbox_scope', s.inbox_scope);
    end if;
    v_read_only := true;
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
    'read_only', v_read_only,
    'finding_status', f.status,
    'action', jsonb_build_object(
      'accepted_at', a.accepted_at,
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
    v_allowed := (focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, e.action_id)
                  or focus.esh_guest_receipt(s.id, s.principal_id, s.inbox_scope, e.action_id))
                 and (e.message_id is not null or e.uploader_principal_id = s.principal_id);
  else
    v_allowed := exists (
      select 1 from public.esh_finding_actions a
       where a.finding_id = e.finding_id
         and (focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, a.id)
              or focus.esh_guest_receipt(s.id, s.principal_id, s.inbox_scope, a.id)));
  end if;
  if not v_allowed then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  return jsonb_build_object('ok', true, 'object_key', e.object_key, 'name', e.original_name,
                            'type', e.content_type);
end;
$$;

revoke all on function focus.esh_guest_receipt(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.esh_guest_action(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.esh_guest_file(text, uuid) from public, anon, authenticated;
grant execute on function public.esh_guest_action(text, uuid, timestamptz) to service_role;
grant execute on function public.esh_guest_file(text, uuid) to service_role;

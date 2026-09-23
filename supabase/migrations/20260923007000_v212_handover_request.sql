-- ============================================================================
-- v212 ESH Finding Management: "this is not mine", said in the conversation.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md
-- §11, §14.
--
-- An Action Owner who is not the right person had two options: say so in prose
-- and hope, or let the work run late. They can now name who should hold it.
-- The name rides with their message exactly as a requested date does: it is a
-- request, it grants that person nothing, and only esh_reassign_action moves
-- the work, with its reason, its new assignment interval and its audit.
-- ============================================================================

alter table public.esh_action_messages
  add column proposed_owner_email text
    check (proposed_owner_email is null or length(proposed_owner_email) between 3 and 254);

comment on column public.esh_action_messages.proposed_owner_email is
  'v212: an owner naming who should hold this instead. A request, never a handover.';

-- `create or replace` with an extra parameter defines a SECOND function rather
-- than replacing the first, and every existing five- and six-argument call then
-- becomes ambiguous (42725) -- which PostgREST returns as a null body, so the
-- caller sees "nothing happened" rather than an error. The old signature goes.
drop function if exists public.esh_guest_send_message(text, uuid, text, text, uuid[], date, uuid);

CREATE OR REPLACE FUNCTION public.esh_guest_send_message(p_session text, p_action_id uuid, p_body text, p_client_key text, p_asset_ids uuid[] DEFAULT '{}'::uuid[], p_proposed_due_date date DEFAULT NULL::date, p_bulk_operation_id uuid DEFAULT NULL::uuid, p_proposed_owner_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     body, client_key, proposed_due_date, bulk_operation_id, proposed_owner_email)
  values
    (a.organization_id, a.id, v_author, s.principal_id, v_principal.display_email,
     v_principal.display_name, v_body, p_client_key, p_proposed_due_date, p_bulk_operation_id,
     case when focus.esh_email_is_valid(p_proposed_owner_email)
          then focus.esh_canonical_email(p_proposed_owner_email) end)
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
$function$;

CREATE OR REPLACE FUNCTION public.esh_guest_action(p_session text, p_action_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_mode text := 'owner';
  v_level smallint;
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
    if focus.esh_escalation_covers(s.id, s.principal_id, p_action_id) then
      -- v201: an escalation recipient reads the context and the conversation,
      -- and may write in it; they never submit or close (§15).
      v_mode := 'escalation';
      select e.level into v_level
        from public.esh_escalation_entitlements e
        join public.esh_finding_actions x on x.id = e.action_id
       where e.action_id = p_action_id
         and e.principal_id = s.principal_id
         and e.revoked_at is null
         and e.assignment_version = x.assignment_version
       order by e.level desc
       limit 1;
    elsif focus.esh_guest_receipt(s.id, s.principal_id, s.inbox_scope, p_action_id) then
      v_read_only := true;
    else
      return jsonb_build_object('ok', false, 'code', 'not_available', 'inbox_scope', s.inbox_scope);
    end if;
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
           m.sent_at, m.proposed_due_date, m.proposed_owner_email
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
           'author_name', case when r.author_kind in ('staff', 'escalation')
                               then r.author_name else null end,
           'author_email', case when r.author_kind in ('owner', 'escalation')
                                then r.author_email else null end,
           'author_principal_id', r.author_principal_id,
           'body', r.body,
           'sent_at', r.sent_at,
           -- The owner may submit an update they sent under this assignment.
           'submittable', r.author_kind = 'owner'
                          and r.author_principal_id = s.principal_id
                          and r.sent_at >= coalesce(v_assignment_start, a.assigned_at),
           -- v211: a date the owner asked for. It is part of what they said,
           -- not a change to anything; only ESH moves a deadline.
           'proposed_due_date', r.proposed_due_date,
           -- v212: and who they say should really hold it. Naming somebody
           -- is a request; only ESH hands work over.
           'proposed_owner_email', r.proposed_owner_email)
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
    'mode', v_mode,
    'escalation_level', v_level,
    'owner_email', (select p.display_email from public.esh_email_principals p
                     where p.id = a.owner_principal_id),
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
$function$;

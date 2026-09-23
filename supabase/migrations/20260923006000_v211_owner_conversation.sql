-- ============================================================================
-- v211 ESH Finding Management: the Action Owner's screen is a conversation.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md
-- §11, §14.
--
-- An owner can already ask for more time in a bulk operation, and the column
-- that carries the date they asked for has been on the message since v206 --
-- but nothing has ever read it back, so the request reached ESH as prose and
-- the date itself was written and forgotten. This returns it with the message,
-- on both sides, so ESH can see the ask and act on it. Nothing here moves a
-- deadline: only esh_change_due does that, with its reason and its audit.
-- ============================================================================

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
           m.sent_at, m.proposed_due_date
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
           'proposed_due_date', r.proposed_due_date)
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

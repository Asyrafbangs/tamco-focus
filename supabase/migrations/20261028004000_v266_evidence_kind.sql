-- ============================================================================
-- v266 — what kind of proof, not just a sentence asking for some
--
-- "A short result and at least one file" is a submission rule. It is not an
-- acceptance criterion, and the difference decides whether the record means
-- anything a year later.
--
-- A photograph can show that a walkway was cleared. It cannot show that an
-- interlock functions, that an extraction system moves enough air, or that a
-- revised procedure reached the people who follow it. ESH could always say so
-- in `evidence_instruction`, in prose, which nothing can count and nobody can
-- be held to.
--
-- So the kind is a field: the owner is told what will be accepted before they
-- go and take the wrong photograph, and ESH can see how much of the register
-- is being closed on photographs alone.
--
-- Left null where nobody said, rather than defaulted to 'photograph'. A
-- default would quietly answer a question ESH never asked.
-- ============================================================================

alter table public.esh_finding_actions
  add column evidence_kind text
    check (evidence_kind is null or evidence_kind in
      ('photograph', 'inspection', 'functional_test', 'measurement', 'procedure', 'other'));

comment on column public.esh_finding_actions.evidence_kind is
  'What ESH will accept as proof (v266). Null means nobody specified, which is '
  'not the same as a photograph being enough.';

-- ---------------------------------------------------------------------------
-- Assignment carries it
--
-- Copied forward from v224, the latest definition of this procedure.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.esh_save_finding(p_finding_id uuid, p_payload jsonb, p_assign boolean DEFAULT false, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- v266 - the kind of proof, not only a sentence describing it.
  v_kind text := nullif(btrim(coalesce(p_payload->>'evidence_kind', '')), '');
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
       evidence_kind,
       priority, due_at, due_is_date_only, reviewer_user_id, no_further_escalation_reason,
       draft_owner_email, draft_escalation, created_by, followup_active_from)
    values
      (org, v_finding_id, 1, coalesce(v_action_title, v_title), v_outcome, v_instruction,
       v_kind,
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
      evidence_kind = v_kind,
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
                    when focus.esh_contact_usable(owner_principal) then 'queued'
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
$function$;


-- ---------------------------------------------------------------------------
-- And the owner is told before they go and photograph the wrong thing
--
-- Copied forward from v263, where this procedure was last defined in this
-- change set. The whole body, not a patch: a partial rewrite here would drop
-- the interim control that v263 added two files ago.
-- ---------------------------------------------------------------------------

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
      -- v266 - told before they go and take the wrong photograph.
      'evidence_kind', a.evidence_kind,
      'due_at', a.due_at,
      'due_is_date_only', a.due_is_date_only,
      'assigned_at', a.assigned_at),
    'finding', jsonb_build_object(
      'reference', f.reference,
      'title', f.title,
      'description', f.description,
      'location', f.location,
      'department', v_department,
      'reported_on', f.reported_on,
      -- v263 - what is protecting them while they work on the permanent fix.
      'interim_control', f.interim_control,
      'interim_owner', f.interim_owner,
      'interim_verified_at', f.interim_verified_at),
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

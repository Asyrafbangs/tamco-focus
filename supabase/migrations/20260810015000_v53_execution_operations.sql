-- TAMCO Focus v53 — closed-loop Task execution, shared requests and proposals.

insert into public.org_settings (key, value, description, manager_editable)
values (
  'goals.governance_mode',
  '"department_only"'::jsonb,
  'Goal agreement authority: department_only now; organization_hierarchy when enabled later.',
  false
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Generic request visibility.
-- ---------------------------------------------------------------------------

create or replace function focus.can_view_request(target_barrier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
    from public.barriers request
    where request.id = target_barrier_id
      and (
        request.raised_by = auth.uid()
        or request.action_required_from = auth.uid()
        or (request.task_id is not null and focus.can_view_task(request.task_id))
        or (request.goal_id is not null and focus.can_view_goal(request.goal_id))
      )
  );
$$;

create or replace function focus.can_manage_request(target_barrier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
    from public.barriers request
    where request.id = target_barrier_id
      and (
        (request.task_id is not null and focus.can_edit_task(request.task_id))
        or (request.goal_id is not null and focus.can_update_goal(request.goal_id))
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Terminal Task cleanup.
--
-- History is retained. Only its actionable projection is closed. Running this
-- from a status trigger makes Complete, Cancel and every future terminal route
-- obey the same rule without duplicating cleanup inside each procedure.
-- ---------------------------------------------------------------------------

create or replace function focus.deactivate_task_projections(target_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_count integer;
  notification_count integer;
  queue_count integer;
begin
  update public.barriers
  set source_active = false,
      source_inactive_at = coalesce(source_inactive_at, now()),
      action_pending = false,
      version = version + 1
  where task_id = target_task_id and source_active;
  get diagnostics request_count = row_count;

  update public.notifications notice
  set requires_action = false
  where notice.requires_action
    and (
      notice.task_id = target_task_id
      or notice.barrier_id in (
        select request.id from public.barriers request where request.task_id = target_task_id
      )
      or (
        notice.entity_type = 'checklist_item'
        and notice.entity_id in (
          select item.id from public.task_checklist_items item where item.task_id = target_task_id
        )
      )
    );
  get diagnostics notification_count = row_count;

  update public.meeting_queue_items item
  set source_active = false,
      source_inactive_at = coalesce(source_inactive_at, now()),
      status = case
        when item.status in ('open', 'queued') then 'removed'::public.meeting_item_status
        else item.status
      end
  where item.source_active
    and (
      item.task_id = target_task_id
      or item.barrier_id in (
        select request.id from public.barriers request where request.task_id = target_task_id
      )
    );
  get diagnostics queue_count = row_count;

  return jsonb_build_object(
    'requests_deactivated', request_count,
    'notifications_deactivated', notification_count,
    'queue_items_deactivated', queue_count
  );
end;
$$;

create or replace function focus.close_task_projections_on_terminal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status not in ('completed', 'cancelled')
     and new.status in ('completed', 'cancelled') then
    perform focus.deactivate_task_projections(new.id);
  end if;
  return new;
end;
$$;

create trigger tasks_close_projections_on_terminal
  after update of status on public.tasks
  for each row execute function focus.close_task_projections_on_terminal();

-- Cancellation authority is explicit: the owner or their manager for ordinary
-- work; an authorised manager for Mandatory/controlled work.
create or replace function public.cancel_task(
  p_task_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  task public.tasks;
  event_id uuid;
  replayed jsonb;
  result jsonb;
  cleanup jsonb;
  manager_authority boolean;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to cancel work.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  manager_authority := focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id));
  if (task.is_mandatory and not manager_authority)
     or (not task.is_mandatory and actor <> task.primary_owner_id and not manager_authority) then
    return focus.error(
      'not_authorised',
      case when task.is_mandatory
        then 'Mandatory work can be cancelled only by an authorised manager.'
        else 'Only the owner or an authorised manager can cancel this work.' end
    );
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed and cancelled work cannot be cancelled again.');
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return focus.error('reason_required', 'Record why this work is being cancelled.');
  end if;
  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This task changed while you were cancelling it. Review the latest information.',
      jsonb_build_object('current_version', task.version)
    );
  end if;

  update public.tasks
  set status = 'cancelled',
      cancelled_at = now(),
      over_focus_target = false,
      last_meaningful_update_at = now(),
      version = version + 1
  where id = p_task_id;

  -- The trigger has already performed the cleanup in this transaction. This
  -- second call is idempotent and returns zeroes only if there is nothing left.
  cleanup := focus.deactivate_task_projections(p_task_id);
  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  event_id := focus.write_audit(
    p_event_type := 'task_cancelled',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := 'cancelled',
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('reason', btrim(p_reason), 'projection_cleanup', cleanup)
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'cancelled',
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id,
    'projection_cleanup', cleanup
  );
  return focus.remember_operation(actor, p_idempotency_key, 'cancel_task', result);
end;
$$;

-- Reassignment never changes lifecycle state. Shared is derived and therefore
-- recalculates in the same commit from the changed parent owner.
create or replace function public.reassign_task(
  p_task_id uuid,
  p_expected_version integer,
  p_new_owner_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  task public.tasks;
  previous_owner uuid;
  new_count integer := 0;
  target integer := 0;
  workload_review_needed boolean := false;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to reassign work.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;
  if not (focus.is_admin()
          or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))) then
    return focus.error('not_authorised', 'Only an authorised manager can reassign this work.');
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Terminal work cannot be reassigned.');
  end if;
  if not exists (
    select 1 from public.user_profiles where id = p_new_owner_id and status = 'active'
  ) then
    return focus.error('invalid_owner', 'The new owner must be an active account.');
  end if;
  if p_new_owner_id = task.primary_owner_id then
    return jsonb_build_object(
      'ok', true, 'code', 'unchanged', 'task', focus.task_snapshot(p_task_id),
      'workload_review_needed', false
    );
  end if;
  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This task changed while you were reassigning it. Review the latest information.',
      jsonb_build_object('current_version', task.version)
    );
  end if;

  previous_owner := task.primary_owner_id;
  update public.tasks
  set primary_owner_id = p_new_owner_id,
      last_meaningful_update_at = now(),
      version = version + 1
  where id = p_task_id;

  perform focus.refresh_over_target(previous_owner, task.focus_bucket);
  perform focus.refresh_over_target(p_new_owner_id, task.focus_bucket);

  if task.status = 'active' and task.focus_bucket is not null then
    new_count := focus.active_focus_count(p_new_owner_id, task.focus_bucket);
    target := coalesce(focus.effective_focus_target(p_new_owner_id, task.focus_bucket), 0);
    workload_review_needed := new_count > target;
  end if;

  -- A contribution assigned to the new parent owner is no longer Shared and
  -- must not leave a red notification claiming they owe a contribution.
  update public.notifications
  set requires_action = false
  where requires_action
    and entity_type = 'checklist_item'
    and entity_id in (
      select item.id
      from public.task_checklist_items item
      where item.task_id = p_task_id and item.assigned_to = p_new_owner_id
    );

  event_id := focus.write_audit(
    p_event_type := 'task_reassigned',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_subject_user_id := p_new_owner_id,
    p_bucket := task.focus_bucket,
    p_count_after := new_count,
    p_target := target,
    p_over_target := workload_review_needed,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'previous_owner_id', previous_owner,
      'status_retained', task.status,
      'shared_recalculated', true,
      'workload_review_needed', workload_review_needed
    )
  );

  perform focus.notify(
    p_new_owner_id, 'reassignment', 'immediate', true,
    'Work assigned to you', format('"%s" is now your responsibility.', task.title),
    p_task_id, null, actor
  );
  perform focus.notify(
    previous_owner, 'ownership_changed', 'immediate', false,
    'Work reassigned',
    format('"%s" was reassigned to %s.', task.title,
      (select full_name from public.user_profiles where id = p_new_owner_id)),
    p_task_id, null, actor
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'reassigned',
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id,
    'status_retained', task.status,
    'active_count', new_count,
    'recommended_target', target,
    'workload_review_needed', workload_review_needed
  );
  return focus.remember_operation(actor, p_idempotency_key, 'reassign_task', result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Major Project proposals.
-- ---------------------------------------------------------------------------

create or replace function focus.link_work_proposal_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'manager_decision_required'
     and new.entity_id is null
     and new.actor_id is not null then
    select proposal.id into new.entity_id
    from public.work_proposals proposal
    where proposal.proposed_by = new.actor_id
      and proposal.status = 'pending'
    order by proposal.created_at desc
    limit 1;
    if new.entity_id is not null then new.entity_type := 'work_proposal'; end if;
  end if;
  return new;
end;
$$;

create trigger notifications_link_work_proposal
  before insert on public.notifications
  for each row execute function focus.link_work_proposal_notification();

-- Best-effort deep links for existing local rows created before the trigger.
update public.notifications notice
set entity_type = 'work_proposal',
    entity_id = (
      select candidate.id
      from public.work_proposals candidate
      where candidate.proposed_by = notice.actor_id and candidate.status = 'pending'
      order by candidate.created_at desc
      limit 1
    )
where notice.kind = 'manager_decision_required'
  and notice.entity_id is null
  and exists (
    select 1 from public.work_proposals candidate
    where candidate.proposed_by = notice.actor_id and candidate.status = 'pending'
  );

create or replace function public.get_work_proposal_capabilities(p_proposal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null or not exists (
    select 1 from public.work_proposals proposal
    where proposal.id = p_proposal_id
      and (
        proposal.proposed_by = auth.uid()
        or focus.is_admin()
        or (focus.is_manager_or_admin() and focus.is_manager_of(proposal.proposed_by))
      )
  ) then jsonb_build_object('can_view', false, 'can_decide', false, 'can_resubmit', false)
  else (
    select jsonb_build_object(
      'can_view', true,
      'can_decide', proposal.status = 'pending' and (
        focus.is_admin()
        or (focus.is_manager_or_admin() and focus.is_manager_of(proposal.proposed_by))
      ),
      'can_resubmit', proposal.status = 'changes_requested' and proposal.proposed_by = auth.uid()
    )
    from public.work_proposals proposal where proposal.id = p_proposal_id
  ) end;
$$;

create or replace function public.decide_major_project_proposal(
  p_proposal_id uuid,
  p_expected_version integer,
  p_decision text,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  proposal public.work_proposals;
  new_task_id uuid;
  replayed jsonb;
  result jsonb;
  audit_type public.audit_event_type;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to decide this proposal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into proposal from public.work_proposals where id = p_proposal_id for update;
  if not found then return focus.error('not_found', 'This proposal no longer exists.'); end if;
  if proposal.kind <> 'major_project' then
    return focus.error('invalid_state', 'This decision route is only for Major Project proposals.');
  end if;
  if not (focus.is_admin()
          or (focus.is_manager_or_admin() and focus.is_manager_of(proposal.proposed_by))) then
    return focus.error('not_authorised', 'Only the proposer''s authorised manager can decide.');
  end if;
  if proposal.status <> 'pending' then
    return focus.error('invalid_state', 'This proposal is no longer awaiting a decision.');
  end if;
  if proposal.version <> p_expected_version then
    return focus.error('version_conflict', 'This proposal changed. Review it and try again.');
  end if;
  if p_decision not in ('agree', 'request_changes', 'decline') then
    return focus.error('validation_failed', 'Choose Agree, Request changes or Decline.');
  end if;
  if p_decision in ('request_changes', 'decline')
     and length(btrim(coalesce(p_note, ''))) = 0 then
    return focus.error('validation_failed', 'Record what needs to change or why it was declined.');
  end if;

  if p_decision = 'agree' then
    insert into public.tasks (
      title, description, next_action, status, work_class, focus_bucket, origin, urgency,
      primary_owner_id, created_by, due_at, due_is_date_only
    ) values (
      proposal.title, proposal.rationale, null, 'backlog', 'major_project', 'major',
      'self_initiated', 'normal', proposal.proposed_by, proposal.proposed_by,
      case when nullif(proposal.payload ->> 'due_at', '') is null then null
           else (proposal.payload ->> 'due_at')::timestamptz end,
      coalesce((proposal.payload ->> 'due_is_date_only')::boolean, true)
    ) returning id into new_task_id;

    update public.work_proposals
    set status = 'approved', decided_by = actor, decided_at = now(),
        decision_note = nullif(btrim(coalesce(p_note, '')), ''),
        created_task_id = new_task_id, version = version + 1
    where id = proposal.id;
    audit_type := 'work_proposal_agreed';

    perform focus.write_audit(
      p_event_type := 'task_created', p_actor_id := actor, p_task_id := new_task_id,
      p_subject_user_id := proposal.proposed_by, p_new_status := 'backlog', p_bucket := 'major',
      p_task_version := 1,
      p_detail := jsonb_build_object('proposal_id', proposal.id, 'activation_deferred', true)
    );
  elsif p_decision = 'request_changes' then
    update public.work_proposals
    set status = 'changes_requested', decided_by = actor, decided_at = now(),
        decision_note = btrim(p_note), version = version + 1
    where id = proposal.id;
    audit_type := 'work_proposal_changes_requested';
  else
    update public.work_proposals
    set status = 'declined', decided_by = actor, decided_at = now(),
        decision_note = btrim(p_note), version = version + 1
    where id = proposal.id;
    audit_type := 'work_proposal_declined';
  end if;

  update public.notifications
  set requires_action = false
  where requires_action and entity_type = 'work_proposal' and entity_id = proposal.id;

  perform focus.write_audit(
    p_event_type := audit_type,
    p_actor_id := actor,
    p_subject_user_id := proposal.proposed_by,
    p_detail := jsonb_build_object(
      'proposal_id', proposal.id,
      'decision', p_decision,
      'note', nullif(btrim(coalesce(p_note, '')), ''),
      'created_task_id', new_task_id
    )
  );

  perform focus.notify(
    proposal.proposed_by, 'manager_decision_required', 'immediate',
    p_decision = 'request_changes',
    case p_decision when 'agree' then 'Major Project agreed'
      when 'request_changes' then 'Major Project changes requested'
      else 'Major Project declined' end,
    case p_decision when 'agree' then proposal.title || ' is now Available for you to activate.'
      else coalesce(nullif(btrim(p_note), ''), proposal.title) end,
    new_task_id, null, actor
  );

  result := jsonb_build_object(
    'ok', true,
    'code', case p_decision when 'agree' then 'proposal_agreed'
      when 'request_changes' then 'proposal_changes_requested' else 'proposal_declined' end,
    'proposal_id', proposal.id,
    'task_id', new_task_id,
    'version', proposal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'decide_major_project_proposal', result);
end;
$$;

create or replace function public.resubmit_major_project_proposal(
  p_proposal_id uuid,
  p_expected_version integer,
  p_title text,
  p_rationale text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  proposal public.work_proposals;
  manager_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in to revise this proposal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into proposal from public.work_proposals where id = p_proposal_id for update;
  if not found then return focus.error('not_found', 'This proposal no longer exists.'); end if;
  if proposal.proposed_by <> actor or proposal.kind <> 'major_project' then
    return focus.error('not_authorised', 'Only the proposer can revise this Major Project.');
  end if;
  if proposal.status <> 'changes_requested' then
    return focus.error('invalid_state', 'This proposal is not awaiting revisions.');
  end if;
  if proposal.version <> p_expected_version then
    return focus.error('version_conflict', 'This proposal changed. Review it and try again.');
  end if;
  if length(btrim(coalesce(p_title, ''))) = 0
     or length(btrim(coalesce(p_rationale, ''))) = 0 then
    return focus.error('validation_failed', 'Add a title and the outcome this project will deliver.');
  end if;

  update public.work_proposals
  set title = btrim(p_title), rationale = btrim(p_rationale), status = 'pending',
      decided_by = null, decided_at = null, decision_note = null,
      last_submitted_at = now(), version = version + 1
  where id = proposal.id;

  select reporting_manager_id into manager_id from public.user_profiles where id = actor;
  perform focus.notify(
    manager_id, 'manager_decision_required', 'immediate', true,
    'Major Project ready for discussion', btrim(p_title), null, null, actor
  );

  result := jsonb_build_object(
    'ok', true, 'code', 'proposal_resubmitted',
    'proposal_id', proposal.id, 'version', proposal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'resubmit_major_project_proposal', result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Goal requests reuse the existing Barrier/request engine.
-- ---------------------------------------------------------------------------

create or replace function public.raise_goal_support_request(
  p_goal_id uuid,
  p_description text,
  p_support_needed text,
  p_action_required_from uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal public.goals;
  recipient uuid;
  request_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in to request Goal support.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This Goal no longer exists.'); end if;
  if goal.status <> 'active' or not focus.can_update_goal(goal.id) then
    return focus.error('not_authorised', 'You cannot request support for this Goal.');
  end if;
  if length(btrim(coalesce(p_description, ''))) = 0
     or length(btrim(coalesce(p_support_needed, ''))) = 0 then
    return focus.error('validation_failed', 'Describe the issue and the action needed.');
  end if;
  recipient := coalesce(
    p_action_required_from,
    goal.manager_id,
    (select reporting_manager_id from public.user_profiles where id = goal.owner_id)
  );
  if recipient is null or recipient = actor then
    return focus.error(
      'validation_failed',
      'Choose another person who can provide the requested support. No superior is invented.'
    );
  end if;
  if not exists (select 1 from public.user_profiles where id = recipient and status = 'active') then
    return focus.error('validation_failed', 'Choose an active person to respond.');
  end if;

  insert into public.barriers (
    task_id, goal_id, description, support_needed, impact, action_type,
    action_required_from, raised_by
  ) values (
    null, goal.id, btrim(p_description), btrim(p_support_needed),
    'management_decision_required', 'support', recipient, actor
  ) returning id into request_id;

  update public.goals
  set health = 'support_requested', last_meaningful_update_at = now(), version = version + 1
  where id = goal.id;

  perform focus.write_goal_audit(
    'goal_support_requested', actor, goal.id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'request_id', request_id,
      'action_required_from', recipient,
      'description', btrim(p_description),
      'support_needed', btrim(p_support_needed),
      'shared_request_engine', true
    )
  );

  result := jsonb_build_object(
    'ok', true, 'code', 'goal_support_requested',
    'request_id', request_id, 'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'raise_goal_support_request', result);
end;
$$;

create or replace function public.post_barrier_response(
  p_barrier_id uuid,
  p_message text,
  p_expected_version integer default null,
  p_kind public.barrier_response_kind default 'answer',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  request public.barriers;
  response_id uuid;
  replayed jsonb;
  result jsonb;
  headline text;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to respond.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into request from public.barriers where id = p_barrier_id for update;
  if not found then return focus.error('not_found', 'That request no longer exists.'); end if;
  if not request.source_active then
    return focus.error('invalid_state', 'The source record is no longer active. This request is historical.');
  end if;
  if request.status <> 'open' then
    return focus.error('invalid_state', 'This request has already been resolved.');
  end if;
  if p_expected_version is not null and request.version <> p_expected_version then
    return focus.error('version_conflict', 'This request changed while you were writing.');
  end if;
  if request.action_required_from is distinct from actor
     and not (
       (request.task_id is not null and focus.can_contribute_to_task(request.task_id))
       or (request.goal_id is not null and focus.can_update_goal(request.goal_id))
     ) then
    return focus.error('not_authorised', 'You are not authorised to respond to this request.');
  end if;
  if length(btrim(coalesce(p_message, ''))) = 0 then
    return focus.error('validation_failed', 'Write a response before sending.');
  end if;
  if p_kind <> 'answer' and request.action_type <> 'approval' then
    return focus.error('validation_failed', 'This request did not ask for an approval decision.');
  end if;

  insert into public.barrier_responses (barrier_id, author_id, message, kind)
  values (request.id, actor, btrim(p_message), p_kind)
  returning id into response_id;
  update public.barriers
  set action_pending = case when actor = request.action_required_from then false else action_pending end,
      version = version + 1
  where id = request.id;

  headline := case when p_kind = 'approved' then 'Approved'
    when p_kind = 'changes_requested' then 'Changes requested'
    when request.action_type = 'decision' then 'Decision received'
    when request.action_type = 'approval' then 'Approval received'
    else 'Response received' end;

  if request.task_id is not null then
    perform focus.write_audit(
      p_event_type := 'barrier_response_posted', p_actor_id := actor,
      p_task_id := request.task_id,
      p_detail := jsonb_build_object('barrier_id', request.id, 'response_id', response_id,
        'response_kind', p_kind, 'action_pending_cleared', actor = request.action_required_from)
    );
    perform focus.notify(
      request.raised_by, 'barrier_raised', 'immediate', true, headline,
      left(btrim(p_message), 220), request.task_id, request.id, actor
    );
  else
    perform focus.write_goal_audit(
      'goal_support_requested', actor, request.goal_id,
      (select owner_id from public.goals where id = request.goal_id),
      (select version from public.goals where id = request.goal_id),
      jsonb_build_object('request_id', request.id, 'response_id', response_id,
        'response_kind', p_kind, 'event', 'response_posted')
    );
    perform focus.notify_goal(
      request.raised_by, 'goal_support_requested', 'immediate', true,
      headline, left(btrim(p_message), 220), request.goal_id, actor
    );
  end if;

  result := jsonb_build_object(
    'ok', true, 'code', 'barrier_response_posted', 'response_id', response_id,
    'response_kind', p_kind, 'action_pending', false, 'barrier_status', request.status
  );
  return focus.remember_operation(actor, p_idempotency_key, 'post_barrier_response', result);
end;
$$;

create or replace function public.resolve_barrier(p_barrier_id uuid, p_resolution_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  request public.barriers;
  remaining_goal_requests integer;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to resolve a request.');
  end if;
  select * into request from public.barriers where id = p_barrier_id for update;
  if not found then return focus.error('not_found', 'This request no longer exists.'); end if;
  if not focus.can_manage_request(request.id) then
    return focus.error('not_authorised', 'You are not authorised to resolve this request.');
  end if;
  if request.status = 'resolved' then
    return jsonb_build_object('ok', true, 'code', 'already_resolved');
  end if;
  if length(btrim(coalesce(p_resolution_note, ''))) = 0 then
    return focus.error('validation_failed', 'Record how the request was resolved.');
  end if;

  update public.barriers
  set status = 'resolved', action_pending = false, resolved_by = actor,
      resolved_at = now(), resolution_note = btrim(p_resolution_note), version = version + 1
  where id = request.id;

  if request.task_id is not null then
    update public.tasks set last_meaningful_update_at = now(), version = version + 1
    where id = request.task_id;
    perform focus.write_audit(
      p_event_type := 'barrier_resolved', p_actor_id := actor, p_task_id := request.task_id,
      p_detail := jsonb_build_object('barrier_id', request.id, 'note', btrim(p_resolution_note))
    );
    perform focus.notify(
      request.raised_by, 'barrier_raised', 'immediate', false, 'Barrier resolved',
      left(btrim(p_resolution_note), 220), request.task_id, request.id, actor
    );
  else
    select
      (select count(*) from public.barriers other
       where other.goal_id = request.goal_id and other.id <> request.id
         and other.source_active and other.status = 'open')
      +
      (select count(*) from public.goal_support_requests legacy
       where legacy.goal_id = request.goal_id and legacy.status <> 'resolved')
    into remaining_goal_requests;
    update public.goals
    set health = case when remaining_goal_requests = 0 then 'on_track' else health end,
        last_meaningful_update_at = now(), version = version + 1
    where id = request.goal_id;
    perform focus.write_goal_audit(
      'goal_support_resolved', actor, request.goal_id,
      (select owner_id from public.goals where id = request.goal_id),
      (select version from public.goals where id = request.goal_id),
      jsonb_build_object('request_id', request.id, 'resolution_note', btrim(p_resolution_note))
    );
    perform focus.notify_goal(
      request.raised_by, 'goal_support_requested', 'digest', false, 'Goal support resolved',
      left(btrim(p_resolution_note), 220), request.goal_id, actor
    );
  end if;
  return jsonb_build_object('ok', true, 'code', 'resolved');
end;
$$;

revoke all on function public.cancel_task(uuid, integer, text, text) from public, anon;
revoke all on function public.reassign_task(uuid, integer, uuid, text) from public, anon;
revoke all on function public.get_work_proposal_capabilities(uuid) from public, anon;
revoke all on function public.decide_major_project_proposal(uuid, integer, text, text, text) from public, anon;
revoke all on function public.resubmit_major_project_proposal(uuid, integer, text, text, text) from public, anon;
revoke all on function public.raise_goal_support_request(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.post_barrier_response(
  uuid, text, integer, public.barrier_response_kind, text
) from public, anon;
revoke all on function public.resolve_barrier(uuid, text) from public, anon;

grant execute on function public.cancel_task(uuid, integer, text, text) to authenticated;
grant execute on function public.reassign_task(uuid, integer, uuid, text) to authenticated;
grant execute on function public.get_work_proposal_capabilities(uuid) to authenticated;
grant execute on function public.decide_major_project_proposal(uuid, integer, text, text, text) to authenticated;
grant execute on function public.resubmit_major_project_proposal(uuid, integer, text, text, text) to authenticated;
grant execute on function public.raise_goal_support_request(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.post_barrier_response(
  uuid, text, integer, public.barrier_response_kind, text
) to authenticated;
grant execute on function public.resolve_barrier(uuid, text) to authenticated;

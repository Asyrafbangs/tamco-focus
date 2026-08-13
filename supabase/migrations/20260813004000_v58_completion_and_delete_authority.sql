-- ---------------------------------------------------------------------------
-- v58 — who may finish work, and who may delete it.
--
-- Two authority corrections, both narrowing.
--
-- COMPLETION. `complete_task` accepted anybody `can_contribute_to_task`
-- allows, which includes task collaborators and checklist assignees. That let
-- a contributor declare somebody else's task finished. Completing a task is a
-- statement that the result was delivered, and only the person accountable for
-- the result is in a position to make it. A contributor finishes their own
-- checklist step; the owner finishes the work.
--
-- Managers keep it, through the reporting line rather than the role, because a
-- manager already carries accountability for their reports' results and has to
-- be able to close work when somebody leaves or is away.
--
-- DELETION. `delete_task` accepted the owner or their manager. Deletion is not
-- a lifecycle decision — it says the task should never have existed — and the
-- only person who can genuinely know that is whoever created it. Ownership can
-- move; authorship cannot. An owner who inherited a task by reassignment has
-- no basis to judge it a mistake, and can cancel it instead.
--
-- Administrators are deliberately NOT given a blanket branch here. They can
-- already cancel anything, which is the reversible instrument, and the Bin is
-- reachable only through the same authority that put work into it.
--
-- Correction to the v57 note, which said a hard DELETE would silently destroy
-- the audit trail. It would not: `focus.reject_audit_mutation` makes
-- `audit_events` append-only, so the cascade raises and the whole DELETE
-- fails —
--
--   ERROR: audit_events is append-only. Record a reversal event instead of
--          modifying history.
--
-- The conclusion is unchanged but the reason is stronger. Hard deletion is not
-- a dangerous option that was rejected; it is impossible for any task that has
-- ever been touched, because every such task has audit history. The Bin is the
-- only way "delete" can exist here at all.
-- ---------------------------------------------------------------------------

create or replace function focus.can_complete_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.tasks t
     where t.id = target_task_id
       and (
            t.primary_owner_id = auth.uid()
         or (focus.is_manager_or_admin() and focus.is_manager_of(t.primary_owner_id))
       )
  );
$$;

comment on function focus.can_complete_task(uuid) is
  'Who may declare the whole task finished: the primary owner, or a manager in their reporting line. Deliberately excludes collaborators and checklist assignees, who complete their own steps rather than the result.';

create or replace function focus.can_delete_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.tasks t
     where t.id = target_task_id
       and t.created_by = auth.uid()
  );
$$;

comment on function focus.can_delete_task(uuid) is
  'Only the person who created the task. Deleting asserts the task should never have existed, which only its author can know; ownership can move, authorship cannot.';

revoke all on function focus.can_complete_task(uuid) from public, anon;
revoke all on function focus.can_delete_task(uuid) from public, anon;
grant execute on function focus.can_complete_task(uuid) to authenticated;
grant execute on function focus.can_delete_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Apply the narrowed rule inside the two procedures.
-- ---------------------------------------------------------------------------

create or replace function public.delete_task(
  p_task_id uuid,
  p_expected_version integer,
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
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to delete work.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_delete_task(p_task_id) then
    return focus.error(
      'not_authorised',
      'Only the person who created this work can delete it. Cancel it instead if it should not go ahead.'
    );
  end if;

  if task.deleted_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_deleted', 'task_id', p_task_id);
  end if;

  if task.status = 'completed' then
    return focus.error(
      'invalid_state',
      'Completed work is a record of what was delivered and cannot be deleted. Cancel it instead if it should not count.'
    );
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This task changed while you were deleting it. Review the latest information.',
      jsonb_build_object('current_version', task.version)
    );
  end if;

  update public.tasks
  set deleted_at = now(),
      deleted_by = actor,
      over_focus_target = false,
      version = version + 1
  where id = p_task_id;

  cleanup := focus.deactivate_task_projections(p_task_id);
  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  event_id := focus.write_audit(
    p_event_type := 'task_deleted',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := task.status,
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('projection_cleanup', cleanup)
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'task_deleted',
    'task_id', p_task_id,
    'audit_event_id', event_id,
    'projection_cleanup', cleanup
  );
  return focus.remember_operation(actor, p_idempotency_key, 'delete_task', result);
end;
$$;

create or replace function public.restore_task(
  p_task_id uuid,
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
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to restore work.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  -- Symmetry matters: whoever could put it in the Bin is who can take it out.
  if not focus.can_delete_task(p_task_id) then
    return focus.error('not_authorised', 'Only the person who created this work can restore it.');
  end if;

  if task.deleted_at is null then
    return jsonb_build_object('ok', true, 'code', 'not_deleted', 'task_id', p_task_id);
  end if;

  update public.tasks
  set deleted_at = null,
      deleted_by = null,
      version = version + 1
  where id = p_task_id;

  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  event_id := focus.write_audit(
    p_event_type := 'task_restored',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := task.status,
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'task_restored',
    'task_id', p_task_id,
    'audit_event_id', event_id
  );
  return focus.remember_operation(actor, p_idempotency_key, 'restore_task', result);
end;
$$;

-- ---------------------------------------------------------------------------
-- The capability payload the drawer reads, so the buttons match the rules.
--
-- Rebuilt from the v54 definition, not the v38 one. An earlier draft of this
-- migration was based on v38 and silently dropped  and
-- , which v52 and v54 had added — two integration tests caught it.
-- Everything below is v54 verbatim plus the two new keys.
-- ---------------------------------------------------------------------------
create or replace function public.get_task_capabilities(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or not focus.can_view_task(p_task_id) then
      jsonb_build_object(
        'can_view', false, 'can_contribute', false, 'can_edit', false,
        'can_review', false, 'can_reassign', false, 'can_cancel', false,
        'can_complete', false, 'can_delete', false
      )
    else (
      select jsonb_build_object(
        'can_view', true,
        'can_contribute', focus.can_contribute_to_task(task.id),
        'can_edit', focus.can_edit_task(task.id),
        'can_review', focus.can_review_task(task.id),
        'can_reassign', task.status not in ('completed', 'cancelled')
          and focus.is_manager_or_admin()
          and focus.is_manager_of(task.primary_owner_id),
        'can_cancel', task.status not in ('completed', 'cancelled') and case
          when task.is_mandatory then (
            focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id)
          )
          else (
            task.primary_owner_id = auth.uid()
            or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))
          )
        end,
        'can_complete', task.status in ('active', 'backlog', 'paused')
          and focus.can_complete_task(task.id),
        'can_delete', task.status <> 'completed'
          and task.deleted_at is null
          and focus.can_delete_task(task.id)
      )
        from public.tasks task
       where task.id = p_task_id
    )
  end;
$$;

revoke all on function public.get_task_capabilities(uuid) from public, anon;
grant execute on function public.get_task_capabilities(uuid) to authenticated;

-- Completion authority narrowed from can_contribute to can_complete.
--
-- Reproduced verbatim apart from the authority check and its message, so the
-- evidence rules, review routing and idempotency behaviour are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_task(p_task_id uuid, p_expected_version integer, p_completion_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  task record;
  missing_items text[];
  missing_evidence text[];
  needs_review boolean;
  reviewer uuid;
  event_id uuid;
  replayed jsonb;
  result jsonb;
  review_classes jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to complete work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_complete_task(p_task_id) then
    return focus.error('not_authorised', 'Only the owner of this work, or their manager, can complete it. Contributors complete their own checklist steps.');
  end if;

  if task.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_completed',
                              'task', focus.task_snapshot(p_task_id));
  end if;

  if task.status not in ('active', 'backlog', 'paused') then
    return focus.error('invalid_state', 'This work cannot be completed from its current state.');
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This task was updated by another user. Review the latest information before continuing.',
      jsonb_build_object('current_version', task.version));
  end if;

  -- Outstanding checklist steps.
  select array_agg(ci.action order by ci.position)
    into missing_items
    from public.task_checklist_items ci
   where ci.task_id = p_task_id
     and ci.state <> 'completed';

  -- Steps marked as requiring evidence that carry no attachment.
  select array_agg(ci.action order by ci.position)
    into missing_evidence
    from public.task_checklist_items ci
   where ci.task_id = p_task_id
     and ci.evidence_rule = 'required'
     and not exists (
       select 1 from public.attachments a where a.checklist_item_id = ci.id
     );

  if missing_items is not null or missing_evidence is not null then
    return focus.error(
      'evidence_missing',
      'This work cannot be completed yet.',
      jsonb_build_object(
        'incomplete_items', coalesce(to_jsonb(missing_items), '[]'::jsonb),
        'missing_evidence', coalesce(to_jsonb(missing_evidence), '[]'::jsonb))
    );
  end if;

  -- Section 20.3 — review policy is configurable by work type, and mandatory
  -- work always requires review.
  review_classes := focus.setting('review.required_for_work_classes');
  needs_review :=
    (review_classes ? task.work_class::text)
    or (task.is_mandatory and coalesce((focus.setting('review.required_when_mandatory'))::boolean, true));

  -- A routine occurrence follows its template's rule (section 20.7).
  if task.work_class = 'routine_occurrence' then
    select rt.requires_completion_review into needs_review
      from public.routine_templates rt where rt.id = task.routine_template_id;
    needs_review := coalesce(needs_review, false);
  end if;

  if needs_review then
    reviewer := coalesce(
      task.reviewer_id,
      (select reporting_manager_id from public.user_profiles where id = task.primary_owner_id)
    );
  end if;

  update public.tasks
     set status = 'completed',
         completed_at = now(),
         progress_percent = 100,
         over_focus_target = false,
         review_status = case when needs_review then 'pending'::public.review_status
                              else 'not_required'::public.review_status end,
         reviewer_id = coalesce(reviewer, task.reviewer_id),
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  if needs_review then
    insert into public.completion_reviews (task_id, submitted_by, reviewer_id)
    values (p_task_id, actor, reviewer);

    perform focus.notify(
      reviewer, 'completion_review_assigned', 'immediate', true,
      'Completion review needed',
      format('"%s" was completed and needs your review decision.', task.title),
      p_task_id, null, actor);
  end if;

  event_id := focus.write_audit(
    p_event_type := 'completion_submitted',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := 'completed',
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('note', p_completion_note, 'review_required', needs_review)
  );

  result := jsonb_build_object(
    'ok', true,
    'code', case when needs_review then 'completed_pending_review' else 'completed' end,
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id,
    'review_required', needs_review
  );

  return focus.remember_operation(actor, p_idempotency_key, 'complete_task', result);
end;
$function$

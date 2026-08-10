-- ---------------------------------------------------------------------------
-- v52 — the capability payload learns about reassignment.
--
-- `reassign_task` has always existed and has always been a manager act: a view
-- grant never confers it, and the owner cannot hand their own work away. But
-- the capabilities a screen reads — view, contribute, edit, review — had no way
-- to express that, so a Reassign control drawn from `can_edit` would appear to
-- every owner and then be refused by the procedure.
--
-- A control that is visible and always fails is worse than an absent one: the
-- person tries, is told no, and learns to distrust the whole screen. The
-- predicate here is the same expression `reassign_task` enforces, so the two
-- cannot disagree about who may do it.
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
        'can_view', false,
        'can_contribute', false,
        'can_edit', false,
        'can_review', false,
        'can_reassign', false
      )
    else jsonb_build_object(
      'can_view', true,
      'can_contribute', focus.can_contribute_to_task(p_task_id),
      'can_edit', focus.can_edit_task(p_task_id),
      'can_review', focus.can_review_task(p_task_id),
      'can_reassign', (
        select focus.is_admin()
            or (focus.is_manager_or_admin() and focus.is_manager_of(t.primary_owner_id))
          from public.tasks t
         where t.id = p_task_id
      )
    )
  end;
$$;

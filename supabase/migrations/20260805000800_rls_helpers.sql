-- ============================================================================
-- TAMCO Focus — authorisation helper functions
--
-- Implements the approved security model (MASTER_PRODUCT_SPEC.md section 22.5):
--
--   default deny -> own work always visible -> inherited direct reports where
--   configured -> explicit additional visibility granted by an administrator
--
-- and the separation demanded by section 3.4: VIEW access never confers edit,
-- activation, reassignment, or completion-acceptance authority.
--
-- Every function here is SECURITY DEFINER and owned by the migration role, so
-- it reads the identity tables without re-entering the policies that call it.
-- Without this, a policy on `user_profiles` that needs to know the caller's
-- role would recurse into itself. Each is also STABLE and argument-free where
-- possible, which lets Postgres evaluate it once per statement as an InitPlan
-- rather than once per row.
--
-- `search_path` is pinned on every function: a SECURITY DEFINER function with a
-- caller-controlled search_path is a privilege-escalation vector.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create or replace function focus.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid();
$$;

-- A deactivated account must not be able to read or write anything, even if it
-- still holds a valid unexpired JWT (section 31B.2: deactivation prevents
-- sign-in AND must revoke access).
create or replace function focus.is_active_account()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.user_profiles p
     where p.id = auth.uid()
       and p.status = 'active'
  );
$$;

create or replace function focus.current_role_name()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
    from public.user_profiles p
   where p.id = auth.uid()
     and p.status = 'active';
$$;

create or replace function focus.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(focus.current_role_name() = 'administrator', false);
$$;

create or replace function focus.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(focus.current_role_name() in ('manager', 'administrator'), false);
$$;

-- ---------------------------------------------------------------------------
-- Reporting lines
-- ---------------------------------------------------------------------------

-- Everyone at or below `root_id` in the reporting tree, including `root_id`.
-- The depth cap is belt-and-braces: `user_profiles_no_reporting_cycle` already
-- prevents a loop, but an unbounded recursive CTE inside a policy is not a
-- risk worth carrying.
create or replace function focus.reporting_tree(root_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive tree as (
    select p.id, 0 as depth
      from public.user_profiles p
     where p.id = root_id
    union all
    select child.id, tree.depth + 1
      from public.user_profiles child
      join tree on child.reporting_manager_id = tree.id
     where tree.depth < 64
  )
  select id from tree;
$$;

create or replace function focus.is_manager_of(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and target_id is not null
    and auth.uid() <> target_id
    and exists (
      select 1
        from focus.reporting_tree(auth.uid()) t
       where t.user_id = target_id
    );
$$;

-- ---------------------------------------------------------------------------
-- Effective visibility
-- ---------------------------------------------------------------------------

-- The set of people whose work the caller may VIEW.
--
-- Composition, in the order section 22.5 states it:
--   * always self
--   * the reporting subtree, when the viewer's mode is `direct_reports_plus`
--   * every explicit administrator grant, under any mode other than `none`
--   * everyone, for an administrator
--
-- A viewer with no policy row falls back to `specific_only`, which with no
-- grants yields exactly {self} — the default-deny position.
create or replace function focus.visible_user_ids()
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with viewer as (
    select
      auth.uid() as id,
      coalesce(
        (select vp.mode from public.visibility_policies vp where vp.viewer_id = auth.uid()),
        'specific_only'::public.visibility_mode
      ) as mode,
      focus.is_admin() as admin
  )
  -- Own work is always visible.
  select viewer.id from viewer where viewer.id is not null

  union

  -- Administrators may review all authorised records (section 3.3).
  select p.id
    from public.user_profiles p, viewer
   where viewer.admin

  union

  -- Inherited direct reports, where the administrator configured that mode.
  select t.user_id
    from viewer
    join lateral focus.reporting_tree(viewer.id) t on true
   where viewer.mode = 'direct_reports_plus'

  union

  -- Explicit additional grants. `none` means no team visibility at all, so
  -- grants are not applied under that mode.
  select g.subject_id
    from public.visibility_grants g, viewer
   where g.viewer_id = viewer.id
     and viewer.mode <> 'none';
$$;

create or replace function focus.can_view_user(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from focus.visible_user_ids() v where v.user_id = target_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Task-level authorisation
-- ---------------------------------------------------------------------------

-- VIEW. Reachable through owner visibility, collaboration, or an assigned
-- review. Collaboration and review are deliberately independent of the
-- visibility rules: being asked to contribute to or verify a task grants sight
-- of that task without granting sight of the owner's other work.
create or replace function focus.can_view_task(target_task_id uuid)
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
            focus.can_view_user(t.primary_owner_id)
         or exists (
              select 1 from public.task_collaborators c
               where c.task_id = t.id and c.user_id = auth.uid()
            )
         or exists (
              select 1 from public.task_checklist_items ci
               where ci.task_id = t.id and ci.assigned_to = auth.uid()
            )
         or t.reviewer_id = auth.uid()
         or exists (
              select 1 from public.completion_reviews cr
               where cr.task_id = t.id
                 and (cr.reviewer_id = auth.uid() or cr.second_reviewer_id = auth.uid())
            )
       )
  );
$$;

-- EDIT. Strictly narrower than view, and this gap is the whole point of
-- section 3.4. An explicit visibility grant appears in `can_view_task` and is
-- absent here, so a viewer such as Amer can read Izzah's work and change
-- nothing about it.
create or replace function focus.can_edit_task(target_task_id uuid)
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
         or focus.is_admin()
         or (focus.is_manager_or_admin() and focus.is_manager_of(t.primary_owner_id))
       )
  );
$$;

-- CONTRIBUTE. What a collaborator may do (section 13.1): complete their
-- assigned checklist items, post updates, attach evidence, raise barriers.
-- It does not extend to editing task fields, activating, or reassigning.
create or replace function focus.can_contribute_to_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    focus.can_edit_task(target_task_id)
    or exists (
      select 1 from public.task_collaborators c
       where c.task_id = target_task_id and c.user_id = auth.uid()
    )
    or exists (
      select 1 from public.task_checklist_items ci
       where ci.task_id = target_task_id and ci.assigned_to = auth.uid()
    );
$$;

-- REVIEW. Who may accept completion or request changes (section 20.5).
create or replace function focus.can_review_task(target_task_id uuid)
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
            focus.is_admin()
         or t.reviewer_id = auth.uid()
         or (focus.is_manager_or_admin() and focus.is_manager_of(t.primary_owner_id))
         or exists (
              select 1 from public.completion_reviews cr
               where cr.task_id = t.id
                 and (cr.reviewer_id = auth.uid() or cr.second_reviewer_id = auth.uid())
            )
       )
       -- A reviewer must be independent of the person who did the work
       -- (section 3.1: a team member may not accept their own completion when
       -- independent review is required).
       and (t.primary_owner_id <> auth.uid() or focus.is_admin())
  );
$$;

-- ---------------------------------------------------------------------------
-- Focus counting (PRODUCTION_LOGIC.md section 2.2)
--
-- Counted from committed state, never from a client-supplied number
-- (ONE_SHOT_LOCAL_BUILD_PROMPT.md, "Do not trust client-supplied permission or
-- focus-count calculations"). Only `active` tasks in a focus bucket count;
-- Quick Actions and routine occurrences carry no bucket and so cannot.
-- ---------------------------------------------------------------------------

create or replace function focus.active_focus_count(owner_id uuid, target_bucket public.focus_bucket)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.tasks t
   where t.primary_owner_id = owner_id
     and t.focus_bucket = target_bucket
     and t.status = 'active';
$$;

-- Resolves the effective recommended target, most specific scope first.
create or replace function focus.effective_focus_target(
  owner_id uuid,
  target_bucket public.focus_bucket
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with owner_department as (
    select p.department_id from public.user_profiles p where p.id = owner_id
  ),
  candidates as (
    select ft.recommended_target, 1 as precedence, ft.effective_from
      from public.focus_targets ft
     where ft.scope_type = 'user'
       and ft.scope_id = owner_id
       and ft.bucket = target_bucket
       and ft.effective_from <= now()

    union all

    select ft.recommended_target, 2, ft.effective_from
      from public.focus_targets ft, owner_department d
     where ft.scope_type = 'department'
       and ft.scope_id = d.department_id
       and ft.bucket = target_bucket
       and ft.effective_from <= now()

    union all

    select ft.recommended_target, 3, ft.effective_from
      from public.focus_targets ft
     where ft.scope_type = 'system'
       and ft.bucket = target_bucket
       and ft.effective_from <= now()
  )
  select recommended_target
    from candidates
   order by precedence, effective_from desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Settings reader used by the transactional procedures.
-- ---------------------------------------------------------------------------

create or replace function focus.setting(setting_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select value from public.org_settings where key = setting_key;
$$;

-- Deny the API roles direct execution. These helpers are called from policy
-- expressions and from SECURITY DEFINER procedures, both of which run
-- regardless of the caller's EXECUTE privilege on the function itself.
revoke all on all functions in schema focus from public, anon, authenticated;

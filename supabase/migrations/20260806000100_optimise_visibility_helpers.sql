-- ============================================================================
-- Performance: short-circuit the visibility helpers on the common cases
--
-- Measured problem
--   A 20-user load test put `task_overview` at mean 560ms / p95 1071ms / p99
--   1483ms, three to five times slower than every other read. EXPLAIN showed
--   why: `focus.can_view_task(id)` runs as a per-row filter, and each of the
--   view's seven correlated subqueries re-applies RLS per inner row. One page
--   load therefore made hundreds of SECURITY DEFINER calls, and each one
--   evaluated `visible_user_ids()` — a recursive CTE over the reporting tree
--   unioned with the grant table.
--
-- Change
--   Order the disjuncts cheapest-first. Postgres short-circuits an OR, so
--   putting the two constant-time identity checks ahead of the recursive lookup
--   means the expensive path runs only for the rows that actually need it:
--   work owned by somebody else.
--
--   `own work` is the first branch because it is both the cheapest test and by
--   far the most common — My Day and the focus tabs are almost entirely the
--   caller's own rows.
--
-- Security
--   Identical result set, reordered. Own work is always visible
--   (MASTER_PRODUCT_SPEC.md section 22.5), so the added branch is a subset of
--   what `can_view_user` already returned, never a widening. The RLS suite and
--   the live security probe both re-run against this.
-- ============================================================================

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
            -- Cheapest first: your own work, then an administrator's blanket
            -- scope, then the paths that need a lookup.
            t.primary_owner_id = auth.uid()
         or focus.is_admin()
         or t.reviewer_id = auth.uid()
         or exists (
              select 1 from public.task_collaborators c
               where c.task_id = t.id and c.user_id = auth.uid()
            )
         or exists (
              select 1 from public.task_checklist_items ci
               where ci.task_id = t.id and ci.assigned_to = auth.uid()
            )
         or exists (
              select 1 from public.completion_reviews cr
               where cr.task_id = t.id
                 and (cr.reviewer_id = auth.uid() or cr.second_reviewer_id = auth.uid())
            )
         -- Most expensive last: the reporting tree and explicit grants.
         or focus.can_view_user(t.primary_owner_id)
       )
  );
$$;

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
         -- `is_manager_of` walks the reporting tree, so it stays last. The
         -- deliberate absence of any grant-based branch is what keeps view
         -- separate from edit (section 3.4).
         or (focus.is_manager_or_admin() and focus.is_manager_of(t.primary_owner_id))
       )
  );
$$;

create or replace function focus.can_contribute_to_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- Ownership is the common case and is already the first test inside
    -- can_edit_task, so this ordering costs nothing and usually returns here.
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

-- ---------------------------------------------------------------------------
-- Indexes supporting the branches that remain.
--
-- The collaborator and assignee lookups run for every task a caller does not
-- own; without these they are sequential scans inside a per-row function.
-- ---------------------------------------------------------------------------

create index if not exists task_collaborators_user_task_idx
  on public.task_collaborators (user_id, task_id);

create index if not exists task_checklist_items_assignee_task_idx
  on public.task_checklist_items (assigned_to, task_id)
  where assigned_to is not null;

create index if not exists completion_reviews_reviewers_idx
  on public.completion_reviews (reviewer_id, second_reviewer_id, task_id);

-- Supports the reporting-tree walk that `visible_user_ids` and `is_manager_of`
-- perform on every uncached call.
create index if not exists user_profiles_manager_active_idx
  on public.user_profiles (reporting_manager_id, id)
  where status = 'active';

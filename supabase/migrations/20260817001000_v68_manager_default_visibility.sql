-- ---------------------------------------------------------------------------
-- v68 — a manager with no policy row can see their own reporting line.
--
-- `focus.visible_user_ids()` fell back to `specific_only` for anybody without a
-- row in `visibility_policies`. For an employee that is right: default deny,
-- own work only. For a manager it silently withdrew the one thing their role
-- is defined by — their reports — so My Team listed only people who happened
-- to hold an explicit grant, and the rest of their line was invisible with
-- nothing on screen to say why or where to change it.
--
-- Nothing here widens what an explicit policy says. A manager who has been
-- given `none` or `specific_only` keeps exactly that; this only decides what
-- "unconfigured" means, and for a manager the honest answer is the reporting
-- line rather than nothing at all. Employees are untouched: no row still means
-- `specific_only`.
-- ---------------------------------------------------------------------------

create or replace function focus.visible_user_ids()
returns table(user_id uuid)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with viewer as (
    select
      auth.uid() as id,
      coalesce(
        (select vp.mode from public.visibility_policies vp where vp.viewer_id = auth.uid()),
        -- The default now depends on who is asking. An unconfigured manager
        -- sees the line they manage; an unconfigured employee sees nobody.
        case when focus.is_manager_or_admin()
             then 'direct_reports_plus'::public.visibility_mode
             else 'specific_only'::public.visibility_mode
        end
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

  -- Inherited direct reports, where the mode allows it.
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

comment on function focus.visible_user_ids is
  'Every user id the caller may see. Unconfigured managers default to their reporting line; unconfigured employees to themselves alone.';

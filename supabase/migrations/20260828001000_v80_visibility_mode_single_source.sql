-- ---------------------------------------------------------------------------
-- v80 — one definition of "which visibility mode is in force".
--
-- v68 changed what an unconfigured viewer defaults to: a manager or
-- administrator with no row in `visibility_policies` sees their reporting
-- line, an employee sees only themselves. It changed that in exactly one
-- place — `focus.visible_user_ids()`, the function the RLS policies call.
--
-- `preview_effective_visibility` was left on the old rule. It is the function
-- the administrator screens use to answer "what can this person see", so from
-- v68 onward the screen and the database disagreed about every manager who had
-- never been configured: the database showed them their whole line, the screen
-- said they could see nobody.
--
-- That is worse than a cosmetic mismatch, because the screen is also an
-- editor. Opening an unconfigured manager pre-selected "Specific people only",
-- and saving anything at all from that page — a tick, a reason, a stray
-- click — wrote that mode as an explicit policy and took their reporting line
-- away for real. The administrator had no way to see it happen: the radio
-- looked the same before and after, because it had been showing the wrong
-- thing to begin with.
--
-- The fix is to stop stating the rule twice. `focus.effective_visibility_mode`
-- is now the only place that knows what "unconfigured" means, and both the
-- enforcing function and the preview call it.
--
-- `public.get_visibility_state` is new, and exists so the administrator
-- interface never has to guess either: it returns the mode actually in force,
-- whether that came from a stored policy or from the default, and the explicit
-- grants. Nothing about who can see whom changes in this migration — only
-- which code is entitled to answer the question.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The single definition.
-- ---------------------------------------------------------------------------

create or replace function focus.effective_visibility_mode(p_user_id uuid)
returns public.visibility_mode
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select vp.mode from public.visibility_policies vp where vp.viewer_id = p_user_id),
    -- Unconfigured. What that means depends on the job: a manager's reporting
    -- line is the thing their role is defined by, an employee's default is
    -- themselves alone.
    case
      when exists (
        select 1 from public.user_profiles p
         where p.id = p_user_id and p.role in ('manager', 'administrator')
      ) then 'direct_reports_plus'::public.visibility_mode
      else 'specific_only'::public.visibility_mode
    end
  );
$$;

comment on function focus.effective_visibility_mode is
  'The visibility mode in force for a user: their stored policy, or the default for their role. The only definition of that fallback.';

grant execute on function focus.effective_visibility_mode(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement, now reading the shared definition rather than restating it.
-- The resolved behaviour is identical to v68.
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
      focus.effective_visibility_mode(auth.uid()) as mode,
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
  'Every user id the caller may see. The mode comes from focus.effective_visibility_mode.';

-- ---------------------------------------------------------------------------
-- The preview the administrator screens read. Same rule as enforcement, now
-- by construction rather than by hoping the two stay in step.
-- ---------------------------------------------------------------------------

create or replace function public.preview_effective_visibility(p_viewer_id uuid)
returns table (
  user_id uuid,
  full_name text,
  employee_id text,
  source text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with viewer as (
    select
      p.id,
      p.role,
      focus.effective_visibility_mode(p.id) as mode
    from public.user_profiles p
    where p.id = p_viewer_id
      -- Only an administrator may run the preview at all.
      and (auth.uid() is null or focus.is_admin())
  ),
  resolved as (
    select viewer.id as user_id, 'own work' as source from viewer

    union all

    select p.id, 'administrator scope'
      from public.user_profiles p, viewer
     where viewer.role = 'administrator'

    union all

    select t.user_id, 'direct report'
      from viewer
      join lateral focus.reporting_tree(viewer.id) t on true
     where viewer.mode = 'direct_reports_plus'
       and t.user_id <> viewer.id

    union all

    select g.subject_id, 'explicit grant'
      from public.visibility_grants g, viewer
     where g.viewer_id = viewer.id and viewer.mode <> 'none'
  )
  select
    r.user_id,
    p.full_name,
    p.employee_id,
    min(r.source) as source
  from resolved r
  join public.user_profiles p on p.id = r.user_id
  group by r.user_id, p.full_name, p.employee_id
  order by p.full_name;
$$;

-- ---------------------------------------------------------------------------
-- What the editor loads. Returns the mode in force and says where it came
-- from, so the screen can show a default as a default instead of presenting it
-- as somebody's decision.
-- ---------------------------------------------------------------------------

create or replace function public.get_visibility_state(p_viewer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  stored public.visibility_mode;
  target record;
begin
  if auth.uid() is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can read visibility rules.');
  end if;

  select id, role into target from public.user_profiles where id = p_viewer_id;
  if not found then
    return focus.error('not_found', 'That user does not exist.');
  end if;

  select vp.mode into stored
    from public.visibility_policies vp
   where vp.viewer_id = p_viewer_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'visibility_state',
    'mode', focus.effective_visibility_mode(p_viewer_id),
    -- False means nobody has chosen this; it is the default for their role,
    -- and saving the form is what turns it into a decision.
    'configured', stored is not null,
    'role', target.role,
    'subject_ids', coalesce(
      (select jsonb_agg(g.subject_id)
         from public.visibility_grants g
        where g.viewer_id = p_viewer_id),
      '[]'::jsonb)
  );
end;
$$;

comment on function public.get_visibility_state is
  'Administrator read of one person visibility rule: the mode in force, whether it was stored or defaulted, and the explicit grants.';

grant execute on function public.get_visibility_state(uuid) to authenticated;

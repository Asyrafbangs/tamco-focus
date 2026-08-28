-- ---------------------------------------------------------------------------
-- v81 — close the default EXECUTE grant on the v80 reader.
--
-- Postgres grants EXECUTE on a new function in `public` to PUBLIC unless the
-- migration says otherwise, and every other procedure in this schema revokes
-- it explicitly. v80 added `get_visibility_state` and only granted to
-- `authenticated`, which adds nothing on top of a grant the whole world
-- already has.
--
-- The guard inside it was written in the same shape as the older procedures —
-- `auth.uid() is not null and not focus.is_admin()` — which lets a caller with
-- no session through, on the assumption that only the service role reaches
-- that state. Nothing calls this as the service role, so the exemption buys
-- nothing and costs the check. It now requires an administrator outright.
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
  -- No service-role exemption: the administrator screens are the only caller.
  if not focus.is_admin() then
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

revoke all on function public.get_visibility_state(uuid) from public, anon;
grant execute on function public.get_visibility_state(uuid) to authenticated;

-- v141 (follow-up) — the current week, asked of the database.
--
-- Added separately rather than by editing the migration that shipped with it:
-- once a migration is in the repository it may already have been applied
-- somewhere, and rewriting it makes two databases that claim the same version
-- disagree about what is in them.
--
-- The screens need the same Monday the procedures use. Computing it in
-- JavaScript would put the boundary in the browser's zone, so a Monday morning
-- in Kuala Lumpur would land in the previous week for anybody whose machine is
-- set to UTC.

create or replace function public.current_week_start() returns date
language sql stable
security definer
set search_path = public, pg_temp
as $$ select focus.local_week_start() $$;

revoke all on function public.current_week_start() from public;
grant execute on function public.current_week_start() to authenticated, service_role

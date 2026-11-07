-- v294 — the public reporting switch exists for every organisation.
--
-- v288 created the row with
--
--   insert into public.esh_qr_intake_settings (organization_id, enabled)
--   select id, false from public.organizations;
--
-- which runs at migration time. On a database that already held the
-- organisation — production, when v288 was pushed — that worked. On a
-- database built from these migrations, migrations run before the seed, so
-- there are no organisations yet and the insert creates nothing.
--
-- `esh_set_qr_intake` then refuses with `intake_not_configured`, because it
-- requires exactly one settings row and resolves the organisation from that
-- row. So on every freshly reset local database, and on any new deployment,
-- the switch an administrator is shown cannot be moved at all, and the public
-- page stays closed with no way to open it. It is the third time a control has
-- shipped unmovable here for want of the row behind it.
--
-- Two halves: the row for organisations that exist now, and a trigger so an
-- organisation created later gets one as it is created. Closed in both cases —
-- opening public reporting stays a decision somebody makes on purpose.

insert into public.esh_qr_intake_settings (organization_id, enabled)
select id, false from public.organizations
on conflict (organization_id) do nothing;

create or replace function focus.esh_qr_intake_settings_for_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.esh_qr_intake_settings (organization_id, enabled)
  values (new.id, false)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

drop trigger if exists esh_qr_intake_settings_seed on public.organizations;
create trigger esh_qr_intake_settings_seed
  after insert on public.organizations
  for each row
  execute function focus.esh_qr_intake_settings_for_new_organization();

comment on function focus.esh_qr_intake_settings_for_new_organization() is
  'v294 — gives a new organisation its public-reporting switch, closed. '
  'Without it the switch has no row, and an administrator cannot move it.';

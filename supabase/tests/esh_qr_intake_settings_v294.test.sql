begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

/*
 * v294 — the switch has a row to move.
 *
 * `esh_set_qr_intake` requires exactly one settings row and resolves the
 * organisation from it, so an organisation without one leaves an
 * administrator looking at a control that answers `intake_not_configured`
 * whatever they do. v288 seeded the row from a migration that runs before any
 * organisation exists, so every database built from these migrations had the
 * problem and only production — where the organisation predated the
 * migration — did not.
 */

select is(
  (select count(*)::integer from public.esh_qr_intake_settings s
    join public.organizations o on o.id = s.organization_id),
  (select count(*)::integer from public.organizations),
  'every organisation has a public-reporting switch');

select is(
  (select count(*)::integer from public.esh_qr_intake_settings where enabled),
  0,
  'and it is closed until somebody opens it');

-- An organisation created after the migration gets one as it is created.
insert into public.organizations (id, name, slug)
values ('e5e50000-0000-4000-8000-0000000094a1', 'v294 later arrival', 'v294-later-arrival');

select is(
  (select enabled from public.esh_qr_intake_settings
    where organization_id = 'e5e50000-0000-4000-8000-0000000094a1'),
  false,
  'an organisation created later is given one too, closed');

select ok(
  has_function_privilege('authenticated', 'public.esh_set_qr_intake(boolean, text)', 'execute'),
  'the switch is still only moved through its own procedure');

select ok(
  not has_table_privilege('authenticated', 'public.esh_qr_intake_settings', 'update'),
  'and never by writing the table directly');

select * from finish();
rollback;

-- ============================================================================
-- TAMCO Focus — reference data, safe for every environment including Production
--
-- The distinction this file draws (instruction section 27) is between data the
-- application needs in order to work at all, and data that only exists to make
-- development convenient. Only the first belongs here.
--
-- What is NOT here, deliberately:
--
--   application settings   inserted by migrations, because they are versioned
--                          alongside the code that reads them
--   routine templates      created by real users through the application; a
--                          seeded template would be somebody's work invented
--                          for them
--   users                  provisioned through the administrator flow after
--                          explicit approval (sections 14 and 24)
--
-- Idempotent: safe to re-run. It inserts nothing that already exists and
-- updates nothing that does.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Departments.
--
-- The organisational units a profile can belong to. EHS is the pilot
-- department; the others exist because the visibility model refers to
-- departments and an organisation with exactly one is not a useful test of it.
-- ---------------------------------------------------------------------------
insert into public.departments (id, code, name) values
  ('f0c05100-0000-4000-a000-000000000001', 'EHS',   'Environment, Health & Safety'),
  ('f0c05100-0000-4000-a000-000000000002', 'OPS',   'Operations'),
  ('f0c05100-0000-4000-a000-000000000003', 'ADMIN', 'Administration')
on conflict (id) do nothing;

commit;

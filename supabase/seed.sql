-- ============================================================================
-- TAMCO Focus — LOCAL-ONLY development and test fixtures
--
-- Every row in this file is local development and automated-test data. It must
-- never be applied to a hosted environment (LOCAL_FIRST_BUILD_GUIDE.md section
-- 6: "Never push local seed users or local fixtures to production").
--
-- The fixtures exist to make every workflow in MASTER_PRODUCT_SPEC.md
-- reachable without hand-building state, and to give the RLS tests a stable
-- cast. Application code never branches on a fixture ID or name.
--
-- Identifiers are fixed UUIDs so tests can address them directly. The `f0c05`
-- prefix marks them as fixtures at a glance.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Refuse to run against a database that holds real people.
--
-- The script layer already refuses to seed anything but the local stack, but a
-- guard that depends on an environment variable depends on somebody having set
-- it. This one depends on the data instead: every fixture identity in this file
-- is `@tamco.local`, so a database containing any other address is a real
-- environment and this seed has no business in it.
--
-- An empty hosted project is not caught here — nothing in the data can catch
-- that — which is why `scripts/lib/environment.mjs` exists as well. Two
-- independent guards, neither relying on memory.
-- ---------------------------------------------------------------------------
do $$
declare
  outsider text;
begin
  select email into outsider
  from public.user_profiles
  where email not like '%@tamco.local'
  limit 1;

  if outsider is not null then
    raise exception using
      errcode = 'raise_exception',
      message = 'Refusing to seed development fixtures: this database holds real accounts.',
      detail  = format('Found %L, which is not a @tamco.local fixture identity.', outsider),
      hint    = 'Development fixtures belong in Local and Staging only.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Local auth identities.
--
-- Created directly because `supabase db reset` runs this file with no HTTP
-- stack available. `scripts/setup-local` re-applies the password from
-- SEED_USER_PASSWORD through the admin API so the credential is never pinned
-- to a value committed in this repository beyond the documented local default.
-- ---------------------------------------------------------------------------

-- A DO block rather than a helper function: `supabase db reset` pipelines this
-- file as a batch, and no temporary schema exists for a `pg_temp` function to
-- live in. This creates nothing that needs cleaning up afterwards.
--
-- The last account is deliberately history-free, so the guarded
-- permanent-deletion path has a legitimate subject (section 31B.8).
do $$
declare
  account record;
begin
  for account in
    select *
      from (values
        ('f0c05000-0000-4000-a000-000000000001'::uuid, 'admin@tamco.local'),
        ('f0c05000-0000-4000-a000-000000000002'::uuid, 'izzul@tamco.local'),
        ('f0c05000-0000-4000-a000-000000000003'::uuid, 'amer@tamco.local'),
        ('f0c05000-0000-4000-a000-000000000004'::uuid, 'izzah@tamco.local'),
        ('f0c05000-0000-4000-a000-000000000005'::uuid, 'ajmal@tamco.local'),
        ('f0c05000-0000-4000-a000-000000000006'::uuid, 'lim@tamco.local'),
        ('f0c05000-0000-4000-a000-000000000007'::uuid, 'temp.tester@tamco.local')
      ) as t(id, email)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      account.id,
      'authenticated',
      'authenticated',
      account.email,
      extensions.crypt('LocalFocus123!', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      account.id::text, account.id,
      jsonb_build_object('sub', account.id::text, 'email', account.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

insert into public.departments (id, code, name) values
  ('f0c05100-0000-4000-a000-000000000001', 'EHS',   'Environment, Health & Safety'),
  ('f0c05100-0000-4000-a000-000000000002', 'OPS',   'Operations'),
  ('f0c05100-0000-4000-a000-000000000003', 'ADMIN', 'Administration');

-- ---------------------------------------------------------------------------
-- Profiles.
--
-- Written through the provisioning procedure rather than by direct insert, so
-- the seed exercises the same transaction an administrator would, including
-- default alert preferences, default visibility policy, and audit events.
-- ---------------------------------------------------------------------------

select public.provision_user_profile(
  'f0c05000-0000-4000-a000-000000000001', 'ADM-001', 'admin@tamco.local',
  'System Administrator', 'f0c05100-0000-4000-a000-000000000003', 'administrator',
  null, 'standard', 'detailed', null);

select public.provision_user_profile(
  'f0c05000-0000-4000-a000-000000000002', 'MGR-100', 'izzul@tamco.local',
  'Izzul Asyraf', 'f0c05100-0000-4000-a000-000000000001', 'manager',
  null, 'standard', 'leadership', 'f0c05000-0000-4000-a000-000000000001');

select public.provision_user_profile(
  'f0c05000-0000-4000-a000-000000000003', 'EMP-201', 'amer@tamco.local',
  'Amer Hakim', 'f0c05100-0000-4000-a000-000000000001', 'team_member',
  'f0c05000-0000-4000-a000-000000000002', 'standard', 'off',
  'f0c05000-0000-4000-a000-000000000001');

select public.provision_user_profile(
  'f0c05000-0000-4000-a000-000000000004', 'EMP-202', 'izzah@tamco.local',
  'Izzah Nurul', 'f0c05100-0000-4000-a000-000000000001', 'team_member',
  'f0c05000-0000-4000-a000-000000000002', 'focused', 'off',
  'f0c05000-0000-4000-a000-000000000001');

select public.provision_user_profile(
  'f0c05000-0000-4000-a000-000000000005', 'EMP-203', 'ajmal@tamco.local',
  'Ajmal Rizani', 'f0c05100-0000-4000-a000-000000000002', 'team_member',
  'f0c05000-0000-4000-a000-000000000002', 'standard', 'off',
  'f0c05000-0000-4000-a000-000000000001');

select public.provision_user_profile(
  'f0c05000-0000-4000-a000-000000000006', 'EMP-204', 'lim@tamco.local',
  'Lim Wei Sheng', 'f0c05100-0000-4000-a000-000000000002', 'team_member',
  'f0c05000-0000-4000-a000-000000000002', 'off', 'off',
  'f0c05000-0000-4000-a000-000000000001');

select public.provision_user_profile(
  'f0c05000-0000-4000-a000-000000000007', 'TMP-900', 'temp.tester@tamco.local',
  'Temporary Tester', 'f0c05100-0000-4000-a000-000000000003', 'team_member',
  'f0c05000-0000-4000-a000-000000000002', 'off', 'off',
  'f0c05000-0000-4000-a000-000000000001');

-- ---------------------------------------------------------------------------
-- Department heads (v165).
--
-- Set after provisioning, because a head is a person and the people are
-- created above. Operations is deliberately left without one: an organisation
-- with no gaps in it is not a useful test of the screens that report them.
-- ---------------------------------------------------------------------------

update public.departments
   set head_id = 'f0c05000-0000-4000-a000-000000000002'
 where id = 'f0c05100-0000-4000-a000-000000000001';

update public.departments
   set head_id = 'f0c05000-0000-4000-a000-000000000001'
 where id = 'f0c05100-0000-4000-a000-000000000003';

-- ---------------------------------------------------------------------------
-- Job titles (v167).
--
-- What each person is called, which the application role cannot say: it holds
-- three values chosen for permissions. The temporary tester is left without
-- one, for the same reason Operations has no head.
-- ---------------------------------------------------------------------------

update public.user_profiles set job_title = case id
    when 'f0c05000-0000-4000-a000-000000000001' then 'System Administrator'
    when 'f0c05000-0000-4000-a000-000000000002' then 'EHS Manager'
    when 'f0c05000-0000-4000-a000-000000000003' then 'EHS Executive'
    when 'f0c05000-0000-4000-a000-000000000004' then 'EHS Executive'
    when 'f0c05000-0000-4000-a000-000000000005' then 'Operations Executive'
    when 'f0c05000-0000-4000-a000-000000000006' then 'Operations Executive'
  end
 where id in (
   'f0c05000-0000-4000-a000-000000000001',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000004',
   'f0c05000-0000-4000-a000-000000000005',
   'f0c05000-0000-4000-a000-000000000006'
 );

-- ---------------------------------------------------------------------------
-- The approved visibility example (MASTER_PRODUCT_SPEC.md section 22.5 and
-- Appendix A9): Amer may VIEW Izzah and Ajmal because they are his interns.
--
-- Amer is a team member, not their manager, so this grant must give sight of
-- their work and nothing else — no editing, no activation, no reassignment, no
-- completion acceptance. `tests/rls/visibility.test.sql` asserts exactly that.
-- ---------------------------------------------------------------------------

select public.set_user_visibility(
  'f0c05000-0000-4000-a000-000000000003',
  'specific_only',
  array['f0c05000-0000-4000-a000-000000000004'::uuid,
        'f0c05000-0000-4000-a000-000000000005'::uuid],
  'Amer supervises Izzah and Ajmal as interns (approved example).'
);

-- Lim has no team visibility at all, which gives the denial tests a subject.
select public.set_user_visibility(
  'f0c05000-0000-4000-a000-000000000006', 'none', array[]::uuid[], 'Individual contributor.');

-- ---------------------------------------------------------------------------
-- Routine templates (section 16).
-- ---------------------------------------------------------------------------

/*
 * Started a few days ago, deliberately.
 *
 * The fixtures have to include a routine occurrence that is genuinely overdue,
 * because My Team surfaces one and a test opens it. Anchoring these to today
 * made that depend on the clock: the daily check falls due at 09:00 local, so
 * the whole thing passed in the afternoon and failed in the morning — the suite
 * reported a working feature as broken purely because of the hour it ran.
 * Backdating the start puts several occurrences in the past at any hour.
 */
insert into public.routine_templates (
  id, title, description, default_owner_id, frequency, interval_count, weekday, weekdays,
  monthly_mode, start_date, due_time, requires_completion_review, evidence_required, created_by
) values
  ('f0c05200-0000-4000-a000-000000000001',
   'Weekly workplace safety walk',
   'Structured walk of the production floor with a standard checklist.',
   'f0c05000-0000-4000-a000-000000000004', 'weekly', 1, 3, array[3]::smallint[],
   null, (current_date - 21), '16:00', true, true, 'f0c05000-0000-4000-a000-000000000002'),

  ('f0c05200-0000-4000-a000-000000000002',
   'Daily PPE stock check',
   'Confirm PPE stock levels at the issuing point.',
   'f0c05000-0000-4000-a000-000000000005', 'daily', 1, null, null,
   null, (current_date - 3), '09:00', false, false, 'f0c05000-0000-4000-a000-000000000002');

insert into public.routine_template_items (template_id, position, action, evidence_rule) values
  ('f0c05200-0000-4000-a000-000000000001', 0, 'Inspect emergency exits and signage', 'not_required'),
  ('f0c05200-0000-4000-a000-000000000001', 1, 'Check fire extinguisher inspection tags', 'required'),
  ('f0c05200-0000-4000-a000-000000000001', 2, 'Record any observations with photographs', 'required'),
  ('f0c05200-0000-4000-a000-000000000002', 0, 'Count helmets, gloves, and eye protection', 'not_required'),
  ('f0c05200-0000-4000-a000-000000000002', 1, 'Raise a finding if any line is below minimum', 'optional');

-- ---------------------------------------------------------------------------
-- Tasks.
--
-- Covers every work class and every normal state, plus the exception states My
-- Day is required to surface: overdue, stale, open barrier, missing evidence,
-- and a completion awaiting review.
--
-- Dates are relative to the reset time so the fixtures stay meaningful however
-- long after seeding the database is used.
-- ---------------------------------------------------------------------------

insert into public.tasks (
  id, title, description, next_action, status, work_class, focus_bucket, origin,
  urgency, primary_owner_id, created_by, due_at, due_is_date_only, review_at,
  progress_percent, is_mandatory, mandatory_justification,
  created_at, state_entered_at, last_meaningful_update_at, activated_at, activated_by,
  -- Supplied in the insert rather than a follow-up update: the
  -- `tasks_completed_at_consistent` constraint rejects a completed row that
  -- carries no completion timestamp, and it is checked per statement.
  completed_at
) values

-- Izzah: an active Major Project, within target.
('f0c05300-0000-4000-a000-000000000001',
 'Reduce recordable incidents by 30% this year against the 2025 baseline',
 'Programme covering training, near-miss reporting, and corrective actions.',
 'Draft the near-miss reporting briefing for line supervisors',
 'active', 'major_project', 'major', 'manager_assigned', 'high',
 'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000002',
 now() + interval '45 days', true, now() + interval '10 days',
 35, false, null,
 now() - interval '62 days', now() - interval '48 days', now() - interval '2 days',
 now() - interval '48 days', 'f0c05000-0000-4000-a000-000000000004', null),

-- Izzah: active operational action, OVERDUE and STALE. Drives the My Day
-- Needs Attention banner and the amber "No update" chip.
('f0c05300-0000-4000-a000-000000000002',
 'Close out corrective actions from the June audit',
 'Six findings remain open from the internal audit.',
 'Chase Operations for the machine guarding evidence',
 'active', 'operational_action', 'operational', 'finding_generated', 'high',
 'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000002',
 now() - interval '4 days', true, null,
 60, false, null,
 now() - interval '30 days', now() - interval '25 days', now() - interval '11 days',
 now() - interval '25 days', 'f0c05000-0000-4000-a000-000000000004', null),

-- Izzah: active operational action with an open barrier.
('f0c05300-0000-4000-a000-000000000003',
 'Install machine guarding on press line 2 before the October audit',
 'Guarding specified but the contractor has not confirmed a date.',
 'Escalate the contractor delay at the Monday meeting',
 'active', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000004',
 now() + interval '12 days', true, null,
 20, false, null,
 now() - interval '18 days', now() - interval '15 days', now() - interval '1 day',
 now() - interval '15 days', 'f0c05000-0000-4000-a000-000000000004', null),

-- Izzah: Available Work, ready to activate. Activating a fourth operational
-- action stays within the target of five.
('f0c05300-0000-4000-a000-000000000004',
 'Refresh the contractor induction pack for the new site access rules',
 'Content is two years old and references a withdrawn standard.',
 'Review the current induction slides',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000004',
 now() + interval '21 days', true, null,
 0, false, null,
 now() - interval '9 days', now() - interval '9 days', now() - interval '9 days',
 null, null, null),

-- Izzah: an active Self-Development Plan, at target.
('f0c05300-0000-4000-a000-000000000005',
 'NEBOSH General Certificate preparation and assessment booking',
 'Structured study plan ahead of the November sitting.',
 'Complete Unit IG1 element 4 revision questions',
 'active', 'self_development', 'self_development', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000004',
 now() + interval '80 days', true, now() + interval '30 days',
 45, false, null,
 now() - interval '70 days', now() - interval '70 days', now() - interval '5 days',
 now() - interval '70 days', 'f0c05000-0000-4000-a000-000000000004', null),

-- Amer: a Quick Action due today. Consumes no focus target.
('f0c05300-0000-4000-a000-000000000006',
 'Replace the torn warning label on tank 3 in the solvent store',
 null,
 'Print the replacement label',
 'active', 'quick_action', null, 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000003',
 date_trunc('day', now()) + interval '17 hours', false, null,
 0, false, null,
 now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours',
 now() - interval '3 hours', 'f0c05000-0000-4000-a000-000000000003', null),

-- Amer: a mandatory operational action. Section 4 allows this to activate above
-- target without the reason question.
('f0c05300-0000-4000-a000-000000000007',
 'Isolate and tag out the faulty conveyor drive on the packing line',
 'Reported burning smell during the morning shift.',
 'Confirm isolation with the shift electrician',
 'active', 'operational_action', 'operational', 'self_initiated', 'critical',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000003',
 date_trunc('day', now()) + interval '12 hours', false, null,
 50, true,
 'Active safety risk reported on the production line requiring immediate controlled action.',
 now() - interval '1 day', now() - interval '1 day', now() - interval '4 hours',
 now() - interval '1 day', 'f0c05000-0000-4000-a000-000000000003', null),

-- Amer: a shared task where Izzah contributes through a checklist handoff.
('f0c05300-0000-4000-a000-000000000008',
 'Run the Q3 emergency evacuation drill across both warehouse bays',
 'Coordinated drill across both production halls.',
 'Confirm the drill date with Operations',
 'active', 'operational_action', 'operational', 'manager_assigned', 'normal',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000002',
 now() + interval '16 days', true, null,
 25, false, null,
 now() - interval '20 days', now() - interval '14 days', now() - interval '3 days',
 now() - interval '14 days', 'f0c05000-0000-4000-a000-000000000003', null),

-- Ajmal: Available Work awaiting selection.
('f0c05300-0000-4000-a000-000000000009',
 'Update the chemical inventory register after the solvent store move',
 'New solvents were received in July and are not yet listed.',
 'Collect the July delivery notes',
 'backlog', 'operational_action', 'operational', 'manager_assigned', 'normal',
 'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000002',
 now() + interval '6 days', true, null,
 0, false, null,
 now() - interval '11 days', now() - interval '11 days', now() - interval '11 days',
 null, null, null),

-- Ajmal: paused work with restart information.
('f0c05300-0000-4000-a000-00000000000a',
 'Rewrite the confined space entry procedure for the new tank farm',
 'On hold until the revised standard is published.',
 'Recheck whether the standard has been issued',
 'paused', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000005',
 now() + interval '40 days', true, now() + interval '14 days',
 30, false, null,
 now() - interval '55 days', now() - interval '20 days', now() - interval '20 days',
 null, null, null),

-- Lim: completed work awaiting a review decision. Evidence exists but nobody
-- has decided yet, which is the state the Completion Review queue shows.
('f0c05300-0000-4000-a000-00000000000b',
 'Replace eyewash stations in the laboratory',
 'Three units replaced and commissioned.',
 null,
 'completed', 'operational_action', 'operational', 'manager_assigned', 'normal',
 'f0c05000-0000-4000-a000-000000000006', 'f0c05000-0000-4000-a000-000000000002',
 now() - interval '6 days', true, null,
 100, false, null,
 now() - interval '35 days', now() - interval '2 days', now() - interval '2 days',
 now() - interval '30 days', 'f0c05000-0000-4000-a000-000000000006', now() - interval '2 days');


-- v255: the backlog at something like the volume a real register carries.
--
-- Two backlog rows against the twenty-one in production meant the Waiting
-- view and the people table were read all through v233-v254 with almost
-- nothing in them, which is how a wrapping title and a dormant test both
-- survived. These eighteen are spread across Amer, Ajmal and Lim so that
-- every grouping the view draws has something in it: overdue, assigned and
-- untouched, due within the week, and the long tail that sits under Later.
--
-- Izzah is deliberately left out. She owns the active work that most of the
-- My Work specs read, and several of them take the first row they find.
insert into public.tasks (
  id, title, description, next_action, status, work_class, focus_bucket, origin,
  urgency, primary_owner_id, created_by, due_at, due_is_date_only, review_at,
  progress_percent, is_mandatory, mandatory_justification,
  created_at, state_entered_at, last_meaningful_update_at, activated_at, activated_by,
  completed_at
) values
('f0c05301-0000-4000-a000-000000000001',
 'Replace the damaged guard rail on the mezzanine walkway',
 'Rail was struck by a pallet and is no longer rated for edge protection.',
 'Get a fabrication quote for the replacement section',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000003',
 now() - interval '6 days', true, null,
 0, false, null,
 now() - interval '11 days', now() - interval '11 days', now() - interval '11 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000002',
 'Re-certify the overhead crane and both chain hoists in bay two',
 'Statutory inspection lapsed while the contractor changed hands.',
 'Confirm a date with the new inspection body',
 'backlog', 'operational_action', 'operational', 'manager_assigned', 'high',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000002',
 now() - interval '2 days', true, null,
 0, false, null,
 now() - interval '21 days', now() - interval '21 days', now() - interval '21 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000003',
 'Review the noise survey results for the compressor room',
 'Readings came back above the action level at two positions.',
 'Compare the readings against the 2024 survey',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000003',
 now() + interval '4 days', true, null,
 0, false, null,
 now() - interval '8 days', now() - interval '8 days', now() - interval '8 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000004',
 'Update the spill response plan for the new solvent store',
 'The plan still describes the old drum store layout.',
 'Walk the new store and mark the bund capacities',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000003',
 now() + interval '6 days', true, null,
 0, false, null,
 now() - interval '5 days', now() - interval '5 days', now() - interval '5 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000005',
 'Standardise the lockout padlock scheme across both production lines',
 'Two colour schemes are in use and neither is documented.',
 'List every padlock currently issued',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000003',
 null, true, null,
 0, false, null,
 now() - interval '4 days', now() - interval '4 days', now() - interval '4 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000006',
 'Refresh the first aid room stock list and expiry checks',
 'Several items expired before the last check was recorded.',
 'Agree a monthly check with the first aiders',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000003',
 now() + interval '30 days', true, null,
 0, false, null,
 now() - interval '3 days', now() - interval '3 days', now() - interval '3 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000007',
 'Close out the three minor findings from the forklift inspection',
 'All three are housekeeping items in the charging area.',
 'Clear the charging bay and photograph it',
 'backlog', 'operational_action', 'operational', 'manager_assigned', 'normal',
 'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000002',
 now() - interval '9 days', true, null,
 0, false, null,
 now() - interval '26 days', now() - interval '26 days', now() - interval '26 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000008',
 'Rewrite the hot work permit to cover roof work by contractors',
 'The current permit assumes work at ground level only.',
 'Draft the roof access section',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000005',
 now() + interval '3 days', true, null,
 0, false, null,
 now() - interval '12 days', now() - interval '12 days', now() - interval '12 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000009',
 'Survey the emergency lighting across the warehouse and offices',
 'Three fittings failed the last discharge test and were not retested.',
 'Mark the failed fittings on the floor plan',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000005',
 now() + interval '5 days', true, null,
 0, false, null,
 now() - interval '7 days', now() - interval '7 days', now() - interval '7 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000010',
 'Introduce a pre-use check sheet for the mobile elevating platform',
 'Operators currently sign the handover book with no checks recorded.',
 'Borrow the manufacturer check list as a starting point',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000005',
 null, true, null,
 0, false, null,
 now() - interval '6 days', now() - interval '6 days', now() - interval '6 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000011',
 'Translate the chemical handling toolbox talk into Bahasa Malaysia',
 'Half the team read the English version with difficulty.',
 'Send the current talk for translation',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000005',
 now() + interval '24 days', true, null,
 0, false, null,
 now() - interval '5 days', now() - interval '5 days', now() - interval '5 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000012',
 'Agree a quarterly review of the contractor approval list',
 'Nobody owns the list and two approvals have lapsed.',
 'Propose the review at the next EHS meeting',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000005',
 null, true, null,
 0, false, null,
 now() - interval '2 days', now() - interval '2 days', now() - interval '2 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000013',
 'Replace the faded eyewash signage in the plating area',
 'Existing signs are faded and hard to see with the lights off.',
 'Measure the sign positions for the order',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000006', 'f0c05000-0000-4000-a000-000000000006',
 now() + interval '2 days', true, null,
 0, false, null,
 now() - interval '9 days', now() - interval '9 days', now() - interval '9 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000014',
 'Record the ventilation airflow readings for the welding booths',
 'Readings have not been logged since the extraction was serviced.',
 'Book the anemometer out for a morning',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000006', 'f0c05000-0000-4000-a000-000000000006',
 now() + interval '7 days', true, null,
 0, false, null,
 now() - interval '10 days', now() - interval '10 days', now() - interval '10 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000015',
 'Tidy the gas cylinder compound and separate the oxidisers',
 'Full and empty cylinders are stored together against the fence.',
 'Mark out separate bays with the floor paint',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000006', 'f0c05000-0000-4000-a000-000000000006',
 null, true, null,
 0, false, null,
 now() - interval '7 days', now() - interval '7 days', now() - interval '7 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000016',
 'Write a safe working procedure for the new shrink wrap machine',
 'The machine arrived with a manual but no site procedure.',
 'Watch a full cycle and note the trapping points',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000006', 'f0c05000-0000-4000-a000-000000000006',
 null, true, null,
 0, false, null,
 now() - interval '6 days', now() - interval '6 days', now() - interval '6 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000017',
 'Audit the ladder register and remove anything unserviceable',
 'The register lists fourteen ladders and nine can be found.',
 'Walk the site and tag what is actually there',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000006', 'f0c05000-0000-4000-a000-000000000006',
 now() + interval '18 days', true, null,
 0, false, null,
 now() - interval '4 days', now() - interval '4 days', now() - interval '4 days',
 null, null, null),

('f0c05301-0000-4000-a000-000000000018',
 'Collect the missing training records for the three new starters',
 'Induction was completed but the records were never filed.',
 'Ask the supervisors for the signed induction sheets',
 'backlog', 'operational_action', 'operational', 'self_initiated', 'normal',
 'f0c05000-0000-4000-a000-000000000006', 'f0c05000-0000-4000-a000-000000000006',
 null, true, null,
 0, false, null,
 now() - interval '3 days', now() - interval '3 days', now() - interval '3 days',
 null, null, null);

-- Purpose set by id, not by title: a rename has left the title-matched
-- updates further down this file stale before.
update public.tasks
   set work_purpose = 'improvement_development'
 where id in ('f0c05301-0000-4000-a000-000000000005','f0c05301-0000-4000-a000-000000000008','f0c05301-0000-4000-a000-000000000010','f0c05301-0000-4000-a000-000000000011');

update public.tasks
   set work_purpose = 'planned_operations'
 where id in ('f0c05301-0000-4000-a000-000000000002','f0c05301-0000-4000-a000-000000000003','f0c05301-0000-4000-a000-000000000004','f0c05301-0000-4000-a000-000000000006','f0c05301-0000-4000-a000-000000000009','f0c05301-0000-4000-a000-000000000012','f0c05301-0000-4000-a000-000000000013','f0c05301-0000-4000-a000-000000000014','f0c05301-0000-4000-a000-000000000015','f0c05301-0000-4000-a000-000000000016','f0c05301-0000-4000-a000-000000000017','f0c05301-0000-4000-a000-000000000018');

update public.tasks
   set work_purpose = 'reactive'
 where id in ('f0c05301-0000-4000-a000-000000000001','f0c05301-0000-4000-a000-000000000007');

-- Review metadata, not a state (section 20.2). `completed_at` is already set by
-- the insert above, so it is deliberately not repeated here.
update public.tasks
   set review_status = 'pending',
       reviewer_id = 'f0c05000-0000-4000-a000-000000000002'
 where id = 'f0c05300-0000-4000-a000-00000000000b';

update public.tasks
   set paused_reason = 'Waiting for the revised confined space standard to be published.',
       paused_restart_at = now() + interval '14 days'
 where id = 'f0c05300-0000-4000-a000-00000000000a';

-- ---------------------------------------------------------------------------
-- Collaboration and the checklist handoff (section 13.3).
--
-- Amer owns the drill. Izzah's briefing step depends on his room-booking step,
-- so it starts Waiting and becomes Ready the moment he completes his.
-- ---------------------------------------------------------------------------

insert into public.task_collaborators (task_id, user_id, added_by) values
  ('f0c05300-0000-4000-a000-000000000008',
   'f0c05000-0000-4000-a000-000000000004',
   'f0c05000-0000-4000-a000-000000000003');

insert into public.task_checklist_items (
  id, task_id, position, action, assigned_to, evidence_rule, state, completed_by, completed_at
) values
  ('f0c05400-0000-4000-a000-000000000001', 'f0c05300-0000-4000-a000-000000000008', 0,
   'Agree the drill date with Operations', 'f0c05000-0000-4000-a000-000000000003',
   'not_required', 'completed', 'f0c05000-0000-4000-a000-000000000003', now() - interval '3 days'),

  ('f0c05400-0000-4000-a000-000000000002', 'f0c05300-0000-4000-a000-000000000008', 1,
   'Book the assembly point and marshals', 'f0c05000-0000-4000-a000-000000000003',
   'not_required', 'ready', null, null),

  ('f0c05400-0000-4000-a000-000000000003', 'f0c05300-0000-4000-a000-000000000008', 2,
   'Deliver the pre-drill briefing to line supervisors',
   'f0c05000-0000-4000-a000-000000000004', 'required', 'ready', null, null),

  ('f0c05400-0000-4000-a000-000000000004', 'f0c05300-0000-4000-a000-000000000008', 3,
   'Record evacuation times and write up findings',
   'f0c05000-0000-4000-a000-000000000003', 'required', 'ready', null, null);

-- Applied after insert so the default-state trigger does not pre-empt it: the
-- briefing waits on the booking step.
update public.task_checklist_items
   set depends_on_item_id = 'f0c05400-0000-4000-a000-000000000002', state = 'waiting'
 where id = 'f0c05400-0000-4000-a000-000000000003';

update public.task_checklist_items
   set depends_on_item_id = 'f0c05400-0000-4000-a000-000000000003', state = 'waiting'
 where id = 'f0c05400-0000-4000-a000-000000000004';

-- Checklist with outstanding required evidence, so the completion block and the
-- "missing mandatory evidence" exception are both reachable.
insert into public.task_checklist_items (task_id, position, action, evidence_rule, state) values
  ('f0c05300-0000-4000-a000-000000000002', 0, 'Obtain machine guarding sign-off', 'required', 'ready'),
  ('f0c05300-0000-4000-a000-000000000002', 1, 'Confirm training records updated', 'optional', 'ready'),
  ('f0c05300-0000-4000-a000-000000000002', 2, 'Close the audit finding in the register', 'not_required', 'ready');

insert into public.task_checklist_items (
  task_id, position, action, evidence_rule, state, completed_by, completed_at
) values
  ('f0c05300-0000-4000-a000-000000000001', 0, 'Publish the near-miss reporting standard',
   'not_required', 'completed', 'f0c05000-0000-4000-a000-000000000004', now() - interval '20 days'),
  ('f0c05300-0000-4000-a000-000000000001', 1, 'Train all line supervisors',
   'required', 'ready', null, null),
  ('f0c05300-0000-4000-a000-000000000001', 2, 'Review quarterly incident trend',
   'not_required', 'ready', null, null);

-- ---------------------------------------------------------------------------
-- An open barrier (section 14), on Izzah's guarding task.
-- ---------------------------------------------------------------------------

insert into public.barriers (
  id, task_id, description, support_needed, impact, add_to_meeting_queue, raised_by, raised_at
) values (
  'f0c05500-0000-4000-a000-000000000001',
  'f0c05300-0000-4000-a000-000000000003',
  'The guarding contractor has not confirmed an installation date after three requests.',
  'A decision on whether to appoint the alternative contractor.',
  'may_delay', true,
  'f0c05000-0000-4000-a000-000000000004',
  now() - interval '5 days'
);

insert into public.meeting_queue_items (task_id, barrier_id, source, summary) values (
  'f0c05300-0000-4000-a000-000000000003',
  'f0c05500-0000-4000-a000-000000000001',
  'barrier',
  'Install machine guarding on press line 2 — contractor has not confirmed a date.'
);

-- ---------------------------------------------------------------------------
-- Updates (section 12).
-- ---------------------------------------------------------------------------

insert into public.task_updates (task_id, author_id, body, created_at) values
  ('f0c05300-0000-4000-a000-000000000001', 'f0c05000-0000-4000-a000-000000000004',
   'Standard published and circulated. Supervisor training is the remaining gap; scheduling starts next week.',
   now() - interval '2 days'),
  ('f0c05300-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000004',
   'Third follow-up sent to the contractor. Raising a barrier so this can be decided at the Monday meeting.',
   now() - interval '5 days'),
  ('f0c05300-0000-4000-a000-000000000008', 'f0c05000-0000-4000-a000-000000000003',
   'Date agreed with Operations. Assembly point booking is next.',
   now() - interval '3 days');

-- ---------------------------------------------------------------------------
-- A completion review awaiting a decision (section 20.5).
-- ---------------------------------------------------------------------------

insert into public.completion_reviews (task_id, submitted_by, reviewer_id, submitted_at) values (
  'f0c05300-0000-4000-a000-00000000000b',
  'f0c05000-0000-4000-a000-000000000006',
  'f0c05000-0000-4000-a000-000000000002',
  now() - interval '2 days'
);

-- ---------------------------------------------------------------------------
-- Routine occurrences.
--
-- Generated through the real procedure so the fixtures match exactly what the
-- scheduler produces, including the copied checklist steps.
-- ---------------------------------------------------------------------------

select public.generate_routine_occurrences((current_date + 14)::date);

-- ---------------------------------------------------------------------------
-- A Major Project proposal awaiting a manager decision (section 8.8).
-- ---------------------------------------------------------------------------

insert into public.work_proposals (kind, title, rationale, proposed_by, payload) values (
  'major_project',
  'Introduce a permit-to-work system across both sites',
  'Contractor control is inconsistent between sites and audit findings keep recurring.',
  'f0c05000-0000-4000-a000-000000000003',
  '{"estimated_months": 6}'::jsonb
);

-- ---------------------------------------------------------------------------
-- How far out a seeded Goal is aimed.
--
-- A Goal is set a few months ahead so the fixtures read as work in progress.
-- Written as a bare `current_date + 120` the target walks out of the current
-- performance period every autumn: from 3 September the date lands in January,
-- the plan bootstrap therefore gives that employee no plan for THIS year, and
-- `tests/integration/execution-goal-v53.test.ts` fails with "Cannot coerce the
-- result to a single JSON object". A calendar failure that reads exactly like
-- a code failure, months after the code was last touched.
--
-- So each offset is kept and clamped to 31 December, which is what a
-- performance period runs to. The clamp has to be applied at INSERT: the
-- trigger that derives `performance_period_id` only fills a null, and the one
-- that creates the employee's plan is AFTER INSERT only -- so correcting a
-- target date afterwards would leave the Goal in the wrong period with no plan
-- at all, which is the bug this avoids rather than a fix for it.
--
-- Late in the year the offsets therefore bunch on 31 December. That is what an
-- annual Goal looks like in December, so it costs the fixtures nothing: the
-- weights, health and progress that the screens actually read still differ.
--
-- Repeated inline rather than wrapped in a helper, for the same reason the
-- account loop above is a DO block: `supabase db reset` pipelines this file as
-- a batch, so there is no temporary schema for a `pg_temp` function to live in.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Goals v33 fixtures.
--
-- Safety Digitalisation is the approved representative Goal from the v33
-- product package. It is ordinary relational fixture data: application code
-- never branches on its identifier or title. The reported 20% deliberately
-- differs from the milestone-derived 19% so both progress concepts remain
-- visible and independently testable.
-- ---------------------------------------------------------------------------

insert into public.goals (
  id, owner_id, manager_id, created_by, title, category, status, health,
  reported_progress, target_date, weight_percent, checkin_due_at,
  last_meaningful_update_at, active_version_id, agreed_at, version, created_at
) values
  ('f0c06000-0000-4000-a000-000000000001',
   'f0c05000-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002',
   'Safety Digitalisation', 'improvement', 'active', 'support_requested',
   20, least(current_date + 150, make_date(extract(year from current_date)::integer, 12, 31)), 10, now() - interval '1 day',
   now() - interval '21 days', null, now() - interval '90 days', 1,
   now() - interval '100 days'),

  ('f0c06000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000004',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002',
   'Strengthen frontline safety coaching', 'development', 'active', 'on_track',
   25, least(current_date + 120, make_date(extract(year from current_date)::integer, 12, 31)), 25, now() + interval '14 days',
   now() - interval '4 days', null, now() - interval '70 days', 1,
   now() - interval '75 days');

insert into public.goal_versions (
  id, goal_id, version_number, status, title, expected_result, success_measure,
  employee_approach, support_agreed, dependencies, baseline, purpose,
  target_date, weight_percent, proposed_by, proposed_at, activated_at
) values
  ('f0c06100-0000-4000-a000-000000000001',
   'f0c06000-0000-4000-a000-000000000001', 1, 'active',
   'Safety Digitalisation',
   'Use a practical digital or AI solution to remove recurring manual safety coordination work.',
   'A working prototype is tested with users and its results, lessons and next actions are recorded.',
   'Start from repeated coordination pain points, prototype the smallest useful workflow, and test it with the people doing the work.',
   'Fortnightly coaching, access to users, and a decision on an approved pilot tool.',
   'Availability of Operations users and access to non-sensitive example data.',
   'Recurring observations, reminders, and follow-ups are currently tracked across spreadsheets and messages.',
   'Reduce avoidable administration so safety time is spent on prevention and coaching.',
   least(current_date + 150, make_date(extract(year from current_date)::integer, 12, 31)), 10,
   'f0c05000-0000-4000-a000-000000000002', now() - interval '100 days',
   now() - interval '90 days'),

  ('f0c06100-0000-4000-a000-000000000002',
   'f0c06000-0000-4000-a000-000000000002', 1, 'active',
   'Strengthen frontline safety coaching',
   'Establish a repeatable coaching rhythm with line supervisors.',
   'Each supervisor receives two observed coaching sessions and can run the conversation without assistance.',
   'Use real walk findings as short practice scenarios and reflect after each session.',
   'Protected time with supervisors and feedback after observed sessions.',
   'Shift coverage during the scheduled sessions.',
   'Coaching currently happens informally and is not consistent between shifts.',
   'Build confident frontline ownership of everyday safety conversations.',
   least(current_date + 120, make_date(extract(year from current_date)::integer, 12, 31)), 25,
   'f0c05000-0000-4000-a000-000000000002', now() - interval '75 days',
   now() - interval '70 days');

update public.goals
   set active_version_id = case id
     when 'f0c06000-0000-4000-a000-000000000001' then 'f0c06100-0000-4000-a000-000000000001'::uuid
     when 'f0c06000-0000-4000-a000-000000000002' then 'f0c06100-0000-4000-a000-000000000002'::uuid
   end
 where id in (
   'f0c06000-0000-4000-a000-000000000001',
   'f0c06000-0000-4000-a000-000000000002'
 );

insert into public.goal_participants (goal_id, user_id, participant_role, added_by) values
  ('f0c06000-0000-4000-a000-000000000001', 'f0c05000-0000-4000-a000-000000000003', 'employee', 'f0c05000-0000-4000-a000-000000000002'),
  ('f0c06000-0000-4000-a000-000000000001', 'f0c05000-0000-4000-a000-000000000002', 'manager', 'f0c05000-0000-4000-a000-000000000002'),
  ('f0c06000-0000-4000-a000-000000000002', 'f0c05000-0000-4000-a000-000000000004', 'employee', 'f0c05000-0000-4000-a000-000000000002'),
  ('f0c06000-0000-4000-a000-000000000002', 'f0c05000-0000-4000-a000-000000000002', 'manager', 'f0c05000-0000-4000-a000-000000000002');

insert into public.goal_milestones (
  id, goal_version_id, position, title, completion_definition,
  weight_percent, progress_percent, last_update_at
) values
  ('f0c06200-0000-4000-a000-000000000001', 'f0c06100-0000-4000-a000-000000000001', 1,
   'Identify recurring operational issues that could be solved digitally',
   'A prioritised problem statement is agreed with the people who perform the work.',
   20, 60, now() - interval '35 days'),
  ('f0c06200-0000-4000-a000-000000000002', 'f0c06100-0000-4000-a000-000000000001', 2,
   'Select a suitable digital or AI tool',
   'A tool is selected against data, access, usability, and support constraints.',
   20, 25, now() - interval '21 days'),
  ('f0c06200-0000-4000-a000-000000000003', 'f0c06100-0000-4000-a000-000000000001', 3,
   'Develop a working prototype',
   'The smallest end-to-end workflow can be demonstrated using non-sensitive data.',
   20, 10, now() - interval '21 days'),
  ('f0c06200-0000-4000-a000-000000000004', 'f0c06100-0000-4000-a000-000000000001', 4,
   'Test the solution with users',
   'At least three intended users complete the core workflow and their feedback is recorded.',
   20, 0, now() - interval '90 days'),
  ('f0c06200-0000-4000-a000-000000000005', 'f0c06100-0000-4000-a000-000000000001', 5,
   'Record results, lessons learned, and next actions',
   'The outcome, lessons, ownership, and recommendation are documented and discussed.',
   20, 0, now() - interval '90 days'),

  ('f0c06200-0000-4000-a000-000000000006', 'f0c06100-0000-4000-a000-000000000002', 1,
   'Agree the coaching standard',
   'The expected coaching behaviours and observation form are agreed.',
   40, 40, now() - interval '9 days'),
  ('f0c06200-0000-4000-a000-000000000007', 'f0c06100-0000-4000-a000-000000000002', 2,
   'Run observed coaching sessions',
   'Every line supervisor completes two observed sessions.',
   35, 20, now() - interval '4 days'),
  ('f0c06200-0000-4000-a000-000000000008', 'f0c06100-0000-4000-a000-000000000002', 3,
   'Review confidence and consistency',
   'A follow-up review confirms the coaching rhythm can continue without project support.',
   25, 0, now() - interval '70 days');

insert into public.goal_agreements (
  id, goal_id, goal_version_id, employee_id, manager_id, agreed_by, agreed_at, detail
) values
  ('f0c06300-0000-4000-a000-000000000001',
   'f0c06000-0000-4000-a000-000000000001',
   'f0c06100-0000-4000-a000-000000000001',
   'f0c05000-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002', now() - interval '90 days',
   '{"mode":"manager_employee_discussion"}'::jsonb),
  ('f0c06300-0000-4000-a000-000000000002',
   'f0c06000-0000-4000-a000-000000000002',
   'f0c06100-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000004',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002', now() - interval '70 days',
   '{"mode":"manager_employee_discussion"}'::jsonb);

insert into public.goal_updates (
  id, goal_id, goal_version_id, author_id, previous_reported_progress,
  new_reported_progress, what_changed, next_step, support_requested,
  support_details, created_at
) values
  ('f0c06400-0000-4000-a000-000000000001',
   'f0c06000-0000-4000-a000-000000000001',
   'f0c06100-0000-4000-a000-000000000001',
   'f0c05000-0000-4000-a000-000000000003', 15, 20,
   'Compared two suitable tools and built the first prototype flow with sample inspection data.',
   'Confirm which platform can be used for the user pilot.', true,
   'Please confirm the approved pilot platform and arrange access to three Operations users.',
   now() - interval '21 days'),
  ('f0c06400-0000-4000-a000-000000000002',
   'f0c06000-0000-4000-a000-000000000002',
   'f0c06100-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000004', 20, 25,
   'Completed the first observed session and incorporated feedback into the prompt card.',
   'Schedule the remaining supervisors across both shifts.', false, null,
   now() - interval '4 days');

insert into public.goal_support_requests (
  id, goal_id, goal_update_id, requested_by, manager_id, details, status, created_at
) values (
  'f0c06500-0000-4000-a000-000000000001',
  'f0c06000-0000-4000-a000-000000000001',
  'f0c06400-0000-4000-a000-000000000001',
  'f0c05000-0000-4000-a000-000000000003',
  'f0c05000-0000-4000-a000-000000000002',
  'Please confirm the approved pilot platform and arrange access to three Operations users.',
  'open', now() - interval '21 days'
);

insert into public.goal_work_links (
  id, goal_id, milestone_id, task_id, linked_by, created_at
) values (
  'f0c06600-0000-4000-a000-000000000001',
  'f0c06000-0000-4000-a000-000000000001',
  'f0c06200-0000-4000-a000-000000000004',
  'f0c05300-0000-4000-a000-000000000008',
  'f0c05000-0000-4000-a000-000000000003', now() - interval '12 days'
);

commit;

-- ---------------------------------------------------------------------------
-- Reminder for anyone reading a database dump: this content is fixtures.
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'TAMCO Focus local fixtures loaded. LOCAL DEVELOPMENT AND TEST DATA ONLY.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Two further agreed goals for Amer, taken from the approved prototype's
-- sample set (`desktop/index.html`, goals `goal-br2` and `goal-field`).
--
-- The prototype ships a fuller goal picture than a single 10% goal, and the
-- formal-weight rule is only legible when a person carries several: 10 + 30 +
-- 25 leaves 35% of the formal Active set available, which is exactly what the
-- weight banner exists to communicate. The wording, milestones and weights are
-- the Product Owner's, transposed into the relational shape this build uses.
-- ---------------------------------------------------------------------------

insert into public.goals (
  id, owner_id, manager_id, created_by, title, category, status, health,
  reported_progress, target_date, weight_percent, checkin_due_at,
  last_meaningful_update_at, active_version_id, agreed_at, version, created_at
) values
  ('f0c06000-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002',
   'BR2 Warehouse ESH Readiness and Stabilisation', 'performance', 'active', 'on_track',
   55, least(current_date + 115, make_date(extract(year from current_date)::integer, 12, 31)), 30, now() + interval '5 days',
   now() - interval '8 days', null, now() - interval '204 days', 1,
   now() - interval '210 days'),

  ('f0c06000-0000-4000-a000-000000000004',
   'f0c05000-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002',
   'Field Service Safety Assurance', 'performance', 'active', 'on_track',
   40, least(current_date + 146, make_date(extract(year from current_date)::integer, 12, 31)), 25, now() + interval '24 days',
   now() - interval '5 days', null, now() - interval '204 days', 1,
   now() - interval '210 days');

insert into public.goal_versions (
  id, goal_id, version_number, status, title, expected_result, success_measure,
  employee_approach, support_agreed, dependencies, baseline, purpose,
  target_date, weight_percent, proposed_by, proposed_at, activated_at
) values
  ('f0c06100-0000-4000-a000-000000000003',
   'f0c06000-0000-4000-a000-000000000003', 1, 'active',
   'BR2 Warehouse ESH Readiness and Stabilisation',
   'Complete ESH readiness, operational handover and initial safety stabilisation of the Bukit Raja 2 warehouse before full operation.',
   'Core ESH controls approved, OSHWA score at least 90%, and no overdue critical action.',
   'Complete the readiness review with Warehouse, close documentation gaps and verify controls through cross-audit.',
   'Warehouse cooperation, Engineering input and timely approval of corrective actions.',
   'Warehouse cooperation and Engineering availability during the handover window.',
   'Warehouse controls and operating arrangements are still being established.',
   'A safe and controlled warehouse start-up prevents unmanaged traffic, racking, emergency and operational risks.',
   least(current_date + 115, make_date(extract(year from current_date)::integer, 12, 31)), 30,
   'f0c05000-0000-4000-a000-000000000002', now() - interval '210 days',
   now() - interval '204 days'),

  ('f0c06100-0000-4000-a000-000000000004',
   'f0c06000-0000-4000-a000-000000000004', 1, 'active',
   'Field Service Safety Assurance',
   'Establish and maintain a risk-based safety-assurance programme for formally notified field-service activities, prioritising critical and high-risk work.',
   'All formally notified critical jobs reviewed, weekly risk-based verification when work is available, monthly reporting, and at least 80% site compliance.',
   'Maintain a field-service register, prioritise flashover-risk jobs, conduct weekly verification when notified work is available and issue a consolidated monthly report.',
   'Timely notification from Projects and Field Service, and support closing cross-department findings.',
   'Access to customer requirements and advance notification of mobilisation dates.',
   'Reviews and site verification are conducted, but coverage and reporting are not yet consistent.',
   'Field-service work changes by site and requires consistent pre-mobilisation review, verification and follow-through.',
   least(current_date + 146, make_date(extract(year from current_date)::integer, 12, 31)), 25,
   'f0c05000-0000-4000-a000-000000000002', now() - interval '210 days',
   now() - interval '204 days');

update public.goals
   set active_version_id = case id
     when 'f0c06000-0000-4000-a000-000000000003' then 'f0c06100-0000-4000-a000-000000000003'::uuid
     when 'f0c06000-0000-4000-a000-000000000004' then 'f0c06100-0000-4000-a000-000000000004'::uuid
   end
 where id in (
   'f0c06000-0000-4000-a000-000000000003',
   'f0c06000-0000-4000-a000-000000000004'
 );

insert into public.goal_participants (goal_id, user_id, participant_role, added_by) values
  ('f0c06000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000003', 'employee', 'f0c05000-0000-4000-a000-000000000002'),
  ('f0c06000-0000-4000-a000-000000000003', 'f0c05000-0000-4000-a000-000000000002', 'manager', 'f0c05000-0000-4000-a000-000000000002'),
  ('f0c06000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000003', 'employee', 'f0c05000-0000-4000-a000-000000000002'),
  ('f0c06000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000002', 'manager', 'f0c05000-0000-4000-a000-000000000002');

-- Milestone weights are equal because weighting belongs to the goal, not to its
-- milestones. The column is retained for history and is never read.
insert into public.goal_milestones (
  id, goal_version_id, position, title, completion_definition,
  weight_percent, progress_percent, completed_by, completed_at, last_update_at
) values
  -- A milestone at 100% must record who completed it and when.
  ('f0c06200-0000-4000-a000-000000000009', 'f0c06100-0000-4000-a000-000000000003', 1,
   'ESH readiness assessment completed',
   'The readiness assessment is complete and signed off with Warehouse.',
   25, 100, 'f0c05000-0000-4000-a000-000000000003', now() - interval '60 days',
   now() - interval '60 days'),
  ('f0c06200-0000-4000-a000-000000000010', 'f0c06100-0000-4000-a000-000000000003', 2,
   'Core controls and documents approved',
   'HIRARC, traffic plan, emergency arrangements, racking controls, procedures and signage are approved.',
   25, 65, null, null, now() - interval '8 days'),
  ('f0c06200-0000-4000-a000-000000000011', 'f0c06100-0000-4000-a000-000000000003', 3,
   'Readiness verification achieved',
   'A cross-audit confirms an OSHWA score of at least 90% with no overdue critical action.',
   25, 30, null, null, now() - interval '25 days'),
  ('f0c06200-0000-4000-a000-000000000012', 'f0c06100-0000-4000-a000-000000000003', 4,
   'Initial stabilisation maintained',
   'Monthly inspection and follow-through are sustained through the first operating quarter.',
   25, 20, null, null, now() - interval '30 days'),

  ('f0c06200-0000-4000-a000-000000000013', 'f0c06100-0000-4000-a000-000000000004', 1,
   'Critical-job pre-mobilisation review',
   'Every formally notified critical or flashover-risk job is reviewed before mobilisation.',
   25, 55, null, null, now() - interval '5 days'),
  ('f0c06200-0000-4000-a000-000000000014', 'f0c06100-0000-4000-a000-000000000004', 2,
   'Risk-based site verification',
   'At least one site verification is completed per week in which notified work is available.',
   25, 45, null, null, now() - interval '12 days'),
  ('f0c06200-0000-4000-a000-000000000015', 'f0c06100-0000-4000-a000-000000000004', 3,
   'Monthly assurance reporting',
   'A consolidated field-service assurance report is issued each month.',
   25, 50, null, null, now() - interval '9 days'),
  ('f0c06200-0000-4000-a000-000000000016', 'f0c06100-0000-4000-a000-000000000004', 4,
   'Compliance and closure performance',
   'Site compliance reaches at least 80% and cross-department findings are closed.',
   25, 20, null, null, now() - interval '20 days');

insert into public.goal_agreements (
  id, goal_id, goal_version_id, employee_id, manager_id, agreed_by, agreed_at, detail
) values
  ('f0c06300-0000-4000-a000-000000000003',
   'f0c06000-0000-4000-a000-000000000003',
   'f0c06100-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002', now() - interval '204 days',
   '{"mode":"manager_employee_discussion"}'::jsonb),
  ('f0c06300-0000-4000-a000-000000000004',
   'f0c06000-0000-4000-a000-000000000004',
   'f0c06100-0000-4000-a000-000000000004',
   'f0c05000-0000-4000-a000-000000000003',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002', now() - interval '204 days',
   '{"mode":"manager_employee_discussion"}'::jsonb);
-- Clean resets load fixtures after migrations, so mirror the migration-time
-- compatibility backfill for legacy narrative Goal measures.
insert into public.goal_success_measures (
  goal_version_id, position, label, measure_type, target_text, current_state
)
select v.id, 1, v.success_measure, 'qualitative', v.success_measure, 'not_started'
from public.goal_versions v
where to_regclass('public.goal_success_measures') is not null
  and not exists (
    select 1 from public.goal_success_measures m where m.goal_version_id = v.id
  );

-- ---------------------------------------------------------------------------
-- v145 §11 — why each piece of fixture work exists.
--
-- Clean resets load fixtures AFTER migrations, so the backfill in
-- `20260909003000_v145_work_purpose.sql` has already run against an empty
-- table and cannot reach these rows. The two rules it applies are mirrored
-- here, then a handful of tasks are classified by what they actually are.
--
-- Four rows are deliberately left with no purpose. Everything that reads a
-- purpose has to say something sensible when there is none — the row falls
-- back to the work class, the drawer offers the choice — and a fixture where
-- every task is classified would let that path rot untested.
-- ---------------------------------------------------------------------------

update public.routine_templates
   set work_purpose = 'planned_operations'
 where work_purpose is null;

update public.tasks
   set work_purpose = 'planned_operations'
 where work_purpose is null
   and work_class = 'routine_occurrence';

update public.tasks
   set work_purpose = 'improvement_development'
 where work_purpose is null
   and focus_bucket = 'self_development';

-- Something broke or went wrong, and this is the response to it.
update public.tasks
   set work_purpose = 'reactive'
 where work_purpose is null
   and title in (
     'Isolate and tag out the faulty conveyor drive on the packing line',
     'Replace the torn warning label on tank 3 in the solvent store',
     'Close out corrective actions from the June audit'
   );

-- A responsibility that runs anyway: scheduled, required, recurring.
update public.tasks
   set work_purpose = 'planned_operations'
 where work_purpose is null
   and title in (
     'Run the Q3 emergency evacuation drill across both warehouse bays',
     'Update the chemical inventory register after the solvent store move',
     'Refresh the contractor induction pack for the new site access rules'
   );

-- Making something better than it was.
update public.tasks
   set work_purpose = 'improvement_development'
 where work_purpose is null
   and title in (
     'Reduce recordable incidents by 30% this year against the 2025 baseline',
     'Install machine guarding on press line 2 before the October audit',
     'Rewrite the confined space entry procedure for the new tank farm'
   );

-- ---------------------------------------------------------------------------
-- v146 §10 — who assigned each shared step in the fixtures.
--
-- The trigger records the acting user, and seeding acts as nobody, so these
-- rows would otherwise carry no assigner and the Shared list would never show
-- the line §10 asks for. The task's creator is the truthful answer here: in
-- this fixture they are the person who set the work up and aimed its steps.
-- ---------------------------------------------------------------------------

update public.task_checklist_items item
   set assigned_by = parent.created_by,
       assigned_at = parent.created_at
  from public.tasks parent
 where parent.id = item.task_id
   and item.assigned_by is null
   and item.assigned_to is not null
   and item.assigned_to <> parent.primary_owner_id;

-- ---------------------------------------------------------------------------
-- v149 §14 — where each routine is recorded, and when it may be signed off.
--
-- Clean resets load fixtures after migrations, so the backfill in
-- `20260909008000_v149_occurrence_snapshot.sql` has already run against an
-- empty table. Setting the templates here and re-running the same inheritance
-- gives the local build a fixture that actually shows the area on a repeated
-- title, which is what §6 asks for.
--
-- The safety walk covers a named hall; the PPE check is at one issuing point
-- and naming it would be noise, so it is left null on purpose — every screen
-- that prints an area has to read well without one.
-- ---------------------------------------------------------------------------

update public.routine_templates
   set area = 'Production Hall A'
 where title = 'Weekly workplace safety walk';

update public.tasks t
   set routine_area = coalesce(t.routine_area, rt.area),
       completion_evidence_rule =
         case when rt.evidence_required then 'file' else 'optional' end,
       completion_evidence_instruction =
         coalesce(t.completion_evidence_instruction, rt.evidence_instruction),
       routine_completion_opens_on =
         coalesce(t.routine_completion_opens_on,
                  t.occurrence_date - coalesce(rt.completion_opens_days_before, 0))
  from public.routine_templates rt
 where rt.id = t.routine_template_id
   and t.work_class = 'routine_occurrence';

-- ---------------------------------------------------------------------------
-- v197 — ESH Finding Management, local stand-in for the rollout identity.
--
-- Production's first setup resolves izzul.asyraf@tamco.com.my, which no local
-- account uses, so a clean local reset leaves the module restricted to nobody.
-- Local work needs somebody inside it: Izzul's local account is enabled here as
-- a Verifier across every department. Everybody else stays Off, exactly as the
-- rollout starts, and tests enable whoever they need through the same
-- administrator procedure the screen uses.
-- ---------------------------------------------------------------------------

insert into public.esh_staff_access
  (organization_id, user_id, enabled, preset, scope_all_departments, enabled_at)
values
  ('e5e50000-0000-4000-8000-000000000001', 'f0c05000-0000-4000-a000-000000000002',
   true, 'verifier', true, now())
on conflict (organization_id, user_id) do nothing;

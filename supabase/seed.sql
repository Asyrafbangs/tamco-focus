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

insert into public.routine_templates (
  id, title, description, default_owner_id, frequency, interval_count, weekday,
  due_time, requires_completion_review, evidence_required, created_by
) values
  ('f0c05200-0000-4000-a000-000000000001',
   'Weekly workplace safety walk',
   'Structured walk of the production floor with a standard checklist.',
   'f0c05000-0000-4000-a000-000000000004', 'weekly', 1, 3,
   '16:00', true, true, 'f0c05000-0000-4000-a000-000000000002'),

  ('f0c05200-0000-4000-a000-000000000002',
   'Daily PPE stock check',
   'Confirm PPE stock levels at the issuing point.',
   'f0c05000-0000-4000-a000-000000000005', 'daily', 1, null,
   '09:00', false, false, 'f0c05000-0000-4000-a000-000000000002');

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
 'Reduce recordable incidents by 30% this year',
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
 'Install machine guarding on press line 2',
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
 'Refresh the contractor induction pack',
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
 'NEBOSH General Certificate preparation',
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
 'Replace the torn warning label on tank 3',
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
 'Isolate and tag out the faulty conveyor drive',
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
 'Run the Q3 emergency evacuation drill',
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
 'Update the chemical inventory register',
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
 'Rewrite the confined space entry procedure',
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
   20, current_date + 150, 10, now() - interval '1 day',
   now() - interval '21 days', null, now() - interval '90 days', 1,
   now() - interval '100 days'),

  ('f0c06000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000004',
   'f0c05000-0000-4000-a000-000000000002',
   'f0c05000-0000-4000-a000-000000000002',
   'Strengthen frontline safety coaching', 'development', 'active', 'on_track',
   25, current_date + 120, 25, now() + interval '14 days',
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
   current_date + 150, 10,
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
   current_date + 120, 25,
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

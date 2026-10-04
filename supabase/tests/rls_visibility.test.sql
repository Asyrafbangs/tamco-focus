-- ============================================================================
-- RLS: effective visibility, and the separation of view from edit
--
-- Covers MASTER_PRODUCT_SPEC.md sections 3.4, 22.5, and Appendix A9, and the
-- acceptance gates in BUILD_ACCEPTANCE_GATES.md section 4.
--
-- These are the properties nothing else in the build can establish. Executing
-- the schema proves the policies compile and attach; only running as a real
-- role with real claims proves they ALLOW and DENY the right rows.
--
-- Each test switches identity with `set local`, so the change is scoped to the
-- surrounding transaction and cannot leak into the next assertion.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

-- ---------------------------------------------------------------------------
-- Fixture identities (supabase/seed.sql)
-- ---------------------------------------------------------------------------

create or replace function pg_temp.act_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
end;
$$;

create or replace function pg_temp.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$$;

create or replace function pg_temp.reset_role()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Fixture UUIDs. Business logic never depends on these; tests may.
create or replace function pg_temp.uid(p_who text)
returns uuid
language sql
immutable
as $$
  select case p_who
    when 'admin' then 'f0c05000-0000-4000-a000-000000000001'
    when 'izzul' then 'f0c05000-0000-4000-a000-000000000002'
    when 'amer'  then 'f0c05000-0000-4000-a000-000000000003'
    when 'izzah' then 'f0c05000-0000-4000-a000-000000000004'
    when 'ajmal' then 'f0c05000-0000-4000-a000-000000000005'
    when 'lim'   then 'f0c05000-0000-4000-a000-000000000006'
    when 'tester' then 'f0c05000-0000-4000-a000-000000000007'
    when 'rafiq' then 'f0c05000-0000-4000-a000-000000000008'
    when 'zainab' then 'f0c05000-0000-4000-a000-000000000009'
  end::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 1. Unauthenticated access reads nothing, anywhere.
--
--    `anon` is refused at the PRIVILEGE gate, before RLS is consulted at all,
--    so these raise 42501 rather than returning an empty set. That is the
--    stronger of the two outcomes: there is no unauthenticated surface to
--    filter in the first place.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_anon();

select throws_ok(
  'select id from public.tasks',
  '42501',
  null,
  'anon cannot read tasks');

select throws_ok(
  'select id from public.user_profiles',
  '42501',
  null,
  'anon cannot read user profiles');

select throws_ok(
  'select id from public.audit_events',
  '42501',
  null,
  'anon cannot read audit history');

select throws_ok(
  'select id from public.attachments',
  '42501',
  null,
  'anon cannot read attachments');

select throws_ok(
  'select id from public.goals',
  '42501',
  null,
  'anon cannot read Goals');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 2. The approved visibility example (section 22.5, Appendix A9).
--
--    Amer may VIEW Izzah and Ajmal because they are his interns. He is a team
--    member, not their manager, so the grant conveys sight and nothing else.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('amer'));

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('izzah')),
  'Amer can view Izzah''s work through the explicit grant');

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('ajmal')),
  'Amer can view Ajmal''s work through the explicit grant');

select is_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('lim')),
  'Amer canNOT view Lim, who was never granted');

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('amer')),
  'Amer can always view his own work');

select is(
  (select count(*)::integer from public.team_load_summary),
  3,
  'Amer Team projection contains only himself and the two explicitly granted people');

select is_empty(
  format('select user_id from public.team_load_summary where user_id = %L', pg_temp.uid('izzul')),
  'Amer reporting-manager attribution does not expose Izzul workload in Team');

-- ---------------------------------------------------------------------------
-- 3. View access does NOT confer edit, activation, or reassignment.
--
--    This is the property section 3.4 turns on, and the one most likely to be
--    quietly lost in a future change.
-- ---------------------------------------------------------------------------

select is(
  (select (public.activate_task(
     (select id from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'backlog' limit 1),
     (select version from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'backlog' limit 1),
     null, null, null) ->> 'code')),
  'not_authorised',
  'Amer cannot ACTIVATE work he can only view');

select is(
  (select (public.move_task_to_available(
     (select id from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'active' limit 1),
     (select version from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'active' limit 1),
     null) ->> 'code')),
  'not_authorised',
  'Amer cannot MOVE OUT work he can only view');

select is(
  (select (public.reassign_task(
     (select id from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'active' limit 1),
     (select version from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'active' limit 1),
     pg_temp.uid('amer'), null) ->> 'code')),
  'not_authorised',
  'Amer cannot REASSIGN work he can only view');

-- A direct UPDATE must be refused by RLS too, not only by the procedures.
select lives_ok(
  format($q$ update public.tasks set title = 'tampered'
              where primary_owner_id = %L $q$, pg_temp.uid('izzah')),
  'a direct UPDATE against viewable-but-not-editable work does not error');

select is(
  (select count(*)::int from public.tasks
    where primary_owner_id = pg_temp.uid('izzah') and title = 'tampered'),
  0,
  'and it changes nothing, because no row passes the UPDATE policy');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 4. A viewer with no team visibility sees only themselves.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('lim'));

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('lim')),
  'Lim can view his own work');

/*
 * What this is actually about: visibility mode `none` grants nothing through
 * the reporting tree.
 *
 * It is NOT "Lim can never see a row Izzah owns". Being given a checklist step,
 * or being named a collaborator or reviewer, is an explicit grant and is
 * supposed to make that one task visible (v45 collaboration). Written as a
 * blanket emptiness check, this passed only against pristine seed data and
 * failed the moment any suite created a collaboration — reporting a working
 * feature as a security failure.
 */
select is_empty(
  format(
    $q$ select t.id
          from public.tasks t
         where t.primary_owner_id = %1$L
           and t.reviewer_id is distinct from %2$L
           and not exists (
                 select 1 from public.task_collaborators c
                  where c.task_id = t.id and c.user_id = %2$L)
           and not exists (
                 select 1 from public.task_checklist_items ci
                  where ci.task_id = t.id and ci.assigned_to = %2$L)
           and not exists (
                 select 1 from public.completion_reviews cr
                  where cr.task_id = t.id
                    and %2$L in (cr.reviewer_id, cr.second_reviewer_id)) $q$,
    pg_temp.uid('izzah'),
    pg_temp.uid('lim')),
  'Lim, whose mode is none, canNOT view Izzah work he was never given');

select is_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('amer')),
  'Lim canNOT view Amer');

select is(
  (select count(*)::integer from public.team_load_summary),
  1,
  'Lim Team projection contains only Lim when visibility mode is none');

select is_empty(
  format('select user_id from public.focus_summary where user_id = %L', pg_temp.uid('izzul')),
  'Lim reporting-manager attribution does not expose Izzul focus information');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 5. A manager sees their reporting line; an owner sees their own work.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzul'));

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('izzah')),
  'Izzul, as manager, can view a direct report''s work');

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('lim')),
  'Izzul can view every direct report, including Lim');

-- Who is in the projection, not how many (AGENTS.md section 10).
--
-- A count passes just as well when an outsider replaces a report, and it
-- moves whenever the fixture gains a person: this read `6` until v255 added
-- two team members, which is a fixture fact rather than a security one.
--
-- The expected set is written out as identities rather than selected from
-- user_profiles, because under Izzul's own role that table is RLS-filtered
-- the same way the projection is, so comparing the two would be equal by
-- construction and would assert nothing (section 11). The administrator
-- case below can derive its expectation safely, because an administrator
-- reads every row.
select is(
  (select array_agg(user_id order by user_id) from public.team_load_summary),
  (select array_agg(who order by who)
     from (values (pg_temp.uid('izzul')),
                  (pg_temp.uid('amer')),
                  (pg_temp.uid('izzah')),
                  (pg_temp.uid('ajmal')),
                  (pg_temp.uid('lim')),
                  (pg_temp.uid('tester')),
                  (pg_temp.uid('rafiq')),
                  (pg_temp.uid('zainab'))) as t(who)),
  'Izzul Team projection is exactly himself and his active direct reports');

select is_empty(
  format('select user_id from public.team_load_summary where user_id = %L', pg_temp.uid('admin')),
  'manager visibility does not silently include an unrelated administrator');

select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.uid('admin'));

select is(
  (select count(*)::integer from public.team_load_summary),
  (select count(*)::integer from public.user_profiles where status = 'active'),
  'administrator Team projection contains every active user');

select isnt_empty(
  format('select user_id from public.team_load_summary where user_id = %L', pg_temp.uid('izzul')),
  'administrator Team projection includes Izzul');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 6. Owners have edit authority over their own work.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzah'));

/*
 * This test brings its own Available task.
 *
 * It used to activate whichever `backlog` row it found first, which made it
 * depend on state it did not create, in two ways. It read the id and the
 * version in two separate unordered `limit 1` subqueries, so with more than
 * one candidate they could name different rows and `activate_task` refused as
 * a version conflict. And activating is a mutation, so a second run — or any
 * earlier suite that had activated her last Available task — left nothing to
 * activate at all.
 *
 * Both failures read as "an owner cannot activate her own work", which would
 * be a serious authorisation bug and was never happening. Creating the row
 * here means the test measures the permission it names and nothing else.
 */
select pg_temp.reset_role();

insert into public.tasks (id, title, work_class, origin, status, primary_owner_id, created_by)
values (
  '0f0c0000-0000-4000-a000-0000000000a1',
  'pgTAP fixture — Izzah activates her own work',
  'operational_action',
  'self_initiated',
  'backlog',
  pg_temp.uid('izzah'),
  pg_temp.uid('izzah'))
on conflict (id) do update
  set status = 'backlog', version = public.tasks.version + 1;

select pg_temp.act_as(pg_temp.uid('izzah'));

select is(
  (with target as (
     select id, version from public.tasks
      where id = '0f0c0000-0000-4000-a000-0000000000a1')
   select public.activate_task(target.id, target.version, null, null, null) ->> 'ok'
     from target),
  'true',
  'Izzah CAN activate her own Available Work');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 7. Audit history is append-only through the API.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzah'));

select throws_ok(
  $q$ insert into public.audit_events (event_type, actor_id)
      values ('task_activated', null) $q$,
  '42501',
  null,
  'a client cannot forge an audit event');

select throws_ok(
  $q$ update public.audit_events set reason_note = 'rewritten' $q$,
  '42501',
  null,
  'a client cannot rewrite audit history');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 8. Goal visibility is broad enough for coaching, but never grants edit.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('amer'));

select isnt_empty(
  format('select id from public.goals where owner_id = %L', pg_temp.uid('amer')),
  'Amer can view his own Goal');

select isnt_empty(
  format('select id from public.goals where owner_id = %L', pg_temp.uid('izzah')),
  'Amer can view Izzah''s Goal through the approved explicit visibility grant');

select is(
  (select public.get_goal_capabilities('f0c06000-0000-4000-a000-000000000002') ->> 'can_view'),
  'true',
  'an authorised Goal viewer receives view capability');

select is(
  (select public.get_goal_capabilities('f0c06000-0000-4000-a000-000000000002') ->> 'can_update'),
  'false',
  'the same viewer does not receive update capability');

select is(
  (select public.raise_goal_support_request(
    'f0c06000-0000-4000-a000-000000000002',
    'Attempted write by a view-only participant.',
    'Should never be recorded.',
    null,
    'rls-goal-view-only-update') ->> 'code'),
  'not_authorised',
  'a view-only participant cannot write against another employee''s Goal');

select throws_ok(
  $$ update public.goals
        set title = 'tampered Goal'
      where id = 'f0c06000-0000-4000-a000-000000000002' $$,
  '42501',
  null,
  'clients cannot bypass Goal procedures with a direct update');

select is(
  (select public.raise_goal_support_request(
    'f0c06000-0000-4000-a000-000000000001',
    'The prototype needs two more Operations users before the next review.',
    'Please release two Operations users for testing this month.',
    null,
    'rls-goal-owner-request') ->> 'code'),
  'goal_support_requested',
  'a Goal owner can raise a request against their own Goal');

select is(
  (select public.create_lean_goal(
    pg_temp.uid('amer'),
    'Prepare one shared lean Goal expectation',
    current_date + 180,
    10,
    '[{"description":"Demonstrate the agreed result in natural language."}]'::jsonb,
    null, null, null, null, null, 'performance', '[]'::jsonb, 'draft',
    'rls-lean-goal-self-draft') ->> 'code'),
  'goal_draft_saved',
  'an employee can prepare one self-owned lean Goal Draft with zero milestones');

select is(
  (select public.create_lean_goal(
    pg_temp.uid('izzah'),
    'Attempt a Goal for another employee',
    current_date + 180,
    10,
    '[{"description":"This must not be stored."}]'::jsonb,
    null, null, null, null, null, 'performance', '[]'::jsonb, 'discussion',
    'rls-lean-goal-unrelated-owner') ->> 'code'),
  'not_authorised',
  'Goal visibility does not let an employee author another employee Goal');

select isnt_empty(
  $$ select id from public.audit_events
      where goal_id = 'f0c06000-0000-4000-a000-000000000001'
        and event_type = 'goal_support_requested' $$,
  'the owner request writes immutable Goal audit history');

select isnt_empty(
  $$ select id from public.goal_success_measures
      where goal_version_id = 'f0c06100-0000-4000-a000-000000000001' $$,
  'a Goal owner can read the structured success measures for their Goal');

select isnt_empty(
  $$ select id from public.goal_plan_overview
      where employee_id = 'f0c05000-0000-4000-a000-000000000004' $$,
  'an employee can read their own performance-period Goal plan');

select throws_ok(
  $$ insert into public.goal_checkin_sessions (
       employee_id, performance_period_id, session_kind, status,
       period_year, period_month, submitted_by, submitted_at
     ) values (
       'f0c05000-0000-4000-a000-000000000004',
       (select performance_period_id from public.goals
         where id = 'f0c06000-0000-4000-a000-000000000001'),
       'monthly', 'submitted', 2026, 11,
       'f0c05000-0000-4000-a000-000000000004', now()
     ) $$,
  '42501',
  null,
  'employees cannot bypass the employee-level Goal session procedure with a direct insert');

select throws_ok(
  $$ insert into public.goal_check_ins (
       goal_id, goal_version_id, checkin_type, period_start, period_end,
       period_year, period_month
     ) values (
       'f0c06000-0000-4000-a000-000000000001',
       'f0c06100-0000-4000-a000-000000000001',
       'monthly', '2026-08-01', '2026-08-31', 2026, 8
     ) $$,
  '42501',
  null,
  'authenticated owners cannot bypass the monthly Goal procedure with a direct insert');

select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.uid('izzul'));

select is(
  (select count(*)::int from public.goals
    where id in (
      'f0c06000-0000-4000-a000-000000000001',
      'f0c06000-0000-4000-a000-000000000002'
    )),
  2,
  'a manager can view the seeded Goals for both direct reports');

select is(
  (select public.get_goal_capabilities('f0c06000-0000-4000-a000-000000000001') ->> 'can_agree'),
  'true',
  'the authorised manager can agree a structural Goal version');

select is(
  (select public.create_lean_goal(
    pg_temp.uid('izzah'),
    'Manager-prepared shared Goal expectation',
    current_date + 180,
    10,
    '[{"description":"Complete the agreed result by the Goal target date."}]'::jsonb,
    null, null, null, null, null, 'performance', '[]'::jsonb, 'discussion',
    'rls-lean-goal-manager-discussion') ->> 'code'),
  'goal_saved_for_discussion',
  'an authorised manager can prepare the same subordinate Goal record for discussion');

select is(
  (select public.get_goal_capabilities('f0c06000-0000-4000-a000-000000000001') ->> 'can_submit_monthly'),
  'false',
  'the manager cannot author the employee monthly Goal check-in');

select isnt_empty(
  $$ select id from public.goal_plan_overview
      where employee_id = 'f0c05000-0000-4000-a000-000000000004' $$,
  'an authorised manager can read a direct report Goal plan');

select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.uid('lim'));

select is_empty(
  $$ select id from public.goals
      where id = 'f0c06000-0000-4000-a000-000000000001' $$,
  'a person with no team visibility cannot read another employee''s Goal');

select is_empty(
  $$ select m.id from public.goal_success_measures m
      join public.goal_versions v on v.id = m.goal_version_id
      where v.goal_id = 'f0c06000-0000-4000-a000-000000000001' $$,
  'Goal success-measure RLS follows Goal visibility for an unrelated employee');

select is_empty(
  $$ select id from public.goal_plan_overview
      where employee_id = 'f0c05000-0000-4000-a000-000000000004' $$,
  'an unrelated employee cannot read another employee Goal plan');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 9. Task commitments remain procedure-owned and auditable.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('amer'));

select is(
  (select public.change_task_due_date(
    'f0c05300-0000-4000-a000-000000000002', 1,
    '2026-08-10 23:59:59.999+08'::timestamptz, true, null,
    'rls-viewer-due-change') ->> 'code'),
  'not_authorised',
  'a view-only participant cannot change another person''s due commitment');

select pg_temp.reset_role();
select pg_temp.act_as(pg_temp.uid('izzah'));

select is(
  (select public.change_task_due_date(
    'f0c05300-0000-4000-a000-000000000002',
    (select version from public.tasks where id = 'f0c05300-0000-4000-a000-000000000002'),
    '2026-08-10 23:59:59.999+08'::timestamptz, true,
    'Waiting for supplier confirmation', 'rls-owner-due-change') ->> 'code'),
  'task_due_date_changed',
  'the task owner can change the due commitment through the guarded operation');

select isnt_empty(
  $$ select id from public.audit_events
      where task_id = 'f0c05300-0000-4000-a000-000000000002'
        and event_type = 'task_due_date_changed'
        and detail ->> 'previous_due_at' is not null
        and detail ->> 'new_due_at' is not null
        and detail ->> 'reason' = 'Waiting for supplier confirmation' $$,
  'a due-date change preserves its previous date, new date, and optional reason');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 10. Notification email delivery history is private and worker-owned.
-- ---------------------------------------------------------------------------

insert into public.notifications (
  recipient_id,
  kind,
  channel,
  requires_action,
  title,
  body
) values (
  pg_temp.uid('izzah'),
  'ordinary_assignment',
  'digest',
  false,
  'RLS notification-email fixture',
  'This row exists only inside the pgTAP transaction.'
);

select pg_temp.act_as(pg_temp.uid('izzah'));

select isnt_empty(
  $$ select id from public.notification_email_deliveries
      where recipient_id = pg_temp.uid('izzah') $$,
  'a recipient can read their own notification email delivery history');

select throws_ok(
  $$ update public.notification_email_deliveries
        set status = 'sent'
      where recipient_id = pg_temp.uid('izzah') $$,
  '42501',
  null,
  'an authenticated recipient cannot mutate notification email delivery state');

select pg_temp.reset_role();
select pg_temp.act_as(pg_temp.uid('lim'));

select is_empty(
  $$ select id from public.notification_email_deliveries
      where recipient_id = pg_temp.uid('izzah') $$,
  'another user cannot read somebody else''s notification email delivery history');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 11. A deactivated account loses access even holding a valid token.
-- ---------------------------------------------------------------------------

select public.deactivate_user(pg_temp.uid('lim'), true);

select pg_temp.act_as(pg_temp.uid('lim'));

select is_empty(
  'select id from public.tasks',
  'a deactivated account reads no tasks');

select is_empty(
  'select id from public.user_profiles',
  'a deactivated account reads no profiles');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 12. Attachments follow the authorisation of the task that owns them.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('lim'));

select is_empty(
  'select id from public.attachments',
  'a deactivated account reads no attachments either');

select pg_temp.reset_role();

select * from finish();

rollback;

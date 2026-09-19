-- ============================================================================
-- RLS v196: visibility worked out once per query, with nobody seeing more or
-- less than before.
--
-- v196 moved task and request visibility from per-row functions to sets that a
-- policy computes once per query (`focus.visible_task_id_array()` and friends),
-- because Production spent 0.8-1 ms per row asking the same question: a manager
-- counting 154 steps took 134 ms, every task list 100-470 ms.
--
-- A speed change to RLS is only acceptable if it changes nothing else. So this
-- file keeps the rules exactly as they were before v196 as the specification,
-- and checks the new sets and the rewritten policies against them for every
-- user, over fixtures that exercise every way a task or request becomes
-- visible.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- The specification: the per-row rules as they stood in v195, verbatim.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.v195_can_view_task(target_task_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.tasks t
     where t.id = target_task_id
       and (
            t.primary_owner_id = auth.uid()
         or focus.is_admin()
         or t.reviewer_id = auth.uid()
         or exists (
              select 1 from public.task_collaborators c
               where c.task_id = t.id and c.user_id = auth.uid()
            )
         or exists (
              select 1 from public.task_checklist_items ci
               where ci.task_id = t.id and ci.assigned_to = auth.uid()
            )
         or exists (
              select 1 from public.completion_reviews cr
               where cr.task_id = t.id
                 and (cr.reviewer_id = auth.uid() or cr.second_reviewer_id = auth.uid())
            )
         or focus.can_view_user(t.primary_owner_id)
       )
  );
$$;

create or replace function pg_temp.v195_can_view_request(target_barrier_id uuid)
returns boolean
language sql
stable
as $$
  select focus.is_active_account() and exists (
    select 1
    from public.barriers request
    where request.id = target_barrier_id
      and (
        request.raised_by = auth.uid()
        or request.action_required_from = auth.uid()
        or (request.task_id is not null and pg_temp.v195_can_view_task(request.task_id))
        or (request.goal_id is not null and focus.can_view_goal(request.goal_id))
      )
  );
$$;

create or replace function pg_temp.as_role(p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('role', p_role, true);
end;
$$;

create or replace function pg_temp.claims_for(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    case
      when p_user_id is null then '{"role":"anon"}'
      else json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text
    end,
    true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: one task per way of seeing it, for Lim, who otherwise sees only
-- his own work; requests that are visible and not; a deactivated account.
-- ---------------------------------------------------------------------------

set local session_replication_role = replica;

insert into public.tasks
  (id, title, status, work_class, focus_bucket, origin, primary_owner_id, created_by,
   reviewer_id, deleted_at, deleted_by)
values
  ('f0c19600-0000-4000-a000-000000000001', 'v196 collaborator path', 'active',
   'operational_action', 'operational', 'self_initiated',
   'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000004', null, null, null),
  ('f0c19600-0000-4000-a000-000000000002', 'v196 reviewer path', 'active',
   'operational_action', 'operational', 'self_initiated',
   'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000004',
   'f0c05000-0000-4000-a000-000000000006', null, null),
  ('f0c19600-0000-4000-a000-000000000003', 'v196 step path', 'active',
   'operational_action', 'operational', 'self_initiated',
   'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000005', null, null, null),
  ('f0c19600-0000-4000-a000-000000000004', 'v196 completion review path', 'active',
   'operational_action', 'operational', 'self_initiated',
   'f0c05000-0000-4000-a000-000000000005', 'f0c05000-0000-4000-a000-000000000005', null, null, null),
  ('f0c19600-0000-4000-a000-000000000005', 'v196 nobody else''s business', 'active',
   'operational_action', 'operational', 'self_initiated',
   'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000004', null, null, null),
  ('f0c19600-0000-4000-a000-000000000006', 'v196 binned but own', 'active',
   'operational_action', 'operational', 'self_initiated',
   'f0c05000-0000-4000-a000-000000000006', 'f0c05000-0000-4000-a000-000000000006', null,
   now(), 'f0c05000-0000-4000-a000-000000000006'),
  -- Owned by the account deactivated below, so that it has something it could
  -- still read if the active-account check were lost.
  ('f0c19600-0000-4000-a000-000000000007', 'v196 left behind', 'active',
   'operational_action', 'operational', 'self_initiated',
   'f0c05000-0000-4000-a000-000000000007', 'f0c05000-0000-4000-a000-000000000007', null, null, null);

insert into public.task_collaborators (task_id, user_id, added_by)
values ('f0c19600-0000-4000-a000-000000000001', 'f0c05000-0000-4000-a000-000000000006',
        'f0c05000-0000-4000-a000-000000000004');

insert into public.task_checklist_items (task_id, position, action, assigned_to, state)
values ('f0c19600-0000-4000-a000-000000000003', 1, 'v196 step for Lim',
        'f0c05000-0000-4000-a000-000000000006', 'ready');

insert into public.completion_reviews (task_id, submitted_by, second_reviewer_id)
values ('f0c19600-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000005',
        'f0c05000-0000-4000-a000-000000000006');

insert into public.barriers
  (id, task_id, goal_id, description, support_needed, impact, raised_by, action_required_from)
values
  ('f0c19600-0000-4000-b000-000000000001', 'f0c19600-0000-4000-a000-000000000005', null,
   'v196 asked of Lim', 'A decision', 'may_delay',
   'f0c05000-0000-4000-a000-000000000004', 'f0c05000-0000-4000-a000-000000000006'),
  ('f0c19600-0000-4000-b000-000000000002', 'f0c19600-0000-4000-a000-000000000005', null,
   'v196 not Lim''s', 'A decision', 'may_delay',
   'f0c05000-0000-4000-a000-000000000004', null),
  ('f0c19600-0000-4000-b000-000000000003', null, 'f0c06000-0000-4000-a000-000000000001',
   'v196 on Amer''s goal', 'Support', 'may_delay',
   'f0c05000-0000-4000-a000-000000000002', null);

update public.user_profiles set status = 'deactivated', deactivated_at = now()
 where id = 'f0c05000-0000-4000-a000-000000000007';

set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 1. The fixtures reach every path, so the comparisons below are not vacuous.
-- ---------------------------------------------------------------------------

select pg_temp.claims_for('f0c05000-0000-4000-a000-000000000006');

select ok(focus.can_view_task('f0c19600-0000-4000-a000-000000000001'), 'a collaborator sees the task');
select ok(focus.can_view_task('f0c19600-0000-4000-a000-000000000002'), 'the reviewer sees the task');
select ok(focus.can_view_task('f0c19600-0000-4000-a000-000000000003'), 'the owner of a step sees its task');
select ok(focus.can_view_task('f0c19600-0000-4000-a000-000000000004'), 'a completion reviewer sees the task');
select ok(focus.can_view_task('f0c19600-0000-4000-a000-000000000006'), 'binned work is still its owner''s');
select ok(not focus.can_view_task('f0c19600-0000-4000-a000-000000000005'), 'unrelated work is not visible');
select ok(focus.can_view_request('f0c19600-0000-4000-b000-000000000001'), 'a request asked of you is visible on hidden work');
select ok(not focus.can_view_request('f0c19600-0000-4000-b000-000000000002'), 'a request on hidden work is not');
select ok(not focus.can_view_request('f0c19600-0000-4000-b000-000000000003'), 'nor one on somebody else''s goal');

select pg_temp.claims_for('f0c05000-0000-4000-a000-000000000003');
select ok(focus.can_view_request('f0c19600-0000-4000-b000-000000000003'), 'a goal owner sees a request on their goal');

-- ---------------------------------------------------------------------------
-- 2. The sets agree with the per-row rules, for every viewer and every row.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.set_disagreements()
returns table(rule text, viewer uuid, subject uuid)
language plpgsql
as $$
declare
  v record;
begin
  for v in select p.id from public.user_profiles p union all select null::uuid loop
    perform pg_temp.claims_for(v.id);
    return query
      select 'task', v.id, t.id
        from public.tasks t
       where pg_temp.v195_can_view_task(t.id)
               is distinct from coalesce(t.id = any (focus.visible_task_id_array()), false)
          or pg_temp.v195_can_view_task(t.id) is distinct from focus.can_view_task(t.id);
    return query
      select 'request', v.id, b.id
        from public.barriers b
       where pg_temp.v195_can_view_request(b.id)
               is distinct from coalesce(b.id = any (focus.visible_request_id_array()), false)
          or pg_temp.v195_can_view_request(b.id) is distinct from focus.can_view_request(b.id);
    return query
      select 'person', v.id, p.id
        from public.user_profiles p
       where focus.can_view_user(p.id)
               is distinct from coalesce(p.id = any (focus.visible_user_id_array()), false);
  end loop;
end;
$$;

select is_empty(
  'select rule, viewer, subject from pg_temp.set_disagreements()',
  'every viewer''s sets match the per-row rules on every task, request and person');

-- ---------------------------------------------------------------------------
-- 3. The rewritten policies return exactly the rows the old ones allowed.
--
--    What each viewer should read is worked out as the table owner from the
--    v195 rules; what they do read is then asked as them, through RLS.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.policy_disagreements()
returns table(relation text, viewer uuid, expected uuid[], actual uuid[])
language plpgsql
as $$
declare
  v record;
  want uuid[];
  got uuid[];
begin
  for v in select p.id from public.user_profiles p loop
    -- tasks
    perform set_config('role', 'postgres', true);
    perform pg_temp.claims_for(v.id);
    select coalesce(array_agg(t.id order by t.id), '{}') into want
      from public.tasks t
     where focus.is_active_account() and pg_temp.v195_can_view_task(t.id);
    perform set_config('role', 'authenticated', true);
    select coalesce(array_agg(t.id order by t.id), '{}') into got from public.tasks t;
    if want is distinct from got then
      relation := 'tasks'; viewer := v.id; expected := want; actual := got; return next;
    end if;

    -- task_checklist_items
    perform set_config('role', 'postgres', true);
    select coalesce(array_agg(ci.id order by ci.id), '{}') into want
      from public.task_checklist_items ci
     where ci.assigned_to = auth.uid() or pg_temp.v195_can_view_task(ci.task_id);
    perform set_config('role', 'authenticated', true);
    select coalesce(array_agg(ci.id order by ci.id), '{}') into got
      from public.task_checklist_items ci;
    if want is distinct from got then
      relation := 'task_checklist_items'; viewer := v.id; expected := want; actual := got; return next;
    end if;

    -- barriers
    perform set_config('role', 'postgres', true);
    select coalesce(array_agg(b.id order by b.id), '{}') into want
      from public.barriers b
     where pg_temp.v195_can_view_request(b.id);
    perform set_config('role', 'authenticated', true);
    select coalesce(array_agg(b.id order by b.id), '{}') into got from public.barriers b;
    if want is distinct from got then
      relation := 'barriers'; viewer := v.id; expected := want; actual := got; return next;
    end if;

    -- user_profiles (the select policy, or an administrator's blanket one)
    perform set_config('role', 'postgres', true);
    select coalesce(array_agg(p.id order by p.id), '{}') into want
      from public.user_profiles p
     where (focus.is_active_account()
            and (p.id = auth.uid() or focus.can_view_user(p.id) or p.id = focus.current_manager_id()))
        or focus.is_admin();
    perform set_config('role', 'authenticated', true);
    select coalesce(array_agg(p.id order by p.id), '{}') into got from public.user_profiles p;
    if want is distinct from got then
      relation := 'user_profiles'; viewer := v.id; expected := want; actual := got; return next;
    end if;
  end loop;
  perform set_config('role', 'postgres', true);
end;
$$;

select is_empty(
  'select relation, viewer, expected, actual from pg_temp.policy_disagreements()',
  'every viewer reads exactly the tasks, steps, requests and people the v195 rules allowed');

-- ---------------------------------------------------------------------------
-- 4. A deactivated account still reads nothing, and no read policy has gone
--    back to asking row by row.
-- ---------------------------------------------------------------------------

select pg_temp.claims_for('f0c05000-0000-4000-a000-000000000007');
select pg_temp.as_role('authenticated');
select is((select count(*)::int from public.tasks), 0, 'a deactivated account reads no tasks');
select pg_temp.as_role('postgres');

select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and cmd = 'SELECT'
        and qual ~ 'focus\.can_view_(task|user|request)\(' $$,
  'no read policy checks task, request or person visibility one row at a time');

select * from finish();

rollback;

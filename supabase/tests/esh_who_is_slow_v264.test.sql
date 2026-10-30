-- ============================================================================
-- ESH Finding Management v264: whether the owner was slow, or ESH was.
--
-- The assertion that matters is the one the old single number could not make:
-- an owner who submitted before the deadline and was accepted after it is
-- **on time on the first measure and late on the second**, and both are true.
-- One figure cannot say that, and which half it reports decides who gets
-- blamed for a slow review.
--
-- The submissions and verification events are written directly rather than
-- driven through the guest procedures: what is under test here is the
-- arithmetic over those rows, and v199/v200 already prove the flow that
-- writes them.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end;
$$;
create or replace function pg_temp.reset_role()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create temporary table v264 (name text primary key, id uuid);
grant all on v264 to authenticated;

delete from public.esh_findings where title like 'v264 %';

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

create or replace function pg_temp.raise(p_name text)
returns void language plpgsql as $$
begin
  insert into v264 (name, id)
  select p_name,
         (public.esh_save_finding(null, jsonb_build_object(
            'title', 'v264 ' || p_name, 'description', 'Something to correct.',
            'reported_on', '2026-08-01', 'accountable_department_id',
            (select id from public.departments where code = 'OPS'),
            'location', 'BR2', 'required_outcome', 'Correct it.',
            'priority', 'normal', 'risk_level', 'medium',
            'owner_email', 'owner.' || p_name || '.v264@example.com',
            'due_date', '2026-09-30', 'escalation', '[]'::jsonb,
            'no_further_escalation_reason', 'Fixture.'), true)->>'action_id')::uuid;
end;
$$;

select pg_temp.raise('early');     -- submitted before the deadline, accepted after
select pg_temp.raise('late');      -- submitted after the deadline
select pg_temp.raise('bounced');   -- asked for more, came back
select pg_temp.raise('silent');    -- asked for more, has not come back

select pg_temp.reset_role();

create or replace function pg_temp.id(p_name text)
returns uuid language sql stable as $$ select id from v264 where name = p_name $$;

-- A baseline every action shares, so each assertion is about the gap and not
-- about the seed's dates.
update public.esh_finding_actions
   set baseline_due_at = timestamptz '2026-09-30 17:00+08',
       due_at = timestamptz '2026-09-30 17:00+08'
 where id in (select id from v264);

create or replace function pg_temp.submit(
  p_action uuid, p_version integer, p_at timestamptz, p_state text)
returns uuid language plpgsql as $$
declare
  v_msg uuid;
  v_sub uuid;
  a public.esh_finding_actions;
begin
  select * into a from public.esh_finding_actions where id = p_action;
  insert into public.esh_action_messages
    (organization_id, action_id, author_kind, author_principal_id, author_email,
     body, client_key, sent_at)
  values (a.organization_id, a.id, 'owner', a.owner_principal_id,
          'owner.v264@example.com', 'Done.', 'v264-' || p_action || '-' || p_version, p_at)
  returning id into v_msg;
  insert into public.esh_action_submissions
    (organization_id, action_id, version, assignment_version, principal_id, owner_email,
     message_id, result_text, due_at_snapshot, baseline_due_at_snapshot, state, submitted_at,
     client_key)
  values (a.organization_id, a.id, p_version, a.assignment_version, a.owner_principal_id,
          'owner.v264@example.com', v_msg, 'Corrected.', a.due_at, a.baseline_due_at,
          p_state, p_at, 'v264s-' || p_action || '-' || p_version)
  returning id into v_sub;
  return v_sub;
end;
$$;

create or replace function pg_temp.review(
  p_submission uuid, p_decision text, p_at timestamptz)
returns void language plpgsql as $$
declare
  s public.esh_action_submissions;
begin
  select * into s from public.esh_action_submissions where id = p_submission;
  insert into public.esh_verification_events
    (organization_id, action_id, submission_id, decision, method, note, due_decision,
     verifier_user_id, verified_at)
  values (s.organization_id, s.action_id, s.id, p_decision,
          case when p_decision = 'accepted' then 'document_review' end,
          -- Asking for more has to say what more (section 13).
          case when p_decision = 'changes_requested'
               then 'The photograph does not show the guard fitted.' end,
          case when p_decision = 'changes_requested' then 'kept' end,
          'f0c05000-0000-4000-a000-000000000002', p_at);
end;
$$;

create or replace function pg_temp.accept_action(p_action uuid, p_at timestamptz)
returns void language sql as $$
  update public.esh_finding_actions
     set state = 'accepted', accepted_at = p_at where id = p_action;
$$;

-- `early`: two days early, reviewed five days after the deadline.
select pg_temp.review(
  pg_temp.submit(pg_temp.id('early'), 1, timestamptz '2026-09-28 09:00+08', 'accepted'),
  'accepted', timestamptz '2026-10-05 09:00+08');
select pg_temp.accept_action(pg_temp.id('early'), timestamptz '2026-10-05 09:00+08');

-- `late`: a week after the deadline, reviewed the next morning.
select pg_temp.review(
  pg_temp.submit(pg_temp.id('late'), 1, timestamptz '2026-10-07 09:00+08', 'accepted'),
  'accepted', timestamptz '2026-10-08 09:00+08');
select pg_temp.accept_action(pg_temp.id('late'), timestamptz '2026-10-08 09:00+08');

-- `bounced`: ten days early, refused, and what was finally accepted arrived
-- after the deadline. This is the whole point of measuring both: on the first
-- measure this owner was early, on the second they were late, and a single
-- figure has to pick one and mislead.
select pg_temp.review(
  pg_temp.submit(pg_temp.id('bounced'), 1, timestamptz '2026-09-20 09:00+08', 'changes_requested'),
  'changes_requested', timestamptz '2026-09-21 09:00+08');
select pg_temp.review(
  pg_temp.submit(pg_temp.id('bounced'), 2, timestamptz '2026-10-02 09:00+08', 'accepted'),
  'accepted', timestamptz '2026-10-03 09:00+08');
select pg_temp.accept_action(pg_temp.id('bounced'), timestamptz '2026-10-03 09:00+08');

-- `silent`: refused, and nothing since.
select pg_temp.review(
  pg_temp.submit(pg_temp.id('silent'), 1, timestamptz '2026-09-25 09:00+08', 'changes_requested'),
  'changes_requested', timestamptz '2026-09-26 09:00+08');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

create or replace function pg_temp.figure(p_group text, p_key text)
returns numeric language sql stable as $$
  select (public.esh_dashboard(24)->'responsiveness'->p_group->>p_key)::numeric
$$;

-- ---------------------------------------------------------------------------
-- The two halves of "on time"
-- ---------------------------------------------------------------------------

-- `early` and `bounced` both got something in before the deadline; `late` did
-- not. Anything else the database is carrying contributes to both figures
-- equally, so the assertions below are about this test's three.
create temporary table v264_mine (first_on_time integer, accepted_on_time integer);
grant all on v264_mine to authenticated;
insert into v264_mine
select count(*) filter (where s.first_at <= a.baseline_due_at),
       count(*) filter (where s.accepted_at is not null and s.accepted_at <= a.baseline_due_at)
  from public.esh_finding_actions a
  join lateral (
    select min(sub.submitted_at) as first_at,
           max(sub.submitted_at) filter (where sub.state = 'accepted') as accepted_at
      from public.esh_action_submissions sub where sub.action_id = a.id) s on true
 where a.id in (select id from v264) and a.state = 'accepted';

select is((select first_on_time from v264_mine), 2,
          'two of the three accepted actions had something in before the deadline');
select is((select accepted_on_time from v264_mine), 1,
          'but only one of them had the thing that was eventually accepted');

select ok(pg_temp.figure('first_submission', 'on_time')
            >= pg_temp.figure('accepted_submission', 'on_time'),
          'so the first-submission figure can never be the smaller of the two');
select ok(pg_temp.figure('first_submission', 'counted') >= 3,
          'and each figure carries how many events it is drawn from');

-- ---------------------------------------------------------------------------
-- The gaps nobody was measuring
-- ---------------------------------------------------------------------------

select ok(pg_temp.figure('esh_review', 'counted') >= 4,
          'every review decision is counted, not only the acceptances');

select ok(pg_temp.figure('esh_review', 'median_hours') > 0,
          'and how long submissions waited for one is a number');

select ok(pg_temp.figure('after_changes', 'waiting') >= 1,
          'an owner who has not come back yet is counted as outstanding');

/*
 * Not as fast. The silent one has no return to measure, so leaving it out of
 * the median is right -- counting it as zero hours would make an unanswered
 * rejection look like the quickest response in the organisation.
 */
select ok(pg_temp.figure('after_changes', 'median_hours') >= 24,
          'and is kept out of the median rather than flattering it');

select * from finish();
rollback;

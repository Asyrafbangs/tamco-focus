-- ============================================================================
-- ESH Finding Management v223: a route a department already has.
--
-- §7. What only the database can establish: recording a route is ESH verify
-- authority within scope, it validates every level and address before writing
-- anything, replacing a route removes what it replaced rather than merging,
-- and listing somebody grants them nothing at all.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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
create or replace function pg_temp.ops()
returns uuid language sql stable as $$
  select id from public.departments where code = 'OPS'
$$;

-- A known baseline: this database may already carry routes from ordinary use.
delete from public.esh_department_escalation_defaults;

select has_table('public', 'esh_department_escalation_defaults', 'a department can carry a route');
select ok((select relrowsecurity from pg_class
            where oid = 'public.esh_department_escalation_defaults'::regclass),
          'and it is read under Finding scope');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_set_department_escalation(pg_temp.ops(),
            '[{"level":1,"email":"a@example.com"}]'::jsonb)->>'code', 'not_permitted',
          'somebody outside ESH cannot set one');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is(public.esh_set_department_escalation(pg_temp.ops(),
            '[{"level":1,"email":"not an address"}]'::jsonb)->>'code', 'email_invalid',
          'an address that is not one is refused');
select is(public.esh_set_department_escalation(pg_temp.ops(),
            '[{"level":0,"email":"a@example.com"}]'::jsonb)->>'code', 'level_invalid',
          'and so is a level outside 1 to 9');
select is((select count(*)::integer from public.esh_department_escalation_defaults
            where department_id = pg_temp.ops()), 0,
          'a refused route writes nothing at all');

select is((public.esh_set_department_escalation(pg_temp.ops(),
            '[{"level":1,"email":"Lead.V223@Example.com"},{"level":2,"email":"boss.v223@example.com"}]'::jsonb)
            ->>'written')::integer, 2,
          'ESH records the route the department uses');
select is((select canonical_email from public.esh_department_escalation_defaults
            where department_id = pg_temp.ops() and level = 1),
          'lead.v223@example.com',
          'the address is matched canonically and displayed as entered');

-- Replacing is replacing: the old route does not survive underneath.
select ok((public.esh_set_department_escalation(pg_temp.ops(),
            '[{"level":1,"email":"only.v223@example.com"}]'::jsonb)->>'ok')::boolean,
          'a shorter route replaces a longer one');
select is((select count(*)::integer from public.esh_department_escalation_defaults
            where department_id = pg_temp.ops()), 1,
          'and what it replaced is gone, not merged');

-- Being listed is not being given anything (§7, §15).
select is((select count(*)::integer from public.esh_email_principals
            where canonical_email = 'only.v223@example.com'), 0,
          'listing somebody creates no contact and grants no access');

select * from finish();
rollback;

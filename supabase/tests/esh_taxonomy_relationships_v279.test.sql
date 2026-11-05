-- v279 — A reviewed taxonomy says what the coordinator decided; it never
-- guesses from a Finding's text or turns a relationship into an automatic one.

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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
create or replace function pg_temp.id(p_name text)
returns uuid language sql stable as $$
  select case p_name
    when 'closed_ehs' then 'f2790000-0000-4000-a000-000000000001'::uuid
    when 'new_ops' then 'f2790000-0000-4000-a000-000000000002'::uuid
    when 'open_ehs' then 'f2790000-0000-4000-a000-000000000003'::uuid
    when 'hidden_admin' then 'f2790000-0000-4000-a000-000000000004'::uuid
  end;
$$;

-- The actor has exactly two departments.  That makes the scope assertions
-- discriminate the positive `= any` rule from the broken `<> any` variant.
update public.esh_staff_access
   set enabled = true, preset = 'coordinator', scope_all_departments = false
 where user_id = 'f0c05000-0000-4000-a000-000000000002';
delete from public.esh_staff_access_departments
 where access_id = (select id from public.esh_staff_access
                     where user_id = 'f0c05000-0000-4000-a000-000000000002');
insert into public.esh_staff_access_departments (access_id, department_id)
select a.id, d.id
  from public.esh_staff_access a
 cross join public.departments d
 where a.user_id = 'f0c05000-0000-4000-a000-000000000002'
   and d.code in ('EHS', 'OPS');

insert into public.esh_problem_tags (code, label, sort_order)
values ('unguarded_machinery', 'Unguarded machinery', 10);

insert into public.esh_findings
  (id, organization_id, reference, title, accountable_department_id, status, created_by)
values
  (pg_temp.id('closed_ehs'), 'e5e50000-0000-4000-8000-000000000001',
   'V279-CLOSED-EHS', 'v279 closed guard failure',
   (select id from public.departments where code = 'EHS'), 'closed',
   'f0c05000-0000-4000-a000-000000000002'),
  (pg_temp.id('new_ops'), 'e5e50000-0000-4000-8000-000000000001',
   'V279-NEW-OPS', 'v279 new machine hazard',
   (select id from public.departments where code = 'OPS'), 'new',
   'f0c05000-0000-4000-a000-000000000002'),
  (pg_temp.id('open_ehs'), 'e5e50000-0000-4000-8000-000000000001',
   'V279-OPEN-EHS', 'v279 open inspection finding',
   (select id from public.departments where code = 'EHS'), 'open',
   'f0c05000-0000-4000-a000-000000000002'),
  (pg_temp.id('hidden_admin'), 'e5e50000-0000-4000-8000-000000000001',
   'V279-HIDDEN-ADMIN', 'v279 administration finding',
   (select id from public.departments where code = 'ADMIN'), 'open',
   'f0c05000-0000-4000-a000-000000000002');

select ok(
  not has_function_privilege('anon',
    'public.esh_set_finding_classification(uuid, text, text, text)', 'EXECUTE'),
  'anonymous callers cannot classify Findings'
);
select is(
  (select c.code from public.esh_findings f
   join public.esh_hazard_categories c on c.id = f.hazard_category_id
   where f.id = pg_temp.id('open_ehs')),
  'unclassified',
  'a Finding starts unclassified rather than being inferred from its title'
);

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is(
  public.esh_set_finding_classification(pg_temp.id('open_ehs'), 'machinery_guarding',
    'unguarded_machinery', 'Coordinator reviewed the guard condition.')->>'code',
  'classification_saved',
  'a scoped coordinator records an explicit category and optional problem tag'
);
select is(
  (select c.code from public.esh_findings f
   join public.esh_hazard_categories c on c.id = f.hazard_category_id
   where f.id = pg_temp.id('open_ehs')),
  'machinery_guarding',
  'the Finding stores the reviewed hazard category'
);
select is(
  (select t.code from public.esh_findings f
   join public.esh_problem_tags t on t.id = f.problem_tag_id
   where f.id = pg_temp.id('open_ehs')),
  'unguarded_machinery',
  'the controlled problem tag is optional but, when supplied, is stored'
);
select is(
  (select count(*)::int from public.esh_finding_classification_events
   where finding_id = pg_temp.id('open_ehs')),
  1,
  'the classification decision has one immutable journal entry'
);
select is(
  public.esh_set_finding_classification(pg_temp.id('open_ehs'), 'machinery_guarding',
    'unguarded_machinery', 'Same reviewed decision.')->>'code',
  'unchanged',
  'repeating the same reviewed decision does not create false history'
);
select is(
  (select count(*)::int from public.esh_finding_classification_events
   where finding_id = pg_temp.id('open_ehs')),
  1,
  'an unchanged request leaves the decision journal alone'
);
select is(
  public.esh_set_finding_classification(pg_temp.id('open_ehs'), 'machinery_guarding',
    'not_a_controlled_tag', 'This tag must be rejected.')->>'code',
  'tag_not_available',
  'a free-text problem tag cannot be smuggled into the taxonomy'
);

select ok(
  (public.esh_link_findings(pg_temp.id('open_ehs'), pg_temp.id('new_ops'),
    'related_pattern', 'Reviewed as the same machinery hazard pattern.')->>'ok')::boolean,
  'a coordinator explicitly confirms a related-pattern relationship'
);
select is(
  (select source_finding_id::text || '/' || target_finding_id::text
   from public.esh_finding_relationships where relation_code = 'related_pattern'),
  least(pg_temp.id('open_ehs'), pg_temp.id('new_ops'))::text || '/' ||
    greatest(pg_temp.id('open_ehs'), pg_temp.id('new_ops'))::text,
  'a related pattern has one canonical direction, whatever order the reviewer supplied'
);
select is(
  public.esh_link_findings(pg_temp.id('new_ops'), pg_temp.id('open_ehs'),
    'related_pattern', 'A second reviewer attempts the same pair.')->>'code',
  'relationship_exists',
  'the same active related-pattern relationship cannot be entered twice'
);
select is(
  public.esh_reverse_finding_relationship(
    (select id from public.esh_finding_relationships where relation_code = 'related_pattern'),
    'Later review found the equipment differs.')->>'code',
  'relationship_reversed',
  'a reviewed relationship is reversible instead of silently deleted'
);
select is(
  (select state || '/' || reversal_reason from public.esh_finding_relationships
   where relation_code = 'related_pattern'),
  'reversed/Later review found the equipment differs.',
  'the reversal retains its reason and original decision record'
);

select is(
  public.esh_link_findings(pg_temp.id('closed_ehs'), pg_temp.id('new_ops'),
    'recurrence', 'The same guard failure returned after closure.')->>'code',
  'relationship_created',
  'a recurrence can link a closed original to the newly raised Finding'
);
select is(
  (select source_finding_id::text || '/' || target_finding_id::text
   from public.esh_finding_relationships where relation_code = 'recurrence'),
  pg_temp.id('closed_ehs')::text || '/' || pg_temp.id('new_ops')::text,
  'recurrence preserves the meaningful old-Finding to new-Finding direction'
);
select is(
  public.esh_link_findings(pg_temp.id('new_ops'), pg_temp.id('closed_ehs'),
    'recurrence', 'A reversed recurrence is not valid.')->>'code',
  'invalid_recurrence_state',
  'recurrence cannot turn an open Finding into a historical source'
);
select is(
  public.esh_link_findings(pg_temp.id('open_ehs'), pg_temp.id('hidden_admin'),
    'related_pattern', 'This would expose an out-of-scope Finding.')->>'code',
  'finding_not_found',
  'a coordinator scoped to two departments cannot disclose a third through a relationship'
);

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(
  public.esh_set_finding_classification(pg_temp.id('open_ehs'), 'machinery_guarding',
    null, 'Unauthorised caller.')->>'code',
  'not_permitted',
  'a person without Finding access cannot classify a visible-looking identifier'
);
select is(
  (select count(*)::int from public.esh_finding_relationships),
  0,
  'a person without Finding access cannot discover any relationship rows'
);

select pg_temp.reset_role();
select is(
  (select count(*)::int from public.esh_audit_events
   where finding_id = pg_temp.id('open_ehs') and event_type = 'finding_classification_changed'),
  1,
  'the classification is also retained in the immutable Finding audit'
);
select is(
  (select count(*)::int from public.esh_audit_events
   where finding_id = pg_temp.id('closed_ehs') and event_type = 'finding_relationship_confirmed'),
  1,
  'the recurrence confirmation is auditable on the historical Finding too'
);

select * from finish();
rollback;

-- ============================================================================
-- TAMCO AI v295: a conversation belongs to one person.
--
-- The assistant answers from records somebody is authorised to see, which
-- makes the conversation itself a record of what they were worried about. A
-- manager who can read it learns who is asking whether a delay is their own
-- fault. So the policy here is narrower than anywhere else in the product:
-- the owner, and nobody - not their manager, not an administrator.
--
-- What only the database can establish: that the policy holds against a
-- directly named id, that a row cannot be written into somebody else's
-- thread, that an administrator is no exception, and that the spend function
-- counts the caller's own spending rather than everybody's.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

create or replace function pg_temp.admin() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.izzul() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.lim() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000006'::uuid $$;

-- Two people, two private threads, written as themselves.
select pg_temp.act_as(pg_temp.izzul());
insert into public.ai_conversations (id, user_id, title)
values ('a1950000-0000-4000-a000-000000000001', pg_temp.izzul(), 'Why are my actions late');
insert into public.ai_messages (conversation_id, user_id, role, content, seq)
values ('a1950000-0000-4000-a000-000000000001', pg_temp.izzul(), 'user',
        '[{"type":"text","text":"am I the reason this slipped"}]'::jsonb, 0);
insert into public.ai_usage (conversation_id, user_id, model, input_tokens, output_tokens, cost_usd)
values ('a1950000-0000-4000-a000-000000000001', pg_temp.izzul(), 'claude-opus-5-5', 1000, 100, 0.006);

select is(
  (select count(*)::integer from public.ai_conversations),
  1,
  'the owner reads their own conversation');

select is(
  (select count(*)::integer from public.ai_messages),
  1,
  'and its messages');

select pg_temp.reset_role();
select pg_temp.act_as(pg_temp.lim());

insert into public.ai_conversations (id, user_id, title)
values ('a1950000-0000-4000-a000-000000000002', pg_temp.lim(), 'What should I prioritise');

-- The whole point. Another employee, naming the id directly.
select is(
  (select count(*)::integer from public.ai_conversations
    where id = 'a1950000-0000-4000-a000-000000000001'),
  0,
  'somebody else cannot read a conversation even by naming its id');

select is(
  (select count(*)::integer from public.ai_messages
    where conversation_id = 'a1950000-0000-4000-a000-000000000001'),
  0,
  'nor the messages inside it');

select is(
  (select count(*)::integer from public.ai_usage
    where conversation_id = 'a1950000-0000-4000-a000-000000000001'),
  0,
  'nor what it cost');

select is(
  (select count(*)::integer from public.ai_conversations),
  1,
  'they see their own, and only their own');

-- Writing into somebody else's thread, with an honest user_id of their own.
select throws_ok(
  $$insert into public.ai_messages (conversation_id, user_id, role, content, seq)
    values ('a1950000-0000-4000-a000-000000000001', 'f0c05000-0000-4000-a000-000000000006',
            'user', '[{"type":"text","text":"and what did they ask"}]'::jsonb, 99)$$,
  '42501',
  NULL,
  'a message cannot be written into a conversation that is not yours');

-- Or by claiming to be the other person.
select throws_ok(
  $$insert into public.ai_conversations (user_id, title)
    values ('f0c05000-0000-4000-a000-000000000002', 'written on their behalf')$$,
  '42501',
  NULL,
  'a conversation cannot be created in somebody else''s name');

select is(
  (select public.ai_spend_last_day())::numeric(10,6),
  0::numeric(10,6),
  'the spend function counts the caller''s own spending, not everybody''s');

select pg_temp.reset_role();
select pg_temp.act_as(pg_temp.izzul());

select is(
  (select public.ai_spend_last_day())::numeric(10,6),
  0.006::numeric(10,6),
  'and reports it for the person who actually spent it');

select pg_temp.reset_role();
select pg_temp.act_as(pg_temp.admin());

/*
 * An administrator runs the installation and may read everything else in this
 * product. Not this. There is deliberately no path from an admin screen to
 * somebody's private questions, and this is the assertion that keeps it that
 * way when a future policy is written.
 */
select is(
  (select count(*)::integer from public.ai_conversations),
  0,
  'an administrator is no exception');

select is(
  (select count(*)::integer from public.ai_messages),
  0,
  'not even for the messages');

select pg_temp.reset_role();
select * from finish();
rollback;

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
select plan(18);

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

/*
 * The assistant's own tables start empty, because every count below is an
 * exact one.
 *
 * This matters more since v296: the usage window totals the whole
 * installation, so the pool is whatever anybody happened to ask on this
 * database before the test ran. It was already fragile for the visibility
 * counts - one real conversation on a developer's machine made "they see
 * their own, and only their own" read 2 against a wanted 1. Rolled back with
 * the rest of the transaction, so nothing is lost.
 */
delete from public.ai_tool_calls;
delete from public.ai_usage;
delete from public.ai_messages;
delete from public.ai_conversations;

-- Two people, two private threads, written as themselves.
select pg_temp.act_as(pg_temp.izzul());
insert into public.ai_conversations (id, user_id, title)
values ('a1950000-0000-4000-a000-000000000001', pg_temp.izzul(), 'Why are my actions late');
insert into public.ai_messages (conversation_id, user_id, role, content, seq)
values ('a1950000-0000-4000-a000-000000000001', pg_temp.izzul(), 'user',
        '[{"type":"text","text":"am I the reason this slipped"}]'::jsonb, 0);
insert into public.ai_usage (conversation_id, user_id, provider, model, requests,
                             input_tokens, output_tokens, charged_usd, list_price_usd)
values ('a1950000-0000-4000-a000-000000000001', pg_temp.izzul(), 'groq',
        'openai/gpt-oss-120b', 3, 1200, 90, 0, 0.000234);

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

/*
 * v296 — the allowance is the installation's, and this assertion used to say
 * the opposite.
 *
 * It read "the usage window counts the caller's own usage, not everybody's",
 * and it was green, and it was the bug. The ceilings this number is held
 * against belong to the API key: one Groq account, one organisation, 200,000
 * tokens a day shared by everybody. Counting one person against an
 * organisation's limit told nine employees they each had the whole day.
 *
 * So Lim, who has spent nothing, must still see what Izzul spent - otherwise
 * the route lets a question through that the provider will refuse. What Lim
 * must NOT see is anything attributable: no row, no title, no question. The
 * two assertions above and below this one are what keep those apart.
 */
select is(
  (select tokens_today from public.ai_usage_window())::bigint,
  1290::bigint,
  'a colleague who has spent nothing still sees the shared pool drawn down');

select is(
  (select my_tokens_today from public.ai_usage_window())::bigint,
  0::bigint,
  'while their own share of it is still reported separately');

select pg_temp.reset_role();
select pg_temp.act_as(pg_temp.izzul());

select is(
  (select tokens_today from public.ai_usage_window())::bigint,
  1290::bigint,
  'and the person who spent them sees the same shared total');

select is(
  (select my_tokens_today from public.ai_usage_window())::bigint,
  1290::bigint,
  'which for them is all their own');

select is(
  (select requests_today from public.ai_usage_window())::integer,
  3,
  'counting requests as well, because a free tier is rationed by request');

/*
 * The distinction the whole accounting rests on: a free-tier turn spent
 * tokens and was charged nothing. Recording it as a small charge would make
 * every later cost report fiction, and recording no tokens would hide the
 * usage that the daily allowance is actually measured in.
 */
select is(
  (select charged_today from public.ai_usage_window())::numeric(10,6),
  0::numeric(10,6),
  'a free-tier turn is charged nothing at all, not almost nothing');

select is(
  (select sum(list_price_usd) from public.ai_usage)::numeric(10,6),
  0.000234::numeric(10,6),
  'while what it would have cost at list price is still answerable');

/*
 * The function reads past RLS to total everybody's usage, so it has to
 * establish who is asking before it answers anything at all. Without this,
 * an unauthenticated caller reads the installation's consumption. Last in
 * this section because it leaves no caller set.
 */
select pg_temp.reset_role();
select throws_ok(
  $$select * from public.ai_usage_window()$$,
  '42501',
  NULL,
  'and refuses to total anything for a caller it cannot identify');

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

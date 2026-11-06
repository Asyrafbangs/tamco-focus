-- v295 — the AI coworker's own records.
--
-- Four tables, and the rule that shapes all of them: a conversation belongs to
-- one person and nobody else reads it. Not their manager, not an
-- administrator, not another coordinator. A private conversation is where
-- somebody asks the question they would not ask in a meeting - "is this
-- actually my fault" - and a workspace that quietly shows that to a manager is
-- a workspace people stop using honestly.
--
-- What is kept, and why each one:
--
--   ai_conversations  the thread, so work continues tomorrow
--   ai_messages       every turn, so the thread can be replayed
--   ai_tool_calls     which records the assistant actually read, so an answer
--                     can be checked rather than believed
--   ai_usage          tokens and cost per turn, so spending is a number
--                     somebody can look at rather than a surprise
--
-- Nothing here is organisational memory. These rows are one person's working
-- conversation; the live tables stay the authority on what is true, and an
-- answer the assistant gave last week has no standing against a record that
-- changed since.

/*
 * No organisation column, deliberately. A profile in this application does not
 * carry one - the ESH tables resolve theirs through `focus.esh_organization_id()`,
 * which is an ESH access fact rather than an identity fact - and a column
 * filled with "the only organisation there is" would be a value nobody
 * maintains and every later reader would half-trust. The owner is the whole
 * boundary here, and the owner is a person.
 */
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  -- Written from the first question, so a list of threads is readable.
  title text not null default 'New conversation' check (length(btrim(title)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Kept rather than deleted when somebody clears their list, so the usage
  -- and tool records behind it stay answerable.
  archived_at timestamptz
);

create index ai_conversations_mine_idx
  on public.ai_conversations (user_id, updated_at desc)
  where archived_at is null;

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  /*
   * The turn in our own neutral shape - text, plus the tool calls an
   * assistant turn asked for and the id each result answers. Neutral rather
   * than a provider's own format because a stored conversation outlives the
   * decision about who runs the model, and a thread written in one provider's
   * blocks would have to be migrated to read it with another.
   */
  content jsonb not null default '{}'::jsonb,
  -- Ordering within a thread, independent of clock skew.
  seq integer not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

create index ai_messages_thread_idx on public.ai_messages (conversation_id, seq);

create table public.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  tool_name text not null,
  /*
   * The arguments, kept whole. An answer that cites a finding is checkable
   * only if somebody can see which finding was actually read, with which
   * filters - and a tool that was called and failed is part of that story.
   */
  input jsonb not null default '{}'::jsonb,
  ok boolean not null,
  error text,
  rows_returned integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index ai_tool_calls_thread_idx on public.ai_tool_calls (conversation_id, created_at);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.ai_conversations (id) on delete set null,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  provider text not null,
  model text not null,
  /** How many requests this turn made of the provider. A step is a request. */
  requests integer not null default 1,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  /*
   * Two numbers, because they are two different facts.
   *
   * `charged_usd` is what this turn actually cost. On a free plan that is
   * zero - not "about zero", zero - and recording a free request as a small
   * charge would make every later cost report fiction.
   *
   * `list_price_usd` is what the same tokens would have cost at the
   * provider's published rate. It is what answers "what would this cost if we
   * paid for it", which is the question somebody asks before they do.
   *
   * Both are priced where they are counted. A cost recomputed next year from
   * today's tokens would be a different number from the one that was spent.
   */
  charged_usd numeric(10, 6) not null default 0,
  list_price_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index ai_usage_daily_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_tool_calls enable row level security;
alter table public.ai_usage enable row level security;

revoke all on table public.ai_conversations from anon;
revoke all on table public.ai_messages from anon;
revoke all on table public.ai_tool_calls from anon;
revoke all on table public.ai_usage from anon;

grant select, insert, update on table public.ai_conversations to authenticated;
grant select, insert on table public.ai_messages to authenticated;
grant select, insert on table public.ai_tool_calls to authenticated;
grant select, insert on table public.ai_usage to authenticated;

/*
 * One rule, four times: it is yours or you cannot see it.
 *
 * `user_id = focus.current_user_id()` and nothing else - no manager clause, no
 * administrator clause. An administrator who needs to know what the assistant
 * is costing reads `ai_usage` through a view that carries no conversation
 * content; there is deliberately no path from an admin screen to somebody
 * else's questions.
 */
create policy ai_conversations_own on public.ai_conversations
  as permissive for select to authenticated
  using ((select focus.is_active_account()) and user_id = (select focus.current_user_id()));

create policy ai_conversations_own_insert on public.ai_conversations
  as permissive for insert to authenticated
  with check ((select focus.is_active_account()) and user_id = (select focus.current_user_id()));

create policy ai_conversations_own_update on public.ai_conversations
  as permissive for update to authenticated
  using ((select focus.is_active_account()) and user_id = (select focus.current_user_id()))
  with check (user_id = (select focus.current_user_id()));

create policy ai_messages_own on public.ai_messages
  as permissive for select to authenticated
  using ((select focus.is_active_account()) and user_id = (select focus.current_user_id()));

create policy ai_messages_own_insert on public.ai_messages
  as permissive for insert to authenticated
  with check (
    (select focus.is_active_account())
    and user_id = (select focus.current_user_id())
    -- And into a thread that is also theirs: a row cannot be written into
    -- somebody else's conversation by naming its id.
    and exists (
      select 1 from public.ai_conversations c
       where c.id = conversation_id
         and c.user_id = (select focus.current_user_id())
    )
  );

create policy ai_tool_calls_own on public.ai_tool_calls
  as permissive for select to authenticated
  using ((select focus.is_active_account()) and user_id = (select focus.current_user_id()));

create policy ai_tool_calls_own_insert on public.ai_tool_calls
  as permissive for insert to authenticated
  with check (
    (select focus.is_active_account())
    and user_id = (select focus.current_user_id())
    and exists (
      select 1 from public.ai_conversations c
       where c.id = conversation_id
         and c.user_id = (select focus.current_user_id())
    )
  );

create policy ai_usage_own on public.ai_usage
  as permissive for select to authenticated
  using ((select focus.is_active_account()) and user_id = (select focus.current_user_id()));

create policy ai_usage_own_insert on public.ai_usage
  as permissive for insert to authenticated
  with check ((select focus.is_active_account()) and user_id = (select focus.current_user_id()));

/*
 * What one person has used, over the two windows that actually constrain a
 * free tier: the rolling day and the last minute.
 *
 * Requests and tokens rather than only dollars, because on a free plan the
 * dollars are zero and the limits are counted in requests and tokens. The
 * minute matters as much as the day: a provider that allows a few thousand
 * tokens a minute will refuse a multi-step investigation halfway through, and
 * a loop that knows its minute budget can stop with findings instead.
 */
create or replace function public.ai_usage_window()
returns table (
  requests_today integer,
  tokens_today bigint,
  charged_today numeric,
  tokens_this_minute bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    coalesce(sum(requests) filter (where created_at > now() - interval '24 hours'), 0)::integer,
    coalesce(sum(input_tokens + output_tokens + cached_input_tokens)
             filter (where created_at > now() - interval '24 hours'), 0)::bigint,
    coalesce(sum(charged_usd) filter (where created_at > now() - interval '24 hours'), 0)::numeric,
    coalesce(sum(input_tokens + output_tokens + cached_input_tokens)
             filter (where created_at > now() - interval '60 seconds'), 0)::bigint
    from public.ai_usage
   where user_id = focus.current_user_id();
$$;

revoke all on function public.ai_usage_window() from public, anon;
grant execute on function public.ai_usage_window() to authenticated;

comment on table public.ai_conversations is
  'v295 — one person''s private thread with the assistant. Readable by its '
  'owner only: no manager, administrator or coordinator path exists.';
comment on table public.ai_tool_calls is
  'v295 — which authorised records the assistant actually read, so an answer '
  'can be checked rather than believed.';
comment on table public.ai_usage is
  'v295 — tokens per turn, with what was charged and what the same tokens '
  'would cost at list price kept apart: a free-tier request is no charge, '
  'not a small one.';

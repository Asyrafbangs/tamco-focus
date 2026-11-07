/*
 * v296 — the assistant's allowance belongs to the installation, not the person.
 *
 * `ai_usage_window` counted one person's usage and the route held it against
 * the provider's ceilings. Those ceilings belong to an API key: one Groq
 * account, one organisation, 200,000 tokens a day between everybody. So nine
 * employees were each told they had the whole day's allowance, and the
 * arithmetic that was supposed to stop a question before it cost anything
 * permitted nine times what the provider would serve. A usage export over one
 * afternoon showed what that looks like from the other side: of 407 requests,
 * 91 refused on the daily token quota.
 *
 * The window is now the installation's, with the caller's own total beside it
 * so one person can be held to a share of the pool rather than racing their
 * colleagues for it.
 *
 * `security definer` is the point of the change and the reason for the care
 * around it. Reading everybody's usage is exactly what RLS on `ai_usage`
 * exists to prevent, so this function returns no rows and no columns anybody
 * could attribute: four totals for the installation and one for the caller.
 * Nobody's question, answer, conversation or identity is reachable through
 * it, and an inactive or anonymous caller gets an error rather than a number.
 */

/*
 * Dropped rather than replaced: the return type gains a column, and
 * `create or replace function` cannot change a return type.
 */
drop function if exists public.ai_usage_window();

create function public.ai_usage_window()
returns table (
  requests_today integer,
  tokens_today bigint,
  charged_today numeric,
  tokens_this_minute bigint,
  /* The caller's own share of the day, for the per-person cap. */
  my_tokens_today bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid;
begin
  /*
   * Fail closed. A function that reads past RLS must establish who is asking
   * before it answers, and "nobody" is not an answer: the caller would
   * otherwise read the installation's usage unauthenticated.
   */
  if not focus.is_active_account() then
    raise exception 'ai_usage_window requires an active account'
      using errcode = '42501';
  end if;
  caller := focus.current_user_id();

  return query
  select
    coalesce(sum(u.requests) filter (where u.created_at > now() - interval '24 hours'), 0)::integer,
    coalesce(sum(u.input_tokens + u.output_tokens + u.cached_input_tokens)
             filter (where u.created_at > now() - interval '24 hours'), 0)::bigint,
    coalesce(sum(u.charged_usd) filter (where u.created_at > now() - interval '24 hours'), 0)::numeric,
    coalesce(sum(u.input_tokens + u.output_tokens + u.cached_input_tokens)
             filter (where u.created_at > now() - interval '60 seconds'), 0)::bigint,
    coalesce(sum(u.input_tokens + u.output_tokens + u.cached_input_tokens)
             filter (where u.created_at > now() - interval '24 hours'
                       and u.user_id = caller), 0)::bigint
    from public.ai_usage u;
end;
$$;

revoke all on function public.ai_usage_window() from public, anon;
grant execute on function public.ai_usage_window() to authenticated;

comment on function public.ai_usage_window() is
  'v296 — what the installation has spent on the assistant over the rolling '
  'day and the last minute, with the caller''s own daily total beside it. '
  'Aggregates only: the provider''s quota is shared across everybody on one '
  'API key, so holding one person''s usage against it permitted as many times '
  'the daily allowance as there were employees.';

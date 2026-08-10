-- ---------------------------------------------------------------------------
-- v46 section 31 — make idempotency keys actually idempotent under concurrency.
--
-- The mechanism was check-then-act:
--
--   replay_operation   read the log; nothing there, so carry on
--   ...                do the work
--   remember_operation insert the result, on conflict do nothing
--
-- Two requests carrying the same key at the same time both read an empty log,
-- both did the work, and only the *log entry* was deduplicated. The second
-- caller got the first caller's result back and looked correct, while the
-- database had two responses, two audit events and two notifications. A
-- double-click on Send decision is precisely that race, and it is the case the
-- specification names.
--
-- The fix is to serialise on the key before deciding whether the work is
-- needed. The lock is transaction-scoped, so it is released on commit or
-- rollback with no cleanup path to forget, and it is keyed by actor and key
-- together, so two people acting at once never wait for each other.
--
-- Placed inside `replay_operation` deliberately: every idempotent procedure in
-- the application already calls it first, so all of them are fixed at once
-- rather than each remembering to take a lock of its own.
-- ---------------------------------------------------------------------------

drop function if exists focus.replay_operation(uuid, text);

create or replace function focus.replay_operation(p_actor uuid, p_key text)
returns jsonb
language plpgsql
-- Volatile, not stable: it now takes a lock, and a stable function may be
-- called fewer times than written.
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  stored jsonb;
begin
  if p_key is null then
    return null;
  end if;

  -- Whoever holds this is doing the work; anybody else waits and then finds
  -- the finished result below.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_key, 0));

  select result into stored
    from public.operation_log
   where actor_id = p_actor
     and idempotency_key = p_key;

  return stored;
end;
$$;

revoke all on function focus.replay_operation(uuid, text) from public, anon;
grant execute on function focus.replay_operation(uuid, text) to authenticated;

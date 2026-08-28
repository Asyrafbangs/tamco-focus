-- ---------------------------------------------------------------------------
-- v83 - Steps become the only answer to "what is left to do".
--
-- A task could say what remained in two places: its checklist, and a single
-- free-text `next_action`. Two places is one too many. Somebody finishing a
-- step then had to go and restate it as the next action, and the two drifted
-- apart the moment anybody forgot -- which is most of the time, because
-- restating what the system already knows is not work.
--
-- Next Action is retired. What survives of it moves into the checklist, which
-- is now called Steps everywhere it is shown.
--
-- WHAT MOVES. Only what a person typed. Four strings were written by the
-- system itself -- "Review and activate when ready", "Complete this action",
-- "Apply immediate control and update the manager" -- and v41 already
-- established that these are interface guidance wearing task data's clothes.
-- They are discarded rather than migrated: turning a fabricated sentence into
-- a real step would make it look like somebody had decided it.
--
-- WHY THE COLUMN STAYS, EMPTY. Dropping it means dropping and rebuilding
-- `task_overview` and everything layered on it, and no test suite has run
-- against this project since v68. The trigger below makes the column
-- incapable of holding a value, which is what "one source of truth" actually
-- requires; removing the empty column is a schema tidy that can wait for a
-- green test run.
--
-- The wrapper goes too. `post_task_update` existed only to carry a next
-- action alongside an update; underneath it, `post_task_update_v34_internal`
-- is the real procedure. The wrapper is dropped and the internal one takes
-- its name back.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Move person-authored next actions into Steps.
-- ---------------------------------------------------------------------------

create or replace function focus.is_system_placeholder_next_action(p_value text)
returns boolean
language sql
immutable
as $$
  select btrim(coalesce(p_value, '')) in (
    'Review and activate when ready',
    'Review and activate when ready.',
    'Complete this action',
    'Complete this action.',
    -- Written by capture_work for a mandatory operational action. Never a
    -- person's words either.
    'Apply immediate control and update the manager',
    'Apply immediate control and update the manager.'
  );
$$;

insert into public.task_checklist_items (task_id, position, action, assigned_to, state)
select
  t.id,
  coalesce(
    (select max(ci.position) from public.task_checklist_items ci where ci.task_id = t.id),
    -1
  ) + 1,
  left(btrim(t.next_action), 500),
  -- The owner's own step, so section 10 readiness never parks it.
  t.primary_owner_id,
  'ready'::public.checklist_item_state
from public.tasks t
where t.next_action is not null
  and btrim(t.next_action) <> ''
  and not focus.is_system_placeholder_next_action(t.next_action)
  and t.status not in ('completed', 'cancelled')
  and t.deleted_at is null
  -- Never twice, if this migration is ever replayed against a live database.
  and not exists (
    select 1 from public.task_checklist_items ci
     where ci.task_id = t.id
       and btrim(ci.action) = btrim(t.next_action)
  );

-- ---------------------------------------------------------------------------
-- 2. Empty the column and keep it empty.
-- ---------------------------------------------------------------------------

update public.tasks set next_action = null where next_action is not null;

create or replace function focus.clear_placeholder_next_action()
returns trigger
language plpgsql
as $$
begin
  -- v83 - the column is retired. Steps are the only record of what is left to
  -- do, and nothing may quietly reintroduce a second one.
  new.next_action := null;
  return new;
end;
$$;

comment on function focus.clear_placeholder_next_action is
  'Holds tasks.next_action at null. The concept was retired at v83; the column remains only until a release with a green test run can drop it.';

-- ---------------------------------------------------------------------------
-- 3. Remove the procedures that existed to maintain it.
-- ---------------------------------------------------------------------------

drop function if exists public.post_task_update(uuid, text, boolean, uuid, uuid[], jsonb, text, text);
drop function if exists public.set_task_next_action(uuid, integer, text, boolean, text);
drop function if exists focus.apply_task_next_action(uuid, uuid, text, boolean, text, boolean);

alter function public.post_task_update_v34_internal(uuid, text, boolean, uuid, uuid[], jsonb, text)
  rename to post_task_update;

revoke all on function public.post_task_update(uuid, text, boolean, uuid, uuid[], jsonb, text)
  from public, anon;
grant execute on function public.post_task_update(uuid, text, boolean, uuid, uuid[], jsonb, text)
  to authenticated;

comment on function public.post_task_update(uuid, text, boolean, uuid, uuid[], jsonb, text)
  is 'Posts one progress update, with optional mentions, evidence and a checklist link. Carries no next action: Steps are the only record of what remains (v83).';

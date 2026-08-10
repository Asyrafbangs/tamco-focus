-- ---------------------------------------------------------------------------
-- v47 — break the recursion between the two calendar policies.
--
-- `calendar_events` asked "is the reader a participant?" by selecting from
-- `calendar_event_participants`, whose own policy asked "may the reader see the
-- event?" by selecting from `calendar_events`. Each policy needed the other to
-- have already been evaluated, and Postgres refuses the loop outright:
--
--   42P17  infinite recursion detected in policy for relation "calendar_events"
--
-- The fix is the same one the rest of this schema uses for cross-table
-- questions: ask them in a `security definer` helper, which reads the base
-- table directly and therefore does not re-enter the policy it is being called
-- from. The visibility rule itself is unchanged.
-- ---------------------------------------------------------------------------

create or replace function focus.is_event_participant(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.calendar_event_participants p
     where p.event_id = target_event_id
       and p.user_id = auth.uid()
  );
$$;

create or replace function focus.can_view_calendar_event(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.calendar_events e
     where e.id = target_event_id
       and (
            e.created_by = auth.uid()
         or focus.is_event_participant(e.id)
         or (e.task_id is not null and focus.can_view_task(e.task_id))
       )
  );
$$;

revoke all on function focus.is_event_participant(uuid) from public, anon;
revoke all on function focus.can_view_calendar_event(uuid) from public, anon;
grant execute on function focus.is_event_participant(uuid) to authenticated;
grant execute on function focus.can_view_calendar_event(uuid) to authenticated;

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (
    focus.is_active_account()
    and (
         created_by = focus.current_user_id()
      or focus.is_event_participant(id)
      or (task_id is not null and focus.can_view_task(task_id))
    )
  );

drop policy if exists calendar_event_participants_select on public.calendar_event_participants;
create policy calendar_event_participants_select on public.calendar_event_participants
  for select to authenticated
  using (
    focus.is_active_account()
    and (user_id = focus.current_user_id() or focus.can_view_calendar_event(event_id))
  );

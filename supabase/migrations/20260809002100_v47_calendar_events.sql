-- ---------------------------------------------------------------------------
-- v47 §24-26 — a scheduled discussion is an event on the calendar that already
-- exists.
--
-- Monthly Plan renders `plan_events`, a view that until now derived every entry
-- from a task's own dates: due, overdue, routine, review. A discussion has no
-- task date to derive from — it is an appointment somebody made — so it needs a
-- row of its own. That is not a second calendar: the row unions into the same
-- view and appears on the same grid, beside the work it concerns.
--
-- The alternative, hanging a date off the meeting queue item and teaching the
-- Plan page to read a second source, would make "what is on my calendar" a
-- question with two answers that have to be kept in step.
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_events (
  id uuid primary key default extensions.gen_random_uuid(),

  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,

  -- Where this event came from. Today only the meeting queue creates events;
  -- naming the source keeps the door open without pretending to know what
  -- walks through it next.
  source_type text not null default 'meeting_queue',
  source_id uuid,

  -- The work being discussed, and the request that prompted it. Both nullable
  -- because a future event may legitimately concern neither.
  task_id uuid references public.tasks (id) on delete cascade,
  barrier_id uuid references public.barriers (id) on delete set null,

  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,

  /*
   * §44 — room for a future external calendar, deliberately empty today.
   *
   * These columns exist so that adding Outlook later is a sync job rather than
   * a migration of live appointments. Nothing writes them yet, no credentials
   * are stored, and `provider` stays null until something genuinely syncs.
   */
  provider text,
  external_event_id text,
  sync_status text,
  last_synced_at timestamptz,

  constraint calendar_events_title_not_blank check (length(btrim(title)) > 0),
  constraint calendar_events_ends_after_start check (ends_at > starts_at)
);

create index if not exists calendar_events_starts_idx on public.calendar_events (starts_at);
create index if not exists calendar_events_task_idx on public.calendar_events (task_id);
create index if not exists calendar_events_barrier_idx on public.calendar_events (barrier_id);

comment on table public.calendar_events is
  'Appointments shown on Monthly Plan alongside task dates. Currently created '
  'only by scheduling a Meeting Queue discussion (v47 sections 24-26).';

-- Who is expected to be there. A separate table because participants are a
-- set, and stuffing them into an array would make "which discussions am I in"
-- an unindexable question.
create table if not exists public.calendar_event_participants (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  primary key (event_id, user_id)
);

alter table public.calendar_events enable row level security;
alter table public.calendar_event_participants enable row level security;

/*
 * Visibility follows the work, not a second sharing system (§47).
 *
 * You may see a discussion if you are in it, if you booked it, or if you can
 * already see the task it is about. Nothing here widens what anybody can read
 * about the work itself.
 */
create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (
    focus.is_active_account()
    and (
         created_by = focus.current_user_id()
      or exists (
           select 1 from public.calendar_event_participants p
            where p.event_id = id and p.user_id = focus.current_user_id()
         )
      or (task_id is not null and focus.can_view_task(task_id))
    )
  );

create policy calendar_event_participants_select on public.calendar_event_participants
  for select to authenticated
  using (
    focus.is_active_account()
    and exists (
      select 1 from public.calendar_events e
       where e.id = event_id
         and (
              e.created_by = focus.current_user_id()
           or user_id = focus.current_user_id()
           or (e.task_id is not null and focus.can_view_task(e.task_id))
         )
    )
  );

-- Writes go through the scheduling procedure, which enforces the rules. No
-- direct insert or update policy exists, so there is no second way in.

revoke all on public.calendar_events from public, anon;
revoke all on public.calendar_event_participants from public, anon;
grant select on public.calendar_events to authenticated;
grant select on public.calendar_event_participants to authenticated;

-- ---------------------------------------------------------------------------
-- The same calendar, one more kind of entry (§26).
-- ---------------------------------------------------------------------------

drop view if exists public.plan_events;

create view public.plan_events
with (security_invoker = true)
as
select
  t.id as task_id,
  t.title,
  t.primary_owner_id,
  t.status,
  t.work_class,
  t.due_at as occurs_at,
  t.due_is_date_only,
  case
    when t.work_class = 'routine_occurrence' then 'routine'
    when t.due_at is not null
         and t.status in ('backlog', 'active', 'paused')
         and now() > t.due_at then 'overdue'
    else 'due'
  end as event_kind,
  null::uuid as event_id,
  null::uuid as barrier_id
from public.tasks t
where t.due_at is not null
  and t.status <> 'cancelled'

union all

select
  t.id,
  t.title,
  t.primary_owner_id,
  t.status,
  t.work_class,
  t.review_at,
  false,
  'review',
  null::uuid,
  null::uuid
from public.tasks t
where t.review_at is not null
  and t.status in ('backlog', 'active', 'paused')

union all

-- A booked discussion. `primary_owner_id` carries whoever arranged it so the
-- "Only me" filter keeps working without a special case.
select
  e.task_id,
  e.title,
  e.created_by,
  'active'::public.task_status,
  'operational_action'::public.work_class,
  e.starts_at,
  false,
  'discussion',
  e.id,
  e.barrier_id
from public.calendar_events e
where e.cancelled_at is null;

grant select on public.plan_events to authenticated;

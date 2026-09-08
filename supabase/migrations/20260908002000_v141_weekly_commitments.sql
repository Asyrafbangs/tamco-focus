-- v141 — this week's priorities, as references to work that already exists.
--
-- Section 7 of the Manager and Employee Change Specification. The trap it warns
-- about twice is worth stating first: a weekly priority is NOT a new kind of
-- task. It is a pointer at an existing task or one of its steps, plus the
-- result expected of it this week and the rank it holds. Copying the work into
-- a second record would give the organisation two places to finish the same
-- thing and two answers about whether it was done.
--
-- So nothing here owns a lifecycle. Delivery is DERIVED from the referenced
-- work: a commitment is delivered when its step or its task is completed, and
-- the view at the bottom says so rather than a column somebody has to maintain.
--
-- The other rule that shapes this file: an agreed commitment is a baseline
-- between two people. It is never silently overwritten. A change to it is a
-- request that sits beside it until the manager resolves it, which is why
-- `weekly_commitment_changes` exists rather than an UPDATE.

-- ---------------------------------------------------------------------------
-- The week, in the organisation's calendar.
-- ---------------------------------------------------------------------------

insert into public.org_settings (key, value, description, manager_editable)
values (
  'org.time_zone',
  '"Asia/Kuala_Lumpur"',
  'The calendar the organisation works to. Week boundaries, weekly targets and date-only rules are resolved in this zone.',
  false
)
on conflict (key) do nothing;

/*
 * `security definer` on all three, deliberately.
 *
 * They are read by `weekly_commitment_overview`, which is `security_invoker` so
 * that RLS applies to the reader — and the reader has no EXECUTE on
 * `focus.setting`, which can read any setting in the table. Rather than grant
 * that broadly, these three expose exactly one non-sensitive value: the
 * calendar the organisation works to.
 */
create or replace function focus.org_time_zone() returns text
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(focus.setting('org.time_zone') #>> '{}', 'Asia/Kuala_Lumpur');
$$;

/*
 * The Monday of the week an instant falls in, read locally.
 *
 * `date_trunc('week')` is already Monday-based in Postgres; the work here is
 * doing it in the organisation's zone rather than the server's, so a commitment
 * made at 08:00 on Monday in Kuala Lumpur does not land in the previous week
 * because UTC has not got there yet.
 */
create or replace function focus.local_week_start(at timestamptz default now()) returns date
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select (date_trunc('week', (at at time zone focus.org_time_zone())))::date;
$$;

/** Today, in the organisation's calendar. */
create or replace function focus.local_today(at timestamptz default now()) returns date
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select (at at time zone focus.org_time_zone())::date;
$$;

grant execute on function focus.org_time_zone() to authenticated, service_role;
grant execute on function focus.local_week_start(timestamptz) to authenticated, service_role;
grant execute on function focus.local_today(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- States.
--
-- Deliberately few, and none of them a task lifecycle state. Section 7 asks
-- that proposed, withdrawn, superseded, missed and carried-forward remain
-- distinguishable in history; missed and carried-forward are derived rather
-- than stored, because both are facts about the referenced work and its dates.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'weekly_commitment_state') then
    create type public.weekly_commitment_state as enum (
      'proposed',    -- put forward, awaiting the manager
      'agreed',      -- the baseline the two people are working to
      'declined',    -- the manager did not agree it; kept, not deleted
      'withdrawn',   -- the proposer took it back before it was resolved
      'superseded'   -- replaced by an agreed amendment; kept for history
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'weekly_change_kind') then
    create type public.weekly_change_kind as enum (
      'amend',        -- a different result, target or reference
      'remove',       -- drop it from the week
      'cannot_meet'   -- "I cannot meet this", with a reason
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'weekly_change_state') then
    create type public.weekly_change_state as enum ('pending', 'accepted', 'rejected', 'withdrawn');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The commitments.
-- ---------------------------------------------------------------------------

create table if not exists public.weekly_commitments (
  id uuid primary key default extensions.gen_random_uuid(),
  employee_id uuid not null references public.user_profiles (id) on delete cascade,
  -- The Monday of the week this belongs to, in the organisation's zone.
  week_start date not null,
  -- Position within that person's week. Guidance is about three; not a limit.
  rank smallint not null default 1,

  -- The work itself, never copied. A step reference carries its parent too, so
  -- the screen can show "Finalise vendor drawing review" under "BR2 sprinkler
  -- installation" without a second lookup.
  task_id uuid not null references public.tasks (id) on delete cascade,
  checklist_item_id uuid references public.task_checklist_items (id) on delete cascade,

  -- What finishing it means this week, in the employee's words. Seeded from the
  -- step or task outcome; a short clarification is allowed. It is not a second
  -- progress tracker.
  expected_result text not null,
  -- Optional, and inside the week when given.
  target_date date,

  state public.weekly_commitment_state not null default 'proposed',
  proposed_by uuid not null references public.user_profiles (id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  decision_note text,

  -- Set when this commitment exists because an unfinished one was explicitly
  -- carried into a new week. Section 7: rollover never silently re-agrees.
  carried_from_id uuid references public.weekly_commitments (id) on delete set null,
  -- Set on the old row when an amendment is agreed, so the baseline it replaced
  -- stays readable rather than being overwritten.
  superseded_by_id uuid references public.weekly_commitments (id) on delete set null,

  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint weekly_commitments_result_present check (length(btrim(expected_result)) > 0),
  -- A weekly target belongs to the selected week. Work that runs past it wants
  -- a milestone or a different week, not a target outside the one it is in.
  constraint weekly_commitments_target_in_week check (
    target_date is null
    or (target_date >= week_start and target_date < week_start + 7)
  ),
  -- The week is a Monday, so two people cannot describe the same week two ways.
  constraint weekly_commitments_week_is_monday check (extract(isodow from week_start) = 1),
  /*
   * A decision has an actor and a time.
   *
   * `superseded` keeps whatever it had: it is an agreement that was later
   * replaced, and erasing who agreed it would lose exactly the history section
   * 7 asks to preserve.
   */
  constraint weekly_commitments_decision_consistent check (
    (state in ('agreed', 'declined') and decided_by is not null and decided_at is not null)
    or (state in ('proposed', 'withdrawn') and decided_by is null and decided_at is null)
    or state = 'superseded'
  )
);

/*
 * One reference to the same work per person per week.
 *
 * `checklist_item_id` is nullable and NULLs are distinct to a unique index, so
 * the coalesce is what actually stops "the whole task" being added twice.
 * Only live states are covered: a declined or withdrawn row must not block the
 * person from proposing it again.
 */
create unique index if not exists weekly_commitments_one_reference
  on public.weekly_commitments (
    employee_id,
    week_start,
    task_id,
    coalesce(checklist_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where state in ('proposed', 'agreed');

create index if not exists weekly_commitments_week_idx
  on public.weekly_commitments (employee_id, week_start, rank);
create index if not exists weekly_commitments_task_idx on public.weekly_commitments (task_id);

drop trigger if exists weekly_commitments_touch_updated_at on public.weekly_commitments;
create trigger weekly_commitments_touch_updated_at
  before update on public.weekly_commitments
  for each row execute function focus.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Requested changes to an agreed commitment.
--
-- A separate record precisely so the agreed version survives while the request
-- is open. Section 7: display the proposed change alongside the baseline, and
-- never silently overwrite it.
-- ---------------------------------------------------------------------------

create table if not exists public.weekly_commitment_changes (
  id uuid primary key default extensions.gen_random_uuid(),
  commitment_id uuid not null references public.weekly_commitments (id) on delete cascade,
  kind public.weekly_change_kind not null,
  -- What is being asked for: the fields an `amend` would change. Read only by
  -- the resolver, which applies them under its own validation.
  payload jsonb not null default '{}'::jsonb,
  reason text not null,
  state public.weekly_change_state not null default 'pending',
  requested_by uuid not null references public.user_profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint weekly_changes_reason_present check (length(btrim(reason)) > 0),
  constraint weekly_changes_decision_consistent check (
    (state in ('accepted', 'rejected') and decided_by is not null and decided_at is not null)
    or (state not in ('accepted', 'rejected') and decided_by is null and decided_at is null)
  )
);

-- At most one open request per commitment: two competing amendments would give
-- the manager a decision they cannot make coherently.
create unique index if not exists weekly_changes_one_open
  on public.weekly_commitment_changes (commitment_id)
  where state = 'pending';

create index if not exists weekly_changes_commitment_idx
  on public.weekly_commitment_changes (commitment_id, requested_at desc);

drop trigger if exists weekly_changes_touch_updated_at on public.weekly_commitment_changes;
create trigger weekly_changes_touch_updated_at
  before update on public.weekly_commitment_changes
  for each row execute function focus.touch_updated_at();

-- ---------------------------------------------------------------------------
-- What happened to a commitment, and who did it.
-- ---------------------------------------------------------------------------

create table if not exists public.weekly_commitment_events (
  id uuid primary key default extensions.gen_random_uuid(),
  commitment_id uuid not null references public.weekly_commitments (id) on delete cascade,
  kind text not null,
  actor_id uuid references public.user_profiles (id),
  note text,
  -- Enough to read the change back without keeping a second copy of the row.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists weekly_commitment_events_idx
  on public.weekly_commitment_events (commitment_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Who may do what.
--
-- Reading follows the same visibility everything else does. Proposing is the
-- employee's, or a manager's for somebody in their team. Agreeing is the
-- manager's alone: section 22 gives an employee no authority to agree their own
-- commitments, and `is_manager_of` already excludes self.
-- ---------------------------------------------------------------------------

create or replace function focus.can_propose_commitment_for(target_id uuid) returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and (
    target_id = auth.uid()
    or (focus.is_manager_or_admin() and focus.can_view_user(target_id))
  );
$$;

create or replace function focus.can_agree_commitment_for(target_id uuid) returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select focus.is_active_account()
     and (focus.is_admin() or focus.is_manager_of(target_id));
$$;

alter table public.weekly_commitments enable row level security;
alter table public.weekly_commitment_changes enable row level security;
alter table public.weekly_commitment_events enable row level security;

drop policy if exists weekly_commitments_select on public.weekly_commitments;
create policy weekly_commitments_select on public.weekly_commitments
  for select using (employee_id = auth.uid() or focus.can_view_user(employee_id));

drop policy if exists weekly_changes_select on public.weekly_commitment_changes;
create policy weekly_changes_select on public.weekly_commitment_changes
  for select using (
    exists (
      select 1 from public.weekly_commitments c
       where c.id = commitment_id
         and (c.employee_id = auth.uid() or focus.can_view_user(c.employee_id))
    )
  );

drop policy if exists weekly_events_select on public.weekly_commitment_events;
create policy weekly_events_select on public.weekly_commitment_events
  for select using (
    exists (
      select 1 from public.weekly_commitments c
       where c.id = commitment_id
         and (c.employee_id = auth.uid() or focus.can_view_user(c.employee_id))
    )
  );

/*
 * No INSERT, UPDATE or DELETE policy anywhere, deliberately.
 *
 * Every write goes through the procedures below, which own the validation the
 * specification describes: duplicate references, targets outside the week,
 * targets past the underlying deadline, and who may agree what. A direct write
 * would be a second way to create a commitment, with none of that applied.
 */

-- ---------------------------------------------------------------------------
-- Proposing.
-- ---------------------------------------------------------------------------

create or replace function public.propose_weekly_commitment(
  p_employee_id uuid,
  p_task_id uuid,
  p_expected_result text,
  p_week_start date default null,
  p_checklist_item_id uuid default null,
  p_target_date date default null,
  p_rank smallint default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  week date := coalesce(p_week_start, focus.local_week_start());
  work public.tasks%rowtype;
  step public.task_checklist_items%rowtype;
  next_rank smallint;
  created uuid;
  task_due date;
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if not focus.can_propose_commitment_for(p_employee_id) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if length(btrim(coalesce(p_expected_result, ''))) = 0 then
    return jsonb_build_object('ok', false, 'code', 'result_required');
  end if;
  if extract(isodow from week) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'week_not_monday');
  end if;

  select * into work from public.tasks where id = p_task_id and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'work_not_found');
  end if;
  if not focus.can_view_task(p_task_id) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  if p_checklist_item_id is not null then
    select * into step from public.task_checklist_items
     where id = p_checklist_item_id and task_id = p_task_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'step_not_found');
    end if;
  end if;

  /*
   * A parent and one of its steps in the same week would count the same
   * expected result twice. Section 7 asks for a warning rather than silence,
   * so this refuses with a code the screen can explain.
   */
  if p_checklist_item_id is null and exists (
    select 1 from public.weekly_commitments c
     where c.employee_id = p_employee_id and c.week_start = week
       and c.task_id = p_task_id and c.checklist_item_id is not null
       and c.state in ('proposed', 'agreed')
  ) then
    return jsonb_build_object('ok', false, 'code', 'step_already_committed');
  end if;
  if p_checklist_item_id is not null and exists (
    select 1 from public.weekly_commitments c
     where c.employee_id = p_employee_id and c.week_start = week
       and c.task_id = p_task_id and c.checklist_item_id is null
       and c.state in ('proposed', 'agreed')
  ) then
    return jsonb_build_object('ok', false, 'code', 'parent_already_committed');
  end if;

  if p_target_date is not null and (p_target_date < week or p_target_date >= week + 7) then
    return jsonb_build_object('ok', false, 'code', 'target_outside_week');
  end if;

  /*
   * A weekly target later than the work's own deadline is a conflict to
   * resolve, not something to absorb. The task's due date is never rewritten
   * here — section 7 is explicit about that — so the caller is told and decides.
   */
  task_due := coalesce(step.due_at, work.due_at)::date;
  if p_target_date is not null and task_due is not null and p_target_date > task_due then
    return jsonb_build_object(
      'ok', false,
      'code', 'target_after_deadline',
      'task_due_on', task_due,
      'requested', p_target_date
    );
  end if;

  select coalesce(max(rank), 0) + 1 into next_rank
    from public.weekly_commitments
   where employee_id = p_employee_id and week_start = week and state in ('proposed', 'agreed');

  insert into public.weekly_commitments (
    employee_id, week_start, rank, task_id, checklist_item_id,
    expected_result, target_date, state, proposed_by
  ) values (
    p_employee_id, week, coalesce(p_rank, next_rank), p_task_id, p_checklist_item_id,
    btrim(p_expected_result), p_target_date, 'proposed', actor
  )
  returning id into created;

  insert into public.weekly_commitment_events (commitment_id, kind, actor_id, detail)
  values (created, 'proposed', actor, jsonb_build_object('week_start', week));

  return jsonb_build_object('ok', true, 'commitment_id', created, 'week_start', week);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already_committed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Agreeing, declining, withdrawing.
-- ---------------------------------------------------------------------------

create or replace function public.agree_weekly_commitment(
  p_commitment_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  row public.weekly_commitments%rowtype;
begin
  select * into row from public.weekly_commitments where id = p_commitment_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'commitment_not_found');
  end if;
  if not focus.can_agree_commitment_for(row.employee_id) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if row.state = 'agreed' then
    -- Idempotent: a second click is not a second agreement.
    return jsonb_build_object('ok', true, 'commitment_id', row.id, 'already', true);
  end if;
  if row.state <> 'proposed' then
    return jsonb_build_object('ok', false, 'code', 'not_open', 'state', row.state);
  end if;

  update public.weekly_commitments
     set state = 'agreed', decided_by = actor, decided_at = now(),
         decision_note = p_note, version = version + 1
   where id = p_commitment_id;

  /*
   * Recorded as the manager's act. Section 7: do not imply the employee
   * confirmed an agreement when only the manager acted.
   */
  insert into public.weekly_commitment_events (commitment_id, kind, actor_id, note)
  values (p_commitment_id, 'agreed', actor, p_note);

  return jsonb_build_object('ok', true, 'commitment_id', p_commitment_id);
end;
$$;

create or replace function public.decline_weekly_commitment(
  p_commitment_id uuid,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  row public.weekly_commitments%rowtype;
begin
  select * into row from public.weekly_commitments where id = p_commitment_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'commitment_not_found');
  end if;
  if not focus.can_agree_commitment_for(row.employee_id) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if row.state <> 'proposed' then
    return jsonb_build_object('ok', false, 'code', 'not_open', 'state', row.state);
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    -- Declining somebody's plan without saying why is not a decision they can
    -- act on.
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  update public.weekly_commitments
     set state = 'declined', decided_by = actor, decided_at = now(),
         decision_note = p_note, version = version + 1
   where id = p_commitment_id;

  insert into public.weekly_commitment_events (commitment_id, kind, actor_id, note)
  values (p_commitment_id, 'declined', actor, p_note);

  return jsonb_build_object('ok', true, 'commitment_id', p_commitment_id);
end;
$$;

create or replace function public.withdraw_weekly_commitment(
  p_commitment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  row public.weekly_commitments%rowtype;
begin
  select * into row from public.weekly_commitments where id = p_commitment_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'commitment_not_found');
  end if;
  -- The proposer takes back their own; an agreed baseline is changed through a
  -- request instead, so both people see it move.
  if row.proposed_by <> actor and row.employee_id <> actor then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if row.state <> 'proposed' then
    return jsonb_build_object('ok', false, 'code', 'not_open', 'state', row.state);
  end if;

  update public.weekly_commitments
     set state = 'withdrawn', version = version + 1
   where id = p_commitment_id;

  insert into public.weekly_commitment_events (commitment_id, kind, actor_id)
  values (p_commitment_id, 'withdrawn', actor);

  return jsonb_build_object('ok', true, 'commitment_id', p_commitment_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ranking.
-- ---------------------------------------------------------------------------

create or replace function public.reorder_weekly_commitments(
  p_employee_id uuid,
  p_week_start date,
  p_ordered_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  position smallint := 0;
  target uuid;
begin
  if not focus.can_propose_commitment_for(p_employee_id) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  foreach target in array p_ordered_ids loop
    position := position + 1;
    update public.weekly_commitments
       set rank = position
     where id = target
       and employee_id = p_employee_id
       and week_start = p_week_start
       and state in ('proposed', 'agreed');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'commitment_not_in_week', 'commitment_id', target);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'ranked', position);
end;
$$;

-- ---------------------------------------------------------------------------
-- Changing an agreed commitment.
-- ---------------------------------------------------------------------------

create or replace function public.request_weekly_commitment_change(
  p_commitment_id uuid,
  p_kind public.weekly_change_kind,
  p_reason text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  row public.weekly_commitments%rowtype;
  created uuid;
begin
  select * into row from public.weekly_commitments where id = p_commitment_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'commitment_not_found');
  end if;
  if row.employee_id <> actor and not focus.can_propose_commitment_for(row.employee_id) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if row.state <> 'agreed' then
    -- Only an agreed baseline needs protecting. Anything else can still be
    -- withdrawn and proposed again.
    return jsonb_build_object('ok', false, 'code', 'not_agreed', 'state', row.state);
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  insert into public.weekly_commitment_changes (
    commitment_id, kind, payload, reason, requested_by
  ) values (
    p_commitment_id, p_kind, coalesce(p_payload, '{}'::jsonb), btrim(p_reason), actor
  )
  returning id into created;

  insert into public.weekly_commitment_events (commitment_id, kind, actor_id, note, detail)
  values (
    p_commitment_id,
    case p_kind when 'cannot_meet' then 'cannot_meet_raised' else 'change_requested' end,
    actor, btrim(p_reason), jsonb_build_object('change_id', created, 'kind', p_kind)
  );

  return jsonb_build_object('ok', true, 'change_id', created);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'change_already_open');
end;
$$;

create or replace function public.resolve_weekly_commitment_change(
  p_change_id uuid,
  p_accept boolean,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  request public.weekly_commitment_changes%rowtype;
  row public.weekly_commitments%rowtype;
  new_target date;
  new_result text;
  replacement uuid;
begin
  select * into request from public.weekly_commitment_changes where id = p_change_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'change_not_found');
  end if;
  if request.state <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_resolved', 'state', request.state);
  end if;

  select * into row from public.weekly_commitments where id = request.commitment_id;
  if not focus.can_agree_commitment_for(row.employee_id) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  if not p_accept then
    update public.weekly_commitment_changes
       set state = 'rejected', decided_by = actor, decided_at = now(), decision_note = p_note
     where id = p_change_id;
    insert into public.weekly_commitment_events (commitment_id, kind, actor_id, note)
    values (row.id, 'change_rejected', actor, p_note);
    -- The baseline is untouched, which is the point of keeping them apart.
    return jsonb_build_object('ok', true, 'commitment_id', row.id, 'accepted', false);
  end if;

  if request.kind = 'remove' then
    update public.weekly_commitments
       set state = 'superseded', version = version + 1
     where id = row.id;
  else
    new_target := coalesce((request.payload ->> 'target_date')::date, row.target_date);
    new_result := coalesce(nullif(btrim(request.payload ->> 'expected_result'), ''), row.expected_result);

    if new_target is not null and (new_target < row.week_start or new_target >= row.week_start + 7) then
      return jsonb_build_object('ok', false, 'code', 'target_outside_week');
    end if;

    /*
     * The amended baseline is a NEW row and the old one is marked superseded,
     * rather than the old one being edited. A missed commitment stays missed:
     * section 7 says changing a target must not erase a result that already
     * happened.
     *
     * Superseding comes FIRST. Only one live commitment may reference a given
     * piece of work in a week, so inserting the replacement while the original
     * was still agreed collided with that index — which is the index doing its
     * job, not something to work around.
     */
    update public.weekly_commitments
       set state = 'superseded', version = version + 1
     where id = row.id;

    insert into public.weekly_commitments (
      employee_id, week_start, rank, task_id, checklist_item_id,
      expected_result, target_date, state, proposed_by, proposed_at,
      decided_by, decided_at, decision_note, carried_from_id, version
    ) values (
      row.employee_id, row.week_start, row.rank, row.task_id, row.checklist_item_id,
      new_result, new_target, 'agreed', request.requested_by, request.requested_at,
      actor, now(), p_note, row.carried_from_id, 1
    )
    returning id into replacement;

    update public.weekly_commitments
       set superseded_by_id = replacement
     where id = row.id;
  end if;

  update public.weekly_commitment_changes
     set state = 'accepted', decided_by = actor, decided_at = now(), decision_note = p_note
   where id = p_change_id;

  insert into public.weekly_commitment_events (commitment_id, kind, actor_id, note, detail)
  values (row.id, 'change_accepted', actor, p_note, jsonb_build_object('kind', request.kind));

  return jsonb_build_object('ok', true, 'commitment_id', row.id, 'accepted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Carrying an unfinished commitment into a new week.
--
-- Explicit, and linked. Section 7: unfinished commitments do not disappear and
-- do not silently become newly agreed ones — the new week starts as a proposal
-- like any other, carrying a pointer back to what it came from.
-- ---------------------------------------------------------------------------

create or replace function public.carry_forward_weekly_commitment(
  p_commitment_id uuid,
  p_week_start date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  row public.weekly_commitments%rowtype;
  week date;
  next_rank smallint;
  created uuid;
begin
  select * into row from public.weekly_commitments where id = p_commitment_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'commitment_not_found');
  end if;
  if not focus.can_propose_commitment_for(row.employee_id) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  week := coalesce(p_week_start, focus.local_week_start());
  if week <= row.week_start then
    return jsonb_build_object('ok', false, 'code', 'week_not_later');
  end if;

  select coalesce(max(rank), 0) + 1 into next_rank
    from public.weekly_commitments
   where employee_id = row.employee_id and week_start = week and state in ('proposed', 'agreed');

  insert into public.weekly_commitments (
    employee_id, week_start, rank, task_id, checklist_item_id,
    expected_result, state, proposed_by, carried_from_id
  ) values (
    row.employee_id, week, next_rank, row.task_id, row.checklist_item_id,
    row.expected_result, 'proposed', actor, row.id
  )
  returning id into created;

  insert into public.weekly_commitment_events (commitment_id, kind, actor_id, detail)
  values (created, 'carried_forward', actor, jsonb_build_object('from', row.id, 'from_week', row.week_start));

  return jsonb_build_object('ok', true, 'commitment_id', created, 'week_start', week);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already_committed');
end;
$$;

revoke all on function public.propose_weekly_commitment(uuid, uuid, text, date, uuid, date, smallint) from public;
revoke all on function public.agree_weekly_commitment(uuid, text) from public;
revoke all on function public.decline_weekly_commitment(uuid, text) from public;
revoke all on function public.withdraw_weekly_commitment(uuid) from public;
revoke all on function public.reorder_weekly_commitments(uuid, date, uuid[]) from public;
revoke all on function public.request_weekly_commitment_change(uuid, public.weekly_change_kind, text, jsonb) from public;
revoke all on function public.resolve_weekly_commitment_change(uuid, boolean, text) from public;
revoke all on function public.carry_forward_weekly_commitment(uuid, date) from public;

grant execute on function public.propose_weekly_commitment(uuid, uuid, text, date, uuid, date, smallint) to authenticated;
grant execute on function public.agree_weekly_commitment(uuid, text) to authenticated;
grant execute on function public.decline_weekly_commitment(uuid, text) to authenticated;
grant execute on function public.withdraw_weekly_commitment(uuid) to authenticated;
grant execute on function public.reorder_weekly_commitments(uuid, date, uuid[]) to authenticated;
grant execute on function public.request_weekly_commitment_change(uuid, public.weekly_change_kind, text, jsonb) to authenticated;
grant execute on function public.resolve_weekly_commitment_change(uuid, boolean, text) to authenticated;
grant execute on function public.carry_forward_weekly_commitment(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading it, with the outcome derived rather than stored.
-- ---------------------------------------------------------------------------

create or replace view public.weekly_commitment_overview
with (security_invoker = true)
as
select
  c.id,
  c.employee_id,
  c.week_start,
  c.rank,
  c.task_id,
  c.checklist_item_id,
  c.expected_result,
  c.target_date,
  c.state,
  c.proposed_by,
  c.proposed_at,
  c.decided_by,
  c.decided_at,
  c.decision_note,
  c.carried_from_id,
  c.superseded_by_id,
  c.version,
  t.title as task_title,
  t.status as task_status,
  t.work_class,
  t.due_at as task_due_at,
  t.primary_owner_id,
  i.action as step_action,
  i.state as step_state,
  -- The parent context a step commitment needs, without a second lookup.
  coalesce(i.action, t.title) as reference_title,
  (c.checklist_item_id is not null) as is_step,
  /*
   * Delivered, still due, or missed — read from the work itself.
   *
   * Nothing writes this. A stored outcome would be a second answer to "was it
   * done", and the two would disagree the first time somebody completed the
   * task from another screen.
   */
  case
    when c.state in ('withdrawn', 'declined', 'superseded') then 'closed'
    when (c.checklist_item_id is not null and i.state = 'completed')
      or (c.checklist_item_id is null and t.status = 'completed') then 'delivered'
    when coalesce(c.target_date, c.week_start + 6) < focus.local_today() then 'missed'
    else 'due'
  end as delivery_outcome,
  (
    select count(*) from public.weekly_commitment_changes ch
     where ch.commitment_id = c.id and ch.state = 'pending'
  ) as open_change_count
from public.weekly_commitments c
join public.tasks t on t.id = c.task_id
left join public.task_checklist_items i on i.id = c.checklist_item_id
where t.deleted_at is null

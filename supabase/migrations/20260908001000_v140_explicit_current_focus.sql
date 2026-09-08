-- v140 — the work somebody says they are on, because they said so.
--
-- My Team has had a "Current focus" column since v132, and it was a guess: the
-- Active task with the most recent `last_meaningful_update_at`. That is a
-- reasonable guess and it is still a guess. Opening a task to read it, renaming
-- a step, or an automated touch could all make something look like the thing
-- somebody is working on. A manager reading the column had no way to tell a
-- deliberate answer from a side effect.
--
-- So it becomes a statement. One reference per person, set by that person,
-- carrying when they set it and when they last confirmed it.
--
-- What this is NOT, and the schema is shaped to keep it that way:
--
--   * Not presence. There is no timer and no heartbeat. `selected_at` is the
--     moment of a decision, not evidence that anybody is at their desk now.
--   * Not a status. The task's own lifecycle is untouched by selecting it.
--   * Not somebody else's to set. A manager may read a selection and may not
--     write one — writing is restricted to the holder, so a row can never
--     misrepresent what an employee said about their own day.

create table if not exists public.current_focus (
  -- One per person: choosing another replaces it rather than adding to it.
  user_id uuid primary key references public.user_profiles (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- Set when the selection is a step of somebody else's work rather than the
  -- whole task. Completing that step clears this selection; completing the
  -- parent clears any selection pointing at the parent.
  checklist_item_id uuid references public.task_checklist_items (id) on delete cascade,
  selected_at timestamptz not null default now(),
  -- Moved by an explicit "still on this", never by activity. An old date is
  -- honest: it says when the person last said so.
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists current_focus_task_idx on public.current_focus (task_id);
create index if not exists current_focus_item_idx on public.current_focus (checklist_item_id);

drop trigger if exists current_focus_touch_updated_at on public.current_focus;
create trigger current_focus_touch_updated_at
  before update on public.current_focus
  for each row execute function focus.touch_updated_at();

alter table public.current_focus enable row level security;

-- Readable by the holder and by anybody authorised to see that person, which is
-- what puts it on the manager's row. Writable by the holder alone.
drop policy if exists current_focus_select on public.current_focus;
create policy current_focus_select on public.current_focus
  for select using (user_id = auth.uid() or focus.can_view_user(user_id));

drop policy if exists current_focus_write on public.current_focus;
create policy current_focus_write on public.current_focus
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Setting it.
--
-- The rules are the product's, so they are enforced here rather than by the
-- screen that happens to offer the button:
--
--   * Available work must be started first. Selecting something nobody has
--     begun would make "what I am working on" mean "what I intend to".
--   * A step may be chosen only by the person it is assigned to, and only
--     while it is still open.
--   * A whole task may be chosen by somebody who may contribute to it.
-- ---------------------------------------------------------------------------

create or replace function public.set_current_focus(
  p_task_id uuid,
  p_checklist_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  work public.tasks%rowtype;
  step public.task_checklist_items%rowtype;
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select * into work from public.tasks where id = p_task_id;
  if not found or work.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'work_not_found');
  end if;

  if p_checklist_item_id is not null then
    select * into step
      from public.task_checklist_items
     where id = p_checklist_item_id and task_id = p_task_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'step_not_found');
    end if;
    if step.assigned_to is distinct from actor then
      return jsonb_build_object('ok', false, 'code', 'step_not_yours');
    end if;
    if step.state = 'completed' then
      return jsonb_build_object('ok', false, 'code', 'step_already_complete');
    end if;
  else
    if not focus.can_contribute_to_task(p_task_id) then
      return jsonb_build_object('ok', false, 'code', 'not_permitted');
    end if;
  end if;

  if work.status = 'backlog' then
    -- §8: an Available task is started first. The screen offers one control
    -- that does both; the two acts stay separate underneath.
    return jsonb_build_object('ok', false, 'code', 'not_started');
  end if;

  if work.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'not_actionable', 'status', work.status);
  end if;

  insert into public.current_focus (user_id, task_id, checklist_item_id, selected_at, confirmed_at)
  values (actor, p_task_id, p_checklist_item_id, now(), now())
  on conflict (user_id) do update
    set task_id = excluded.task_id,
        checklist_item_id = excluded.checklist_item_id,
        selected_at = now(),
        confirmed_at = now();

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'checklist_item_id', p_checklist_item_id);
end;
$$;

create or replace function public.clear_current_focus() returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  delete from public.current_focus where user_id = actor;
  return jsonb_build_object('ok', true);
end;
$$;

-- "Still on this." Moves the confirmation without touching the selection, so a
-- stale date can be refreshed without pretending it was chosen again today.
create or replace function public.confirm_current_focus() returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  update public.current_focus set confirmed_at = now() where user_id = actor;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'nothing_selected');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_current_focus(uuid, uuid) from public;
revoke all on function public.clear_current_focus() from public;
revoke all on function public.confirm_current_focus() from public;
grant execute on function public.set_current_focus(uuid, uuid) to authenticated;
grant execute on function public.clear_current_focus() to authenticated;
grant execute on function public.confirm_current_focus() to authenticated;

-- ---------------------------------------------------------------------------
-- Clearing it, without anybody having to remember to.
--
-- A selection that outlives the work it points at is worse than none: the
-- manager's row would name something finished, and the employee would have to
-- tidy up after themselves to stop it lying.
-- ---------------------------------------------------------------------------

create or replace function focus.clear_current_focus_for_task() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Finished, cancelled, binned, or no longer in progress: nobody is on it.
  if new.status in ('completed', 'cancelled') or new.deleted_at is not null then
    delete from public.current_focus where task_id = new.id;
    return new;
  end if;

  /*
   * Reassigned. The new owner's own selection stands; anybody else keeps theirs
   * only while they still have a step of their own on this work, which is the
   * relationship that let them choose it.
   */
  if new.primary_owner_id is distinct from old.primary_owner_id then
    delete from public.current_focus cf
     where cf.task_id = new.id
       and cf.user_id <> new.primary_owner_id
       and not exists (
         select 1 from public.task_checklist_items i
          where i.task_id = new.id
            and i.assigned_to = cf.user_id
            and i.state <> 'completed'
       );
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_clear_current_focus on public.tasks;
create trigger tasks_clear_current_focus
  after update on public.tasks
  for each row execute function focus.clear_current_focus_for_task();

create or replace function focus.clear_current_focus_for_step() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  /*
   * A finished step clears a selection OF THAT STEP and nothing else.
   *
   * Somebody who picked the whole task keeps it: they have not finished the
   * task, they have finished one part of it. The `checklist_item_id` match is
   * what keeps those two apart.
   */
  if new.state = 'completed' and old.state is distinct from 'completed' then
    delete from public.current_focus where checklist_item_id = new.id;
    return new;
  end if;

  -- Handed to somebody else: the previous assignee no longer has it to be on.
  if new.assigned_to is distinct from old.assigned_to then
    delete from public.current_focus
     where checklist_item_id = new.id
       and (new.assigned_to is null or user_id <> new.assigned_to);
  end if;

  return new;
end;
$$;

drop trigger if exists checklist_items_clear_current_focus on public.task_checklist_items;
create trigger checklist_items_clear_current_focus
  after update on public.task_checklist_items
  for each row execute function focus.clear_current_focus_for_step();

-- ---------------------------------------------------------------------------
-- Reading it: one row per person, already carrying what a screen shows.
-- ---------------------------------------------------------------------------

create or replace view public.current_focus_overview
with (security_invoker = true)
as
select
  cf.user_id,
  cf.task_id,
  cf.checklist_item_id,
  cf.selected_at,
  cf.confirmed_at,
  t.title as task_title,
  t.status as task_status,
  t.work_class,
  t.due_at,
  t.due_is_date_only,
  t.primary_owner_id,
  i.action as step_action,
  -- What the person is on, named the way they would name it: the step when
  -- they chose a step, the task when they chose the task.
  coalesce(i.action, t.title) as focus_title,
  (cf.checklist_item_id is not null) as is_step
from public.current_focus cf
join public.tasks t on t.id = cf.task_id
left join public.task_checklist_items i on i.id = cf.checklist_item_id
where t.deleted_at is null

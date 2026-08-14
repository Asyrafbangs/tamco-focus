-- ---------------------------------------------------------------------------
-- v62b — recurrence people can actually express, and dates that are correct.
--
-- Three defects, all of which presented as "I set up a routine and nothing
-- happened":
--
-- 1. The monthly rule skipped a period. `date_trunc('month', after) + N months`
--    advances unconditionally, so with today the 13th and a routine due on the
--    23rd it returned 23 SEPTEMBER — the 23rd of this month was still ahead and
--    was simply passed over. Every monthly, quarterly and yearly schedule lost
--    its first period this way.
--
-- 2. `generated_through` was set to the horizon whether or not anything was
--    generated, so a date the broken rule failed to produce ended up behind the
--    watermark and could never be produced again. Silent, permanent loss.
--
-- 3. A schedule could only say "day N". There was no way to say "the first
--    Wednesday of every month", no start date at all — `start_date` was
--    accepted by the create procedure and then discarded — and no way to say
--    when a series should stop.
--
-- This replaces the arithmetic with an anchored recurrence in the shape people
-- already know from a calendar client: a pattern, a start, and an end.
-- ---------------------------------------------------------------------------

alter table public.routine_templates
  -- The anchor. Every pattern counts its interval from here, which is what
  -- makes "every 3 months" and "every 2 weeks" mean something specific rather
  -- than something relative to whenever the generator last ran.
  add column if not exists start_date date,
  -- Weekly can select several days, as a calendar client does: a walk on
  -- Monday and Thursday is one routine, not two.
  add column if not exists weekdays smallint[],
  -- 'day_of_month' = the 5th. 'nth_weekday' = the first Wednesday.
  add column if not exists monthly_mode text,
  -- 1-4, or -1 for last. -1 is a distinct concept, not the 5th: not every
  -- month has a fifth Wednesday, but every month has a last one.
  add column if not exists nth_weekday smallint,
  add column if not exists nth_weekday_dow smallint,
  -- Yearly needs the month the day belongs to.
  add column if not exists month_of_year smallint,
  -- 'never' | 'after' | 'on_date'
  add column if not exists ends_mode text not null default 'never',
  add column if not exists ends_after_count integer,
  add column if not exists ends_on_date date,
  -- Counted, not derived: occurrences can be deleted, and "stop after 10" must
  -- mean ten were scheduled, not ten still exist.
  add column if not exists occurrences_generated integer not null default 0,
  -- The Bin, matching tasks. A routine added by mistake could previously only
  -- be paused, so it stayed in the list for good.
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.user_profiles(id);

update public.routine_templates
   set start_date = coalesce(start_date, generated_through, created_at::date)
 where start_date is null;

update public.routine_templates
   set weekdays = array[weekday]
 where weekday is not null and weekdays is null;

update public.routine_templates
   set monthly_mode = 'day_of_month'
 where frequency = 'monthly' and monthly_mode is null;

update public.routine_templates
   set occurrences_generated = (
     select count(*) from public.tasks o where o.routine_template_id = routine_templates.id)
 where occurrences_generated = 0;

alter table public.routine_templates
  alter column start_date set default current_date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'routine_templates_ends_mode_check') then
    alter table public.routine_templates
      add constraint routine_templates_ends_mode_check
      check (ends_mode in ('never', 'after', 'on_date'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'routine_templates_monthly_mode_check') then
    alter table public.routine_templates
      add constraint routine_templates_monthly_mode_check
      check (monthly_mode is null or monthly_mode in ('day_of_month', 'nth_weekday'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'routine_templates_nth_weekday_check') then
    alter table public.routine_templates
      add constraint routine_templates_nth_weekday_check
      check (nth_weekday is null or nth_weekday in (1, 2, 3, 4, -1));
  end if;
end $$;

create index if not exists routine_templates_live_idx
  on public.routine_templates (is_active) where deleted_at is null;

/*
 * The old shape check insisted every monthly routine carry a day number, which
 * is precisely what "the first Wednesday of the month" does not have. Replaced
 * rather than dropped: the point of the constraint — that a schedule cannot be
 * stored half-described — still holds, it just has more shapes to allow now.
 */
alter table public.routine_templates
  drop constraint if exists routine_templates_schedule_fields_match_frequency;

alter table public.routine_templates
  add constraint routine_templates_schedule_fields_match_frequency check (
    (frequency = 'daily'
      and weekday is null and day_of_month is null and nth_weekday is null)
    or (frequency = 'weekly'
      and weekday is not null and day_of_month is null and nth_weekday is null)
    or (frequency in ('monthly', 'yearly') and weekday is null
      and (
        (coalesce(monthly_mode, 'day_of_month') = 'day_of_month'
          and day_of_month is not null and nth_weekday is null)
        or (monthly_mode = 'nth_weekday'
          and day_of_month is null
          and nth_weekday is not null and nth_weekday_dow is not null)))
  );

-- ---------------------------------------------------------------------------
-- The nth weekday of a month.
-- ---------------------------------------------------------------------------

create or replace function focus.nth_weekday_of_month(
  p_year integer,
  p_month integer,
  p_nth integer,
  p_dow integer)
returns date
language plpgsql
immutable
as $$
declare
  first_of_month date;
  last_of_month date;
  candidate date;
begin
  if p_nth is null or p_dow is null then return null; end if;

  first_of_month := make_date(p_year, p_month, 1);
  last_of_month := (date_trunc('month', first_of_month) + interval '1 month - 1 day')::date;

  if p_nth = -1 then
    -- Walk back from the end. "Last Friday" exists in every month, which is
    -- exactly why it is offered separately from "fourth".
    candidate := last_of_month;
    while extract(isodow from candidate)::integer <> p_dow loop
      candidate := candidate - 1;
    end loop;
    return candidate;
  end if;

  candidate := first_of_month;
  while extract(isodow from candidate)::integer <> p_dow loop
    candidate := candidate + 1;
  end loop;
  candidate := candidate + ((p_nth - 1) * 7);

  -- A fifth Wednesday does not exist in every month. Returning null lets the
  -- caller skip that period rather than silently sliding into the next one.
  if candidate > last_of_month then return null; end if;
  return candidate;
end;
$$;

comment on function focus.nth_weekday_of_month is
  'The nth (1-4, or -1 for last) occurrence of an ISO weekday within a month, or null when that month has no such day.';

-- ---------------------------------------------------------------------------
-- The next occurrence, counted from the start date.
-- ---------------------------------------------------------------------------

create or replace function focus.next_occurrence_date(
  p_template public.routine_templates,
  p_after date)
returns date
language plpgsql
immutable
as $$
declare
  anchor date;
  every integer;
  candidate date;
  best date;
  periods integer;
  probe integer;
  target_dom integer;
  month_start date;
  dow integer;
begin
  anchor := coalesce(p_template.start_date, p_template.created_at::date, current_date);
  every := greatest(coalesce(p_template.interval_count, 1), 1);

  case p_template.frequency
    when 'daily' then
      if p_after < anchor then
        candidate := anchor;
      else
        -- Land on the first multiple of the interval strictly after p_after,
        -- arithmetically rather than by stepping a day at a time.
        periods := ((p_after - anchor) / every) + 1;
        candidate := anchor + (periods * every);
      end if;

    when 'weekly' then
      declare
        anchor_week date := (date_trunc('week', anchor))::date;
        week_start date;
        days smallint[] := coalesce(
          nullif(p_template.weekdays, '{}'),
          case when p_template.weekday is not null then array[p_template.weekday] else null end,
          array[extract(isodow from anchor)::smallint]);
      begin
        if p_after < anchor_week then
          periods := 0;
        else
          periods := (((p_after - anchor_week) / 7) / every);
        end if;

        -- Two passes at most: the period p_after falls in, then the next one.
        for probe in 0..1 loop
          week_start := anchor_week + ((periods + probe) * every * 7);
          for dow in 1..7 loop
            if dow = any (days) then
              candidate := week_start + (dow - 1);
              if candidate > p_after and candidate >= anchor
                 and (best is null or candidate < best) then
                best := candidate;
              end if;
            end if;
          end loop;
          exit when best is not null;
        end loop;
        candidate := best;
      end;

    when 'monthly', 'yearly' then
      declare
        anchor_month date := date_trunc('month', anchor)::date;
        base_year integer := extract(year from anchor)::integer;
        run_month integer := coalesce(p_template.month_of_year, extract(month from anchor)::integer);
        months_between integer;
      begin
        if p_template.frequency = 'yearly' then
          -- Yearly names a month, so the date is BUILT in that month of each
          -- qualifying year. Stepping twelve months from the anchor instead —
          -- which is what "yearly = monthly with an interval of 12" did — can
          -- only ever land back in the anchor's own month, so a routine set to
          -- September from an August anchor produced no date at all.
          periods := greatest((extract(year from p_after)::integer - base_year) / every, 0);
        else
          months_between := ((extract(year from p_after)::integer - extract(year from anchor_month)::integer) * 12)
                            + (extract(month from p_after)::integer - extract(month from anchor_month)::integer);
          periods := greatest(months_between / every, 0);
        end if;

        /*
         * Start one period early and walk forward.
         *
         * Starting at the period p_after falls in is what the previous version
         * got wrong: it jumped a whole period before looking, so a date still
         * ahead in the current month was skipped. Beginning one back and
         * stopping at the first candidate strictly after p_after cannot skip.
         * The extra passes cover a month with no fifth weekday and a February
         * that clamps.
         */
        for probe in -1..14 loop
          if p_template.frequency = 'yearly' then
            month_start := make_date(base_year + ((periods + probe) * every), run_month, 1);
          else
            month_start := (anchor_month + ((periods + probe) * every) * interval '1 month')::date;
          end if;

          if p_template.monthly_mode = 'nth_weekday' then
            candidate := focus.nth_weekday_of_month(
              extract(year from month_start)::integer,
              extract(month from month_start)::integer,
              p_template.nth_weekday,
              p_template.nth_weekday_dow);
            if candidate is null then continue; end if;
          else
            -- Clamp 29-31 to the last day of a short month rather than rolling
            -- into the next one.
            target_dom := least(
              coalesce(p_template.day_of_month, extract(day from anchor)::integer),
              extract(day from (month_start + interval '1 month - 1 day'))::integer);
            candidate := month_start + (target_dom - 1);
          end if;

          if candidate > p_after and candidate >= anchor then
            best := candidate;
            exit;
          end if;
        end loop;
        candidate := best;
      end;
  end case;

  if candidate is null then return null; end if;
  -- A series that has been given an end date stops offering dates past it.
  if p_template.ends_mode = 'on_date' and p_template.ends_on_date is not null
     and candidate > p_template.ends_on_date then
    return null;
  end if;
  return candidate;
end;
$$;

comment on function focus.next_occurrence_date is
  'The first occurrence strictly after p_after, counted from the template start date. Null when the series has ended.';

-- ---------------------------------------------------------------------------
-- Generation, which no longer advances over dates it did not create.
-- ---------------------------------------------------------------------------

create or replace function public.generate_routine_occurrences(p_through date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  template public.routine_templates%rowtype;
  horizon date;
  cursor_date date;
  next_date date;
  new_task_id uuid;
  created integer := 0;
  made_here integer;
  lead_days integer;
begin
  if auth.uid() is not null and not focus.is_manager_or_admin() then
    return focus.error('not_authorised',
      'Only a manager or administrator can generate routine occurrences.');
  end if;

  lead_days := coalesce((focus.setting('routine.occurrence_lead_days'))::integer, 14);
  horizon := coalesce(p_through, (current_date + lead_days));

  for template in
    select * from public.routine_templates where is_active = true and deleted_at is null
  loop
    made_here := 0;
    -- One day before the start, so the start date itself is eligible. The
    -- watermark only ever moves forward, so a shorter horizon on a later run
    -- cannot rewind it and re-offer dates already generated.
    cursor_date := greatest(
      coalesce(template.generated_through, template.start_date - 1, current_date - 1),
      template.start_date - 1);

    loop
      next_date := focus.next_occurrence_date(template, cursor_date);
      -- Null means the series has ended. Past the horizon means not yet.
      exit when next_date is null or next_date > horizon;

      -- "Stop after N" counts what was scheduled, not what still exists.
      exit when template.ends_mode = 'after'
            and template.ends_after_count is not null
            and (template.occurrences_generated + made_here) >= template.ends_after_count;

      insert into public.tasks (
        title, description, next_action, status, work_class, focus_bucket, origin,
        urgency, primary_owner_id, created_by,
        due_at, due_is_date_only,
        routine_template_id, occurrence_date
      ) values (
        template.title, template.description, null, 'backlog', 'routine_occurrence', null,
        'routine_generated', 'normal', template.default_owner_id, template.created_by,
        (next_date + template.due_time) at time zone
          coalesce(current_setting('focus.org_timezone', true), 'Asia/Kuala_Lumpur'),
        false,
        template.id, next_date
      )
      on conflict (routine_template_id, occurrence_date)
        where routine_template_id is not null
        do nothing
      returning id into new_task_id;

      if new_task_id is not null then
        insert into public.task_checklist_items (task_id, position, action, evidence_rule)
        select new_task_id, ti.position, ti.action, ti.evidence_rule
          from public.routine_template_items ti
         where ti.template_id = template.id;

        perform focus.write_audit(
          p_event_type := 'routine_occurrence_generated',
          p_actor_id := auth.uid(),
          p_task_id := new_task_id,
          p_detail := jsonb_build_object(
            'template_id', template.id, 'occurrence_date', next_date));

        created := created + 1;
        made_here := made_here + 1;
        new_task_id := null;
      end if;

      cursor_date := next_date;
    end loop;

    /*
     * The watermark is the last date actually considered, never a horizon that
     * was never reached. Advancing it unconditionally is what made a date the
     * old monthly rule skipped unreachable for good.
     */
    update public.routine_templates
       set generated_through = greatest(coalesce(generated_through, horizon), least(cursor_date, horizon)),
           occurrences_generated = occurrences_generated + made_here
     where id = template.id;
  end loop;

  return jsonb_build_object('ok', true, 'code', 'generated', 'created', created);
end;
$$;

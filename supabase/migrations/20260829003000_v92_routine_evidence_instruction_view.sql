-- ---------------------------------------------------------------------------
-- v92 - the evidence instruction reaches the screen that shows it.
--
-- v91 put `evidence_instruction` on `routine_templates`, but every routine
-- screen reads `routine_template_overview`, so the sentence was stored and
-- never seen. Appended to the end of the view's column list, which is the only
-- place `create or replace view` allows one.
-- ---------------------------------------------------------------------------

create or replace view public.routine_template_overview
with (security_invoker = true) as
select t.id,
       t.title,
       t.description,
       t.default_owner_id,
       coalesce(owner.full_name, owner_dir.full_name) as owner_name,
       t.frequency,
       t.interval_count,
       t.weekday,
       t.weekdays,
       t.monthly_mode,
       t.day_of_month,
       t.nth_weekday,
       t.nth_weekday_dow,
       t.month_of_year,
       t.due_time,
       t.start_date,
       t.ends_mode,
       t.ends_after_count,
       t.ends_on_date,
       t.evidence_required,
       t.requires_completion_review,
       t.is_active,
       t.generated_through,
       t.deleted_at,
       t.deleted_by,
       t.created_by,
       t.created_at,
       (select count(*) from public.tasks o
         where o.routine_template_id = t.id and o.deleted_at is null) as occurrence_count,
       (select min(o.occurrence_date) from public.tasks o
         where o.routine_template_id = t.id and o.deleted_at is null
           and o.occurrence_date >= current_date) as next_occurrence_date,
       /*
        * What the schedule says, whether or not a task exists for it yet.
        *
        * The list only knew about generated occurrences, and generation runs a
        * fortnight ahead — so a routine due in three weeks read "nothing
        * scheduled yet", which is indistinguishable from a routine that is
        * broken. That is exactly what a monthly routine set up mid-month looked
        * like, and it was the reason a working schedule was reported as doing
        * nothing.
        */
       focus.next_occurrence_date(t.*, greatest(current_date - 1, t.start_date - 1))
         as scheduled_next_date,
       -- Appended, not inserted: `create or replace view` refuses to rename an
       -- existing column, so a new one can only go on the end.
       t.purged_at,
       t.purged_by,
       -- Appended for the same reason the two above were: `create or replace
       -- view` will not reorder or rename, so a new column goes on the end.
       t.evidence_instruction
  from public.routine_templates t
  left join public.user_profiles owner on owner.id = t.default_owner_id
  left join public.person_display owner_dir on owner_dir.id = t.default_owner_id;

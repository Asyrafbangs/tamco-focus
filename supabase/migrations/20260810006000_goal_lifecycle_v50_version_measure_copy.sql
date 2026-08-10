-- Preserve structured success measures when a new immutable Goal version is
-- proposed through the existing agreement workflow.

create or replace function focus.copy_goal_measures_to_new_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_version_id uuid;
begin
  if new.version_number <= 1 then return new; end if;

  select g.active_version_id into source_version_id
  from public.goals g
  where g.id = new.goal_id;

  if source_version_id is not null then
    insert into public.goal_success_measures (
      goal_version_id, source_measure_id, position, label, measure_type,
      target_numeric, current_numeric, unit, period, target_text, current_state
    )
    select
      new.id, m.id, m.position, m.label, m.measure_type,
      m.target_numeric, m.current_numeric, m.unit, m.period, m.target_text, m.current_state
    from public.goal_success_measures m
    where m.goal_version_id = source_version_id
    order by m.position;
  end if;

  if not exists (
    select 1 from public.goal_success_measures m where m.goal_version_id = new.id
  ) then
    insert into public.goal_success_measures (
      goal_version_id, position, label, measure_type, target_text, current_state
    ) values (
      new.id, 1, new.success_measure, 'qualitative', new.success_measure, 'not_started'
    );
  end if;

  return new;
end;
$$;

create trigger goal_versions_copy_success_measures
  after insert on public.goal_versions
  for each row execute function focus.copy_goal_measures_to_new_version();

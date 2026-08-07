-- ============================================================================
-- TAMCO Focus — auditable personal and organisation settings operations
--
-- Implements MASTER_PRODUCT_SPEC.md section 22. Personal preferences are
-- changed in one transaction, and every organisation-setting update is
-- audited even when it did not originate from the web interface.
-- ============================================================================

alter table public.user_profiles
  add column daily_brief_mode text not null default 'workdays',
  add column daily_brief_hour smallint not null default 8,
  add column status_labels_always_visible boolean not null default true,
  add column shortcut_hints boolean not null default true,
  add constraint user_profiles_daily_brief_mode_known
    check (daily_brief_mode in ('off', 'daily', 'workdays')),
  add constraint user_profiles_daily_brief_hour_range
    check (daily_brief_hour between 0 and 23);

create or replace function focus.audit_org_setting_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.value is distinct from old.value then
    perform focus.write_audit(
      p_event_type := 'settings_changed',
      p_actor_id := auth.uid(),
      p_detail := jsonb_build_object(
        'scope', 'organisation',
        'key', new.key,
        'previous', old.value,
        'value', new.value)
    );
  end if;
  return new;
end;
$$;

create trigger org_settings_write_audit
  after update of value on public.org_settings
  for each row execute function focus.audit_org_setting_change();

create or replace function public.update_my_preferences(
  p_default_landing_page text,
  p_daily_brief_mode text,
  p_daily_brief_hour smallint,
  p_quiet_hours_enabled boolean,
  p_quiet_hours_start smallint,
  p_quiet_hours_end smallint,
  p_first_day_of_week smallint,
  p_theme_preference text,
  p_text_size text,
  p_reduced_motion boolean,
  p_status_labels_always_visible boolean,
  p_shortcut_hints boolean,
  p_personal_summary_mode public.personal_summary_mode,
  p_barrier_involving_me boolean,
  p_assignment_changes boolean,
  p_collaboration_handoff boolean,
  p_due_today_and_deadlines boolean,
  p_routine_upcoming boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  previous jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change settings.');
  end if;

  if p_default_landing_page not in ('today', 'work', 'plan', 'team', 'more')
     or p_daily_brief_mode not in ('off', 'daily', 'workdays')
     or p_daily_brief_hour not between 0 and 23
     or p_first_day_of_week not between 0 and 6
     or p_theme_preference not in ('system', 'light', 'dark')
     or p_text_size not in ('default', 'large', 'larger')
     or (p_quiet_hours_enabled and (
       p_quiet_hours_start is null or p_quiet_hours_end is null
       or p_quiet_hours_start not between 0 and 23
       or p_quiet_hours_end not between 0 and 23
     ))
  then
    return focus.error('validation_failed', 'One or more preference values are invalid.');
  end if;

  select jsonb_build_object(
    'default_landing_page', default_landing_page,
    'daily_brief_mode', daily_brief_mode,
    'daily_brief_hour', daily_brief_hour,
    'quiet_hours_start', quiet_hours_start,
    'quiet_hours_end', quiet_hours_end,
    'first_day_of_week', first_day_of_week,
    'theme_preference', theme_preference,
    'text_size', text_size,
    'reduced_motion', reduced_motion,
    'status_labels_always_visible', status_labels_always_visible,
    'shortcut_hints', shortcut_hints,
    'personal_summary_mode', personal_summary_mode)
  into previous
  from public.user_profiles where id = actor;

  update public.user_profiles
     set default_landing_page = p_default_landing_page,
         daily_brief_mode = p_daily_brief_mode,
         daily_brief_hour = p_daily_brief_hour,
         quiet_hours_start = case when p_quiet_hours_enabled then p_quiet_hours_start end,
         quiet_hours_end = case when p_quiet_hours_enabled then p_quiet_hours_end end,
         first_day_of_week = p_first_day_of_week,
         theme_preference = p_theme_preference,
         text_size = p_text_size,
         reduced_motion = p_reduced_motion,
         status_labels_always_visible = p_status_labels_always_visible,
         shortcut_hints = p_shortcut_hints,
         personal_summary_mode = p_personal_summary_mode
   where id = actor;

  insert into public.user_alert_preferences (
    user_id, barrier_involving_me, assignment_changes, collaboration_handoff,
    due_today_and_deadlines, routine_upcoming)
  values (
    actor, p_barrier_involving_me, p_assignment_changes, p_collaboration_handoff,
    p_due_today_and_deadlines, p_routine_upcoming)
  on conflict (user_id) do update set
    barrier_involving_me = excluded.barrier_involving_me,
    assignment_changes = excluded.assignment_changes,
    collaboration_handoff = excluded.collaboration_handoff,
    due_today_and_deadlines = excluded.due_today_and_deadlines,
    routine_upcoming = excluded.routine_upcoming;

  perform focus.write_audit(
    p_event_type := 'settings_changed',
    p_actor_id := actor,
    p_subject_user_id := actor,
    p_detail := jsonb_build_object(
      'scope', 'personal',
      'previous', previous,
      'updated_fields', jsonb_build_array(
        'workspace', 'alerts', 'accessibility', 'weekly_summary'))
  );

  return jsonb_build_object('ok', true, 'code', 'preferences_updated');
end;
$$;

revoke all on function public.update_my_preferences(
  text, text, smallint, boolean, smallint, smallint, smallint, text, text,
  boolean, boolean, boolean, public.personal_summary_mode,
  boolean, boolean, boolean, boolean, boolean) from public, anon;

grant execute on function public.update_my_preferences(
  text, text, smallint, boolean, smallint, smallint, smallint, text, text,
  boolean, boolean, boolean, public.personal_summary_mode,
  boolean, boolean, boolean, boolean, boolean) to authenticated;

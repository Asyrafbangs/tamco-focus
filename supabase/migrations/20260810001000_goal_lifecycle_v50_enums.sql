-- TAMCO Focus v50 - Goal lifecycle vocabulary.
-- Enum values are committed separately before later migrations reference them.

alter type public.goal_health add value if not exists 'at_risk';
alter type public.goal_health add value if not exists 'off_track';

create type public.goal_measure_type as enum (
  'number',
  'percentage',
  'qualitative'
);

create type public.goal_measure_state as enum (
  'not_started',
  'progressing',
  'achieved',
  'exceeded'
);

create type public.goal_checkin_type as enum (
  'monthly',
  'quarterly',
  'year_end'
);

create type public.goal_checkin_status as enum (
  'draft',
  'submitted',
  'agreed',
  'finalized'
);

alter type public.audit_event_type add value if not exists 'goal_measure_updated';
alter type public.audit_event_type add value if not exists 'goal_monthly_checkin_submitted';
alter type public.audit_event_type add value if not exists 'goal_quarterly_checkin_submitted';
alter type public.audit_event_type add value if not exists 'goal_quarterly_checkin_agreed';
alter type public.audit_event_type add value if not exists 'goal_year_end_result_saved';
alter type public.audit_event_type add value if not exists 'goal_year_end_result_finalized';

alter type public.notification_kind add value if not exists 'goal_manager_attention';
alter type public.notification_kind add value if not exists 'goal_quarterly_due';
alter type public.notification_kind add value if not exists 'goal_year_end_due';

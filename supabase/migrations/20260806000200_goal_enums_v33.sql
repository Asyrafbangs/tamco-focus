-- ============================================================================
-- TAMCO Focus v33 — Goal vocabulary
--
-- Enum additions are isolated from the schema migration because PostgreSQL
-- requires newly added enum values to be committed before later migrations use
-- them in functions, constraints, fixtures, or indexes.
-- ============================================================================

create type public.goal_status as enum (
  'draft',
  'pending_discussion',
  'active',
  'completed',
  'closed',
  'cancelled'
);

create type public.goal_health as enum (
  'on_track',
  'need_attention',
  'support_requested',
  'completed'
);

create type public.goal_version_status as enum (
  'pending',
  'active',
  'superseded',
  'rejected'
);

create type public.goal_update_kind as enum (
  'overall',
  'milestone',
  'comment'
);

alter type public.audit_event_type add value if not exists 'goal_created';
alter type public.audit_event_type add value if not exists 'goal_update_posted';
alter type public.audit_event_type add value if not exists 'goal_milestone_updated';
alter type public.audit_event_type add value if not exists 'goal_milestone_completed';
alter type public.audit_event_type add value if not exists 'goal_version_proposed';
alter type public.audit_event_type add value if not exists 'goal_version_agreed';
alter type public.audit_event_type add value if not exists 'goal_support_requested';
alter type public.audit_event_type add value if not exists 'goal_support_resolved';
alter type public.audit_event_type add value if not exists 'goal_work_linked';
alter type public.audit_event_type add value if not exists 'goal_update_requested';
alter type public.audit_event_type add value if not exists 'goal_completed';
alter type public.audit_event_type add value if not exists 'goal_closed';

alter type public.notification_kind add value if not exists 'goal_support_requested';
alter type public.notification_kind add value if not exists 'goal_update_requested';
alter type public.notification_kind add value if not exists 'goal_version_ready';
alter type public.notification_kind add value if not exists 'goal_milestone_completed';

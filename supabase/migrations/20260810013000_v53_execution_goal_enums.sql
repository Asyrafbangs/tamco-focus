-- TAMCO Focus v53 — vocabulary for the closed-loop execution and Goal cadence.
-- Enum values are committed separately so later migrations may use them.

alter type public.proposal_status add value if not exists 'changes_requested';
alter type public.proposal_status add value if not exists 'declined';

create type public.goal_session_kind as enum ('monthly', 'quarterly');
create type public.goal_session_status as enum ('draft', 'submitted', 'completed');
create type public.goal_governance_mode as enum ('department_only', 'organization_hierarchy');
create type public.goal_plan_status as enum ('draft', 'finalized', 'reallocation_required');

alter type public.audit_event_type add value if not exists 'work_proposal_agreed';
alter type public.audit_event_type add value if not exists 'work_proposal_changes_requested';
alter type public.audit_event_type add value if not exists 'work_proposal_declined';
alter type public.audit_event_type add value if not exists 'goal_monthly_session_submitted';
alter type public.audit_event_type add value if not exists 'goal_quarterly_session_completed';
alter type public.audit_event_type add value if not exists 'goal_cancelled';
alter type public.audit_event_type add value if not exists 'goal_plan_finalized';

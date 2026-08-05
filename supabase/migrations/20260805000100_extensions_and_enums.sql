-- ============================================================================
-- TAMCO Focus — extensions, private schema, and domain enumerations
--
-- Every value below is a business vocabulary term defined by
-- MASTER_PRODUCT_SPEC.md section 5 (Terminology) and section 6 (Work model).
-- Enumerations are used rather than free text so that an unknown state cannot
-- be written by any client, including one holding the service-role key.
-- ============================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext" with schema extensions;

-- `focus` holds SECURITY DEFINER helpers and transactional procedures. It is
-- deliberately NOT exposed through the PostgREST API (see config.toml
-- `schemas`), so a browser client can never call these directly; they are
-- reachable only from `public` wrappers that re-check authorisation.
create schema if not exists focus;
revoke all on schema focus from public, anon, authenticated;
grant usage on schema focus to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Identity and authority
-- ---------------------------------------------------------------------------

-- MASTER_PRODUCT_SPEC.md section 3.
create type public.app_role as enum (
  'team_member',
  'manager',
  'administrator'
);

-- section 31B.2 — normal removal is deactivation, never destructive deletion.
create type public.account_status as enum (
  'active',
  'deactivated'
);

-- section 22.5 — administrator-configured visibility mode per viewer.
create type public.visibility_mode as enum (
  'specific_only',
  'direct_reports_plus',
  'none'
);

-- PRODUCTION_LOGIC.md "V30 — Weekly email preference logic", items 1 and 2.
create type public.personal_summary_mode as enum (
  'off',
  'focused',
  'standard'
);

create type public.team_summary_mode as enum (
  'off',
  'leadership',
  'detailed'
);

-- ---------------------------------------------------------------------------
-- Work model
-- ---------------------------------------------------------------------------

-- section 6.1 — only these four appear in the normal lifecycle. `cancelled` is
-- a terminal archived outcome, not a working column.
create type public.task_status as enum (
  'backlog',
  'active',
  'paused',
  'completed',
  'cancelled'
);

-- section 7.1 — the three buckets that carry a focus target.
create type public.focus_bucket as enum (
  'major',
  'operational',
  'self_development'
);

-- section 6.3. Quick Actions, routine occurrences, and collaborative
-- contributions deliberately carry no focus bucket.
create type public.work_class as enum (
  'quick_action',
  'major_project',
  'operational_action',
  'self_development',
  'routine_occurrence',
  'collaborative_contribution'
);

-- section 6.2 — origin is metadata, never a state or a separate board.
create type public.work_origin as enum (
  'manager_assigned',
  'self_initiated',
  'routine_generated',
  'finding_generated',
  'collaborative',
  'meeting_generated',
  'system_generated'
);

create type public.urgency_level as enum (
  'normal',
  'high',
  'critical'
);

-- section 11.1 — per checklist item.
create type public.evidence_rule as enum (
  'not_required',
  'optional',
  'required'
);

-- section 7.4 — the exact approved reason list. `other` is the only value that
-- additionally requires a free-text note.
create type public.activation_reason as enum (
  'urgent_deadline',
  'workload_peak',
  'cannot_move_out',
  'external_request',
  'dependency',
  'other'
);

-- section 15.2 — plain-language relationships, never dependency jargon.
create type public.relation_type as enum (
  'before',
  'after',
  'related'
);

-- section 14.2 — barrier impact options.
create type public.barrier_impact as enum (
  'may_delay',
  'cannot_continue',
  'safety_or_compliance_risk',
  'management_decision_required'
);

create type public.barrier_status as enum (
  'open',
  'resolved'
);

-- section 20.5 — viewing evidence is not accepting completion.
create type public.review_decision as enum (
  'accepted',
  'changes_requested'
);

create type public.review_status as enum (
  'pending',
  'decided',
  'not_required'
);

-- section 16.4 — routine finding severity drives what the occurrence creates.
create type public.finding_severity as enum (
  'minor',
  'significant',
  'immediate_risk'
);

create type public.recurrence_frequency as enum (
  'daily',
  'weekly',
  'monthly'
);

-- section 19.2 — why an item reached the decision queue.
create type public.meeting_item_source as enum (
  'barrier',
  'overdue_high_impact',
  'stale_work',
  'over_target_focus',
  'missed_selection_deadline',
  'completion_review_overdue',
  'unresolved_dependency'
);

create type public.meeting_item_status as enum (
  'open',
  'decided',
  'dismissed'
);

-- section 8.4 — the destinations Capture Work may recommend. Mandatory
-- Operational Action is reachable only through the explicit urgency question
-- (section 8.6), never from the ordinary "Change type" list.
create type public.capture_destination as enum (
  'quick_action',
  'operational_available_work',
  'routine_template_request',
  'self_development_plan',
  'collaborative_contribution',
  'major_project_request',
  'mandatory_operational_action'
);

create type public.capture_status as enum (
  'pending_confirmation',
  'confirmed',
  'discarded'
);

-- section 8.8 — proposals that genuinely need manager or administrator review.
create type public.proposal_status as enum (
  'pending',
  'approved',
  'rejected'
);

-- section 24.1 — the immutable audit vocabulary.
create type public.audit_event_type as enum (
  'task_created',
  'task_classified',
  'task_assigned',
  'task_reassigned',
  'task_activated',
  'task_moved_to_available',
  'task_paused',
  'task_resumed',
  'task_completed',
  'task_cancelled',
  'task_due_date_changed',
  'task_urgency_changed',
  'over_target_activation',
  'checklist_item_completed',
  'checklist_item_reopened',
  'update_posted',
  'attachment_added',
  'attachment_opened',
  'barrier_raised',
  'barrier_resolved',
  'relation_added',
  'relation_removed',
  'completion_submitted',
  'completion_accepted',
  'changes_requested',
  'routine_occurrence_generated',
  'routine_finding_recorded',
  'meeting_decision_recorded',
  'settings_changed',
  'visibility_changed',
  'focus_target_changed',
  'user_created',
  'user_updated',
  'user_deactivated',
  'user_reactivated',
  'user_deleted',
  'event_reversed'
);

create type public.notification_channel as enum (
  'immediate',
  'digest'
);

-- section 23.2 and 23.3.
create type public.notification_kind as enum (
  'barrier_raised',
  'work_cannot_continue',
  'mandatory_action',
  'manager_decision_required',
  'reassignment',
  'completion_review_assigned',
  'over_target_activation',
  'ordinary_assignment',
  'routine_upcoming',
  'due_soon',
  'stale_work',
  'collaboration_handoff',
  'ownership_changed'
);

create type public.email_summary_type as enum (
  'personal',
  'manager_team'
);

-- section 14.4 of PRODUCTION_LOGIC.md — delivery must be idempotent, with
-- retryable transient failure.
create type public.email_delivery_status as enum (
  'queued',
  'sent',
  'failed'
);

create type public.focus_target_scope as enum (
  'system',
  'department',
  'user'
);

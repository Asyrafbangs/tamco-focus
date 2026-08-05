-- ============================================================================
-- TAMCO Focus — immutable audit, notifications, and weekly email delivery
--
-- Implements MASTER_PRODUCT_SPEC.md sections 23, 24, 31B.3, 31B.4 and
-- PRODUCTION_LOGIC.md sections 5, 8, 14.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Audit events (section 24.1).
--
-- Immutability is enforced by a trigger that rejects UPDATE and DELETE for
-- every caller, including the service role. Undo does not erase history: it
-- writes a NEW event carrying `reversal_of_event_id` (section 24.3).
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),

  event_type public.audit_event_type not null,
  occurred_at timestamptz not null default now(),

  -- The actor. Nullable only for system-generated events such as scheduled
  -- routine occurrence generation, which no human performed.
  --
  -- ON DELETE SET NULL, not RESTRICT: an account with no participation history
  -- may be permanently deleted (section 31B.2), and deletion has to be able to
  -- sever the identity link. The event itself survives with its content intact,
  -- and `admin_security_log` retains the employee ID and email in denormalised
  -- columns that no foreign key can cascade away. The append-only trigger below
  -- permits this nulling and nothing else.
  actor_id uuid references public.user_profiles (id) on delete set null,

  -- Subjects. An event concerns at most one of each.
  task_id uuid references public.tasks (id) on delete cascade,
  subject_user_id uuid references public.user_profiles (id) on delete set null,

  previous_status public.task_status,
  new_status public.task_status,

  -- section 5 of PRODUCTION_LOGIC.md — focus context captured at event time, so
  -- a later target change cannot rewrite what the record meant.
  bucket public.focus_bucket,
  count_before smallint,
  count_after smallint,
  target_at_event smallint,
  over_target boolean,

  reason_code public.activation_reason,
  reason_note text,

  -- section 24.3 — links a reversal to the event it reverses.
  reversal_of_event_id uuid references public.audit_events (id),

  task_version integer,

  -- Everything that does not deserve a dedicated column: classification
  -- recommendation vs final choice, changed setting keys, old/new due dates.
  detail jsonb not null default '{}'::jsonb
);

create index audit_events_task_idx on public.audit_events (task_id, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, occurred_at desc);
create index audit_events_subject_user_idx on public.audit_events (subject_user_id, occurred_at desc);
create index audit_events_type_idx on public.audit_events (event_type, occurred_at desc);
create index audit_events_reversal_idx on public.audit_events (reversal_of_event_id)
  where reversal_of_event_id is not null;

create or replace function focus.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_events is append-only. Record a reversal event instead of modifying history.'
    using errcode = 'insufficient_privilege';
end;
$$;

-- The ONE permitted update: severing a reference to a permanently deleted
-- account. Every other column must be byte-identical, so this cannot be used to
-- rewrite what an event says — only to forget who it pointed at, which is what
-- deletion means. Anything else still raises.
create or replace function focus.allow_only_identity_severance()
returns trigger
language plpgsql
as $$
begin
  if new.id                   is not distinct from old.id
     and new.event_type       is not distinct from old.event_type
     and new.occurred_at      is not distinct from old.occurred_at
     and new.task_id          is not distinct from old.task_id
     and new.previous_status  is not distinct from old.previous_status
     and new.new_status       is not distinct from old.new_status
     and new.bucket           is not distinct from old.bucket
     and new.count_before     is not distinct from old.count_before
     and new.count_after      is not distinct from old.count_after
     and new.target_at_event  is not distinct from old.target_at_event
     and new.over_target      is not distinct from old.over_target
     and new.reason_code      is not distinct from old.reason_code
     and new.reason_note      is not distinct from old.reason_note
     and new.reversal_of_event_id is not distinct from old.reversal_of_event_id
     and new.task_version     is not distinct from old.task_version
     and new.detail           is not distinct from old.detail
     -- Each identity column may only go from set to NULL, never change to a
     -- different person.
     and (new.actor_id is not distinct from old.actor_id or new.actor_id is null)
     and (new.subject_user_id is not distinct from old.subject_user_id
          or new.subject_user_id is null)
  then
    return new;
  end if;

  raise exception
    'audit_events is append-only. Record a reversal event instead of modifying history.'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function focus.allow_only_identity_severance();

create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function focus.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Administrative security log (PRODUCTION_LOGIC.md section 13.4).
--
-- Deliberately does NOT reference user_profiles. A `user_deleted` event must
-- survive the deletion of the row it describes, so the actor and subject are
-- recorded as denormalised text that no foreign key can cascade away.
-- ---------------------------------------------------------------------------

create table public.admin_security_log (
  id uuid primary key default extensions.gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_type public.audit_event_type not null,

  actor_user_id uuid,
  actor_employee_id text,
  actor_email text,

  subject_user_id uuid,
  subject_employee_id text,
  subject_email text,

  summary text not null,
  detail jsonb not null default '{}'::jsonb,

  constraint admin_security_log_summary_not_blank check (length(btrim(summary)) > 0)
);

create index admin_security_log_occurred_idx on public.admin_security_log (occurred_at desc);
create index admin_security_log_subject_idx on public.admin_security_log (subject_user_id);

create trigger admin_security_log_no_update
  before update on public.admin_security_log
  for each row execute function focus.reject_audit_mutation();

create trigger admin_security_log_no_delete
  before delete on public.admin_security_log
  for each row execute function focus.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Notifications (section 23).
--
-- `channel` separates immediate notifications (23.2) from those that must be
-- folded into My Day or the digest (23.3). `requires_action` is what licenses a
-- red indicator — section 23.4 requires every red dot to mean action is
-- genuinely required, and to carry a written explanation, which is `body`.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  recipient_id uuid not null references public.user_profiles (id),

  kind public.notification_kind not null,
  channel public.notification_channel not null default 'digest',
  requires_action boolean not null default false,

  title text not null,
  body text not null,

  task_id uuid references public.tasks (id) on delete cascade,
  barrier_id uuid references public.barriers (id) on delete cascade,
  actor_id uuid references public.user_profiles (id),

  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notifications_title_not_blank check (length(btrim(title)) > 0),
  -- Every red indicator must have a written explanation (section 23.4).
  constraint notifications_body_not_blank check (length(btrim(body)) > 0)
);

create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index notifications_unread_action_idx
  on public.notifications (recipient_id)
  where read_at is null and requires_action = true;

-- ---------------------------------------------------------------------------
-- Weekly email delivery (section 31B.3, 31B.4; PRODUCTION_LOGIC.md 14.4).
--
-- The unique index on (recipient, summary type, period start) IS the
-- idempotency key. A worker restart cannot produce a second send, because the
-- insert that claims the send happens before the transport is invoked.
-- ---------------------------------------------------------------------------

create table public.email_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),

  recipient_id uuid not null references public.user_profiles (id),
  recipient_email extensions.citext not null,
  summary_type public.email_summary_type not null,

  -- Start of the reporting week in UTC, derived from the organisation-local
  -- Monday 08:00 schedule.
  period_start timestamptz not null,
  period_end timestamptz not null,

  status public.email_delivery_status not null default 'queued',
  attempt_count smallint not null default 0,
  last_error text,

  subject text not null,
  body_html text not null,
  body_text text not null,

  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  next_retry_at timestamptz,

  constraint email_deliveries_period_ordered check (period_end > period_start),
  constraint email_deliveries_sent_consistent check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  ),
  constraint email_deliveries_attempts_bounded check (attempt_count between 0 and 10)
);

create unique index email_deliveries_idempotency_key
  on public.email_deliveries (recipient_id, summary_type, period_start);
create index email_deliveries_retry_idx
  on public.email_deliveries (status, next_retry_at)
  where status = 'failed';

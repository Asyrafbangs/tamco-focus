-- v120 — every committed notification receives one durable email delivery.
--
-- The notification remains the authoritative handoff. This outbox is created
-- in the same transaction and is keyed by notification_id, so retries and
-- concurrent workers cannot create a second logical delivery record.

create table public.notification_email_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null unique
    references public.notifications (id) on delete cascade,
  recipient_id uuid not null references public.user_profiles (id) on delete restrict,
  recipient_email extensions.citext not null,

  status public.email_delivery_status not null default 'queued',
  attempt_count smallint not null default 0,
  last_error text,

  subject text,
  body_html text,
  body_text text,

  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  next_retry_at timestamptz,
  processing_started_at timestamptz,

  constraint notification_email_attempts_bounded
    check (attempt_count between 0 and 10),
  constraint notification_email_sent_consistent check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  ),
  constraint notification_email_processing_consistent check (
    (status = 'processing' and processing_started_at is not null)
    or (status <> 'processing' and processing_started_at is null)
  ),
  constraint notification_email_rendered_when_sent check (
    status <> 'sent'
    or (
      length(btrim(coalesce(subject, ''))) > 0
      and length(btrim(coalesce(body_html, ''))) > 0
      and length(btrim(coalesce(body_text, ''))) > 0
    )
  )
);

create index notification_email_claim_idx
  on public.notification_email_deliveries (
    status,
    next_retry_at,
    processing_started_at,
    queued_at
  );

alter table public.notification_email_deliveries enable row level security;

create policy notification_email_deliveries_select_own
  on public.notification_email_deliveries
  for select to authenticated
  using (recipient_id = focus.current_user_id());

revoke all on public.notification_email_deliveries from public, anon, authenticated;
grant select on public.notification_email_deliveries to authenticated;
grant all on public.notification_email_deliveries to service_role;

create or replace function focus.queue_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notification_email_deliveries (
    notification_id,
    recipient_id,
    recipient_email
  )
  select
    new.id,
    profile.id,
    profile.email
  from public.user_profiles profile
  where profile.id = new.recipient_id
    and profile.status = 'active'
  on conflict (notification_id) do nothing;

  return new;
end;
$$;

create trigger notifications_queue_email
  after insert on public.notifications
  for each row execute function focus.queue_notification_email();

create or replace function public.claim_notification_email_delivery(
  p_delivery_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.notification_email_deliveries;
begin
  update public.notification_email_deliveries
     set status = 'processing',
         attempt_count = attempt_count + 1,
         processing_started_at = now(),
         next_retry_at = null,
         last_error = null
   where id = p_delivery_id
     and attempt_count < 10
     and (
       status = 'queued'
       or (status = 'failed' and coalesce(next_retry_at, now()) <= now())
       or (
         status = 'processing'
         and processing_started_at < now() - interval '15 minutes'
       )
     )
  returning * into claimed;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_claimable');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'delivery', to_jsonb(claimed)
  );
end;
$$;

revoke all on function public.claim_notification_email_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_notification_email_delivery(uuid)
  to service_role;

comment on table public.notification_email_deliveries is
  'Transactional email outbox with one durable delivery record per application notification.';
comment on function public.claim_notification_email_delivery(uuid) is
  'Atomically claims one queued, retryable, or abandoned notification email for the service worker.';

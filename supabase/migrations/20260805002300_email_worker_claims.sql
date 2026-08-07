-- ============================================================================
-- TAMCO Focus — concurrency-safe weekly email delivery claims
--
-- Kept in a separate migration from the enum addition because PostgreSQL only
-- permits a newly added enum value to be used after that transaction commits.
-- ============================================================================

alter table public.email_deliveries
  add column processing_started_at timestamptz,
  add constraint email_deliveries_processing_consistent check (
    (status = 'processing' and processing_started_at is not null)
    or (status <> 'processing' and processing_started_at is null)
  );

create index email_deliveries_claim_idx
  on public.email_deliveries (status, next_retry_at, processing_started_at)
  where status in ('queued', 'failed', 'processing');

create or replace function public.claim_email_delivery(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.email_deliveries;
begin
  update public.email_deliveries
     set status = 'processing',
         processing_started_at = now(),
         attempt_count = attempt_count + 1,
         last_error = null,
         next_retry_at = null
   where id = p_delivery_id
     and attempt_count < 10
     and (
       status = 'queued'
       or (status = 'failed' and coalesce(next_retry_at, now()) <= now())
       or (status = 'processing' and processing_started_at < now() - interval '15 minutes')
     )
  returning * into claimed;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_claimed');
  end if;

  return jsonb_build_object('ok', true, 'code', 'claimed', 'delivery', to_jsonb(claimed));
end;
$$;

revoke all on function public.claim_email_delivery(uuid) from public, anon, authenticated;
grant execute on function public.claim_email_delivery(uuid) to service_role;

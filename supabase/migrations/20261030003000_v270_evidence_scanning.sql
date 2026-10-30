-- ============================================================================
-- v270 — evidence is scanned, in the background, after it has landed
--
-- v199 left the column pinned and said why: "There is no scanner. The column
-- exists so that one day there can be, and so that nothing ever claims a file
-- was checked when it was not." This is that day, and the same principle still
-- governs every state below — `not_scanned` and `unavailable` are different
-- things, and neither of them is `clean`.
--
-- **Scanning never blocks the owner.** They upload, the file attaches, they
-- submit. The scan happens afterwards on the scheduled worker. Somebody
-- standing on a plant floor with one bar of signal is not made to wait for a
-- virus scanner, and a scanner that is down does not stop work being reported.
--
-- An infected file is marked `rejected`, which is the state every existing
-- read already excludes — `esh_guest_file` and its staff equivalent both
-- refuse anything that is not `ready`. So quarantine needs no new gate on any
-- download path, which is the kind of change least likely to leave a hole.
--
-- Four verdicts, deliberately:
--
--   not_scanned  nothing has looked at it (no scanner configured, or not yet)
--   pending      a worker has claimed it and is looking now
--   clean        a scanner looked and found nothing
--   infected     a scanner found something; the file is quarantined
--   unavailable  a scanner was configured and could not be reached
--
-- `unavailable` exists because the alternative is lying. Without it, a file
-- nobody could scan is indistinguishable from a file nobody tried to scan, and
-- an outage would quietly look like a clean bill of health.
-- ============================================================================

alter table public.esh_evidence_assets
  drop constraint esh_evidence_assets_scan_state_check;
alter table public.esh_evidence_assets
  add constraint esh_evidence_assets_scan_state_check
    check (scan_state in ('not_scanned', 'pending', 'clean', 'infected', 'unavailable'));

alter table public.esh_evidence_assets
  add column scanned_at timestamptz,
  -- What the scanner called it. Kept so an infection can be explained to the
  -- person whose file was quarantined rather than silently disappearing.
  add column scan_detail text,
  add column scan_attempts integer not null default 0;

comment on column public.esh_evidence_assets.scan_state is
  'v270. not_scanned means nobody looked; unavailable means somebody tried and '
  'could not. Neither is clean.';

create index esh_evidence_scan_queue_idx
  on public.esh_evidence_assets (organization_id, created_at)
  where state = 'ready' and scan_state in ('not_scanned', 'pending');

alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_event_type_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_event_type_check
  check (event_type in ('owner_assignment', 'esh_reply', 'access_link',
                        'submission_received', 'submission_withdrawn',
                        'changes_requested', 'due_changed', 'finding_closed',
                        'finding_reopened', 'reassigned_away',
                        'owner_reminder', 'escalation', 'review_reminder',
                        'escalation_exhausted', 'owner_reply',
                        'escalation_reply', 'import_assignment',
                        'owner_digest', 'escalation_digest',
                        'effectiveness_due', 'evidence_infected'));

-- ---------------------------------------------------------------------------
-- The worker claims a batch
--
-- `for update skip locked`, and a stale `pending` is reclaimed after an hour,
-- so a worker that dies mid-scan does not strand its batch forever. Attempts
-- are counted and a file that has defeated five attempts is left `unavailable`
-- rather than retried until the end of time.
-- ---------------------------------------------------------------------------

create or replace function public.esh_scan_claim(p_limit integer default 20)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  with picked as (
    select e.id
      from public.esh_evidence_assets e
     where e.state = 'ready'
       and (e.scan_state = 'not_scanned'
            or (e.scan_state = 'pending' and e.scanned_at < now() - interval '1 hour'))
       and e.scan_attempts < 5
     order by e.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  ),
  marked as (
    update public.esh_evidence_assets e
       set scan_state = 'pending',
           scanned_at = now(),
           scan_attempts = e.scan_attempts + 1
      from picked
     where e.id = picked.id
     returning e.id, e.object_key, e.original_name, e.content_type, e.size_bytes
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'object_key', object_key, 'name', original_name,
           'type', content_type, 'size', size_bytes)), '[]'::jsonb)
    into v_rows from marked;

  return jsonb_build_object('ok', true, 'files', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- And records what the scanner said
-- ---------------------------------------------------------------------------

create or replace function public.esh_scan_record(
  p_asset_id uuid,
  p_verdict text,
  p_detail text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  e public.esh_evidence_assets;
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
  v_user uuid;
  v_told integer := 0;
begin
  if coalesce(p_verdict, '') not in ('clean', 'infected', 'unavailable') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into e from public.esh_evidence_assets where id = p_asset_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.esh_evidence_assets set
    scan_state = p_verdict,
    scanned_at = now(),
    scan_detail = v_detail,
    /*
     * Quarantine by the state every existing read already excludes, rather
     * than by a new condition on each download path. `esh_guest_file` and the
     * staff route both refuse anything that is not `ready`, so this closes
     * every door at once instead of one at a time.
     */
    state = case when p_verdict = 'infected' then 'rejected' else e.state end,
    rejected_reason = case when p_verdict = 'infected'
                           then coalesce(v_detail, 'Infected file quarantined')
                           else e.rejected_reason end
   where id = e.id;

  if p_verdict = 'infected' then
    insert into public.esh_audit_events
      (organization_id, actor_kind, event_type, finding_id, action_id, detail)
    values (e.organization_id, 'system', 'evidence_quarantined', e.finding_id, e.action_id,
            jsonb_build_object('asset_id', e.id, 'name', e.original_name,
                               'detail', v_detail));

    -- Somebody has to be told. A quarantined file nobody hears about is an
    -- owner who believes they have submitted evidence that nobody can open.
    for v_user in
      select x.user_id from public.esh_staff_access x
       where x.organization_id = e.organization_id
         and x.enabled
         and x.preset = 'verifier'
         and focus.esh_user_can_coordinate(x.user_id, e.finding_id)
       limit 20
    loop
      insert into public.esh_notification_outbox
        (organization_id, event_type, recipient_user_id, finding_id, action_id,
         state, link_intents, idempotency_key, next_attempt_at)
      values
        (e.organization_id, 'evidence_infected', v_user, e.finding_id, e.action_id,
         'queued', '[]'::jsonb, 'evidence_infected:' || e.id || ':' || v_user, now())
      on conflict (idempotency_key) do nothing;
      v_told := v_told + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'told', v_told);
end;
$$;

revoke all on function public.esh_scan_claim(integer) from public, anon, authenticated;
revoke all on function public.esh_scan_record(uuid, text, text) from public, anon, authenticated;
grant execute on function public.esh_scan_claim(integer) to service_role;
grant execute on function public.esh_scan_record(uuid, text, text) to service_role;

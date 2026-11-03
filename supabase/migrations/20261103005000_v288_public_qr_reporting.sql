-- v288 — public QR reporting: the data boundary v272 deliberately left closed.
--
-- v272 built the tables and wrote its own reason for stopping there: "There is
-- deliberately no anonymous policy or public submission procedure in this
-- migration. Those require the approved privacy, emergency and upload
-- operating policies before a public endpoint can be enabled." Those policies
-- are now approved, so this migration adds the submission path — and keeps the
-- switch off.
--
-- Three things are deliberate and worth stating before the SQL.
--
-- **Nothing is granted to `anon`.** The public page is served by our own
-- server, and its Server Actions hold the trust boundary: they resolve the QR
-- code, apply the rate limit, validate and rebuild the photographs, and then
-- call these procedures as the service role. Granting an anonymous database
-- role execute on a submit procedure would widen the surface v272 closed for
-- no benefit, because the browser never needs to reach the database directly.
--
-- **The reporter is anonymous unless they choose otherwise.** There is one
-- nullable contact column and nothing else about who they are: no account, no
-- IP on the report, no device identifier. The rate limit keeps its counters in
-- a separate table with a short window and no link to any report, so a report
-- cannot be traced back to a submission bucket afterwards.
--
-- **The enable switch moves to a procedure instead of a CHECK.** v272 wrote
-- `check (enabled = false)`, which made the only legal value the closed one.
-- v197 did the same thing to the rollout mode and v224 had to undo it — if the
-- pair had not been fixed, the first attempt to open the rollout would have
-- failed with a check violation at the worst possible moment. The switch is
-- now an administrator-only procedure that demands a reason, and production
-- stays closed because nobody has run it.

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------

/*
 * The constraint is dropped by definition rather than by name: v272 wrote it
 * inline, so its name is whatever Postgres chose, and `drop constraint if
 * exists <guess>` would silently do nothing and leave the switch welded shut
 * until somebody tried to open it.
 */
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.esh_qr_intake_settings'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%enabled%'
  loop
    execute format('alter table public.esh_qr_intake_settings drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.esh_qr_intake_settings
  add column updated_by uuid references public.user_profiles (id),
  add column change_reason text;

/*
 * And a row to switch. v272 created the table and nothing ever inserted into
 * it, so every read fell through to "not configured": the location lookup
 * would have refused every QR code, and the switch itself would have refused
 * the administrator trying to open the pilot. This is the same shape as the
 * rollout mode v197 welded shut and v224 had to free - a control that cannot
 * be operated is discovered at the worst possible moment, so it is found here
 * instead.
 *
 * Closed, for every organisation. Opening it is a procedure call somebody has
 * to make on purpose.
 */
insert into public.esh_qr_intake_settings (organization_id, enabled)
select id, false from public.organizations
on conflict (organization_id) do nothing;

create or replace function public.esh_set_qr_intake(
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  /*
   * The organisation comes from the settings row rather than from
   * `focus.esh_organization_id()`, which answers for the caller's ESH access -
   * and a System Administrator need not have any. v224's rollout switch
   * resolves it the same way, for the same reason: the person opening a
   * channel is not necessarily a member of the module they are opening.
   */
  org uuid;
  reason text := btrim(coalesce(p_reason, ''));
  was boolean;
begin
  -- An administrator only, and the same shape v224 gave the rollout switch:
  -- opening a channel to the whole site is not a toggle to flick in passing.
  if actor is null or not focus.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if p_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'state_required');
  end if;
  if length(reason) < 10 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  -- One organisation, one switch. Anything else fails closed rather than
  -- guessing which one the administrator meant.
  if (select count(*) from public.esh_qr_intake_settings) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'intake_not_configured');
  end if;
  select organization_id, enabled into org, was
    from public.esh_qr_intake_settings
     for update;

  update public.esh_qr_intake_settings
     set enabled = p_enabled,
         updated_at = now(),
         updated_by = actor,
         change_reason = reason
   where organization_id = org;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'qr_intake_switched',
          jsonb_build_object('from', was, 'to', p_enabled, 'reason', reason));

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

comment on function public.esh_set_qr_intake(boolean, text) is
  'v288 — an administrator opens or closes public QR reporting, with a reason. '
  'Closing it stops new reports; the ones already received stay in the queue.';

revoke all on function public.esh_set_qr_intake(boolean, text) from public, anon;
grant execute on function public.esh_set_qr_intake(boolean, text) to authenticated;

/*
 * And the administrator can read what they are about to change. v272 revoked
 * select from everybody, which was right while the only legal value was
 * "closed"; a switch somebody has to operate has to be legible to them, and
 * `focus.is_admin()` is the same test the procedure applies.
 */
grant select on table public.esh_qr_intake_settings to authenticated;

create policy esh_qr_intake_settings_admin_select on public.esh_qr_intake_settings
  as permissive for select to authenticated
  using ((select focus.is_admin()));

-- ---------------------------------------------------------------------------
-- What a public report carries
-- ---------------------------------------------------------------------------

alter table public.esh_report_intake
  -- One optional line: a name, a phone number, a radio call sign, whatever the
  -- person is willing to give. Null is the default and means anonymous, which
  -- is a state the queue shows rather than a gap it tries to fill.
  add column reporter_contact text
    check (reporter_contact is null or length(btrim(reporter_contact)) between 1 and 160),
  -- The window in which the browser that submitted may still attach photos.
  -- Hashed, short-lived, and cleared the moment it is spent.
  add column photo_token_hash text,
  add column photo_token_expires_at timestamptz;

comment on column public.esh_report_intake.reporter_contact is
  'v288 — optional. Null means the reporter chose to stay anonymous, and '
  'nothing else on the row identifies them.';

-- ---------------------------------------------------------------------------
-- The photographs
-- ---------------------------------------------------------------------------
--
-- A separate table from `esh_evidence_assets` on purpose. Evidence belongs to a
-- finding and an action and carries a chain of custody; a report that has not
-- been triaged has neither, and forcing one would mean inventing a finding
-- before anybody has decided there is one.

create table public.esh_report_intake_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  intake_id uuid not null references public.esh_report_intake (id) on delete cascade,
  object_key text not null unique,
  original_name text not null check (length(original_name) between 1 and 120),
  -- 12 MB in, which is what a current phone produces before the browser
  -- shrinks it; the stored copy is normally a few hundred kilobytes.
  declared_size bigint not null check (declared_size between 1 and 12582912),
  content_type text check (content_type in ('image/jpeg', 'image/png')),
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 12582912),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'uploading'
    check (state in ('uploading', 'ready', 'rejected')),
  rejected_reason text,
  -- The same honesty as evidence: nothing is ever called clean, and with no
  -- scanner configured every photograph reads "Not scanned".
  scan_state text not null default 'not_scanned'
    check (scan_state in ('not_scanned', 'pending', 'clean', 'infected', 'unavailable')),
  scan_detail text,
  scanned_at timestamptz,
  scan_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  check (state <> 'ready' or (content_type is not null and size_bytes is not null
                              and content_sha256 is not null))
);

create index esh_report_intake_photos_report_idx
  on public.esh_report_intake_photos (intake_id, created_at);

alter table public.esh_report_intake_photos enable row level security;

revoke all on table public.esh_report_intake_photos from anon, authenticated;
grant select on table public.esh_report_intake_photos to authenticated;

/*
 * Readable exactly where its report is. The predicate is not copied from
 * v273's policy but delegated to it through an `exists`: two copies of a
 * visibility rule drift, and the one that drifts is the one nobody is looking
 * at.
 */
create policy esh_report_intake_photos_staff_select on public.esh_report_intake_photos
  as permissive for select to authenticated
  using (
    exists (select 1 from public.esh_report_intake r where r.id = intake_id)
  );

-- ---------------------------------------------------------------------------
-- The rate limit
-- ---------------------------------------------------------------------------
--
-- Counters only, in their own table, with no link to any report. A bucket is
-- whatever the server hands over — a hash of the caller's address and a
-- per-day salt — and rows are swept daily, so there is nothing here to join a
-- report back to a person even for somebody with the whole database.

create table public.esh_public_submit_throttle (
  bucket text primary key check (length(bucket) between 8 and 128),
  window_started_at timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0)
);

alter table public.esh_public_submit_throttle enable row level security;
revoke all on table public.esh_public_submit_throttle from anon, authenticated;

comment on table public.esh_public_submit_throttle is
  'v288 — short-lived submission counters for rate limiting. No report refers '
  'to a bucket and no bucket refers to a report; rows older than a day are '
  'swept, so this cannot become a log of who reported what.';

-- ---------------------------------------------------------------------------
-- Submitting
-- ---------------------------------------------------------------------------

create or replace function public.esh_public_report_submit(
  p_public_code text,
  p_text text,
  p_reported_location text,
  p_contact text,
  p_bucket text,
  p_photo_token_hash text,
  p_window_seconds integer default 600,
  p_window_limit integer default 6
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  loc public.esh_qr_locations%rowtype;
  settings public.esh_qr_intake_settings%rowtype;
  text_in text := btrim(coalesce(p_text, ''));
  contact_in text := nullif(btrim(coalesce(p_contact, '')), '');
  v_window_seconds integer := greatest(60, least(coalesce(p_window_seconds, 600), 3600));
  v_window_limit integer := greatest(1, least(coalesce(p_window_limit, 6), 100));
  v_hits integer;
  created public.esh_report_intake%rowtype;
begin
  if text_in = '' then
    return jsonb_build_object('ok', false, 'code', 'description_required');
  end if;
  if length(text_in) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'description_too_long');
  end if;
  if contact_in is not null and length(contact_in) > 160 then
    return jsonb_build_object('ok', false, 'code', 'contact_too_long');
  end if;

  select * into loc
    from public.esh_qr_locations
   where public_code = btrim(coalesce(p_public_code, ''))
     and active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_location');
  end if;

  select * into settings
    from public.esh_qr_intake_settings
   where organization_id = loc.organization_id;
  -- Closed is the default and the production state. A report submitted while
  -- it is closed is refused outright rather than queued for later, because
  -- "received" would be a promise nobody is on the other end of.
  if not found or not settings.enabled then
    return jsonb_build_object('ok', false, 'code', 'not_enabled');
  end if;

  /*
   * The rate limit. One statement, so two submissions arriving together
   * cannot both read a stale count: the insert takes the row or the update
   * takes the lock, and the result is the count after this attempt.
   */
  if p_bucket is not null and length(btrim(p_bucket)) >= 8 then
    insert into public.esh_public_submit_throttle as throttle
      (bucket, window_started_at, hits)
    values (btrim(p_bucket), now(), 1)
    on conflict (bucket) do update
      set hits = case
                   when throttle.window_started_at
                        < now() - make_interval(secs => v_window_seconds)
                   then 1
                   else throttle.hits + 1
                 end,
          window_started_at = case
                                when throttle.window_started_at
                                     < now() - make_interval(secs => v_window_seconds)
                                then now()
                                else throttle.window_started_at
                              end
    returning throttle.hits into v_hits;
    if v_hits > v_window_limit then
      return jsonb_build_object('ok', false, 'code', 'too_many_reports');
    end if;
  end if;

  insert into public.esh_report_intake
    (organization_id, qr_location_id, source, status, report_text, reported_location,
     department_id, reporter_contact, photo_token_hash, photo_token_expires_at)
  values (loc.organization_id, loc.id, 'qr', 'new', text_in,
          coalesce(nullif(btrim(coalesce(p_reported_location, '')), ''), loc.display_label),
          loc.department_id, contact_in,
          nullif(btrim(coalesce(p_photo_token_hash, '')), ''),
          case when p_photo_token_hash is null then null else now() + interval '20 minutes' end)
  returning * into created;

  insert into public.esh_audit_events
    (organization_id, actor_kind, event_type, detail)
  values (loc.organization_id, 'system', 'public_report_received',
          jsonb_build_object('intake_id', created.id, 'location', loc.public_code,
                             'anonymous', contact_in is null));

  return jsonb_build_object('ok', true, 'reference', created.public_reference,
                            'intake_id', created.id);
end;
$$;

comment on function public.esh_public_report_submit(text, text, text, text, text, text, integer, integer) is
  'v288 — a public safety report from a QR code. Called by the server on behalf '
  'of somebody who is not signed in; refuses everything while the switch is off.';

revoke all on function
  public.esh_public_report_submit(text, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.esh_public_report_submit(text, text, text, text, text, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Attaching a photograph to a report just submitted
-- ---------------------------------------------------------------------------

create or replace function public.esh_public_photo_start(
  p_reference uuid,
  p_token_hash text,
  p_name text,
  p_size bigint,
  p_max_photos integer default 3
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  intake public.esh_report_intake%rowtype;
  cap integer := greatest(1, least(coalesce(p_max_photos, 3), 10));
  attached integer;
  new_id uuid := gen_random_uuid();
  key text;
begin
  if p_size is null or p_size <= 0 or p_size > 12582912 then
    return jsonb_build_object('ok', false, 'code', 'too_large');
  end if;

  select * into intake
    from public.esh_report_intake
   where public_reference = p_reference
     for update;
  /*
   * The token is the whole authorisation. It is compared as a hash, it expires
   * after twenty minutes, and a report with none cannot accept photographs at
   * all - so knowing a reference, which the reporter is shown, is not enough.
   */
  if not found
     or intake.photo_token_hash is null
     or p_token_hash is null
     or intake.photo_token_hash <> btrim(p_token_hash)
     or intake.photo_token_expires_at is null
     or intake.photo_token_expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if intake.status <> 'new' then
    return jsonb_build_object('ok', false, 'code', 'already_triaged');
  end if;

  select count(*) into attached
    from public.esh_report_intake_photos
   where intake_id = intake.id
     and state <> 'rejected';
  if attached >= cap then
    return jsonb_build_object('ok', false, 'code', 'too_many_photos');
  end if;

  key := 'intake/' || intake.id::text || '/' || new_id::text;
  insert into public.esh_report_intake_photos
    (id, organization_id, intake_id, object_key, original_name, declared_size)
  values (new_id, intake.organization_id, intake.id, key,
          left(coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'photo.jpg'), 120), p_size);

  return jsonb_build_object('ok', true, 'photo_id', new_id, 'object_key', key);
end;
$$;

create or replace function public.esh_public_photo_finish(
  p_photo_id uuid,
  p_ok boolean,
  p_type text,
  p_size bigint,
  p_sha256 text,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  photo public.esh_report_intake_photos%rowtype;
begin
  select * into photo
    from public.esh_report_intake_photos
   where id = p_photo_id
     for update;
  if not found or photo.state <> 'uploading' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not coalesce(p_ok, false) then
    update public.esh_report_intake_photos
       set state = 'rejected', rejected_reason = left(coalesce(p_reason, 'refused'), 200)
     where id = photo.id;
    return jsonb_build_object('ok', false, 'code', coalesce(p_reason, 'refused'));
  end if;

  update public.esh_report_intake_photos
     set state = 'ready',
         content_type = p_type,
         size_bytes = p_size,
         content_sha256 = p_sha256,
         ready_at = now()
   where id = photo.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.esh_public_photo_start(uuid, text, text, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.esh_public_photo_finish(uuid, boolean, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.esh_public_photo_start(uuid, text, text, bigint, integer)
  to service_role;
grant execute on function public.esh_public_photo_finish(uuid, boolean, text, bigint, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- What the form needs before anybody types anything
-- ---------------------------------------------------------------------------

create or replace function public.esh_qr_location_for(p_public_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  loc public.esh_qr_locations%rowtype;
  settings public.esh_qr_intake_settings%rowtype;
begin
  select * into loc
    from public.esh_qr_locations
   where public_code = btrim(coalesce(p_public_code, ''))
     and active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_location');
  end if;
  select * into settings
    from public.esh_qr_intake_settings
   where organization_id = loc.organization_id;
  if not found or not settings.enabled then
    return jsonb_build_object('ok', false, 'code', 'not_enabled');
  end if;
  return jsonb_build_object('ok', true, 'label', loc.display_label, 'code', loc.public_code);
end;
$$;

revoke all on function public.esh_qr_location_for(text) from public, anon, authenticated;
grant execute on function public.esh_qr_location_for(text) to service_role;

-- ---------------------------------------------------------------------------
-- Sweeping the counters and the spent tokens
-- ---------------------------------------------------------------------------

create or replace function public.esh_public_intake_sweep()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  buckets integer;
  tokens integer;
begin
  with gone as (
    delete from public.esh_public_submit_throttle
     where window_started_at < now() - interval '1 day'
     returning 1
  )
  select count(*) into buckets from gone;

  -- A spent or expired photo window is not kept: it is authorisation, and
  -- authorisation that outlives its purpose is only a liability.
  with cleared as (
    update public.esh_report_intake
       set photo_token_hash = null, photo_token_expires_at = null
     where photo_token_hash is not null
       and (photo_token_expires_at is null or photo_token_expires_at < now())
     returning 1
  )
  select count(*) into tokens from cleared;

  return jsonb_build_object('ok', true, 'buckets', buckets, 'tokens', tokens);
end;
$$;

revoke all on function public.esh_public_intake_sweep() from public, anon, authenticated;
grant execute on function public.esh_public_intake_sweep() to service_role;

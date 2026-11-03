-- v286 — the uploads that never finished, and the objects they left behind.
--
-- An evidence upload is three steps: a procedure names the object, the browser
-- puts the bytes there with a one-time URL, the server reads them back and
-- records what they are. Steps one and two can happen without step three — the
-- phone loses signal mid-upload, the person closes the tab, the Server Action
-- is cancelled by a navigation. What is left is a row stuck in `uploading` and,
-- very often, a private object nobody will ever read.
--
-- The same is true of v271's second upload. The compressed copy attaches and
-- the message goes; the camera's own file follows in the background, and
-- `source_state = 'pending'` is what says it is still coming. If it never
-- arrives that row says "still arriving" for ever, and `sourceNote` tells ESH
-- exactly that, indefinitely.
--
-- Neither is a security hole and neither loses anybody's evidence. They are
-- storage nobody can account for and a status that stops being true, which is
-- the kind of thing that is easy to fix now and awkward to fix once there are
-- thousands of them.
--
-- This procedure only decides and records. Removing the objects is the
-- worker's job, because only the service role can reach the bucket, and it is
-- the reason the rows are marked first: a key that has been handed out is a
-- key that will be deleted, so nothing is left pointing at an object that is
-- about to stop existing.

create or replace function public.esh_evidence_claim_orphans(
  p_older_than_minutes integer default 120,
  p_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz;
  v_limit integer;
  v_abandoned jsonb;
  v_sources jsonb;
begin
  -- Never less than five minutes. An upload in flight must not be swept out
  -- from under the person making it, and a caller passing 0 or a negative
  -- number is a mistake rather than an instruction.
  v_cutoff := now() - make_interval(
    mins => greatest(5, least(coalesce(p_older_than_minutes, 120), 10080))
  );
  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  with picked as (
    select e.id
      from public.esh_evidence_assets e
     where e.state = 'uploading'
       and e.created_at < v_cutoff
     order by e.created_at
     limit v_limit
     for update skip locked
  ),
  marked as (
    update public.esh_evidence_assets e
       set state = 'rejected',
           rejected_reason = 'abandoned'
      from picked
     where e.id = picked.id
     returning e.id, e.object_key
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('id', id, 'object_key', object_key)),
           '[]'::jsonb
         )
    into v_abandoned
    from marked;

  /*
   * The second upload, which has its own key and its own clock. The asset
   * itself is untouched: its compressed copy is attached, sent and verified,
   * and the only thing that changes is the sentence ESH reads about the
   * original. `source_object_key` is cleared with it, so nothing points at the
   * object this call is about to have deleted.
   */
  with picked as (
    -- The key is read here, before the update clears it: `returning` on the
    -- updated table would hand back the null this statement just wrote.
    select e.id, e.source_object_key
      from public.esh_evidence_assets e
     where e.source_state = 'pending'
       and coalesce(e.source_started_at, e.created_at) < v_cutoff
     order by coalesce(e.source_started_at, e.created_at)
     limit v_limit
     for update skip locked
  ),
  marked as (
    update public.esh_evidence_assets e
       set source_state = 'unavailable',
           source_object_key = null
      from picked
     where e.id = picked.id
     returning picked.id as asset_id, picked.source_object_key as object_key
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('id', asset_id, 'object_key', object_key)),
           '[]'::jsonb
         )
    into v_sources
    from marked;

  return jsonb_build_object('ok', true, 'abandoned', v_abandoned, 'sources', v_sources);
end;
$$;

comment on function public.esh_evidence_claim_orphans(integer, integer) is
  'v286 — marks abandoned uploads and never-arrived originals, and returns the '
  'object keys the worker must then delete from the private bucket.';

revoke all on function public.esh_evidence_claim_orphans(integer, integer)
  from public, anon, authenticated;
grant execute on function public.esh_evidence_claim_orphans(integer, integer) to service_role;

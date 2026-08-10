-- ---------------------------------------------------------------------------
-- v52 — record that a manager reviewed an over-target workload and accepted it.
--
-- Deliberately changes nothing else. It does not touch the mandatory work that
-- caused the condition, does not alter anybody's focus counts, and does not
-- clear the over-target state — the person really is still over target, and
-- pretending otherwise would hide the thing the review existed to consider.
--
-- What it produces is a record: this manager, this person, these numbers, at
-- this time. That is what "reviewed and accepted" means, and without it the
-- panel was asking for a decision it then threw away.
-- ---------------------------------------------------------------------------

create or replace function public.accept_workload_review(
  p_person_id uuid,
  p_bucket public.focus_bucket,
  p_active_count integer,
  p_recommended_target integer,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  person public.user_profiles;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to record this.');
  end if;

  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then return replayed; end if;
  end if;

  select * into person from public.user_profiles where id = p_person_id;
  if not found then
    return focus.error('not_found', 'That team member no longer exists.');
  end if;

  -- The same authority that lets somebody see the workload review at all:
  -- their manager, or an administrator.
  if not focus.can_view_user(p_person_id) and not focus.is_admin() then
    return focus.error('not_authorised', 'You are not authorised to review this workload.');
  end if;

  perform focus.write_audit(
    p_event_type := 'workload_review_accepted',
    p_actor_id := actor,
    p_subject_user_id := p_person_id,
    p_bucket := p_bucket,
    p_count_after := p_active_count,
    p_target := p_recommended_target,
    p_over_target := p_active_count > p_recommended_target,
    p_detail := jsonb_build_object(
      'accepted_at', now(),
      'active_count', p_active_count,
      'recommended_target', p_recommended_target));

  result := jsonb_build_object('ok', true, 'code', 'workload_review_accepted');
  return focus.remember_operation(actor, p_idempotency_key, 'accept_workload_review', result);
end;
$$;

revoke all on function public.accept_workload_review(
  uuid, public.focus_bucket, integer, integer, text) from public, anon;
grant execute on function public.accept_workload_review(
  uuid, public.focus_bucket, integer, integer, text) to authenticated;

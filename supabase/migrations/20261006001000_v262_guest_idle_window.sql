-- ---------------------------------------------------------------------------
-- v262 — a guest session survives a working shift, not a working week.
--
-- The idle window was two hours. An action owner on the factory floor opens
-- the action at the start of a shift, walks to the machine, does the work, and
-- comes back to attach the photograph — and two hours is comfortably shorter
-- than that gap, so the session was gone and the one thing they came back to
-- do asked them to go and find an email first.
--
-- Eight hours covers a shift. The twelve-hour absolute cap is unchanged and
-- deliberately so: it is what stops a session becoming a standing login on a
-- shared or personal device, and in practice it is now the rule that ends most
-- sessions, with the idle window catching the ones left open and abandoned.
--
-- The 24-hour life of an emailed link is also unchanged (§18): that is the
-- exposure if a notification is forwarded or leaked, and it is a different
-- question from how long somebody already verified stays verified.
-- ---------------------------------------------------------------------------

/*
 * The live session behind a secret, or null. Expired, idle, revoked, a
 * contact switched off or an identity since changed all read as no session.
 */
create or replace function focus.esh_guest_resolve(p_session text, p_touch boolean)
returns public.esh_guest_sessions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  v_identity integer;
begin
  if p_session is null or length(p_session) < 40 then
    return null;
  end if;
  select * into s from public.esh_guest_sessions
   where session_hash = focus.esh_secret_hash(p_session);
  if not found or s.revoked_at is not null
     or s.absolute_expires_at <= now()
     or s.last_used_at <= now() - interval '8 hours'
     or not focus.esh_contact_usable(s.principal_id) then
    return null;
  end if;
  select identity_version into v_identity from public.esh_email_principals where id = s.principal_id;
  if v_identity is distinct from s.identity_version then
    return null;
  end if;
  if p_touch and s.last_used_at < now() - interval '1 minute' then
    update public.esh_guest_sessions set last_used_at = now() where id = s.id;
    s.last_used_at := now();
  end if;
  return s;
end;
$$;

comment on table public.esh_guest_sessions is
  'Guest sessions for email-verified action owners (§18). Twelve hours at '
  'most, eight hours idle since v262. `inbox_scope` is the owner''s own inbox; '
  'the action rows are the single actions a link opened, each bound to the '
  'assignment it was sent for, so a reassignment ends it (§14).';

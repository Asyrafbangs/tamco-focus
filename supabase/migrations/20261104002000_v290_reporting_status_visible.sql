-- v290 — ESH can see whether the public channel is open.
--
-- The Finding Management Today page told every reader "Public QR reporting is
-- not enabled" in hard-coded text. It was true when it was written and false
-- the moment an administrator opened the channel — which happened on
-- 4 November 2026, leaving the ESH team reading that no reports could arrive
-- while the form was live.
--
-- The page could not have done better: v288 gave `esh_qr_intake_settings` one
-- select policy, for `focus.is_admin()`, so the row is invisible to the
-- coordinators who actually watch the queue. A screen cannot report a state it
-- is not allowed to read.
--
-- This adds the second policy. The switch's state is not a secret from the
-- people who triage what comes through it — and the whole point of showing it
-- is that somebody notices when reports should be arriving and are not.

create policy esh_qr_intake_settings_staff_select on public.esh_qr_intake_settings
  as permissive for select to authenticated
  using ((select focus.esh_enabled()));

comment on table public.esh_qr_intake_settings is
  'v272/v288/v290 — the public QR reporting switch. Readable by anybody with '
  'Finding Management access so the module can report its own state; writable '
  'only through esh_set_qr_intake, by an administrator, with a reason.';

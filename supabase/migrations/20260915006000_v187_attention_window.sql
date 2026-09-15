-- ============================================================================
-- TAMCO Focus v187 — the attention window
--
-- The Product Owner, 15 September 2026: overdue is already late, due soon is
-- due within the next five days, and everything further out is normal — the
-- same rule for tasks and steps, on every screen, as one organisation setting.
--
-- `day.upcoming_window_days` already existed, and meant only how far ahead My
-- Day's Coming up looked. It becomes that window. The value moves from 7 to 5
-- only where it is still the original 7, so an organisation that chose its
-- own window keeps it. The change is audited by org_settings_write_audit, with
-- no actor, as a migration.
-- ============================================================================

update public.org_settings
   set value = '5'::jsonb
 where key = 'day.upcoming_window_days'
   and value = '7'::jsonb;

update public.org_settings
   set description = 'The attention window: work and steps due within this many days count as due soon on My Day, My Work, Shared, a task''s steps and My Team. Overdue work is always shown.'
 where key = 'day.upcoming_window_days';

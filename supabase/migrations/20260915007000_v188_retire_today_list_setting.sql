-- ============================================================================
-- TAMCO Focus v188 — My Day as the action view
--
-- `day.today_list_max_items` bounded My Day's ranked Today list, then Next up
-- (section 9.6). v188 replaces that list with the Overdue and Due within N
-- days sections, which show every card that applies rather than a ranked few,
-- so nothing reads the setting any more. A setting that changes nothing is a
-- control that lies, so it goes: from Settings in the application, and here.
-- ============================================================================

delete from public.org_settings
 where key = 'day.today_list_max_items';

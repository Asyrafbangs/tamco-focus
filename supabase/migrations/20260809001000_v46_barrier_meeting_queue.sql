-- ---------------------------------------------------------------------------
-- v46 sections 18-19, 46-47 — "this needs discussing" belongs to the person
-- being asked.
--
-- Adding a barrier to the Meeting Queue was previously a checkbox on the
-- employee's Raise Barrier form, which asked the wrong person: the employee
-- had to predict whether their manager would want to handle the problem in
-- writing or in a meeting. Only the manager, reading the request, knows that.
--
-- No new table. `meeting_queue_items` already carries `source`, `barrier_id`
-- and `task_id`; a barrier-shaped meeting item is exactly what it was built
-- for. What is added here is the transactional entry point, so pressing the
-- button twice cannot produce two identical agenda lines.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'barrier_added_to_meeting_queue';

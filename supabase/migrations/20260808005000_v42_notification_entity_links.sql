-- ---------------------------------------------------------------------------
-- v42 sections M and N — notifications that open the exact thing they mention.
--
-- The table already links a task and a barrier, which covered every case until
-- Shared contributions arrived. A contribution is a checklist item, not a task,
-- so "Shared contribution ready" had nothing precise to point at. Rather than
-- add a third nullable foreign key — and a fourth next time — this adds a
-- generic pair.
--
-- `entity_id` is deliberately NOT a foreign key. It has to name rows in
-- different tables, and a notification should not keep a deleted record alive
-- or vanish with it: the bell says what happened, and a dead link is handled by
-- the reader, which resolves it through RLS like anything else.
-- ---------------------------------------------------------------------------

alter table public.notifications
  add column if not exists entity_type text,
  add column if not exists entity_id uuid;

comment on column public.notifications.entity_type is
  'What this notification is about: task, checklist_item, barrier, goal, '
  'routine_occurrence. Paired with entity_id to open the exact record.';

-- Backfill from the columns that already carried the link, so existing
-- notifications gain deep links rather than being left as dead text.
update public.notifications
   set entity_type = 'barrier', entity_id = barrier_id
 where entity_id is null and barrier_id is not null;

update public.notifications
   set entity_type = 'task', entity_id = task_id
 where entity_id is null and task_id is not null;

alter table public.notifications
  drop constraint if exists notifications_entity_pair_complete;
alter table public.notifications
  add constraint notifications_entity_pair_complete check (
    (entity_type is null and entity_id is null)
    or (entity_type is not null and entity_id is not null)
  );

-- The bell reads exactly one thing: this person's unread, actionable items.
create index if not exists notifications_bell_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null and requires_action;

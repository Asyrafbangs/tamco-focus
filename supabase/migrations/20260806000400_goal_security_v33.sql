-- ============================================================================
-- TAMCO Focus v33 — Goal authorisation, RLS, private Storage and shared audit
-- helpers. View access remains strictly separate from update/agreement rights.
-- ============================================================================

create or replace function focus.can_view_goal(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
      from public.goals g
     where g.id = target_goal_id
       and (
            g.owner_id = auth.uid()
         or g.manager_id = auth.uid()
         or focus.is_admin()
         or focus.can_view_user(g.owner_id)
         or exists (
              select 1
                from public.goal_participants gp
               where gp.goal_id = g.id and gp.user_id = auth.uid()
            )
       )
  );
$$;

create or replace function focus.can_update_goal(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
      from public.goals g
     where g.id = target_goal_id
       and (
            g.owner_id = auth.uid()
         or g.manager_id = auth.uid()
         or focus.is_admin()
         or (focus.is_manager_or_admin() and focus.is_manager_of(g.owner_id))
       )
  );
$$;

create or replace function focus.can_edit_goal_structure(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.can_update_goal(target_goal_id);
$$;

create or replace function focus.can_agree_goal(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
      from public.goals g
     where g.id = target_goal_id
       and g.owner_id <> auth.uid()
       and (
            focus.is_admin()
         or g.manager_id = auth.uid()
         or (focus.is_manager_or_admin() and focus.is_manager_of(g.owner_id))
       )
  );
$$;

create or replace function focus.goal_weighted_progress(target_goal_id uuid)
returns smallint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    round(sum(m.progress_percent * m.weight_percent)::numeric / nullif(sum(m.weight_percent), 0)),
    0
  )::smallint
    from public.goals g
    join public.goal_milestones m on m.goal_version_id = g.active_version_id
   where g.id = target_goal_id;
$$;

create or replace function focus.write_goal_audit(
  p_event_type public.audit_event_type,
  p_actor_id uuid,
  p_goal_id uuid,
  p_subject_user_id uuid,
  p_goal_version integer,
  p_detail jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
begin
  insert into public.audit_events (
    event_type, actor_id, goal_id, subject_user_id, task_version, detail
  ) values (
    p_event_type, p_actor_id, p_goal_id, p_subject_user_id, p_goal_version,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('goal_version', p_goal_version)
  )
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function focus.notify_goal(
  p_recipient uuid,
  p_kind public.notification_kind,
  p_channel public.notification_channel,
  p_requires_action boolean,
  p_title text,
  p_body text,
  p_goal_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_recipient is null or p_recipient = p_actor_id then return; end if;
  if not exists (
    select 1 from public.user_profiles where id = p_recipient and status = 'active'
  ) then return; end if;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body, goal_id, actor_id
  ) values (
    p_recipient, p_kind, p_channel, p_requires_action, p_title, p_body,
    p_goal_id, p_actor_id
  );
end;
$$;

create or replace function public.get_goal_capabilities(p_goal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or not focus.can_view_goal(p_goal_id) then
      jsonb_build_object(
        'can_view', false,
        'can_update', false,
        'can_edit_structure', false,
        'can_agree', false
      )
    else jsonb_build_object(
      'can_view', true,
      'can_update', focus.can_update_goal(p_goal_id),
      'can_edit_structure', focus.can_edit_goal_structure(p_goal_id),
      'can_agree', focus.can_agree_goal(p_goal_id)
    )
  end;
$$;

alter table public.goals                  enable row level security;
alter table public.goal_participants      enable row level security;
alter table public.goal_versions          enable row level security;
alter table public.goal_milestones        enable row level security;
alter table public.goal_agreements        enable row level security;
alter table public.goal_updates           enable row level security;
alter table public.goal_milestone_updates enable row level security;
alter table public.goal_attachments       enable row level security;
alter table public.goal_attachment_views  enable row level security;
alter table public.goal_work_links        enable row level security;
alter table public.goal_support_requests  enable row level security;

create policy goals_select on public.goals
  for select to authenticated
  using (focus.can_view_goal(id));

create policy goal_participants_select on public.goal_participants
  for select to authenticated
  using (focus.can_view_goal(goal_id));

create policy goal_versions_select on public.goal_versions
  for select to authenticated
  using (focus.can_view_goal(goal_id));

create policy goal_milestones_select on public.goal_milestones
  for select to authenticated
  using (
    exists (
      select 1 from public.goal_versions gv
       where gv.id = goal_version_id and focus.can_view_goal(gv.goal_id)
    )
  );

create policy goal_agreements_select on public.goal_agreements
  for select to authenticated
  using (focus.can_view_goal(goal_id));

create policy goal_updates_select on public.goal_updates
  for select to authenticated
  using (focus.can_view_goal(goal_id));

create policy goal_milestone_updates_select on public.goal_milestone_updates
  for select to authenticated
  using (focus.can_view_goal(goal_id));

create policy goal_attachments_select on public.goal_attachments
  for select to authenticated
  using (focus.can_view_goal(goal_id));

create policy goal_attachment_views_select on public.goal_attachment_views
  for select to authenticated
  using (
    viewer_id = focus.current_user_id()
    or exists (
      select 1 from public.goal_attachments ga
       where ga.id = attachment_id and focus.can_view_goal(ga.goal_id)
    )
  );

create policy goal_work_links_select on public.goal_work_links
  for select to authenticated
  using (focus.can_view_goal(goal_id) and focus.can_view_task(task_id));

create policy goal_support_requests_select on public.goal_support_requests
  for select to authenticated
  using (focus.can_view_goal(goal_id));

drop policy audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    focus.is_admin()
    or (task_id is not null and focus.can_view_task(task_id))
    or (goal_id is not null and focus.can_view_goal(goal_id))
    or (subject_user_id is not null and focus.can_view_user(subject_user_id))
    or actor_id = focus.current_user_id()
  );

create or replace function focus.storage_object_goal_id(object_name text)
returns uuid
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select case (storage.foldername(object_name))[1]
    when 'goals' then focus.try_uuid((storage.foldername(object_name))[2])
    else null
  end;
$$;

create policy "goal attachments are readable by authorised viewers"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and focus.can_view_goal(focus.storage_object_goal_id(name))
  );

create policy "goal attachments are writable by authorised updaters"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and owner = auth.uid()
    and focus.can_update_goal(focus.storage_object_goal_id(name))
  );

create policy "uncommitted goal uploads are removable by their uploader"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'goals'
    and focus.can_update_goal(focus.storage_object_goal_id(name))
    and not exists (
      select 1
        from public.goal_attachments ga
       where ga.storage_bucket = bucket_id and ga.storage_path = name
    )
  );

revoke all on public.goals, public.goal_participants, public.goal_versions,
  public.goal_milestones, public.goal_agreements, public.goal_updates,
  public.goal_milestone_updates, public.goal_attachments,
  public.goal_attachment_views, public.goal_work_links,
  public.goal_support_requests from anon, authenticated;

grant select on public.goals, public.goal_participants, public.goal_versions,
  public.goal_milestones, public.goal_agreements, public.goal_updates,
  public.goal_milestone_updates, public.goal_attachments,
  public.goal_attachment_views, public.goal_work_links,
  public.goal_support_requests to authenticated;

grant all on public.goals, public.goal_participants, public.goal_versions,
  public.goal_milestones, public.goal_agreements, public.goal_updates,
  public.goal_milestone_updates, public.goal_attachments,
  public.goal_attachment_views, public.goal_work_links,
  public.goal_support_requests to service_role;

revoke all on function public.get_goal_capabilities(uuid) from public;
grant execute on function public.get_goal_capabilities(uuid) to authenticated;

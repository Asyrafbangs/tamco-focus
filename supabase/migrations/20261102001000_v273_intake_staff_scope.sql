-- v273 — Staff-only intake visibility. Public access remains deliberately absent.

alter table public.esh_qr_locations
  add column department_id uuid references public.departments (id);

alter table public.esh_report_intake
  add column department_id uuid references public.departments (id),
  add column assigned_triager_id uuid references public.user_profiles (id),
  add column triaged_at timestamptz,
  add column decision_reason text;

create index esh_report_intake_scope_queue_idx
  on public.esh_report_intake (organization_id, department_id, status, received_at);

create policy esh_qr_locations_staff_select on public.esh_qr_locations
  as permissive for select to authenticated
  using (
    (select focus.esh_can('coordinate'))
    and organization_id = (select focus.esh_organization_id())
    and (
      (select focus.esh_scope_all())
      or department_id = any ((select focus.esh_visible_department_ids())::uuid[])
    )
  );

create policy esh_report_intake_staff_select on public.esh_report_intake
  as permissive for select to authenticated
  using (
    (select focus.esh_can('coordinate'))
    and organization_id = (select focus.esh_organization_id())
    and (
      (select focus.esh_scope_all())
      or department_id = any ((select focus.esh_visible_department_ids())::uuid[])
    )
  );

grant select on public.esh_qr_locations, public.esh_report_intake to authenticated;

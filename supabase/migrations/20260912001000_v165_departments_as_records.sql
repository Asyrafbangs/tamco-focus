-- ---------------------------------------------------------------------------
-- v165 — A department becomes a record, not a label
--
-- A department was a code and a name. Everything else about the shape of the
-- organisation lived in people's heads: which department sits under which, and
-- who heads one. This gives a department a parent, a head and a status, and two
-- administrator procedures that maintain them under the same rules as every
-- other identity change — administrator only, validated, audited.
--
-- Naming a head is not a grant. A department head gains no sight of anybody's
-- work by being named here; what a person may see remains the visibility model
-- (v66, v68, v80). The organisation chart must not become the security model.
-- ---------------------------------------------------------------------------

create type public.department_status as enum ('active', 'archived');

alter table public.departments
  add column parent_id uuid references public.departments (id),
  add column head_id uuid references public.user_profiles (id),
  add column status public.department_status not null default 'active';

alter table public.departments
  add constraint departments_not_own_parent
    check (parent_id is null or parent_id <> id);

create index departments_parent_idx on public.departments (parent_id)
  where parent_id is not null;
create index departments_head_idx on public.departments (head_id)
  where head_id is not null;

comment on column public.departments.parent_id is
  'The department this one sits under. Null at the top of the organisation.';
comment on column public.departments.head_id is
  'Who heads the department. Names a person; grants sight of nobody''s work.';
comment on column public.departments.status is
  'archived keeps the record for history without offering it for new assignment.';

-- ---------------------------------------------------------------------------
-- Cycle guard, the same shape as the reporting one (identity_and_org): a
-- department that is its own ancestor makes every walk of the tree
-- non-terminating, and the tree is walked on every Organisation screen.
-- ---------------------------------------------------------------------------

create or replace function focus.assert_no_department_cycle()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid := new.parent_id;
  hops integer := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Department parent would create a cycle for %', new.id
        using errcode = 'check_violation';
    end if;

    hops := hops + 1;
    if hops > 32 then
      raise exception 'Department nesting exceeds the supported depth of 32'
        using errcode = 'check_violation';
    end if;

    select parent_id into cursor_id from public.departments where id = cursor_id;
  end loop;

  return new;
end;
$$;

create trigger departments_no_cycle
  before insert or update of parent_id on public.departments
  for each row when (new.parent_id is not null)
  execute function focus.assert_no_department_cycle();

-- ---------------------------------------------------------------------------
-- Administrator procedures
--
-- `settings_changed` is the audit event: the enum has no department-specific
-- value, and a department record is organisation configuration. Both the audit
-- trail and the administrator security log carry the before and after, because
-- moving a department moves everybody in it.
-- ---------------------------------------------------------------------------

create or replace function public.create_department(
  p_name text,
  p_code text,
  p_parent_id uuid default null,
  p_head_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  next_name text := btrim(coalesce(p_name, ''));
  next_code text := upper(btrim(coalesce(p_code, '')));
  created uuid;
  detail jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can create a department.');
  end if;

  if length(next_name) = 0 then
    return focus.error('name_required', 'Give the department a name.');
  end if;

  if next_code !~ '^[A-Z0-9_-]{2,32}$' then
    return focus.error('code_invalid',
      'A department code is 2 to 32 letters, digits, dashes or underscores.');
  end if;

  if exists (select 1 from public.departments where code = next_code) then
    return focus.error('code_taken', 'Another department already uses that code.');
  end if;

  if p_parent_id is not null
     and not exists (select 1 from public.departments where id = p_parent_id) then
    return focus.error('not_found', 'That parent department does not exist.');
  end if;

  if p_head_id is not null
     and not exists (select 1 from public.user_profiles where id = p_head_id) then
    return focus.error('not_found', 'That person does not exist.');
  end if;

  insert into public.departments (code, name, parent_id, head_id)
  values (next_code, next_name, p_parent_id, p_head_id)
  returning id into created;

  detail := jsonb_build_object(
    'action', 'department_created',
    'department_id', created,
    'code', next_code,
    'name', next_name,
    'parent_id', p_parent_id,
    'head_id', p_head_id);

  perform focus.write_audit(
    p_event_type := 'settings_changed',
    p_actor_id := actor,
    p_subject_user_id := p_head_id,
    p_detail := detail);

  insert into public.admin_security_log (
    event_type, actor_user_id, subject_user_id, summary, detail
  ) values (
    'settings_changed', actor, p_head_id,
    format('Created department %s (%s)', next_name, next_code), detail
  );

  return jsonb_build_object('ok', true, 'code', 'created', 'id', created);
end;
$$;

comment on function public.create_department is
  'Administrator-only department creation. Validated, audited, and no grant of visibility.';

/*
 * Nulls mean "leave alone", so clearing a parent or a head is asked for
 * explicitly.
 *
 * `update_user_profile` reads a null reporting manager as "clear it", which
 * works there because that form always submits the field. A department form
 * that omits a field it does not offer would silently unseat the head, so this
 * one separates the two questions.
 */
create or replace function public.update_department(
  p_department_id uuid,
  p_name text default null,
  p_code text default null,
  p_parent_id uuid default null,
  p_head_id uuid default null,
  p_status public.department_status default null,
  p_clear_parent boolean default false,
  p_clear_head boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target record;
  next_name text;
  next_code text;
  next_parent uuid;
  next_head uuid;
  next_status public.department_status;
  changes jsonb := '{}'::jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can change a department.');
  end if;

  select * into target from public.departments where id = p_department_id for update;
  if not found then
    return focus.error('not_found', 'That department does not exist.');
  end if;

  next_name := coalesce(btrim(p_name), target.name);
  next_code := coalesce(upper(btrim(p_code)), target.code);
  next_parent := case when p_clear_parent then null
                      else coalesce(p_parent_id, target.parent_id) end;
  next_head := case when p_clear_head then null
                    else coalesce(p_head_id, target.head_id) end;
  next_status := coalesce(p_status, target.status);

  if length(next_name) = 0 then
    return focus.error('name_required', 'Give the department a name.');
  end if;

  if next_code !~ '^[A-Z0-9_-]{2,32}$' then
    return focus.error('code_invalid',
      'A department code is 2 to 32 letters, digits, dashes or underscores.');
  end if;

  if exists (
    select 1 from public.departments where code = next_code and id <> p_department_id
  ) then
    return focus.error('code_taken', 'Another department already uses that code.');
  end if;

  if next_parent = p_department_id then
    return focus.error('parent_invalid', 'A department cannot sit under itself.');
  end if;

  if next_parent is not null
     and not exists (select 1 from public.departments where id = next_parent) then
    return focus.error('not_found', 'That parent department does not exist.');
  end if;

  if next_head is not null
     and not exists (select 1 from public.user_profiles where id = next_head) then
    return focus.error('not_found', 'That person does not exist.');
  end if;

  /*
   * Archiving is not deletion, and it is not a way to hide people. A
   * department still holding active accounts or sub-departments would
   * disappear from the assignment lists while everybody in it stayed exactly
   * where they were.
   */
  if next_status = 'archived' and target.status <> 'archived' then
    if exists (
      select 1 from public.user_profiles
       where department_id = p_department_id and status = 'active'
    ) then
      return focus.error('department_in_use',
        'Move the active people out of this department before archiving it.');
    end if;

    if exists (
      select 1 from public.departments
       where parent_id = p_department_id and status <> 'archived'
    ) then
      return focus.error('department_in_use',
        'Archive or move the departments under this one first.');
    end if;
  end if;

  if next_name is distinct from target.name then
    changes := changes || jsonb_build_object('name',
      jsonb_build_object('from', target.name, 'to', next_name));
  end if;
  if next_code is distinct from target.code then
    changes := changes || jsonb_build_object('code',
      jsonb_build_object('from', target.code, 'to', next_code));
  end if;
  if next_parent is distinct from target.parent_id then
    changes := changes || jsonb_build_object('parent_id',
      jsonb_build_object('from', target.parent_id, 'to', next_parent));
  end if;
  if next_head is distinct from target.head_id then
    changes := changes || jsonb_build_object('head_id',
      jsonb_build_object('from', target.head_id, 'to', next_head));
  end if;
  if next_status is distinct from target.status then
    changes := changes || jsonb_build_object('status',
      jsonb_build_object('from', target.status, 'to', next_status));
  end if;

  if changes = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'id', p_department_id);
  end if;

  update public.departments
     set name = next_name,
         code = next_code,
         parent_id = next_parent,
         head_id = next_head,
         status = next_status
   where id = p_department_id;

  perform focus.write_audit(
    p_event_type := 'settings_changed',
    p_actor_id := actor,
    p_subject_user_id := next_head,
    p_detail := jsonb_build_object('action', 'department_updated',
                                   'department_id', p_department_id) || changes);

  insert into public.admin_security_log (
    event_type, actor_user_id, subject_user_id, summary, detail
  ) values (
    'settings_changed', actor, next_head,
    format('Updated department %s (%s)', next_name, next_code),
    jsonb_build_object('department_id', p_department_id) || changes
  );

  return jsonb_build_object('ok', true, 'code', 'updated', 'id', p_department_id);
exception
  -- The cycle guard fires on the update itself, for a parent further up the
  -- chain than the self-check above can see. An administrator gets a sentence,
  -- not a raised exception.
  when check_violation then
    return focus.error('parent_invalid',
      'That would put a department inside itself. Choose a different parent.');
end;
$$;

comment on function public.update_department is
  'Administrator-only department maintenance. Nulls leave a field alone; clearing is explicit.';

revoke all on function public.create_department(text, text, uuid, uuid) from public, anon;
revoke all on function public.update_department(
  uuid, text, text, uuid, uuid, public.department_status, boolean, boolean
) from public, anon;
grant execute on function public.create_department(text, text, uuid, uuid) to authenticated;
grant execute on function public.update_department(
  uuid, text, text, uuid, uuid, public.department_status, boolean, boolean
) to authenticated;

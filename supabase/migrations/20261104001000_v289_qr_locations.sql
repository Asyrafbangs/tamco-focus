-- v289 — somewhere for a sticker to point.
--
-- v272 created `esh_qr_locations` and v288 built the submission path, and
-- between them they left a gap nobody notices until the day the pilot starts:
-- **there is no way to create a location**. The table is revoked from
-- `authenticated`, there is no procedure, and there is no screen. Opening the
-- switch today would make every sticker in the plant resolve to "this link
-- does not report anything", because there is nothing for a code to find.
--
-- This is the third time in this module a control has existed and been
-- inoperable — the rollout CHECK, the missing settings row, and now this — so
-- the test for it does what the other two needed: it creates a location,
-- reads it back, and retires it.
--
-- Two decisions worth stating.
--
-- **The code is generated here, not typed.** A sticker's code is the whole of
-- its authorisation: anybody who can guess it can submit a report against that
-- location. `BR2-PRESS-LINE-2` is guessable by anyone who has walked through
-- the building, so the code is 16 random characters and the label carries the
-- meaning. Nothing in the URL says where it is.
--
-- **Retiring, never deleting.** A sticker that has been printed and glued to a
-- machine cannot be recalled. Retiring stops it resolving while keeping the
-- row, so a report already submitted against it still names where it came
-- from, and the same code can never be re-issued.

create or replace function public.esh_add_qr_location(
  p_label text,
  p_department_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  label text := btrim(coalesce(p_label, ''));
  code text;
  created public.esh_qr_locations%rowtype;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if length(label) < 1 or length(label) > 160 then
    return jsonb_build_object('ok', false, 'code', 'label_required');
  end if;

  /*
   * A department the coordinator does not cover is not theirs to put a
   * sticker in. `<> all` with the null branch written out, because `<> any` is
   * true the moment somebody covers more than one department. A location with
   * no department is allowed and lands in the organisation-wide queue.
   */
  if p_department_id is not null
     and not focus.esh_scope_all()
     and p_department_id <> all (focus.esh_visible_department_ids()) then
    return jsonb_build_object('ok', false, 'code', 'department_not_yours');
  end if;
  if p_department_id is not null
     and not exists (select 1 from public.departments where id = p_department_id) then
    return jsonb_build_object('ok', false, 'code', 'department_not_found');
  end if;

  /*
   * Sixteen characters from twelve random bytes, in the alphabet the column's
   * CHECK already allows. Not derived from the label: a code that can be
   * guessed from the area's name is a code anybody who has walked through the
   * building can post to.
   */
  -- `extensions.` qualified: pgcrypto lives there, and this function's
  -- `search_path` is `public, pg_temp` on purpose, so an unqualified call
  -- raises "no function matches" at runtime rather than at deploy time.
  code := translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_x');

  insert into public.esh_qr_locations
    (organization_id, public_code, display_label, department_id, active)
  values (org, code, label, p_department_id, true)
  returning * into created;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'qr_location_added',
          jsonb_build_object('location_id', created.id, 'label', label,
                             'department_id', p_department_id));

  return jsonb_build_object('ok', true, 'id', created.id, 'code', created.public_code);
end;
$$;

comment on function public.esh_add_qr_location(text, uuid) is
  'v289 — an ESH coordinator creates a QR location. The code is generated, '
  'never typed: it is the whole authorisation a sticker carries.';

create or replace function public.esh_retire_qr_location(p_location_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  loc public.esh_qr_locations%rowtype;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  select * into loc
    from public.esh_qr_locations
   where id = p_location_id
     and organization_id = org
     for update;
  if not found
     or (not focus.esh_scope_all()
         and (loc.department_id is null
              or loc.department_id <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not loc.active then
    return jsonb_build_object('ok', true, 'already_retired', true);
  end if;

  -- The row stays. A sticker on a machine cannot be recalled, so the code must
  -- never resolve again and must never be re-issued.
  update public.esh_qr_locations
     set active = false, retired_at = now(), updated_at = now()
   where id = loc.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'qr_location_retired',
          jsonb_build_object('location_id', loc.id, 'label', loc.display_label));

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.esh_retire_qr_location(uuid) is
  'v289 — stops a sticker resolving. The row is kept so reports already '
  'submitted against it still name where they came from.';

revoke all on function public.esh_add_qr_location(text, uuid) from public, anon;
revoke all on function public.esh_retire_qr_location(uuid) from public, anon;
grant execute on function public.esh_add_qr_location(text, uuid) to authenticated;
grant execute on function public.esh_retire_qr_location(uuid) to authenticated;

/*
 * v273 already lets a coordinator select the locations in their scope. A
 * retired one has to stay visible to them — it is the row that explains where
 * an old report came from — and v273's policy does not filter on `active`, so
 * nothing more is needed here.
 */

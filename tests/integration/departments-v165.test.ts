import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v165 — a department is a record, not a label.
 *
 * It had a code and a name, so the shape of the organisation — which unit sits
 * under which, and who heads one — existed only in people's heads. These are
 * the rules that make the record trustworthy: only an administrator writes it,
 * a department cannot end up inside itself, and archiving one cannot be used to
 * make a populated unit disappear from the screens that assign work.
 *
 * Naming a head grants nothing. That is asserted in the visibility suite, which
 * this deliberately does not touch.
 */

interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
  id?: string;
}

const created: string[] = [];

afterEach(async () => {
  const admin = serviceClient();
  // Children first: the parent reference would otherwise refuse the delete.
  while (created.length) {
    await admin.from('departments').delete().eq('id', created.pop()!);
  }
});

/** A code that cannot collide with another run: 2-32 of [A-Z0-9_-]. */
function code(prefix: string): string {
  return `${prefix}${crypto
    .randomUUID()
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase()}`;
}

async function createDepartment(
  client: SupabaseClient,
  fields: { name: string; code: string; parentId?: string | null; headId?: string | null },
): Promise<RpcResult> {
  const { data, error } = await client.rpc('create_department', {
    p_name: fields.name,
    p_code: fields.code,
    p_parent_id: fields.parentId ?? null,
    p_head_id: fields.headId ?? null,
  });
  if (error) throw new Error(`create_department failed: ${error.message}`);
  const result = data as RpcResult;
  if (result.ok && result.id) created.unshift(result.id);
  return result;
}

async function updateDepartment(
  client: SupabaseClient,
  departmentId: string,
  fields: Record<string, unknown> = {},
): Promise<RpcResult> {
  const { data, error } = await client.rpc('update_department', {
    p_department_id: departmentId,
    ...fields,
  });
  if (error) throw new Error(`update_department failed: ${error.message}`);
  return data as RpcResult;
}

async function readDepartment(departmentId: string) {
  const { data, error } = await serviceClient()
    .from('departments')
    .select('code,name,parent_id,head_id,status')
    .eq('id', departmentId)
    .single();
  if (error) throw new Error(`Could not read the department: ${error.message}`);
  return data as {
    code: string;
    name: string;
    parent_id: string | null;
    head_id: string | null;
    status: string;
  };
}

describe('v165 departments as records', () => {
  it('creates one under a parent, with a head', async () => {
    const admin = await signInAs('admin');
    const parent = await createDepartment(admin, { name: 'Operations Group', code: code('OPG') });
    expect(parent.ok, parent.message).toBe(true);

    const child = await createDepartment(admin, {
      name: 'Fabrication',
      code: code('FAB'),
      parentId: parent.id,
      headId: PEOPLE.izzul.id,
    });
    expect(child.ok, child.message).toBe(true);

    const stored = await readDepartment(child.id!);
    expect(stored.parent_id).toBe(parent.id);
    expect(stored.head_id).toBe(PEOPLE.izzul.id);
    expect(stored.status).toBe('active');
  });

  it('refuses a code another department already uses', async () => {
    const admin = await signInAs('admin');
    const shared = code('DUP');
    const first = await createDepartment(admin, { name: 'Tendering', code: shared });
    expect(first.ok, first.message).toBe(true);

    const second = await createDepartment(admin, { name: 'Tendering again', code: shared });
    expect(second.ok).toBe(false);
    expect(second.code).toBe('code_taken');
  });

  it('refuses anybody who is not an administrator', async () => {
    // A manager, and the manager of most of the fixture: authority over people
    // is not authority over the organisation's structure.
    const manager = await signInAs('izzul');
    const attempt = await createDepartment(manager, { name: 'Shadow unit', code: code('SHD') });
    expect(attempt.ok).toBe(false);
    expect(attempt.code).toBe('not_authorised');
  });

  it('refuses a move that would put a department inside itself', async () => {
    const admin = await signInAs('admin');
    const top = await createDepartment(admin, { name: 'Engineering', code: code('ENG') });
    const under = await createDepartment(admin, {
      name: 'Design',
      code: code('DSG'),
      parentId: top.id,
    });
    expect(under.ok, under.message).toBe(true);

    const cycle = await updateDepartment(admin, top.id!, { p_parent_id: under.id });
    expect(cycle.ok).toBe(false);
    expect(cycle.code).toBe('parent_invalid');

    // And the attempt changed nothing.
    expect((await readDepartment(top.id!)).parent_id).toBeNull();
  });

  it('refuses to archive a department that still has active people', async () => {
    const admin = await signInAs('admin');
    // The seeded EHS department, which the fixture staffs.
    const attempt = await updateDepartment(admin, 'f0c05100-0000-4000-a000-000000000001', {
      p_status: 'archived',
    });
    expect(attempt.ok).toBe(false);
    expect(attempt.code).toBe('department_in_use');

    const stored = await readDepartment('f0c05100-0000-4000-a000-000000000001');
    expect(stored.status).toBe('active');
  });

  it('clears a head only when asked, and archives an empty department', async () => {
    const admin = await signInAs('admin');
    const unit = await createDepartment(admin, {
      name: 'Quality',
      code: code('QAL'),
      headId: PEOPLE.izzul.id,
    });

    // A rename says nothing about the head, so the head stays.
    const renamed = await updateDepartment(admin, unit.id!, { p_name: 'Quality Assurance' });
    expect(renamed.ok, renamed.message).toBe(true);
    expect((await readDepartment(unit.id!)).head_id).toBe(PEOPLE.izzul.id);

    const cleared = await updateDepartment(admin, unit.id!, { p_clear_head: true });
    expect(cleared.ok, cleared.message).toBe(true);
    expect((await readDepartment(unit.id!)).head_id).toBeNull();

    const archived = await updateDepartment(admin, unit.id!, { p_status: 'archived' });
    expect(archived.ok, archived.message).toBe(true);
    const stored = await readDepartment(unit.id!);
    expect(stored.status).toBe('archived');
    expect(stored.name).toBe('Quality Assurance');
  });
});

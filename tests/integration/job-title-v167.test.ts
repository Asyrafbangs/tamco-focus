import { afterEach, describe, expect, it } from 'vitest';

import { serviceClient, signInAs } from './setup';

/**
 * v167 — a person has a job title, and it is descriptive only.
 *
 * The identity record could say what somebody may do (`role`, three values
 * chosen for permissions) and where they sit, but not what they are called.
 * These are the rules that make the field safe to rely on: an administrator
 * writes it, a save that does not mention it leaves it alone, emptying it
 * clears it, and every change is on the record.
 */

/** The temporary tester: seeded deliberately without a title. */
const SUBJECT = 'f0c05000-0000-4000-a000-000000000007';

interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
}

afterEach(async () => {
  await serviceClient().from('user_profiles').update({ job_title: null }).eq('id', SUBJECT);
});

async function readTitle(): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from('user_profiles')
    .select('job_title')
    .eq('id', SUBJECT)
    .single();
  if (error) throw new Error(`Could not read the profile: ${error.message}`);
  return (data as { job_title: string | null }).job_title;
}

async function update(
  client: Awaited<ReturnType<typeof signInAs>>,
  fields: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await client.rpc('update_user_profile', {
    p_user_id: SUBJECT,
    ...fields,
  });
  if (error) throw new Error(`update_user_profile failed: ${error.message}`);
  return data as RpcResult;
}

describe('v167 job title', () => {
  it('is set, left alone, and cleared by emptying it', async () => {
    const admin = await signInAs('admin');

    const set = await update(admin, { p_job_title: '  Senior Executive  ' });
    expect(set.ok, set.message).toBe(true);
    // Trimmed on the way in, so a stray space cannot make two of the same title.
    expect(await readTitle()).toBe('Senior Executive');

    // A save that says nothing about the title keeps it: most edits are about
    // something else entirely.
    const renamed = await update(admin, { p_full_name: 'Temporary Tester' });
    expect(renamed.ok, renamed.message).toBe(true);
    expect(await readTitle()).toBe('Senior Executive');

    // Emptying the box is a decision, and the only way to clear it.
    const cleared = await update(admin, { p_job_title: '' });
    expect(cleared.ok, cleared.message).toBe(true);
    expect(await readTitle()).toBeNull();
  });

  it('records the change where an administrator can read it', async () => {
    const admin = await signInAs('admin');
    const set = await update(admin, { p_job_title: 'EHS Executive' });
    expect(set.ok, set.message).toBe(true);

    const { data, error } = await serviceClient()
      .from('admin_security_log')
      .select('detail')
      .eq('subject_user_id', SUBJECT)
      .order('occurred_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`Could not read the security log: ${error.message}`);
    const detail = (data![0] as { detail: Record<string, { from: unknown; to: unknown }> }).detail;
    expect(detail.job_title).toEqual({ from: null, to: 'EHS Executive' });
  });

  it('refuses anybody who is not an administrator', async () => {
    const manager = await signInAs('izzul');
    const attempt = await update(manager, { p_job_title: 'Director' });
    expect(attempt.ok).toBe(false);
    expect(attempt.code).toBe('not_authorised');
    expect(await readTitle()).toBeNull();
  });
});

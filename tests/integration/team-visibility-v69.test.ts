import { afterEach, describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

const APPROVED_AMER_SUBJECTS = [PEOPLE.izzah.id, PEOPLE.ajmal.id];

async function restoreAmerVisibility() {
  const admin = await signInAs('admin');
  const { error } = await admin.rpc('set_user_visibility', {
    p_viewer_id: PEOPLE.amer.id,
    p_mode: 'specific_only',
    p_subject_ids: APPROVED_AMER_SUBJECTS,
    p_reason: 'Restore approved visibility fixture after v69 coverage',
  });
  if (error) throw error;
}

async function teamIds(person: 'admin' | 'izzul' | 'amer' | 'lim') {
  const client = await signInAs(person);
  const { data, error } = await client
    .from('team_load_summary')
    .select('user_id')
    .neq('user_id', PEOPLE[person].id)
    .order('user_id');
  if (error) throw error;
  return (data ?? []).map((row) => String(row.user_id));
}

afterEach(async () => {
  await restoreAmerVisibility();
});

describe('v69 Team visibility boundary', () => {
  it('returns the complete active roster to an administrator, including Izzul', async () => {
    const service = serviceClient();
    const { data: active, error } = await service
      .from('user_profiles')
      .select('id')
      .eq('status', 'active')
      .neq('id', PEOPLE.admin.id)
      .order('id');
    if (error) throw error;

    const actual = await teamIds('admin');
    const expected = (active ?? []).map((row) => String(row.id)).sort();

    expect(actual).toEqual(expected);
    expect(actual).toContain(PEOPLE.izzul.id);
  });

  it('keeps reporting-manager attribution out of explicit and denied Team scopes', async () => {
    await expect(teamIds('amer')).resolves.toEqual(
      [...APPROVED_AMER_SUBJECTS].sort((left, right) => left.localeCompare(right)),
    );
    await expect(teamIds('lim')).resolves.toEqual([]);
  });

  it('applies an administrator rule change to the authoritative roster immediately', async () => {
    const admin = await signInAs('admin');
    const { error } = await admin.rpc('set_user_visibility', {
      p_viewer_id: PEOPLE.amer.id,
      p_mode: 'specific_only',
      p_subject_ids: [PEOPLE.izzah.id],
      p_reason: 'v69 immediate Team roster coverage',
    });
    if (error) throw error;

    await expect(teamIds('amer')).resolves.toEqual([PEOPLE.izzah.id]);
  });
});

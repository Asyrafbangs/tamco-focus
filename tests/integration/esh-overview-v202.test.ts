import { describe, expect, it } from 'vitest';

import { serviceClient, signInAs } from './setup';

describe('v202 ESH overview and export boundaries', () => {
  it('uses the signed-in Finding scope for overview, drill-down and export', async () => {
    const izzul = await signInAs('izzul');
    const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
    const { data: saved, error } = await izzul.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title: `v202 integration ${crypto.randomUUID().slice(0, 8)}`,
        description: 'A scoped export row.',
        reported_on: '2026-09-10',
        accountable_department_id: departments?.[0]?.id,
        required_outcome: 'Correct the condition.',
        priority: 'normal',
        owner_email: `owner.v202.${crypto.randomUUID().slice(0, 8)}@example.com`,
        due_date: '2026-10-18',
        escalation: [],
        no_further_escalation_reason: 'No escalation is needed for this fixture.',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    if (!saved?.ok) throw new Error(JSON.stringify(saved));
    await serviceClient()
      .from('esh_finding_actions')
      .update({ due_at: '2026-09-18T09:00:00Z' })
      .eq('id', saved.action_id);

    const overview = await izzul.rpc('esh_overview', {
      p_department_id: departments?.[0]?.id,
      p_closed_since: '2026-08-22T00:00:00Z',
      p_closed_until: null,
      p_as_of: '2026-09-20T01:00:00Z',
    });
    expect(overview.error).toBeNull();
    const overviewRows = (overview.data ?? []) as Array<{
      open_findings: number;
      overdue_actions: number;
    }>;
    expect(overviewRows.reduce((sum, row) => sum + Number(row.open_findings), 0)).toBeGreaterThan(
      0,
    );
    expect(overviewRows.reduce((sum, row) => sum + Number(row.overdue_actions), 0)).toBeGreaterThan(
      0,
    );

    const overdue = await izzul
      .from('esh_action_register_rows')
      .select('action_id, finding_id')
      .eq('finding_id', saved.finding_id)
      .eq('is_overdue', true);
    expect(overdue.error).toBeNull();
    expect(overdue.data).toHaveLength(1);

    const exported = await izzul
      .from('esh_register_export_rows')
      .select('finding_id, before_description, baseline_due_at, current_due_at, escalation_state')
      .eq('finding_id', saved.finding_id)
      .single();
    expect(exported.error).toBeNull();
    expect(exported.data).toMatchObject({
      before_description: 'A scoped export row.',
      escalation_state: 'none',
    });
    expect(exported.data?.baseline_due_at).toBeTruthy();
    expect(exported.data?.current_due_at).toBeTruthy();

    const amer = await signInAs('amer');
    const hiddenOverview = await amer.rpc('esh_overview', {
      p_department_id: null,
      p_closed_since: '2026-08-22T00:00:00Z',
      p_closed_until: null,
      p_as_of: '2026-09-20T01:00:00Z',
    });
    expect(hiddenOverview.error).toBeNull();
    expect(hiddenOverview.data).toEqual([]);
    const hiddenExport = await amer.from('esh_register_export_rows').select('finding_id');
    expect(hiddenExport.error).toBeNull();
    expect(hiddenExport.data).toEqual([]);
  });
});

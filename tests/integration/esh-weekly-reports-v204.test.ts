import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

describe('v204 weekly Finding Management reports', () => {
  it('captures one restricted-safe snapshot and purpose-separates its guest link', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `leader.${suffix}@example.com`;
    const secret = 'A'.repeat(43);
    const session = 'B'.repeat(43);
    const service = serviceClient();
    await service
      .from('esh_staff_access')
      .update({ can_manage_reports: true })
      .eq('user_id', PEOPLE.izzul.id);
    const izzul = await signInAs('izzul');
    const { data: departments } = await izzul.from('departments').select('id,code');
    const ops = departments?.find((department) => department.code === 'OPS')?.id;
    expect(ops).toBeTruthy();

    const createFinding = async (title: string, restricted: boolean) => {
      const saved = await izzul.rpc('esh_save_finding', {
        p_finding_id: null,
        p_payload: {
          title,
          description: 'v204 snapshot fixture',
          reported_on: '2026-09-14',
          accountable_department_id: ops,
          required_outcome: 'Correct the condition.',
          priority: 'high',
          owner_email: `owner.${suffix}@example.com`,
          due_date: '2026-09-18',
          is_restricted: restricted,
          escalation: [],
          no_further_escalation_reason: 'Integration fixture.',
        },
        p_assign: true,
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(saved.error).toBeNull();
      expect(saved.data).toMatchObject({ ok: true });
      return saved.data.finding_id as string;
    };
    const visibleFinding = await createFinding(`v204 visible ${suffix}`, false);
    const restrictedFinding = await createFinding(`v204 restricted ${suffix}`, true);

    const savedReport = await izzul.rpc('esh_save_report_definition', {
      p_id: null,
      p_name: `Leadership ${suffix}`,
      p_state: 'active',
      p_timezone: 'Asia/Kuala_Lumpur',
      p_schedule_isodow: 1,
      p_schedule_local_time: '08:30',
      p_organization_wide: false,
      p_include_descendants: true,
      p_department_ids: [ops!],
      p_recipient_emails: [email],
    });
    expect(savedReport.error).toBeNull();
    expect(savedReport.data).toMatchObject({ ok: true, version: 1, scope_version: 1 });
    const reportId = savedReport.data.id as string;

    const { data: principal } = await service
      .from('esh_email_principals')
      .select('id')
      .eq('canonical_email', email)
      .single();
    await service
      .from('esh_email_principals')
      .update({ access_enabled: true, access_enabled_at: new Date().toISOString() })
      .eq('id', principal!.id);

    const generated = await service.rpc('esh_generate_weekly_reports', {
      p_now: '2026-09-21T01:00:00Z',
    });
    expect(generated.error).toBeNull();
    expect(generated.data).toMatchObject({ ok: true, created: 1, queued: 1 });
    const repeated = await service.rpc('esh_generate_weekly_reports', {
      p_now: '2026-09-21T02:00:00Z',
    });
    expect(repeated.data).toMatchObject({ ok: true, created: 0, queued: 0 });

    const { data: outbox } = await service
      .from('esh_report_outbox')
      .select('id,run_id')
      .eq(
        'recipient_id',
        (
          await service
            .from('esh_report_recipients')
            .select('id')
            .eq('report_definition_id', reportId)
            .single()
        ).data!.id,
      )
      .single();
    const claim = await service.rpc('esh_report_dispatch_claim', {
      p_outbox_id: outbox!.id,
      p_secret: secret,
    });
    expect(claim.data).toMatchObject({ ok: true, to: email });
    const exchanged = await service.rpc('esh_report_guest_exchange', {
      p_token: secret,
      p_new_session: session,
      p_consume: true,
    });
    expect(exchanged.data).toMatchObject({
      ok: true,
      destination: `/respond/reports/${outbox!.run_id}`,
    });
    const snapshot = await service.rpc('esh_guest_report', {
      p_session: session,
      p_run_id: outbox!.run_id,
      p_live: false,
    });
    expect(snapshot.error).toBeNull();
    expect(snapshot.data).toMatchObject({ ok: true, mode: 'snapshot' });
    const rows = snapshot.data.rows as Array<{ finding_title: string }>;
    expect(rows.some((row) => row.finding_title === `v204 visible ${suffix}`)).toBe(true);
    expect(rows.some((row) => row.finding_title === `v204 restricted ${suffix}`)).toBe(false);

    // Pausing prevents another run, but the already issued report remains readable.
    const paused = await izzul.rpc('esh_save_report_definition', {
      p_id: reportId,
      p_name: `Leadership ${suffix}`,
      p_state: 'paused',
      p_timezone: 'Asia/Kuala_Lumpur',
      p_schedule_isodow: 1,
      p_schedule_local_time: '08:30',
      p_organization_wide: false,
      p_include_descendants: true,
      p_department_ids: [ops!],
      p_recipient_emails: [email],
    });
    expect(paused.data).toMatchObject({ ok: true, version: 1, scope_version: 1 });
    expect(
      (
        await service.rpc('esh_guest_report', {
          p_session: session,
          p_run_id: outbox!.run_id,
          p_live: false,
        })
      ).data,
    ).toMatchObject({ ok: true });

    await service.from('esh_findings').delete().in('id', [visibleFinding, restrictedFinding]);
  });
});

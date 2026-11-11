import { afterAll, describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

const ORGANIZATION_ID = 'e5e50000-0000-4000-8000-000000000001';

/**
 * v313 — the two decisions that could still be taken off somebody.
 *
 * v310 settled that taking a report over is deliberate: the claim refuses a
 * report another coordinator holds unless the caller asks, and accepting one
 * has always refused anybody who is not the holder. Auditing that invariant
 * across every procedure that writes `assigned_triager_id` found two that were
 * never part of it.
 *
 * `esh_decline_report_intake` and `esh_mark_report_intake_duplicate` ask only
 * that the status be 'new' or 'triaging'. Neither asks who holds it. So the
 * take over the claim now refuses could still happen through either of them,
 * and more destructively: assigning a report leaves a Finding somebody can
 * find, while declining it closes the report under somebody else's name and
 * linking it as a duplicate retires it against a Finding of the caller's
 * choosing. The triage screen reached both — since v310 it said "X is holding
 * this report" directly above a working Decline form.
 *
 * These tests are written against the refusal rather than the screen, because
 * the procedure is the authority: the RPC is executable by any coordinator.
 */
describe('v313 a decision about a held report belongs to its holder', () => {
  afterAll(async () => {
    // The seed grants ESH access to one person. `esh-foundations-v197` asserts
    // Lim's access reads "Off", and a browser run after this one would fail on
    // it. Hand the access back.
    const service = serviceClient();
    const { data: access } = await service
      .from('esh_staff_access')
      .select('id')
      .eq('user_id', PEOPLE.lim.id)
      .maybeSingle();
    if (!access) return;
    await service.from('esh_staff_access_departments').delete().eq('access_id', access.id);
    await service.from('esh_staff_access').delete().eq('id', access.id);
  });

  async function ensureCoordinator(who: keyof typeof PEOPLE) {
    const service = serviceClient();
    const { data: existing } = await service
      .from('esh_staff_access')
      .select('id')
      .eq('user_id', PEOPLE[who].id)
      .maybeSingle();
    if (existing) return;
    const { error } = await service.from('esh_staff_access').insert({
      organization_id: ORGANIZATION_ID,
      user_id: PEOPLE[who].id,
      enabled: true,
      preset: 'verifier',
      scope_all_departments: true,
      can_manage_reports: true,
    });
    expect(error, `${who} needs ESH access for this to be about the hold`).toBeNull();
  }

  async function reportFrom(marker: string) {
    const service = serviceClient();
    const { data: department } = await service
      .from('departments')
      .select('id')
      .eq('code', 'OPS')
      .single();
    const { data, error } = await service
      .from('esh_report_intake')
      .insert({
        organization_id: ORGANIZATION_ID,
        source: 'esh_manual' as const,
        report_text: `v313 ${marker} the walkway by the press is blocked with stacked pallets`,
        reported_location: 'BR2 Workshop',
        department_id: department!.id,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    return String(data!.id);
  }

  async function heldState(intakeId: string) {
    const service = serviceClient();
    const { data, error } = await service
      .from('esh_report_intake')
      .select('status, assigned_triager_id, decision_reason')
      .eq('id', intakeId)
      .single();
    expect(error).toBeNull();
    return data!;
  }

  it('refuses to let a second coordinator decline a report somebody is holding', async () => {
    await ensureCoordinator('lim');
    const intakeId = await reportFrom(crypto.randomUUID().slice(0, 8));

    const izzul = await signInAs('izzul');
    const claimed = await izzul.rpc('esh_claim_report_intake', {
      p_intake_id: intakeId,
      p_take_over: false,
    });
    expect(claimed.error).toBeNull();
    expect(claimed.data).toMatchObject({ ok: true, status: 'triaging' });

    const lim = await signInAs('lim');
    const declined = await lim.rpc('esh_decline_report_intake', {
      p_intake_id: intakeId,
      p_reason: 'Nothing in it, as far as I can see.',
    });
    expect(declined.error).toBeNull();
    expect(declined.data).toMatchObject({ ok: false, code: 'held_by_other' });

    /*
     * The refusal is only half the requirement. What made this worth fixing is
     * the state the old behaviour left: the report closed, and the holder
     * replaced by whoever pressed the button.
     */
    const after = await heldState(intakeId);
    expect(after.status, 'the report was closed by somebody who was not holding it').toBe(
      'triaging',
    );
    expect(after.assigned_triager_id, 'the hold was transferred by a decline').toBe(
      PEOPLE.izzul.id,
    );
    expect(after.decision_reason, "somebody else's reason was recorded").toBeNull();
  });

  it('refuses to let a second coordinator retire a held report as a duplicate', async () => {
    await ensureCoordinator('lim');
    const marker = crypto.randomUUID().slice(0, 8);
    const intakeId = await reportFrom(marker);

    const izzul = await signInAs('izzul');
    const service = serviceClient();
    const { data: department } = await service
      .from('departments')
      .select('id')
      .eq('code', 'OPS')
      .single();
    const saved = await izzul.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title: `v313 duplicate target ${marker}`,
        description: 'An existing finding for the duplicate link to point at.',
        reported_on: '2026-09-05',
        accountable_department_id: department!.id,
        location: 'BR2 Workshop',
        required_outcome: 'Clear the walkway and keep the route marked.',
        priority: 'normal',
        risk_level: 'medium',
        owner_email: `v313.${marker}@example.com`,
        due_date: '2026-12-15',
        escalation: [],
        no_further_escalation_reason: 'Fixture needs no route.',
      },
      p_assign: true,
    });
    expect(saved.error).toBeNull();
    const findingId = (saved.data as { ok?: boolean; finding_id?: string }).finding_id;
    expect(findingId, JSON.stringify(saved.data)).toBeTruthy();

    const claimed = await izzul.rpc('esh_claim_report_intake', {
      p_intake_id: intakeId,
      p_take_over: false,
    });
    expect(claimed.data).toMatchObject({ ok: true });

    const lim = await signInAs('lim');
    const linked = await lim.rpc('esh_mark_report_intake_duplicate', {
      p_intake_id: intakeId,
      p_finding_id: findingId!,
      p_reason: 'Looks like the one we already have.',
    });
    expect(linked.error).toBeNull();
    expect(linked.data).toMatchObject({ ok: false, code: 'held_by_other' });

    const after = await heldState(intakeId);
    expect(after.status).toBe('triaging');
    expect(after.assigned_triager_id).toBe(PEOPLE.izzul.id);
  });

  it('still lets any coordinator decline a report nobody is holding', async () => {
    await ensureCoordinator('lim');
    const intakeId = await reportFrom(crypto.randomUUID().slice(0, 8));

    // Nobody has claimed it: status 'new'. This is the ordinary case and the
    // one a holder check must not break.
    const lim = await signInAs('lim');
    const declined = await lim.rpc('esh_decline_report_intake', {
      p_intake_id: intakeId,
      p_reason: 'Already made safe at the time; nothing to act on.',
    });
    expect(declined.error).toBeNull();
    expect(declined.data).toMatchObject({ ok: true, status: 'declined' });

    const after = await heldState(intakeId);
    expect(after.status).toBe('declined');
    expect(after.assigned_triager_id).toBe(PEOPLE.lim.id);
  });

  it('lets the holder decline their own report', async () => {
    const intakeId = await reportFrom(crypto.randomUUID().slice(0, 8));
    const izzul = await signInAs('izzul');
    const claimed = await izzul.rpc('esh_claim_report_intake', {
      p_intake_id: intakeId,
      p_take_over: false,
    });
    expect(claimed.data).toMatchObject({ ok: true, status: 'triaging' });

    const declined = await izzul.rpc('esh_decline_report_intake', {
      p_intake_id: intakeId,
      p_reason: 'Inspected the location; the pallets were cleared the same day.',
    });
    expect(declined.error).toBeNull();
    expect(declined.data).toMatchObject({ ok: true, status: 'declined' });
  });

  it('lets a colleague decline it once they have taken it over deliberately', async () => {
    await ensureCoordinator('lim');
    const intakeId = await reportFrom(crypto.randomUUID().slice(0, 8));

    const izzul = await signInAs('izzul');
    await izzul.rpc('esh_claim_report_intake', { p_intake_id: intakeId, p_take_over: false });

    /*
     * The front door v310 built. The rescue the old back door existed for is
     * still available — it is now a deliberate act, and the audit keeps the
     * person it was taken from.
     */
    const lim = await signInAs('lim');
    const takenOver = await lim.rpc('esh_claim_report_intake', {
      p_intake_id: intakeId,
      p_take_over: true,
    });
    expect(takenOver.data).toMatchObject({ ok: true, taken_over: true });

    const declined = await lim.rpc('esh_decline_report_intake', {
      p_intake_id: intakeId,
      p_reason: 'Took it over while Izzul is away; there is nothing to act on.',
    });
    expect(declined.error).toBeNull();
    expect(declined.data).toMatchObject({ ok: true, status: 'declined' });

    const service = serviceClient();
    const { data: events } = await service
      .from('esh_audit_events')
      .select('event_type, detail')
      .eq('event_type', 'report_intake_claimed')
      .order('occurred_at', { ascending: false })
      .limit(20);
    const handover = (events ?? []).find(
      (row) => (row.detail as { intake_id?: string }).intake_id === intakeId,
    );
    expect(handover, 'the handover is not in the audit').toBeTruthy();
    expect((handover!.detail as { taken_over_from?: string }).taken_over_from).toBe(
      PEOPLE.izzul.id,
    );
  });
});

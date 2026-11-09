import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v307 — a hazard report claimed by somebody who never comes back.
 *
 * Triage is a two-step lock: `esh_claim_report_intake` moves a report from
 * 'new' to 'triaging' and records who holds it, and `esh_accept_report_intake`
 * — the only path that turns a report into a Finding — refuses anybody who is
 * not that person.
 *
 * The claim used to refuse anything that was not 'new', so a colleague could
 * neither take the report nor accept it. A report claimed by somebody who then
 * goes on leave could never become a Finding. The one act still open to anyone
 * else was `esh_decline_report_intake`, which checks no triager at all — so
 * the only thing a colleague could do with a stuck hazard report was throw it
 * away.
 *
 * Both coordinators here are seeded ESH staff with organisation-wide scope, so
 * this is about the claim and not about who may triage.
 */
describe('v307 a claimed report can be taken over', () => {
  /**
   * The seed grants ESH access to one person, so the second coordinator this
   * is about has to be made. Granted with organisation-wide scope on purpose:
   * the question here is the claim, not who may see which department, and a
   * scope difference would quietly answer it for the wrong reason.
   */
  async function ensureCoordinator(who: keyof typeof PEOPLE) {
    const service = serviceClient();
    const { data: existing } = await service
      .from('esh_staff_access')
      .select('id')
      .eq('user_id', PEOPLE[who].id)
      .maybeSingle();
    if (existing) return;
    const { error } = await service.from('esh_staff_access').insert({
      organization_id: 'e5e50000-0000-4000-8000-000000000001',
      user_id: PEOPLE[who].id,
      enabled: true,
      preset: 'verifier',
      scope_all_departments: true,
      can_manage_reports: true,
    });
    expect(error, `${who} needs ESH access for this to be about the claim`).toBeNull();
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
        organization_id: 'e5e50000-0000-4000-8000-000000000001',
        source: 'esh_manual' as const,
        report_text: `v307 ${marker} the guard fence by the press is tied back with wire`,
        reported_location: 'BR2 Workshop',
        department_id: department!.id,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    return String(data!.id);
  }

  it('lets a second coordinator take it and turn it into a finding', async () => {
    await ensureCoordinator('lim');
    const marker = crypto.randomUUID().slice(0, 8);
    const intakeId = await reportFrom(marker);

    const izzul = await signInAs('izzul');
    const claimed = await izzul.rpc('esh_claim_report_intake', { p_intake_id: intakeId });
    expect(claimed.error).toBeNull();
    expect(claimed.data).toMatchObject({ ok: true, status: 'triaging' });

    // Before: Lim could neither take it nor accept it, and the report was
    // stuck with Izzul for as long as Izzul was away.
    const lim = await signInAs('lim');
    const takenOver = await lim.rpc('esh_claim_report_intake', { p_intake_id: intakeId });
    expect(takenOver.error).toBeNull();
    expect(takenOver.data).toMatchObject({ ok: true, status: 'triaging', taken_over: true });

    const accepted = await lim.rpc('esh_accept_report_intake', {
      p_intake_id: intakeId,
      p_payload: {
        title: `v307 ${marker} guard fence tied back`,
        description: 'Reported through intake and triaged by a second coordinator.',
        reported_on: '2026-11-09',
        location: 'BR2 Workshop',
        required_outcome: 'Refit the fence properly and remove the wire.',
        priority: 'high',
        risk_level: 'high',
        owner_email: `v307.${marker}@example.com`,
        due_date: '2026-12-20',
        escalation: [],
        no_further_escalation_reason: 'integration',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toMatchObject({ ok: true });
  });

  it('records the handover rather than losing who had it', async () => {
    /*
     * "Who was triaging this" has to stay answerable after a take over, so the
     * audit row carries the person it was taken from. Auditability is not
     * optional here: the whole point of the claim is that somebody owned the
     * decision.
     */
    await ensureCoordinator('lim');
    const marker = crypto.randomUUID().slice(0, 8);
    const intakeId = await reportFrom(marker);

    const izzul = await signInAs('izzul');
    await izzul.rpc('esh_claim_report_intake', { p_intake_id: intakeId });
    const lim = await signInAs('lim');
    await lim.rpc('esh_claim_report_intake', { p_intake_id: intakeId });

    const service = serviceClient();
    const { data: events } = await service
      .from('esh_audit_events')
      .select('actor_user_id, detail')
      .eq('event_type', 'report_intake_claimed')
      .contains('detail', { intake_id: intakeId });

    const handover = (events ?? []).find(
      (row) => (row.detail as { taken_over_from?: string }).taken_over_from,
    );
    expect(handover, 'the take over should be in the audit').toBeTruthy();
    expect((handover!.detail as { taken_over_from?: string }).taken_over_from).toBe(
      PEOPLE.izzul.id,
    );
    expect(handover!.actor_user_id).toBe(PEOPLE.lim.id);
  });

  it('still refuses a report that already has an outcome', async () => {
    // The lock is relaxed for 'triaging' only. A declined report is a decision
    // somebody made, and claiming must not quietly reopen it.
    await ensureCoordinator('lim');
    const marker = crypto.randomUUID().slice(0, 8);
    const intakeId = await reportFrom(marker);

    const izzul = await signInAs('izzul');
    const declined = await izzul.rpc('esh_decline_report_intake', {
      p_intake_id: intakeId,
      p_reason: 'v307 not a finding',
    });
    expect(declined.error).toBeNull();
    expect(declined.data).toMatchObject({ ok: true });

    const lim = await signInAs('lim');
    const refused = await lim.rpc('esh_claim_report_intake', { p_intake_id: intakeId });
    expect(refused.error).toBeNull();
    expect(refused.data).toMatchObject({ ok: false, code: 'not_available' });
  });
});

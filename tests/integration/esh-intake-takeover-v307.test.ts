import { afterAll, describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * Both describes below need a second coordinator, and the seed grants ESH
 * access to one person only. Granting Lim access is therefore a change to the
 * seeded state, and leaving it behind is not harmless: `esh-foundations-v197`
 * asserts that Lim's Finding Management access reads "Off", and a browser run
 * that follows an integration run without an intervening `db:reset` fails on
 * it as though the administration screen had broken. Hand the access back.
 */
async function revokeCoordinator(who: keyof typeof PEOPLE) {
  const service = serviceClient();
  const { data: access } = await service
    .from('esh_staff_access')
    .select('id')
    .eq('user_id', PEOPLE[who].id)
    .maybeSingle();
  if (!access) return;
  await service.from('esh_staff_access_departments').delete().eq('access_id', access.id);
  await service.from('esh_staff_access').delete().eq('id', access.id);
}

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
  afterAll(async () => {
    await revokeCoordinator('lim');
  });

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

describe('v307 who may take a report over', () => {
  const ORG = 'e5e50000-0000-4000-8000-000000000001';

  afterAll(async () => {
    await revokeCoordinator('lim');
  });

  async function reportIn(code: string, marker: string) {
    const service = serviceClient();
    const { data: department } = await service
      .from('departments')
      .select('id')
      .eq('code', code)
      .single();
    const { data, error } = await service
      .from('esh_report_intake')
      .insert({
        organization_id: ORG,
        source: 'esh_manual' as const,
        report_text: `v307 ${marker} report filed against ${code}`,
        reported_location: code,
        department_id: department!.id,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    return String(data!.id);
  }

  it('refuses somebody with no Finding Management access at all', async () => {
    /*
     * The take over relaxed WHEN a report may be claimed. It must not have
     * relaxed WHO may claim one: `amer` is an ordinary member of staff with no
     * `esh_staff_access` row, and the module is not his to touch.
     */
    const marker = crypto.randomUUID().slice(0, 8);
    const intakeId = await reportIn('OPS', marker);
    const izzul = await signInAs('izzul');
    await izzul.rpc('esh_claim_report_intake', { p_intake_id: intakeId });

    const amer = await signInAs('amer');
    const refused = await amer.rpc('esh_claim_report_intake', { p_intake_id: intakeId });
    expect(refused.error).toBeNull();
    expect(refused.data).toMatchObject({ ok: false, code: 'not_permitted' });
  });

  it('refuses a coordinator whose departments do not cover it', async () => {
    /*
     * Scoped to TWO departments on purpose. At one department a scope check
     * written with the wrong negation reads exactly like a correct one, which
     * is how six Stage 2 procedures shipped inverted behind passing
     * assertions. The report is filed against a third department, so a
     * coordinator who covers neither must be told `not_found` - the same
     * answer they would get for a report that does not exist, because
     * "exists but is not yours" is itself a disclosure.
     */
    const marker = crypto.randomUUID().slice(0, 8);
    const intakeId = await reportIn('OPS', marker);
    const izzul = await signInAs('izzul');
    await izzul.rpc('esh_claim_report_intake', { p_intake_id: intakeId });

    const service = serviceClient();
    // The unique constraint is (organization_id, user_id), not user_id alone,
    // so naming the wrong one makes this an INSERT that collides and errors.
    // Assert the error: a silent null here turned a scope test into a
    // TypeError three lines later and said nothing about the scope at all.
    const { data: access, error: accessError } = await service
      .from('esh_staff_access')
      .upsert(
        {
          organization_id: ORG,
          user_id: PEOPLE.lim.id,
          enabled: true,
          preset: 'verifier',
          scope_all_departments: false,
          can_manage_reports: true,
        },
        { onConflict: 'organization_id,user_id' },
      )
      .select('id')
      .single();
    expect(accessError, 'Lim needs a scoped access row for this to be about scope').toBeNull();
    const { data: elsewhere } = await service
      .from('departments')
      .select('id, code')
      .in('code', ['ADMIN', 'EHS']);
    for (const department of elsewhere ?? []) {
      await service
        .from('esh_staff_access_departments')
        .upsert(
          { access_id: access!.id, department_id: department.id, include_descendants: false },
          { onConflict: 'access_id,department_id' },
        );
    }

    const lim = await signInAs('lim');
    const refused = await lim.rpc('esh_claim_report_intake', { p_intake_id: intakeId });
    expect(refused.error).toBeNull();
    expect(refused.data).toMatchObject({ ok: false, code: 'not_found' });

    // Put Lim back as an organisation-wide coordinator for the rest of the suite.
    await service.from('esh_staff_access_departments').delete().eq('access_id', access!.id);
    await service
      .from('esh_staff_access')
      .update({ scope_all_departments: true })
      .eq('id', access!.id);
  });

  it('never lets two coordinators convert the same report twice', async () => {
    /*
     * The property the claim exists for, and the one a take over could have
     * broken. Both coordinators claim at the same moment and both try to
     * accept at the same moment; `for update` serialises the claims, so one of
     * them ends up holding it and exactly one Finding is created. Two would be
     * two corrective actions, two owners and two due dates for one hazard.
     */
    const marker = crypto.randomUUID().slice(0, 8);
    const intakeId = await reportIn('OPS', marker);
    const izzul = await signInAs('izzul');
    const lim = await signInAs('lim');

    await Promise.all([
      izzul.rpc('esh_claim_report_intake', { p_intake_id: intakeId }),
      lim.rpc('esh_claim_report_intake', { p_intake_id: intakeId }),
    ]);

    const payload = (who: string) => ({
      p_intake_id: intakeId,
      p_payload: {
        title: `v307 ${marker} race ${who}`,
        description: 'Two coordinators accepting at once.',
        reported_on: '2026-11-09',
        location: 'OPS',
        required_outcome: 'Only one of these may exist.',
        priority: 'high',
        risk_level: 'high',
        owner_email: `v307.race.${marker}@example.com`,
        due_date: '2026-12-20',
        escalation: [],
        no_further_escalation_reason: 'integration',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });

    const results = await Promise.all([
      izzul.rpc('esh_accept_report_intake', payload('izzul')),
      lim.rpc('esh_accept_report_intake', payload('lim')),
    ]);
    const accepted = results.filter((one) => (one.data as { ok?: boolean })?.ok === true);
    expect(accepted, 'exactly one coordinator may convert a report').toHaveLength(1);

    const service = serviceClient();
    const { data: findings } = await service
      .from('esh_findings')
      .select('id')
      .like('title', `v307 ${marker} race%`);
    expect(findings ?? [], 'one hazard, one finding').toHaveLength(1);

    const { data: intake } = await service
      .from('esh_report_intake')
      .select('status')
      .eq('id', intakeId)
      .single();
    expect(intake!.status).toBe('accepted');
  });
});

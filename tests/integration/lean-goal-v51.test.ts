import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

const targetDate = () => new Date(Date.now() + 210 * 86_400_000).toISOString().slice(0, 10);

const measures = [
  { description: 'Complete at least four ESH inspections each month.' },
  { description: 'Assign an owner and target date to every inspection finding.' },
];

async function createSelfDraft(person: PersonKey = 'izzah') {
  const owner = await signInAs(person);
  const response = await owner.rpc('create_lean_goal', {
    p_owner_id: PEOPLE[person].id,
    p_expected_result: `Lean Goal ${crypto.randomUUID().slice(0, 8)}`,
    p_target_date: targetDate(),
    p_weight_percent: 15,
    p_measures: measures,
    p_agreed_approach: 'Review findings with area owners each month.',
    p_support_needed: null,
    p_dependencies: null,
    p_baseline: null,
    p_purpose: null,
    p_category: 'performance',
    p_milestones: [],
    p_submission_mode: 'draft',
    p_idempotency_key: crypto.randomUUID(),
  });
  expect(response.error).toBeNull();
  expect(response.data).toMatchObject({ ok: true, code: 'goal_draft_saved' });
  return response.data as Rpc & { goal_id: string; goal_version_id: string; version: number };
}

describe('Lean Goal v51 authoring and agreement', () => {
  it('lets an employee create one self-owned Draft with natural measures and zero milestones', async () => {
    const created = await createSelfDraft();
    const admin = serviceClient();
    const [{ data: goal }, { data: storedMeasures }, { count: milestoneCount }] = await Promise.all(
      [
        admin
          .from('goals')
          .select('owner_id,manager_id,created_by,status,active_version_id,pending_version_id')
          .eq('id', created.goal_id)
          .single(),
        admin
          .from('goal_success_measures')
          .select('description,optional_target_date,label,measure_type,current_state')
          .eq('goal_version_id', created.goal_version_id)
          .order('position'),
        admin
          .from('goal_milestones')
          .select('id', { count: 'exact', head: true })
          .eq('goal_version_id', created.goal_version_id),
      ],
    );

    expect(goal).toMatchObject({
      owner_id: PEOPLE.izzah.id,
      manager_id: PEOPLE.izzul.id,
      created_by: PEOPLE.izzah.id,
      status: 'draft',
      active_version_id: null,
      pending_version_id: created.goal_version_id,
    });
    expect(storedMeasures).toEqual([
      expect.objectContaining({
        description: measures[0]!.description,
        label: measures[0]!.description,
        measure_type: 'qualitative',
        current_state: 'not_started',
      }),
      expect.objectContaining({ description: measures[1]!.description }),
    ]);
    expect(milestoneCount).toBe(0);
  });

  it('edits the same pre-activation Goal and sends it for discussion without duplication', async () => {
    const created = await createSelfDraft();
    const owner = await signInAs('izzah');
    const response = await owner.rpc('save_goal_candidate_version', {
      p_goal_id: created.goal_id,
      p_expected_version: created.version,
      p_expected_result: 'Strengthen inspection follow-through and ownership.',
      p_target_date: targetDate(),
      p_weight_percent: 20,
      p_measures: [
        {
          description: 'Close at least half of monthly corrective actions.',
          optional_target_date: targetDate(),
        },
      ],
      p_agreed_approach: 'Consolidate findings monthly and review overdue actions.',
      p_support_needed: 'Escalation support for department-owned actions.',
      p_dependencies: null,
      p_baseline: null,
      p_purpose: null,
      p_milestones: [],
      p_submission_mode: 'discussion',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(response.error).toBeNull();
    expect(response.data).toMatchObject({ ok: true, code: 'goal_version_proposed', version: 2 });

    const [{ data: goal }, { data: versions }, { count: goalCount }] = await Promise.all([
      serviceClient()
        .from('goals')
        .select('id,status,pending_version_id,weight_percent')
        .eq('id', created.goal_id)
        .single(),
      serviceClient()
        .from('goal_versions')
        .select('status,version_number')
        .eq('goal_id', created.goal_id)
        .order('version_number'),
      serviceClient()
        .from('goals')
        .select('id', { count: 'exact', head: true })
        .eq('id', created.goal_id),
    ]);
    expect(goal).toMatchObject({ status: 'pending_discussion', weight_percent: 20 });
    expect(goal?.pending_version_id).not.toBe(created.goal_version_id);
    expect(versions).toEqual([
      { status: 'superseded', version_number: 1 },
      { status: 'pending', version_number: 2 },
    ]);
    expect(goalCount).toBe(1);
  });

  it('keeps formal activation manager-only and permits activation with zero milestones', async () => {
    // Amer retains allocation capacity even when an earlier v53 spec has
    // finalized Izzah's independent plan in this shared database suite.
    const created = await createSelfDraft('amer');
    const owner = await signInAs('amer');
    const refused = (
      await owner.rpc('agree_lean_goal_version', {
        p_goal_id: created.goal_id,
        p_pending_version_id: created.goal_version_id,
        p_expected_version: created.version,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });

    const manager = await signInAs('izzul');
    const agreed = (
      await manager.rpc('agree_lean_goal_version', {
        p_goal_id: created.goal_id,
        p_pending_version_id: created.goal_version_id,
        p_expected_version: created.version,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(agreed).toMatchObject({ ok: true, code: 'goal_version_agreed', version: 2 });

    const { data: active } = await serviceClient()
      .from('goals')
      .select('status,active_version_id,pending_version_id,manager_id,agreed_at')
      .eq('id', created.goal_id)
      .single();
    expect(active).toMatchObject({
      status: 'active',
      active_version_id: created.goal_version_id,
      pending_version_id: null,
      manager_id: PEOPLE.izzul.id,
    });
    expect(active?.agreed_at).toBeTruthy();
  });

  it('lets a manager create the same subordinate Goal directly and blocks unrelated employees', async () => {
    const manager = await signInAs('izzul');
    const created = (
      await manager.rpc('create_lean_goal', {
        p_owner_id: PEOPLE.izzah.id,
        p_expected_result: `Manager Goal ${crypto.randomUUID().slice(0, 8)}`,
        p_target_date: targetDate(),
        p_weight_percent: 10,
        p_measures: measures,
        p_milestones: [],
        p_submission_mode: 'discussion',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(created).toMatchObject({ ok: true, code: 'goal_saved_for_discussion' });

    const unrelated = await signInAs('ajmal');
    const refused = (
      await unrelated.rpc('create_lean_goal', {
        p_owner_id: PEOPLE.izzah.id,
        p_expected_result: 'Unauthorised Goal',
        p_target_date: targetDate(),
        p_weight_percent: 10,
        p_measures: measures,
        p_milestones: [],
        p_submission_mode: 'discussion',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });
  });

  it('blocks direct Goal writes while keeping audited revision history queryable', async () => {
    const created = await createSelfDraft();
    const owner = await signInAs('izzah');
    const direct = await owner
      .from('goals')
      .update({ title: 'Silent rewrite' })
      .eq('id', created.goal_id);
    expect(direct.error).not.toBeNull();

    const { data: audit } = await serviceClient()
      .from('audit_events')
      .select('event_type,goal_id,actor_id')
      .eq('goal_id', created.goal_id)
      .eq('event_type', 'goal_created')
      .single();
    expect(audit).toMatchObject({
      event_type: 'goal_created',
      goal_id: created.goal_id,
      actor_id: PEOPLE.izzah.id,
    });
  });
});

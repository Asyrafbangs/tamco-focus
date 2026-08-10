import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs, type PersonKey } from './setup';

/**
 * Goal read model, authority and milestone work.
 *
 * These were written against the v33 authoring procedures, which v53 §22
 * retired. The rules they establish did not go anywhere — who may create a
 * Goal for whom, that formal allocation cannot exceed 100%, that a milestone
 * moves on its own and completes the Goal only when every one of them is done —
 * so they now exercise the same rules through the lean flow that replaced it.
 *
 * What is gone from here is what is gone from the product: the per-Goal overall
 * update, whose idempotency and support handling now belong to
 * `submit_goal_monthly_session` and `raise_goal_support_request`
 * (`execution-goal-v53.test.ts`).
 */

type Rpc = Record<string, unknown> & { ok: boolean; code: string };

const targetDate = () => new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
const milestones = [
  {
    title: 'Define the problem',
    completion_definition: 'Users agree a prioritised problem statement.',
    weight_percent: 50,
    progress_percent: 0,
  },
  {
    title: 'Test the result',
    completion_definition: 'Three users complete the workflow and feedback is recorded.',
    weight_percent: 50,
    progress_percent: 0,
  },
];
const measures = [
  { description: 'The result is demonstrated and accepted by the intended users.' },
];

/**
 * An Active Goal with two milestones, created by the authorised manager.
 *
 * Owned by Lim by default. He carries no seeded formal allocation, so a fixture
 * cannot fail on the 100% guard because another suite in this shared database
 * activated something for the same person first. The weight is deliberately
 * small for the same reason.
 */
async function createGoalFixture(owner: PersonKey = 'lim', activate = true) {
  const manager = await signInAs('izzul');
  const { data, error } = await manager.rpc('create_lean_goal', {
    p_owner_id: PEOPLE[owner].id,
    p_expected_result: `Integration Goal ${crypto.randomUUID().slice(0, 8)}`,
    p_target_date: targetDate(),
    p_weight_percent: 2,
    p_measures: measures,
    p_agreed_approach: 'Test the smallest useful version first.',
    p_support_needed: 'Fortnightly coaching and access to intended users.',
    p_dependencies: null,
    p_baseline: 'The work is currently coordinated manually.',
    p_purpose: 'Reduce repeated administration.',
    p_category: 'improvement',
    p_milestones: milestones,
    p_submission_mode: activate ? 'active' : 'discussion',
    p_idempotency_key: crypto.randomUUID(),
  });
  expect(error).toBeNull();
  expect(data).toMatchObject({ ok: true });
  return data as Rpc & { goal_id: string; goal_version_id: string; version: number };
}

describe('Goal read model and authority', () => {
  it('keeps reported progress separate from structured success-measure progress', async () => {
    const owner = await signInAs('amer');
    const { data, error } = await owner
      .from('goal_overview')
      .select(
        'title,reported_progress,derived_progress,open_support_count,needs_attention,active_version_id',
      )
      .eq('id', 'f0c06000-0000-4000-a000-000000000001')
      .single();
    expect(error).toBeNull();
    expect(data?.title).toBe('Safety Digitalisation');
    expect(data?.reported_progress).toEqual(expect.any(Number));
    expect(data?.open_support_count).toEqual(expect.any(Number));
    expect(data?.needs_attention).toEqual(expect.any(Boolean));

    const measuresResult = await owner
      .from('goal_success_measures')
      .select('measure_type,target_numeric,current_numeric,current_state')
      .eq('goal_version_id', data!.active_version_id!);
    expect(measuresResult.error).toBeNull();
    expect(measuresResult.data!.length).toBeGreaterThan(0);
    expect(data?.derived_progress).toBe(0);
  });

  it('separates visibility, update, structural edit, and agreement capabilities', async () => {
    const viewer = await signInAs('amer');
    const visible = await viewer.rpc('get_goal_capabilities', {
      p_goal_id: 'f0c06000-0000-4000-a000-000000000002',
    });
    expect(visible.data).toMatchObject({
      can_view: true,
      can_update: false,
      can_edit_structure: false,
      can_agree: false,
    });

    const manager = await signInAs('izzul');
    const managed = await manager.rpc('get_goal_capabilities', {
      p_goal_id: 'f0c06000-0000-4000-a000-000000000002',
    });
    expect(managed.data).toMatchObject({
      can_view: true,
      can_update: true,
      can_edit_structure: true,
      can_agree: true,
    });
  });

  it('holds a Goal saved for discussion in pending_discussion with no active version', async () => {
    const created = await createGoalFixture('izzah', false);
    expect(created.code).toBe('goal_saved_for_discussion');
    const row = await serviceClient()
      .from('goals')
      .select('status,active_version_id,pending_version_id')
      .eq('id', created.goal_id)
      .single();
    expect(row.data).toMatchObject({
      status: 'pending_discussion',
      active_version_id: null,
      pending_version_id: created.goal_version_id,
    });
  });

  it('blocks formal activation above 100% while preserving save for discussion', async () => {
    const manager = await signInAs('izzul');
    const args = {
      p_owner_id: PEOPLE.amer.id,
      p_expected_result: `Formal weight guard ${crypto.randomUUID().slice(0, 8)}`,
      p_target_date: targetDate(),
      p_weight_percent: 100,
      p_measures: [
        { description: 'The formal allocation remains at or below one hundred percent.' },
      ],
      p_category: 'performance',
      p_milestones: milestones,
      p_idempotency_key: crypto.randomUUID(),
    };
    // Amer already carries seeded formal weight, so 100 more can never fit.
    const blocked = (
      await manager.rpc('create_lean_goal', { ...args, p_submission_mode: 'active' })
    ).data as Rpc;
    expect(blocked).toMatchObject({ ok: false, code: 'invalid_target' });

    const discussion = (
      await manager.rpc('create_lean_goal', {
        ...args,
        p_submission_mode: 'discussion',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(discussion).toMatchObject({ ok: true, code: 'goal_saved_for_discussion' });
  });
});

describe('Goal milestone and revision transactions', () => {
  it('updates milestones independently and completes the Goal only when every milestone is complete', async () => {
    const goal = await createGoalFixture();
    const owner = await signInAs('lim');
    const admin = serviceClient();
    const { data: milestoneRows } = await admin
      .from('goal_milestones')
      .select('id,position')
      .eq('goal_version_id', goal.goal_version_id)
      .order('position');
    const firstId = milestoneRows![0]!.id;
    const secondId = milestoneRows![1]!.id;

    const firstResponse = await owner.rpc('post_goal_milestone_update', {
      p_goal_id: goal.goal_id,
      p_milestone_id: firstId,
      p_expected_version: 1,
      p_progress: 100,
      p_comment: 'Problem definition agreed.',
      p_mark_complete: true,
      p_attachments: [],
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(firstResponse.error).toBeNull();
    const first = firstResponse.data as Rpc;
    expect(first).toMatchObject({ ok: true, code: 'milestone_updated', derived_progress: 50 });
    const afterFirst = await admin
      .from('goals')
      .select('status,reported_progress,version')
      .eq('id', goal.goal_id)
      .single();
    expect(afterFirst.data).toMatchObject({ status: 'active', reported_progress: 0, version: 2 });

    const secondResponse = await owner.rpc('post_goal_milestone_update', {
      p_goal_id: goal.goal_id,
      p_milestone_id: secondId,
      p_expected_version: 2,
      p_progress: 100,
      p_comment: 'User testing accepted.',
      p_mark_complete: true,
      p_attachments: [],
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(secondResponse.error).toBeNull();
    const second = secondResponse.data as Rpc;
    expect(second).toMatchObject({ ok: true, code: 'goal_completed', derived_progress: 100 });
    const completed = await admin
      .from('goals')
      .select('status,health,reported_progress,completed_at')
      .eq('id', goal.goal_id)
      .single();
    expect(completed.data).toMatchObject({
      status: 'completed',
      health: 'completed',
      reported_progress: 0,
    });
    expect(completed.data?.completed_at).not.toBeNull();
  });

  it('saves a milestone check-in and its shared support request atomically', async () => {
    const goal = await createGoalFixture();
    const owner = await signInAs('lim');
    const admin = serviceClient();
    const { data: milestone } = await admin
      .from('goal_milestones')
      .select('id')
      .eq('goal_version_id', goal.goal_version_id)
      .order('position')
      .limit(1)
      .single();

    const response = await owner.rpc('post_goal_milestone_checkin', {
      p_goal_id: goal.goal_id,
      p_milestone_id: milestone!.id,
      p_expected_version: 1,
      p_progress: 5,
      p_comment:
        'Validated the first result.\n\nNext step: Confirm the remaining users.\n\nSupport requested: Arrange night-shift access.',
      p_what_changed: 'Validated the first result.',
      p_next_step: 'Confirm the remaining users.',
      p_support_requested: true,
      p_support_details: 'Arrange night-shift access.',
      p_mark_complete: false,
      p_attachments: [],
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(response.error).toBeNull();
    expect(response.data).toMatchObject({
      ok: true,
      support_requested: true,
      derived_progress: 3,
    });

    const [{ data: support }, { data: notification }, { data: update }] = await Promise.all([
      admin.from('barriers').select('status,support_needed').eq('goal_id', goal.goal_id).single(),
      admin
        .from('notifications')
        .select('kind,requires_action,goal_id')
        .eq('goal_id', goal.goal_id)
        .eq('kind', 'goal_support_requested')
        .single(),
      admin
        .from('goal_milestone_updates')
        .select('new_progress,comment')
        .eq('goal_id', goal.goal_id)
        .single(),
    ]);
    expect(support).toMatchObject({
      status: 'open',
      support_needed: 'Arrange night-shift access.',
    });
    expect(notification).toMatchObject({
      kind: 'goal_support_requested',
      requires_action: true,
      goal_id: goal.goal_id,
    });
    expect(update).toMatchObject({ new_progress: 5 });
    expect(update?.comment).toContain('Next step: Confirm the remaining users.');
  });

  it('rolls back an invalid Active revision and activates only an agreed valid version', async () => {
    const goal = await createGoalFixture();
    const owner = await signInAs('lim');
    const revision = {
      p_goal_id: goal.goal_id,
      p_expected_version: 1,
      p_target_date: targetDate(),
      p_weight_percent: 2,
      p_revision_reason: 'The intended users changed after the first walkthrough.',
    };
    const invalid = (
      await owner.rpc('revise_lean_goal_version', {
        ...revision,
        p_expected_result: 'Revised outcome',
        p_measures: [{ description: 'Revised measure' }],
        // Milestone weights that do not add up: the whole revision must be
        // refused, leaving the agreed version exactly as it was.
        p_milestones: [
          { ...milestones[0], weight_percent: 80 },
          { ...milestones[1], weight_percent: 10 },
        ],
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(invalid).toMatchObject({ ok: false, code: 'validation_failed' });
    const afterInvalid = await serviceClient()
      .from('goals')
      .select('active_version_id,pending_version_id,version')
      .eq('id', goal.goal_id)
      .single();
    expect(afterInvalid.data).toMatchObject({
      active_version_id: goal.goal_version_id,
      pending_version_id: null,
      version: 1,
    });

    const proposed = (
      await owner.rpc('revise_lean_goal_version', {
        ...revision,
        p_expected_result: 'Revised aligned outcome',
        p_measures: [{ description: 'The revised result is accepted by five users.' }],
        p_agreed_approach: 'Expand testing after the first validated workflow.',
        p_support_needed: 'Weekly coaching during the pilot.',
        p_milestones: milestones,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { pending_version_id: string; version: number };
    expect(proposed).toMatchObject({
      ok: true,
      code: 'goal_version_proposed',
      version: 2,
      revision_reason_recorded: true,
    });

    const manager = await signInAs('izzul');
    const agreed = (
      await manager.rpc('agree_lean_goal_version', {
        p_goal_id: goal.goal_id,
        p_pending_version_id: proposed.pending_version_id,
        p_expected_version: 2,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(agreed).toMatchObject({ ok: true, code: 'goal_version_agreed', version: 3 });

    const versions = await serviceClient()
      .from('goal_versions')
      .select('id,status')
      .eq('goal_id', goal.goal_id);
    expect(versions.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: goal.goal_version_id, status: 'superseded' }),
        expect.objectContaining({ id: proposed.pending_version_id, status: 'active' }),
      ]),
    );
  });

  it('commits private Goal evidence metadata with its update', async () => {
    const goal = await createGoalFixture();
    const owner = await signInAs('lim');
    const { data: milestone } = await serviceClient()
      .from('goal_milestones')
      .select('id')
      .eq('goal_version_id', goal.goal_version_id)
      .order('position')
      .limit(1)
      .single();

    const attachmentId = crypto.randomUUID();
    const path = `goals/${goal.goal_id}/${attachmentId}-goal-evidence.txt`;
    const body = new Blob(['goal evidence'], { type: 'text/plain' });
    const upload = await owner.storage.from('task-attachments').upload(path, body, {
      contentType: 'text/plain',
      upsert: false,
    });
    expect(upload.error).toBeNull();

    const posted = (
      await owner.rpc('post_goal_milestone_update', {
        p_goal_id: goal.goal_id,
        p_milestone_id: milestone!.id,
        p_expected_version: 1,
        p_progress: 5,
        p_comment: 'Attached the first validation record.',
        p_mark_complete: false,
        p_attachments: [
          {
            id: attachmentId,
            storage_path: path,
            file_name: 'goal-evidence.txt',
            mime_type: 'text/plain',
            byte_size: body.size,
          },
        ],
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(posted).toMatchObject({ ok: true, attachment_count: 1 });

    const attachment = await serviceClient()
      .from('goal_attachments')
      .select('goal_id,milestone_update_id,uploaded_by,storage_path')
      .eq('id', attachmentId)
      .single();
    expect(attachment.data).toMatchObject({
      goal_id: goal.goal_id,
      uploaded_by: PEOPLE.lim.id,
      storage_path: path,
    });
    // Evidence is committed against the update it arrived with, not left loose.
    expect(attachment.data?.milestone_update_id).toBeTruthy();
  });
});

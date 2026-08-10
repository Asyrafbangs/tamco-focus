import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

async function currentPlan(employeeId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await serviceClient()
    .from('goal_plan_overview')
    .select('*')
    .eq('employee_id', employeeId)
    .lte('starts_on', today)
    .gte('ends_on', today)
    .order('ends_on', { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

async function activeGoals(employeeId: string, periodId: string) {
  const { data, error } = await serviceClient()
    .from('goals')
    .select('id,version,title')
    .eq('owner_id', employeeId)
    .eq('performance_period_id', periodId)
    .eq('status', 'active')
    .order('created_at');
  if (error) throw error;
  return data;
}

describe('v53 execution lifecycle cleanup', () => {
  it('keeps Mandatory cancellation manager-only and deactivates every action projection', async () => {
    const task = await createTask('izzah', {
      status: 'active',
      is_mandatory: true,
      mandatory_justification: 'Controlled action required by the manager.',
      activated_by: PEOPLE.izzul.id,
      activated_at: new Date().toISOString(),
    });
    const owner = await signInAs('izzah');
    const raised = (
      await owner.rpc('raise_barrier', {
        p_task_id: task.id,
        p_description: 'A decision is needed before work can continue.',
        p_support_needed: 'Confirm the safe method.',
        p_impact: 'management_decision_required',
        p_action_type: 'decision',
        p_action_required_from: PEOPLE.izzul.id,
        p_add_to_meeting_queue: true,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { barrier_id: string };
    expect(raised.ok).toBe(true);

    const refused = (
      await owner.rpc('cancel_task', {
        p_task_id: task.id,
        p_expected_version: task.version + 1,
        p_reason: 'Owner cannot cancel mandatory work.',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });

    const manager = await signInAs('izzul');
    const cancelled = (
      await manager.rpc('cancel_task', {
        p_task_id: task.id,
        p_expected_version: task.version + 1,
        p_reason: 'The controlled action was superseded by an approved engineering control.',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(cancelled).toMatchObject({ ok: true, code: 'cancelled' });

    const admin = serviceClient();
    const [{ data: barrier }, { data: notices }, { data: queue }] = await Promise.all([
      admin
        .from('barriers')
        .select('source_active,action_pending,status')
        .eq('id', raised.barrier_id)
        .single(),
      admin.from('notifications').select('requires_action').eq('barrier_id', raised.barrier_id),
      admin
        .from('meeting_queue_items')
        .select('source_active,status')
        .eq('barrier_id', raised.barrier_id),
    ]);
    expect(barrier).toMatchObject({ source_active: false, action_pending: false });
    expect(notices?.every((notice) => !notice.requires_action)).toBe(true);
    expect(queue?.every((item) => !item.source_active && item.status === 'removed')).toBe(true);
  });

  it('retains Active state on reassignment and recalculates Shared as a projection', async () => {
    const task = await createTask('izzah', {
      status: 'active',
      activated_by: PEOPLE.izzah.id,
      activated_at: new Date().toISOString(),
    });
    const { error: checklistError } = await serviceClient().from('task_checklist_items').insert({
      task_id: task.id,
      action: 'Prepare the shared operating record.',
      position: 1,
      assigned_to: PEOPLE.ajmal.id,
      evidence_rule: 'not_required',
    });
    expect(checklistError).toBeNull();
    const { count: before } = await serviceClient()
      .from('shared_contributions')
      .select('checklist_item_id', { count: 'exact', head: true })
      .eq('task_id', task.id)
      .eq('assignee_id', PEOPLE.ajmal.id);
    expect(before).toBe(1);

    const manager = await signInAs('izzul');
    const result = (
      await manager.rpc('reassign_task', {
        p_task_id: task.id,
        p_expected_version: task.version,
        p_new_owner_id: PEOPLE.ajmal.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(result).toMatchObject({ ok: true, status_retained: 'active' });

    const [{ data: after }, { count: sharedAfter }] = await Promise.all([
      serviceClient().from('tasks').select('status,primary_owner_id').eq('id', task.id).single(),
      serviceClient()
        .from('shared_contributions')
        .select('checklist_item_id', { count: 'exact', head: true })
        .eq('task_id', task.id)
        .eq('assignee_id', PEOPLE.ajmal.id),
    ]);
    expect(after).toMatchObject({ status: 'active', primary_owner_id: PEOPLE.ajmal.id });
    expect(sharedAfter).toBe(0);
  });

  it('requires the generic source triple to be all present or all absent', async () => {
    const { error } = await serviceClient().from('tasks').insert({
      title: 'Invalid partial source',
      status: 'backlog',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: PEOPLE.izzah.id,
      created_by: PEOPLE.izzah.id,
      source_module: 'external_module',
    });
    expect(error?.message).toContain('tasks_source_link_all_or_none');
  });
});

describe('v53 Major Project discussion', () => {
  it('supports request changes, owner resubmission and agreement into Available', async () => {
    const admin = serviceClient();
    const { data: proposal, error } = await admin
      .from('work_proposals')
      .insert({
        kind: 'major_project',
        title: `Major proposal ${crypto.randomUUID().slice(0, 8)}`,
        rationale: 'A sustained outcome requiring planned work.',
        proposed_by: PEOPLE.izzah.id,
      })
      .select('id,version')
      .single();
    expect(error).toBeNull();

    const manager = await signInAs('izzul');
    const changes = (
      await manager.rpc('decide_major_project_proposal', {
        p_proposal_id: proposal!.id,
        p_expected_version: proposal!.version,
        p_decision: 'request_changes',
        p_note: 'Clarify the operating result and ownership.',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(changes).toMatchObject({ ok: true, code: 'proposal_changes_requested' });

    const owner = await signInAs('izzah');
    const resubmitted = (
      await owner.rpc('resubmit_major_project_proposal', {
        p_proposal_id: proposal!.id,
        p_expected_version: Number(changes.version),
        p_title: 'Stabilise the operating control system',
        p_rationale: 'Deliver a stable, owned and demonstrably effective control system.',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(resubmitted).toMatchObject({ ok: true, code: 'proposal_resubmitted' });

    const agreed = (
      await manager.rpc('decide_major_project_proposal', {
        p_proposal_id: proposal!.id,
        p_expected_version: Number(resubmitted.version),
        p_decision: 'agree',
        p_note: 'Agreed for owner activation.',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { task_id: string };
    expect(agreed).toMatchObject({ ok: true, code: 'proposal_agreed' });
    const { data: task } = await admin
      .from('tasks')
      .select('status,work_class,primary_owner_id')
      .eq('id', agreed.task_id)
      .single();
    expect(task).toMatchObject({
      status: 'backlog',
      work_class: 'major_project',
      primary_owner_id: PEOPLE.izzah.id,
    });
  });
});

describe('v53 employee-level Goal sessions', () => {
  it('validates the whole month before writing and completes it exactly once', async () => {
    const plan = await currentPlan(PEOPLE.izzah.id);
    const goals = await activeGoals(PEOPLE.izzah.id, plan.performance_period_id);
    expect(goals.length).toBeGreaterThan(0);
    const owner = await signInAs('izzah');
    const year = 2026;
    const { data: existingMonths } = await serviceClient()
      .from('goal_checkin_sessions')
      .select('period_month')
      .eq('employee_id', PEOPLE.izzah.id)
      .eq('period_year', year)
      .eq('session_kind', 'monthly');
    const month = Array.from({ length: 12 }, (_, index) => index + 1).find(
      (candidate) => !existingMonths?.some((session) => session.period_month === candidate),
    );
    expect(month).toBeDefined();
    const { count: beforeInvalid } = await serviceClient()
      .from('goal_checkin_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', PEOPLE.izzah.id)
      .eq('period_year', year)
      .eq('period_month', month!);

    const invalid = (
      await owner.rpc('submit_goal_monthly_session', {
        p_employee_id: PEOPLE.izzah.id,
        p_performance_period_id: plan.performance_period_id,
        p_period_year: year,
        p_period_month: month!,
        p_items: goals.map((goal, index) => ({
          goal_id: goal.id,
          health: index === 0 ? 'at_risk' : 'on_track',
          update_text: null,
          support_requested: false,
        })),
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(invalid).toMatchObject({ ok: false, code: 'validation_failed' });
    const { count: afterInvalid } = await serviceClient()
      .from('goal_checkin_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', PEOPLE.izzah.id)
      .eq('period_year', year)
      .eq('period_month', month!);
    expect(afterInvalid).toBe(beforeInvalid);

    const key = crypto.randomUUID();
    const args = {
      p_employee_id: PEOPLE.izzah.id,
      p_performance_period_id: plan.performance_period_id,
      p_period_year: year,
      p_period_month: month!,
      p_items: goals.map((goal) => ({
        goal_id: goal.id,
        health: 'on_track',
        update_text: null,
        support_requested: false,
      })),
      p_idempotency_key: key,
    };
    const submitted = (await owner.rpc('submit_goal_monthly_session', args)).data as Rpc;
    const replay = (await owner.rpc('submit_goal_monthly_session', args)).data as Rpc;
    expect(submitted).toMatchObject({ ok: true, goal_count: goals.length });
    expect(replay).toEqual(submitted);

    const duplicate = (
      await owner.rpc('submit_goal_monthly_session', {
        ...args,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(duplicate).toMatchObject({ ok: false, code: 'already_submitted' });
  });

  it('completes one quarterly review for all Active Goals, including manager self-governance', async () => {
    const employeePlan = await currentPlan(PEOPLE.izzah.id);
    const employeeGoals = await activeGoals(PEOPLE.izzah.id, employeePlan.performance_period_id);
    const manager = await signInAs('izzul');
    const { data: existingQuarters } = await serviceClient()
      .from('goal_checkin_sessions')
      .select('period_quarter')
      .eq('employee_id', PEOPLE.izzah.id)
      .eq('period_year', 2026)
      .eq('session_kind', 'quarterly');
    const quarter = [1, 2, 3, 4].find(
      (candidate) => !existingQuarters?.some((session) => session.period_quarter === candidate),
    );
    expect(quarter).toBeDefined();
    const reviewResponse = await manager.rpc('complete_goal_quarterly_session', {
      p_employee_id: PEOPLE.izzah.id,
      p_performance_period_id: employeePlan.performance_period_id,
      p_period_year: 2026,
      p_period_quarter: quarter!,
      p_items: employeeGoals.map((goal) => ({
        goal_id: goal.id,
        health: 'on_track',
        attention_text: null,
        support_adjustment: null,
      })),
      p_summary: 'The complete Active Goal set was reviewed.',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(reviewResponse.error).toBeNull();
    const reviewed = reviewResponse.data as Rpc;
    expect(reviewed).toMatchObject({ ok: true, goal_count: employeeGoals.length });

    const selfGoal = (
      await manager.rpc('create_lean_goal', {
        p_owner_id: PEOPLE.izzul.id,
        p_expected_result: `Manager self-governed Goal ${crypto.randomUUID().slice(0, 8)}`,
        p_target_date: '2026-12-19',
        p_weight_percent: 10,
        p_measures: [{ description: 'The self-governed result is demonstrated.' }],
        p_milestones: [],
        p_submission_mode: 'discussion',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { goal_id: string; goal_version_id: string; version: number };
    expect(selfGoal.ok).toBe(true);
    const selfAgreed = (
      await manager.rpc('agree_lean_goal_version', {
        p_goal_id: selfGoal.goal_id,
        p_pending_version_id: selfGoal.goal_version_id,
        p_expected_version: selfGoal.version,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(selfAgreed.ok).toBe(true);
    const managerPlan = await currentPlan(PEOPLE.izzul.id);
    const managerGoals = await activeGoals(PEOPLE.izzul.id, managerPlan.performance_period_id);
    if (managerGoals.length > 0) {
      const { data: managerQuarters } = await serviceClient()
        .from('goal_checkin_sessions')
        .select('period_quarter')
        .eq('employee_id', PEOPLE.izzul.id)
        .eq('period_year', 2026)
        .eq('session_kind', 'quarterly');
      const managerQuarter = [1, 2, 3, 4].find(
        (candidate) => !managerQuarters?.some((session) => session.period_quarter === candidate),
      );
      expect(managerQuarter).toBeDefined();
      const selfReview = (
        await manager.rpc('complete_goal_quarterly_session', {
          p_employee_id: PEOPLE.izzul.id,
          p_performance_period_id: managerPlan.performance_period_id,
          p_period_year: 2026,
          p_period_quarter: managerQuarter!,
          p_items: managerGoals.map((goal) => ({
            goal_id: goal.id,
            health: 'no_material_change',
          })),
          p_idempotency_key: crypto.randomUUID(),
        })
      ).data as Rpc;
      expect(selfReview).toMatchObject({ ok: true, self_review: true });
    }
  });

  it('finalizes the formal plan only at exactly 100%', async () => {
    let plan = await currentPlan(PEOPLE.izzah.id);
    const manager = await signInAs('izzul');
    if (plan.formal_weight < 100) {
      const allocationGoal = (
        await manager.rpc('create_lean_goal', {
          p_owner_id: PEOPLE.izzah.id,
          p_expected_result: `Complete formal allocation ${crypto.randomUUID().slice(0, 8)}`,
          p_target_date: '2026-12-22',
          p_weight_percent: 100 - plan.formal_weight,
          p_measures: [{ description: 'The remaining formal outcome is demonstrated.' }],
          p_milestones: [],
          p_submission_mode: 'active',
          p_idempotency_key: crypto.randomUUID(),
        })
      ).data as Rpc;
      expect(allocationGoal.ok).toBe(true);
      plan = await currentPlan(PEOPLE.izzah.id);
    }
    expect(plan.formal_weight).toBe(100);
    expect(plan.can_finalize).toBe(true);
    const finalized = (
      await manager.rpc('finalize_goal_plan', {
        p_employee_id: PEOPLE.izzah.id,
        p_performance_period_id: plan.performance_period_id,
        p_expected_version: plan.version,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(finalized).toMatchObject({ ok: true, code: 'goal_plan_finalized' });
  });
});

describe('v53 Goal support uses the shared request engine', () => {
  it('keeps a response distinct from resolution and then closes the same request', async () => {
    const { data: goal } = await serviceClient()
      .from('goals')
      .select('id')
      .eq('owner_id', PEOPLE.izzah.id)
      .eq('status', 'active')
      .limit(1)
      .single();
    const owner = await signInAs('izzah');
    const raised = (
      await owner.rpc('raise_goal_support_request', {
        p_goal_id: goal!.id,
        p_description: 'A cross-team decision is blocking the agreed result.',
        p_support_needed: 'Confirm which team owns the interface decision.',
        p_action_required_from: PEOPLE.izzul.id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { request_id: string };
    expect(raised).toMatchObject({ ok: true, code: 'goal_support_requested' });

    const manager = await signInAs('izzul');
    const answered = (
      await manager.rpc('post_barrier_response', {
        p_barrier_id: raised.request_id,
        p_message: 'Operations owns the interface and will confirm the named contact.',
        p_expected_version: 1,
        p_kind: 'answer',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(answered).toMatchObject({ ok: true });
    const { data: afterAnswer } = await serviceClient()
      .from('barriers')
      .select('status,action_pending,source_active')
      .eq('id', raised.request_id)
      .single();
    expect(afterAnswer).toMatchObject({
      status: 'open',
      action_pending: false,
      source_active: true,
    });

    const resolved = (
      await owner.rpc('resolve_barrier', {
        p_barrier_id: raised.request_id,
        p_resolution_note: 'The owner was confirmed and the interface decision was recorded.',
      })
    ).data as Rpc;
    expect(resolved).toMatchObject({ ok: true });
    const { data: afterResolve } = await serviceClient()
      .from('barriers')
      .select('status,source_active')
      .eq('id', raised.request_id)
      .single();
    expect(afterResolve).toMatchObject({ status: 'resolved', source_active: true });
  });
});

describe('v53 Goal terminal outcomes and audited revision', () => {
  it('records every actual result on completion and keeps cancellation separate', async () => {
    const manager = await signInAs('izzul');
    const created = (
      await manager.rpc('create_lean_goal', {
        p_owner_id: PEOPLE.lim.id,
        p_expected_result: `Terminal outcome ${crypto.randomUUID().slice(0, 8)}`,
        p_target_date: '2026-12-20',
        p_weight_percent: 10,
        p_measures: [{ description: 'The operating result is demonstrated.' }],
        p_milestones: [],
        p_submission_mode: 'active',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { goal_id: string; goal_version_id: string; version: number };
    expect(created.ok).toBe(true);
    const { data: measure } = await serviceClient()
      .from('goal_success_measures')
      .select('id')
      .eq('goal_version_id', created.goal_version_id)
      .single();

    const completed = (
      await manager.rpc('complete_goal', {
        p_goal_id: created.goal_id,
        p_expected_version: created.version,
        p_final_result_summary: 'The agreed operating result was delivered and verified.',
        p_measure_results: [
          { measure_id: measure!.id, actual_result: 'The result was demonstrated on 8 Aug 2026.' },
        ],
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(completed).toMatchObject({ ok: true, code: 'goal_completed' });
    const { data: recorded } = await serviceClient()
      .from('goal_success_measures')
      .select('actual_result,actual_recorded_at')
      .eq('id', measure!.id)
      .single();
    expect(recorded?.actual_result).toContain('demonstrated');
    expect(recorded?.actual_recorded_at).not.toBeNull();

    const second = (
      await manager.rpc('create_lean_goal', {
        p_owner_id: PEOPLE.lim.id,
        p_expected_result: `Cancelled outcome ${crypto.randomUUID().slice(0, 8)}`,
        p_target_date: '2026-12-21',
        p_weight_percent: 15,
        p_measures: [{ description: 'A second result is demonstrated.' }],
        p_milestones: [],
        p_submission_mode: 'active',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc & { goal_id: string; version: number };
    expect(second.ok).toBe(true);
    const cancelResponse = await manager.rpc('cancel_goal', {
      p_goal_id: second.goal_id,
      p_expected_version: second.version,
      p_reason: 'The operating model changed and this agreement no longer applies.',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(cancelResponse.error).toBeNull();
    const cancelled = cancelResponse.data as Rpc;
    expect(cancelled).toMatchObject({ ok: true, code: 'goal_cancelled' });
    const { data: cancelledGoal } = await serviceClient()
      .from('goals')
      .select('status,cancellation_reason,final_result_summary')
      .eq('id', second.goal_id)
      .single();
    expect(cancelledGoal).toMatchObject({
      status: 'cancelled',
      final_result_summary: null,
    });
    expect(cancelledGoal?.cancellation_reason).toContain('no longer applies');
    const { data: planAfterCancellation } = await serviceClient()
      .from('goal_plan_overview')
      .select('status,reallocation_required')
      .eq('employee_id', PEOPLE.lim.id)
      .limit(1)
      .single();
    expect(planAfterCancellation?.status).toBe('reallocation_required');
    expect(planAfterCancellation?.reallocation_required).toBeGreaterThan(0);
  });

  it('requires a reason and preserves before/after snapshots for an Active revision', async () => {
    const { data: goal } = await serviceClient()
      .from('goals')
      .select('id,version,active_version_id')
      .eq('owner_id', PEOPLE.izzah.id)
      .eq('status', 'active')
      .limit(1)
      .single();
    const { data: version } = await serviceClient()
      .from('goal_versions')
      .select('*')
      .eq('id', goal!.active_version_id!)
      .single();
    const { data: measures } = await serviceClient()
      .from('goal_success_measures')
      .select('description,label,optional_target_date')
      .eq('goal_version_id', goal!.active_version_id!)
      .order('position');
    const owner = await signInAs('izzah');
    const baseArgs = {
      p_goal_id: goal!.id,
      p_expected_version: goal!.version,
      p_expected_result: version!.expected_result,
      p_target_date: version!.target_date,
      p_weight_percent: version!.weight_percent,
      p_measures: measures?.map((measure) => ({
        description: measure.description ?? measure.label,
        optional_target_date: measure.optional_target_date,
      })),
      p_agreed_approach: version!.employee_approach,
      p_support_needed: version!.support_agreed,
      p_dependencies: version!.dependencies,
      p_baseline: version!.baseline,
      p_purpose: version!.purpose,
      p_milestones: [],
    };
    const noReason = (
      await owner.rpc('revise_lean_goal_version', {
        ...baseArgs,
        p_revision_reason: '',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(noReason).toMatchObject({ ok: false, code: 'reason_required' });

    const revisionResponse = await owner.rpc('revise_lean_goal_version', {
      ...baseArgs,
      p_expected_result: `${version!.expected_result} with verified handover`,
      p_revision_reason: 'The agreed operating scope now includes handover verification.',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(revisionResponse.error).toBeNull();
    const revised = revisionResponse.data as Rpc;
    expect(revised).toMatchObject({ ok: true, revision_reason_recorded: true });
    const { data: audit } = await serviceClient()
      .from('audit_events')
      .select('detail')
      .eq('goal_id', goal!.id)
      .eq('event_type', 'goal_version_proposed')
      .contains('detail', { revision_record: true })
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit?.detail).toMatchObject({
      reason: 'The agreed operating scope now includes handover verification.',
      before: expect.any(Object),
      after: expect.any(Object),
    });
  });
});

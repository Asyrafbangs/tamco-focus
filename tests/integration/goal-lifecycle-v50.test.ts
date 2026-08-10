import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * What survives of the v50 per-Goal cadence.
 *
 * v53 §11 and §14 replaced the per-Goal monthly and quarterly records with one
 * employee session covering every Active Goal, and §17 replaced the year-end
 * finalise with an explicit Complete. The procedures behind the old cadence are
 * gone (§22), and the tests that only exercised their mechanics went with them:
 * exactly-once submission, whole-month validation and quarterly completion are
 * covered against the session engine in `execution-goal-v53.test.ts`.
 *
 * Three rules did not move, and are kept here because nothing else asserts them:
 * a manager cannot author their employee's record, a reported risk is
 * visibility rather than a manager action, and no client can write the
 * lifecycle tables directly.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code: string; message?: string };

/**
 * Inside the current performance period, deliberately.
 *
 * A Goal is filed against the period its target date falls in, so a date a few
 * months out can land in next year's period and then be missing from this
 * year's session — a confusing failure that says nothing about the rule under
 * test.
 */
const targetDate = () => `${new Date().getFullYear()}-12-15`;

interface PlanRow {
  performance_period_id: string;
}

async function currentPlan(employeeId: string): Promise<PlanRow> {
  const { data, error } = await serviceClient()
    .from('employee_goal_plans')
    .select('performance_period_id')
    .eq('employee_id', employeeId)
    .limit(1)
    .single();
  expect(error).toBeNull();
  return data as PlanRow;
}

/** Every Goal the session must cover: one item short and the whole month is refused. */
async function activeGoals(employeeId: string, periodId: string) {
  const { data, error } = await serviceClient()
    .from('goals')
    .select('id')
    .eq('owner_id', employeeId)
    .eq('performance_period_id', periodId)
    .eq('status', 'active');
  expect(error).toBeNull();
  return (data ?? []).map((goal) => String(goal.id));
}

/** An Active Goal owned by Lim, whose formal allocation starts empty. */
async function activeGoal() {
  const manager = await signInAs('izzul');
  const created = (
    await manager.rpc('create_lean_goal', {
      p_owner_id: PEOPLE.lim.id,
      p_expected_result: `Lifecycle Goal ${crypto.randomUUID().slice(0, 8)}`,
      p_target_date: targetDate(),
      p_weight_percent: 2,
      p_measures: [{ description: 'Ten controls are operating effectively.' }],
      p_category: 'performance',
      p_milestones: [],
      p_submission_mode: 'active',
      p_idempotency_key: crypto.randomUUID(),
    })
  ).data as Rpc & { goal_id: string; goal_version_id: string; version: number };
  expect(created).toMatchObject({ ok: true, code: 'goal_activated' });
  return created;
}

/** The next month with no session yet, so a run never collides with itself. */
async function freeMonth(employeeId: string, year: number) {
  const { data } = await serviceClient()
    .from('goal_checkin_sessions')
    .select('period_month')
    .eq('employee_id', employeeId)
    .eq('period_year', year)
    .eq('session_kind', 'monthly');
  const month = Array.from({ length: 12 }, (_, index) => index + 1).find(
    (candidate) => !data?.some((session) => session.period_month === candidate),
  );
  expect(month).toBeDefined();
  return month!;
}

describe('Goal session authority and manager visibility', () => {
  it('refuses to let a manager author their employee session, and keeps a reported risk out of the action queue', async () => {
    const goal = await activeGoal();
    const plan = await currentPlan(PEOPLE.lim.id);
    const year = new Date().getFullYear();
    const month = await freeMonth(PEOPLE.lim.id, year);
    // The session covers the employee's whole Active set, so the other Goals
    // this shared database already holds for Lim travel with it.
    const goalIds = await activeGoals(PEOPLE.lim.id, plan.performance_period_id);
    expect(goalIds).toContain(goal.goal_id);
    const items = goalIds.map((goalId) => ({
      goal_id: goalId,
      health: goalId === goal.goal_id ? 'off_track' : 'on_track',
      update_text:
        goalId === goal.goal_id ? 'Supplier validation has missed the agreed date.' : null,
      support_requested: false,
    }));

    const manager = await signInAs('izzul');
    const refused = (
      await manager.rpc('submit_goal_monthly_session', {
        p_employee_id: PEOPLE.lim.id,
        p_performance_period_id: plan.performance_period_id,
        p_period_year: year,
        p_period_month: month,
        p_items: items,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });

    const owner = await signInAs('lim');
    const submitted = (
      await owner.rpc('submit_goal_monthly_session', {
        p_employee_id: PEOPLE.lim.id,
        p_performance_period_id: plan.performance_period_id,
        p_period_year: year,
        p_period_month: month,
        p_items: items,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(submitted).toMatchObject({ ok: true });

    /*
     * §13 — the manager can see it, and is not asked to do anything.
     *
     * Off track is news, not a request. Turning every risk report into an
     * action item is what made the old manager queue unreadable, so the
     * notification exists and `requires_action` is deliberately false.
     */
    const { data: notification } = await serviceClient()
      .from('notifications')
      .select('recipient_id,requires_action,goal_id')
      .eq('goal_id', goal.goal_id)
      .eq('kind', 'goal_manager_attention')
      .single();
    expect(notification).toMatchObject({
      recipient_id: PEOPLE.izzul.id,
      requires_action: false,
      goal_id: goal.goal_id,
    });
  });

  it('keeps a manager-requested owner update out of the manager action queue', async () => {
    const goal = await activeGoal();
    const manager = await signInAs('izzul');
    const requested = (
      await manager.rpc('request_goal_update', {
        p_goal_id: goal.goal_id,
        p_expected_version: 1,
        p_message: "Please record this month's position.",
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(requested).toMatchObject({ ok: true });

    const { data: overview } = await serviceClient()
      .from('goal_overview')
      .select('is_update_requested,manager_needs_attention')
      .eq('id', goal.goal_id)
      .single();
    expect(overview).toMatchObject({
      is_update_requested: true,
      manager_needs_attention: false,
    });
  });

  it('blocks direct lifecycle writes from authenticated clients', async () => {
    const goal = await activeGoal();
    const owner = await signInAs('lim');
    const direct = await owner.from('goal_check_ins').insert({
      goal_id: goal.goal_id,
      goal_version_id: goal.goal_version_id,
      checkin_type: 'monthly',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      period_year: 2026,
      period_month: 8,
    });
    expect(direct.error).not.toBeNull();

    const session = await owner.from('goal_checkin_sessions').insert({
      employee_id: PEOPLE.lim.id,
      performance_period_id: (await currentPlan(PEOPLE.lim.id)).performance_period_id,
      session_kind: 'monthly',
      period_year: 2026,
      period_month: 12,
    });
    expect(session.error).not.toBeNull();
  });
});

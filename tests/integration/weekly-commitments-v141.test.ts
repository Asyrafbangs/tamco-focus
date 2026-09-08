import { afterEach, describe, expect, it } from 'vitest';

import { createTask, deleteTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v141 §7 — this week's priorities, as references to work that already exists.
 *
 * The trap the specification warns about twice: a weekly priority is not a new
 * kind of task. It points at a task or one of its steps, and delivery is read
 * from that work rather than tracked again. Everything asserted here is about
 * keeping those two things one thing.
 *
 * The other half is the agreed baseline. Once a manager has agreed a
 * commitment it is a statement between two people, so a change to it is a
 * request that sits beside it — never an edit that quietly replaces it.
 */

type Rpc = Record<string, unknown> & { ok: boolean; code?: string };

const created: string[] = [];

/** The Monday of this week, in the organisation's calendar. */
function mondayOf(date = new Date()): string {
  const local = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  const day = (local.getDay() + 6) % 7; // Monday = 0
  local.setDate(local.getDate() - day);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

async function fixture(person: keyof typeof PEOPLE, overrides: Record<string, unknown> = {}) {
  const task = await createTask(person, overrides);
  created.push(task.id);
  return task;
}

async function addStep(taskId: string, assignee: keyof typeof PEOPLE, action: string) {
  const { data, error } = await serviceClient()
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position: 1,
      action,
      assigned_to: PEOPLE[assignee].id,
      state: 'ready',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not add fixture step: ${error.message}`);
  return data.id as string;
}

async function commitmentsFor(person: keyof typeof PEOPLE, week: string) {
  const { data, error } = await serviceClient()
    .from('weekly_commitment_overview')
    .select('*')
    .eq('employee_id', PEOPLE[person].id)
    .eq('week_start', week)
    .order('rank');
  // Never swallowed: an ignored read error looks exactly like "there are no
  // commitments", and every assertion after it then checks the wrong thing.
  if (error) throw new Error(`Could not read commitments: ${error.message}`);
  return data ?? [];
}

afterEach(async () => {
  // Commitments cascade from their task, so removing the fixtures removes them.
  while (created.length) await deleteTask(created.pop()!);
});

describe('v141 proposing', () => {
  it('references existing work rather than copying it', async () => {
    const task = await fixture('izzah', { status: 'active', title: 'BR2 sprinkler installation' });
    const izzah = await signInAs('izzah');
    const week = mondayOf();

    const result = (
      await izzah.rpc('propose_weekly_commitment', {
        p_employee_id: PEOPLE.izzah.id,
        p_task_id: task.id,
        p_expected_result: 'Finalise vendor drawing review',
        p_week_start: week,
      })
    ).data as Rpc;
    expect(result.ok).toBe(true);

    const rows = await commitmentsFor('izzah', week);
    expect(rows).toHaveLength(1);
    // The commitment carries the reference and the week's expected result; the
    // task keeps its own title and its own lifecycle.
    expect(rows[0]).toMatchObject({
      task_id: task.id,
      task_title: 'BR2 sprinkler installation',
      expected_result: 'Finalise vendor drawing review',
      state: 'proposed',
      delivery_outcome: 'due',
    });

    // And no second task was created anywhere.
    const { count } = await serviceClient()
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('title', 'Finalise vendor drawing review');
    expect(count).toBe(0);
  });

  it('refuses the same work twice in one week', async () => {
    const task = await fixture('izzah', { status: 'active' });
    const izzah = await signInAs('izzah');
    const week = mondayOf();
    const args = {
      p_employee_id: PEOPLE.izzah.id,
      p_task_id: task.id,
      p_expected_result: 'Finish it',
      p_week_start: week,
    };

    expect(((await izzah.rpc('propose_weekly_commitment', args)).data as Rpc).ok).toBe(true);
    expect((await izzah.rpc('propose_weekly_commitment', args)).data as Rpc).toMatchObject({
      ok: false,
      code: 'already_committed',
    });
  });

  it('refuses a parent and its own step in the same week', async () => {
    // Both would describe the same expected result, and the week would count it
    // twice. §7 asks for a warning rather than silence.
    const task = await fixture('izzah', { status: 'active' });
    const step = await addStep(task.id, 'izzah', 'Review the drawings');
    const izzah = await signInAs('izzah');
    const week = mondayOf();

    await izzah.rpc('propose_weekly_commitment', {
      p_employee_id: PEOPLE.izzah.id,
      p_task_id: task.id,
      p_expected_result: 'Review the drawings',
      p_week_start: week,
      p_checklist_item_id: step,
    });

    expect(
      (
        await izzah.rpc('propose_weekly_commitment', {
          p_employee_id: PEOPLE.izzah.id,
          p_task_id: task.id,
          p_expected_result: 'The whole thing',
          p_week_start: week,
        })
      ).data as Rpc,
    ).toMatchObject({ ok: false, code: 'step_already_committed' });
  });

  it('refuses a target outside the week it belongs to', async () => {
    const task = await fixture('izzah', { status: 'active' });
    const izzah = await signInAs('izzah');
    const week = mondayOf();

    expect(
      (
        await izzah.rpc('propose_weekly_commitment', {
          p_employee_id: PEOPLE.izzah.id,
          p_task_id: task.id,
          p_expected_result: 'Finish it',
          p_week_start: week,
          p_target_date: addDays(week, 9),
        })
      ).data as Rpc,
    ).toMatchObject({ ok: false, code: 'target_outside_week' });
  });

  it('reports a target later than the deadline instead of moving the deadline', async () => {
    /*
     * §7 is explicit: a weekly target later than the underlying task deadline
     * is a conflict to resolve, and the task's own due date is never silently
     * changed. The refusal carries both dates so the screen can say which.
     */
    const week = mondayOf();
    const deadline = addDays(week, 2);
    const task = await fixture('izzah', {
      status: 'active',
      due_at: `${deadline}T09:00:00Z`,
      due_is_date_only: false,
    });
    const izzah = await signInAs('izzah');

    const result = (
      await izzah.rpc('propose_weekly_commitment', {
        p_employee_id: PEOPLE.izzah.id,
        p_task_id: task.id,
        p_expected_result: 'Finish it',
        p_week_start: week,
        p_target_date: addDays(week, 5),
      })
    ).data as Rpc;
    expect(result).toMatchObject({ ok: false, code: 'target_after_deadline' });

    const { data } = await serviceClient()
      .from('tasks')
      .select('due_at')
      .eq('id', task.id)
      .single();
    expect(data!.due_at).toContain(deadline);
  });

  it('is not something one employee may do for another', async () => {
    const task = await fixture('izzah', { status: 'active' });
    const ajmal = await signInAs('ajmal');
    expect(
      (
        await ajmal.rpc('propose_weekly_commitment', {
          p_employee_id: PEOPLE.izzah.id,
          p_task_id: task.id,
          p_expected_result: 'Something for somebody else',
          p_week_start: mondayOf(),
        })
      ).data as Rpc,
    ).toMatchObject({ ok: false, code: 'not_permitted' });
  });
});

describe('v141 agreeing', () => {
  async function proposed(person: keyof typeof PEOPLE = 'izzah') {
    const task = await fixture(person, { status: 'active' });
    const client = await signInAs(person);
    const week = mondayOf();
    const result = (
      await client.rpc('propose_weekly_commitment', {
        p_employee_id: PEOPLE[person].id,
        p_task_id: task.id,
        p_expected_result: 'Finish the survey',
        p_week_start: week,
      })
    ).data as Rpc;
    return { id: result.commitment_id as string, week };
  }

  it("is the manager's act, and is recorded as theirs", async () => {
    const { id, week } = await proposed();
    const izzul = await signInAs('izzul');
    expect(
      ((await izzul.rpc('agree_weekly_commitment', { p_commitment_id: id })).data as Rpc).ok,
    ).toBe(true);

    const rows = await commitmentsFor('izzah', week);
    // §7: do not imply the employee confirmed when only the manager acted.
    expect(rows[0]).toMatchObject({ state: 'agreed', decided_by: PEOPLE.izzul.id });
    expect(rows[0].proposed_by).toBe(PEOPLE.izzah.id);
  });

  it("is not the employee's to do for themselves", async () => {
    const { id } = await proposed();
    const izzah = await signInAs('izzah');
    expect(
      (await izzah.rpc('agree_weekly_commitment', { p_commitment_id: id })).data as Rpc,
    ).toMatchObject({ ok: false, code: 'not_permitted' });
  });

  it('absorbs a second click rather than agreeing twice', async () => {
    const { id } = await proposed();
    const izzul = await signInAs('izzul');
    await izzul.rpc('agree_weekly_commitment', { p_commitment_id: id });
    const again = (await izzul.rpc('agree_weekly_commitment', { p_commitment_id: id })).data as Rpc;
    expect(again).toMatchObject({ ok: true, already: true });
  });

  it('requires a reason to decline', async () => {
    const { id } = await proposed();
    const izzul = await signInAs('izzul');
    expect(
      (await izzul.rpc('decline_weekly_commitment', { p_commitment_id: id, p_note: '  ' }))
        .data as Rpc,
    ).toMatchObject({ ok: false, code: 'reason_required' });
  });
});

describe('v141 changing an agreed commitment', () => {
  async function agreed() {
    const week = mondayOf();
    const task = await fixture('izzah', { status: 'active' });
    const izzah = await signInAs('izzah');
    const proposal = (
      await izzah.rpc('propose_weekly_commitment', {
        p_employee_id: PEOPLE.izzah.id,
        p_task_id: task.id,
        p_expected_result: 'Original result',
        p_week_start: week,
        p_target_date: addDays(week, 3),
      })
    ).data as Rpc;
    const izzul = await signInAs('izzul');
    await izzul.rpc('agree_weekly_commitment', { p_commitment_id: proposal.commitment_id });
    return { id: proposal.commitment_id as string, week, taskId: task.id };
  }

  it('leaves the baseline standing while the request is open', async () => {
    const { id, week } = await agreed();
    const izzah = await signInAs('izzah');

    const request = (
      await izzah.rpc('request_weekly_commitment_change', {
        p_commitment_id: id,
        p_kind: 'amend',
        p_reason: 'The vendor moved the site visit.',
        p_payload: { expected_result: 'Revised result' },
      })
    ).data as Rpc;
    expect(request.ok).toBe(true);

    const rows = await commitmentsFor('izzah', week);
    // Still agreed, still saying what was agreed — with the request visible
    // beside it rather than replacing it.
    expect(rows[0]).toMatchObject({
      state: 'agreed',
      expected_result: 'Original result',
      open_change_count: 1,
    });
  });

  it('supersedes rather than overwrites when the change is accepted', async () => {
    const { id, week } = await agreed();
    const izzah = await signInAs('izzah');
    const request = (
      await izzah.rpc('request_weekly_commitment_change', {
        p_commitment_id: id,
        p_kind: 'amend',
        p_reason: 'The vendor moved the site visit.',
        p_payload: { expected_result: 'Revised result' },
      })
    ).data as Rpc;

    const izzul = await signInAs('izzul');
    expect(
      (
        await izzul.rpc('resolve_weekly_commitment_change', {
          p_change_id: request.change_id,
          p_accept: true,
          p_note: 'Agreed with the new date.',
        })
      ).data as Rpc,
    ).toMatchObject({ ok: true, accepted: true });

    const { data: all } = await serviceClient()
      .from('weekly_commitments')
      .select('id,state,expected_result,superseded_by_id')
      .eq('employee_id', PEOPLE.izzah.id)
      .eq('week_start', week);

    const superseded = all!.find((row) => row.id === id);
    const replacement = all!.find((row) => row.id !== id);
    // The history keeps what was agreed first; §7 forbids erasing it.
    expect(superseded).toMatchObject({ state: 'superseded', expected_result: 'Original result' });
    expect(replacement).toMatchObject({ state: 'agreed', expected_result: 'Revised result' });
    expect(superseded!.superseded_by_id).toBe(replacement!.id);
  });

  it('leaves the baseline exactly as it was when the change is refused', async () => {
    const { id, week } = await agreed();
    const izzah = await signInAs('izzah');
    const request = (
      await izzah.rpc('request_weekly_commitment_change', {
        p_commitment_id: id,
        p_kind: 'cannot_meet',
        p_reason: 'The contractor cancelled.',
      })
    ).data as Rpc;

    const izzul = await signInAs('izzul');
    await izzul.rpc('resolve_weekly_commitment_change', {
      p_change_id: request.change_id,
      p_accept: false,
      p_note: 'Please try the alternative supplier.',
    });

    const rows = await commitmentsFor('izzah', week);
    expect(rows[0]).toMatchObject({
      state: 'agreed',
      expected_result: 'Original result',
      open_change_count: 0,
    });
  });

  it('allows one open request at a time', async () => {
    const { id } = await agreed();
    const izzah = await signInAs('izzah');
    const args = {
      p_commitment_id: id,
      p_kind: 'amend' as const,
      p_reason: 'A reason.',
      p_payload: {},
    };
    await izzah.rpc('request_weekly_commitment_change', args);
    expect((await izzah.rpc('request_weekly_commitment_change', args)).data as Rpc).toMatchObject({
      ok: false,
      code: 'change_already_open',
    });
  });
});

describe('v141 the outcome is read from the work', () => {
  it('turns delivered when the referenced task is completed', async () => {
    const week = mondayOf();
    const task = await fixture('izzah', { status: 'active' });
    const izzah = await signInAs('izzah');
    await izzah.rpc('propose_weekly_commitment', {
      p_employee_id: PEOPLE.izzah.id,
      p_task_id: task.id,
      p_expected_result: 'Finish it',
      p_week_start: week,
    });

    expect((await commitmentsFor('izzah', week))[0].delivery_outcome).toBe('due');

    await serviceClient()
      .from('tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', task.id);

    // Nothing wrote the outcome: completing the work is what changed it.
    expect((await commitmentsFor('izzah', week))[0].delivery_outcome).toBe('delivered');
  });

  it('a completed step delivers the step, and not the parent commitment', async () => {
    const week = mondayOf();
    const task = await fixture('izzah', { status: 'active' });
    const step = await addStep(task.id, 'izzah', 'Review the drawings');
    const izzah = await signInAs('izzah');
    await izzah.rpc('propose_weekly_commitment', {
      p_employee_id: PEOPLE.izzah.id,
      p_task_id: task.id,
      p_expected_result: 'Review the drawings',
      p_week_start: week,
      p_checklist_item_id: step,
    });

    await serviceClient()
      .from('task_checklist_items')
      .update({
        state: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: PEOPLE.izzah.id,
      })
      .eq('id', step);

    expect((await commitmentsFor('izzah', week))[0].delivery_outcome).toBe('delivered');
    // §10: finishing a step does not close the parent task.
    const { data } = await serviceClient()
      .from('tasks')
      .select('status')
      .eq('id', task.id)
      .single();
    expect(data!.status).toBe('active');
  });

  it('reads as missed once its week has passed unfinished', async () => {
    const lastWeek = addDays(mondayOf(), -7);
    const task = await fixture('izzah', { status: 'active' });
    const izzah = await signInAs('izzah');
    await izzah.rpc('propose_weekly_commitment', {
      p_employee_id: PEOPLE.izzah.id,
      p_task_id: task.id,
      p_expected_result: 'Should have been done',
      p_week_start: lastWeek,
    });

    expect((await commitmentsFor('izzah', lastWeek))[0].delivery_outcome).toBe('missed');
  });
});

describe('v141 carrying forward', () => {
  it('is explicit, linked, and starts as a proposal', async () => {
    const lastWeek = addDays(mondayOf(), -7);
    const thisWeek = mondayOf();
    const task = await fixture('izzah', { status: 'active' });
    const izzah = await signInAs('izzah');
    const first = (
      await izzah.rpc('propose_weekly_commitment', {
        p_employee_id: PEOPLE.izzah.id,
        p_task_id: task.id,
        p_expected_result: 'Unfinished work',
        p_week_start: lastWeek,
      })
    ).data as Rpc;
    const izzul = await signInAs('izzul');
    await izzul.rpc('agree_weekly_commitment', { p_commitment_id: first.commitment_id });

    const carried = (
      await (
        await signInAs('izzah')
      ).rpc('carry_forward_weekly_commitment', {
        p_commitment_id: first.commitment_id,
        p_week_start: thisWeek,
      })
    ).data as Rpc;
    expect(carried.ok).toBe(true);

    const now = await commitmentsFor('izzah', thisWeek);
    // A new week's commitment, not a re-agreed old one: §7 says rollover must
    // never silently turn an unfinished result into a fresh agreement.
    expect(now[0]).toMatchObject({ state: 'proposed', carried_from_id: first.commitment_id });

    // And the missed week keeps its own result.
    const before = await commitmentsFor('izzah', lastWeek);
    expect(before[0]).toMatchObject({ state: 'agreed', delivery_outcome: 'missed' });
  });
});

describe('v141 who can read it', () => {
  it('is visible to the employee and to somebody authorised to see them', async () => {
    const week = mondayOf();
    const task = await fixture('izzah', { status: 'active' });
    const izzah = await signInAs('izzah');
    await izzah.rpc('propose_weekly_commitment', {
      p_employee_id: PEOPLE.izzah.id,
      p_task_id: task.id,
      p_expected_result: 'Visible to the right people',
      p_week_start: week,
    });

    // Amer supervises Izzah through the approved visibility grant.
    const amer = await signInAs('amer');
    const seen = await amer
      .from('weekly_commitment_overview')
      .select('id')
      .eq('employee_id', PEOPLE.izzah.id);
    expect(seen.data!.length).toBeGreaterThan(0);

    const lim = await signInAs('lim');
    const hidden = await lim
      .from('weekly_commitment_overview')
      .select('id')
      .eq('employee_id', PEOPLE.izzah.id);
    expect(hidden.data).toHaveLength(0);
  });

  it('cannot be written around the procedures', async () => {
    // No insert policy exists: the validation lives in the procedures, and a
    // direct write would be a second way in with none of it applied.
    const task = await fixture('izzah', { status: 'active' });
    const izzah = await signInAs('izzah');
    const { error } = await izzah.from('weekly_commitments').insert({
      employee_id: PEOPLE.izzah.id,
      week_start: mondayOf(),
      task_id: task.id,
      expected_result: 'Straight in',
      proposed_by: PEOPLE.izzah.id,
    });
    expect(error).not.toBeNull();
  });
});

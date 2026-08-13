import { describe, expect, it } from 'vitest';

import { createTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * A shared contributor could see their contribution listed and then not open
 * the task it belonged to.
 *
 * The cause was an inner join to `user_profiles` inside `task_overview`, which
 * is `security_invoker`. A contributor may read the task but not the owner's
 * profile, and an inner join against an invisible row deletes the record
 * rather than blanking a column — so an authorised reader got nothing.
 *
 * These tests pin both halves: the contributor can open the task, and nothing
 * about profile privacy moved to achieve it.
 */
describe('v56 shared contributors can open the parent task', () => {
  async function taskWithContributor() {
    const task = await createTask('amer', { title: 'Evacuation drill', status: 'active' });
    await serviceClient().from('task_checklist_items').insert({
      task_id: task.id,
      position: 1,
      action: 'Book the assembly point',
      assigned_to: PEOPLE.izzah.id,
      evidence_rule: 'not_required',
    });
    return task;
  }

  it('lets the checklist assignee read the task through task_overview', async () => {
    const task = await taskWithContributor();
    const contributor = await signInAs('izzah');

    const { data } = await contributor
      .from('task_overview')
      .select('id, owner_name, owner_department_id')
      .eq('id', task.id)
      .maybeSingle();

    // This was null before the fix — the row vanished at the join.
    expect(data).not.toBeNull();
    expect(data?.id).toBe(task.id);
    // Resolved from the names-only projection, so the drawer has a name to show.
    expect(data?.owner_name).toBeTruthy();
    // Not widened: the department belongs to the profile she still cannot read.
    expect(data?.owner_department_id).toBeNull();
  });

  it('does not give the contributor the owner profile row', async () => {
    const task = await taskWithContributor();
    const contributor = await signInAs('izzah');

    const { data } = await contributor
      .from('user_profiles')
      .select('id')
      .eq('id', PEOPLE.amer.id)
      .maybeSingle();

    expect(data).toBeNull();
    void task;
  });

  it('still shows the owner their own task in full', async () => {
    const task = await taskWithContributor();
    const owner = await signInAs('amer');

    const { data } = await owner
      .from('task_overview')
      .select('id, owner_name, owner_department_id')
      .eq('id', task.id)
      .maybeSingle();

    expect(data?.id).toBe(task.id);
    expect(data?.owner_name).toBeTruthy();
    expect(data?.owner_department_id).not.toBeNull();
  });

  it('keeps task_overview readable by the service role', async () => {
    // The first attempt at this fix joined `team_directory`, which gates on
    // `focus.is_active_account()` — granted to `authenticated` but not to
    // `service_role`. That broke the weekly-summary worker with a permission
    // error nowhere near the change. This is the regression guard.
    const task = await taskWithContributor();

    const { data, error } = await serviceClient()
      .from('task_overview')
      .select('id, owner_name')
      .eq('id', task.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.id).toBe(task.id);
    expect(data?.owner_name).toBeTruthy();
  });
});

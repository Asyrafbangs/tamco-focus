import { describe, expect, it } from 'vitest';

import { serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string };

/**
 * Recurrence, and the three ways it silently did nothing.
 *
 * All three presented identically — "I set up a routine and nothing happened" —
 * and none of them raised an error:
 *
 *  - the monthly rule advanced a whole period before it looked, so a date still
 *    ahead in the current month was skipped;
 *  - `generated_through` moved to the horizon whether or not anything had been
 *    generated, putting any date the rule missed permanently behind the mark;
 *  - the scheduled job passed `p_through = today`, collapsing the fortnight of
 *    lead to nothing at all.
 *
 * These read dates back rather than trusting a success code, because every one
 * of those failures returned `ok: true`.
 */
describe('v62 routine recurrence', () => {
  const base = {
    p_description: null,
    p_owner_id: null,
    p_weekdays: null,
    p_monthly_mode: null,
    p_day_of_month: null,
    p_nth_weekday: null,
    p_nth_weekday_dow: null,
    p_month_of_year: null,
    p_due_time: '09:00',
    p_ends_mode: 'never',
    p_ends_after_count: null,
    p_ends_on_date: null,
    p_evidence_required: false,
    p_requires_completion_review: false,
  };

  async function create(fields: Record<string, unknown>) {
    const manager = await signInAs('izzul');
    const result = (
      await manager.rpc('create_routine_template', {
        ...base,
        ...fields,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    if (!result.ok) throw new Error(`${result.code}: ${JSON.stringify(result)}`);
    return { id: result.routine_template_id as string, manager };
  }

  async function datesFor(templateId: string): Promise<string[]> {
    const { data } = await serviceClient()
      .from('tasks')
      .select('occurrence_date')
      .eq('routine_template_id', templateId)
      .is('deleted_at', null)
      .order('occurrence_date');
    return (data ?? []).map((row) => String(row.occurrence_date));
  }

  it('does not skip a date still ahead in the current month', async () => {
    // Anchored to the 1st, due on the 28th: the 28th of THAT month is the
    // answer. The old rule returned the 28th of the following month.
    const { id } = await create({
      p_title: `Skip check ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'monthly',
      p_interval_count: 1,
      p_monthly_mode: 'day_of_month',
      p_day_of_month: 28,
      p_start_date: '2026-03-01',
    });

    const { data } = await serviceClient()
      .from('routine_template_overview')
      .select('scheduled_next_date')
      .eq('id', id)
      .single();

    // Read from the anchor, so the first date is inside the starting month.
    const { data: first } = await serviceClient().rpc('generate_routine_occurrences', {
      p_through: '2026-03-31',
    });
    expect(first).toMatchObject({ ok: true });
    expect(await datesFor(id)).toContain('2026-03-28');
    expect(data?.scheduled_next_date).toBeTruthy();
  });

  it('schedules a yearly routine in the month it names, not twelve months on', async () => {
    const { id } = await create({
      p_title: `Yearly check ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'yearly',
      p_interval_count: 1,
      p_monthly_mode: 'day_of_month',
      p_day_of_month: 5,
      p_month_of_year: 9,
      p_start_date: '2026-08-01',
    });

    await serviceClient().rpc('generate_routine_occurrences', { p_through: '2026-12-31' });
    const dates = await datesFor(id);

    // Stored as monthly-times-twelve this landed in August 2027.
    expect(dates).toContain('2026-09-05');
    expect(dates.every((date) => date.startsWith('2026-09'))).toBe(true);
  });

  it('supports the first Wednesday of every month', async () => {
    const { id } = await create({
      p_title: `Nth weekday ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'monthly',
      p_interval_count: 1,
      p_monthly_mode: 'nth_weekday',
      p_nth_weekday: 1,
      p_nth_weekday_dow: 3,
      p_start_date: '2026-09-01',
    });

    await serviceClient().rpc('generate_routine_occurrences', { p_through: '2026-11-30' });
    // 2 Sep, 7 Oct and 4 Nov 2026 are all Wednesdays, and all the first of
    // their month. This pattern had no representation at all before v62.
    expect(await datesFor(id)).toEqual(['2026-09-02', '2026-10-07', '2026-11-04']);
  });

  it('stops after the requested number of occurrences', async () => {
    const { id } = await create({
      p_title: `Bounded ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'weekly',
      p_interval_count: 1,
      p_weekdays: [1],
      p_start_date: '2026-04-06',
      p_ends_mode: 'after',
      p_ends_after_count: 3,
    });

    await serviceClient().rpc('generate_routine_occurrences', { p_through: '2026-12-31' });
    expect(await datesFor(id)).toHaveLength(3);
  });

  it('stops on the end date', async () => {
    const { id } = await create({
      p_title: `Until ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'weekly',
      p_interval_count: 1,
      p_weekdays: [1],
      p_start_date: '2026-04-06',
      p_ends_mode: 'on_date',
      p_ends_on_date: '2026-04-20',
    });

    await serviceClient().rpc('generate_routine_occurrences', { p_through: '2026-12-31' });
    expect(await datesFor(id)).toEqual(['2026-04-06', '2026-04-13', '2026-04-20']);
  });

  it('generates a fortnight ahead when no horizon is given', async () => {
    // The scheduled job passes no horizon, so the procedure's own lead applies.
    // It used to pass today, which is why Upcoming was permanently empty.
    const { id } = await create({
      p_title: `Lead ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'daily',
      p_interval_count: 1,
      p_start_date: new Date().toISOString().slice(0, 10),
    });

    await serviceClient().rpc('generate_routine_occurrences', {});
    const dates = await datesFor(id);
    expect(dates.length).toBeGreaterThanOrEqual(14);
  });

  it('moves future occurrences when the schedule is edited', async () => {
    const start = new Date().toISOString().slice(0, 10);
    const { id, manager } = await create({
      p_title: `Edit me ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'weekly',
      p_interval_count: 1,
      p_weekdays: [1, 4],
      p_start_date: start,
    });
    await serviceClient().rpc('generate_routine_occurrences', {});
    const before = await datesFor(id);
    expect(before.length).toBeGreaterThan(0);

    // Built explicitly rather than spread from `base`: the update procedure has
    // no `p_owner_id`, and an argument PostgREST cannot match makes the whole
    // call resolve to no function at all — which arrives as a null body rather
    // than an error.
    const updated = (
      await manager.rpc('update_routine_template', {
        p_template_id: id,
        p_title: 'Edited to Fridays',
        p_description: null,
        p_frequency: 'weekly',
        p_interval_count: 1,
        p_weekdays: [5],
        p_monthly_mode: null,
        p_day_of_month: null,
        p_nth_weekday: null,
        p_nth_weekday_dow: null,
        p_month_of_year: null,
        p_due_time: '09:00',
        p_start_date: start,
        p_ends_mode: 'never',
        p_ends_after_count: null,
        p_ends_on_date: null,
        p_evidence_required: false,
        p_requires_completion_review: false,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(updated).toMatchObject({ ok: true });

    await serviceClient().rpc('generate_routine_occurrences', {});
    const after = await datesFor(id);
    // Every remaining future occurrence is a Friday. Changing the pattern used
    // to leave the old dates standing until they had all passed.
    for (const date of after) {
      if (date <= start) continue;
      expect(new Date(`${date}T12:00:00Z`).getUTCDay()).toBe(5);
    }
  });

  it('deletes to the Bin and restores paused', async () => {
    const { id, manager } = await create({
      p_title: `Binned ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'daily',
      p_interval_count: 1,
      p_start_date: new Date().toISOString().slice(0, 10),
    });

    const deleted = (
      await manager.rpc('delete_routine_template', {
        p_template_id: id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(deleted).toMatchObject({ ok: true, code: 'routine_deleted' });

    const admin = serviceClient();
    const { data: binned } = await admin
      .from('routine_templates')
      .select('deleted_at, is_active')
      .eq('id', id)
      .single();
    expect(binned?.deleted_at).not.toBeNull();
    expect(binned?.is_active).toBe(false);

    // A deleted routine generates nothing, even before it is restored.
    const countBefore = (await datesFor(id)).length;
    await admin.rpc('generate_routine_occurrences', {});
    expect(await datesFor(id)).toHaveLength(countBefore);

    const restored = (
      await manager.rpc('restore_routine_template', {
        p_template_id: id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(restored).toMatchObject({ ok: true, code: 'routine_restored' });

    // Paused, not running: a routine coming back out of the Bin must not fill
    // somebody's diary without a decision.
    const { data: after } = await admin
      .from('routine_templates')
      .select('deleted_at, is_active')
      .eq('id', id)
      .single();
    expect(after?.deleted_at).toBeNull();
    expect(after?.is_active).toBe(false);
  });

  it('refuses deletion by somebody who did not set the routine up', async () => {
    const { id } = await create({
      p_title: `Not yours ${crypto.randomUUID().slice(0, 8)}`,
      p_frequency: 'daily',
      p_interval_count: 1,
      p_start_date: new Date().toISOString().slice(0, 10),
    });

    const other = await signInAs('izzah');
    const refused = (
      await other.rpc('delete_routine_template', {
        p_template_id: id,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(refused).toMatchObject({ ok: false, code: 'not_authorised' });
  });
});

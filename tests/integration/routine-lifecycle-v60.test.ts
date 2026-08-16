import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

type Rpc = Record<string, unknown> & { ok: boolean; code: string };

/**
 * The routine lifecycle, end to end.
 *
 * Before v60 this could not be tested because it could not be reached: nothing
 * created a `routine_templates` row, and the proposal that New Work wrote had
 * no procedure to act on it. These tests pin the loop that was missing.
 */
describe('v60 routine lifecycle', () => {
  /*
   * v62 widened the recurrence: a weekly routine can name several days, a
   * monthly one can say "the first Wednesday", yearly is its own frequency
   * with a month, and a series can be given an end. These defaults keep the
   * v60 cases expressing exactly what they expressed before.
   */
  const shape = {
    p_description: null,
    p_owner_id: null,
    p_due_time: '09:00',
    p_monthly_mode: null,
    p_nth_weekday: null,
    p_nth_weekday_dow: null,
    p_month_of_year: null,
    p_ends_mode: 'never',
    p_ends_after_count: null,
    p_ends_on_date: null,
    p_evidence_required: false,
    p_requires_completion_review: false,
  };

  it('creates an active routine for a manager and generates on cadence', async () => {
    const manager = await signInAs('izzul');
    const created = (
      await manager.rpc('create_routine_template', {
        ...shape,
        p_title: 'Quarterly extinguisher check',
        p_frequency: 'monthly',
        p_interval_count: 3,
        p_weekdays: null,
        p_monthly_mode: 'day_of_month',
        p_day_of_month: 15,
        /*
         * A fixed start, not "today".
         *
         * Anchored to today this test asserted the first occurrence was less
         * than 32 days away, which held only while the suite ran before the
         * 15th of the month. Run on the 16th, "day 15 of every 3 months"
         * starting today correctly lands three months out — the same answer a
         * calendar client gives — and a correct product failed a calendar-
         * dependent assertion.
         */
        p_start_date: '2026-03-01',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(created).toMatchObject({ ok: true, code: 'routine_created', is_active: true });

    const admin = serviceClient();
    await admin.rpc('generate_routine_occurrences', {
      p_through: new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10),
    });

    const { data: rows } = await admin
      .from('tasks')
      .select('occurrence_date')
      .eq('routine_template_id', String(created.routine_template_id))
      .order('occurrence_date');

    const dates = (rows ?? []).map((row) => String(row.occurrence_date));
    expect(dates.length).toBeGreaterThanOrEqual(4);

    // Three months apart, always on the 15th.
    for (const date of dates) expect(date.slice(-2)).toBe('15');
    const first = new Date(dates[0]!);
    const second = new Date(dates[1]!);
    const monthsApart =
      (second.getFullYear() - first.getFullYear()) * 12 + (second.getMonth() - first.getMonth());
    expect(monthsApart).toBe(3);

    /*
     * The bug that made a quarterly routine look broken: the old rule advanced
     * a whole period before it looked, so a routine anchored on 1 March skipped
     * 15 March and started in June. The first occurrence belongs in the
     * starting month whenever that month's day has not yet passed.
     */
    expect(dates[0]).toBe('2026-03-15');
    expect(dates.slice(0, 4)).toEqual([
      '2026-03-15',
      '2026-06-15',
      '2026-09-15',
      '2026-12-15',
    ]);
  });

  it('holds a routine somebody sets up for themselves until a manager activates it', async () => {
    const employee = await signInAs('amer');
    const created = (
      await employee.rpc('create_routine_template', {
        ...shape,
        p_title: 'Self-started toolbox talk',
        p_frequency: 'weekly',
        p_interval_count: 1,
        p_weekdays: [1],
        p_day_of_month: null,
        p_start_date: new Date().toISOString().slice(0, 10),
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(created).toMatchObject({ ok: true, code: 'routine_awaiting_review', is_active: false });

    // The promise the interface has always made, now enforced: an inactive
    // template generates nothing.
    const admin = serviceClient();
    await admin.rpc('generate_routine_occurrences', {
      p_through: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
    });
    const { count } = await admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('routine_template_id', String(created.routine_template_id));
    expect(count).toBe(0);

    // And the person who owns it cannot wave it through themselves.
    const selfActivate = (
      await employee.rpc('set_routine_template_active', {
        p_template_id: created.routine_template_id,
        p_active: true,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(selfActivate.ok).toBe(false);
    expect(selfActivate.code).toBe('not_authorised');
  });

  it('refuses a schedule the recurrence rule cannot resolve', async () => {
    const manager = await signInAs('izzul');

    const noWeekday = (
      await manager.rpc('create_routine_template', {
        ...shape,
        p_title: 'Weekly without a day',
        p_frequency: 'weekly',
        p_interval_count: 1,
        p_weekdays: null,
        p_day_of_month: null,
        p_start_date: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(noWeekday.ok).toBe(false);
    expect(String(noWeekday.message)).toMatch(/day of the week/i);

    const noDayOfMonth = (
      await manager.rpc('create_routine_template', {
        ...shape,
        p_title: 'Monthly without a date',
        p_frequency: 'monthly',
        p_interval_count: 1,
        p_weekdays: null,
        p_day_of_month: null,
        p_start_date: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(noDayOfMonth.ok).toBe(false);
    expect(String(noDayOfMonth.message)).toMatch(/day of the month/i);
  });

  it('pausing stops future occurrences and keeps the ones already created', async () => {
    const manager = await signInAs('izzul');
    const created = (
      await manager.rpc('create_routine_template', {
        ...shape,
        p_title: 'Daily walkaround',
        p_frequency: 'daily',
        p_interval_count: 1,
        p_weekdays: null,
        p_day_of_month: null,
        p_start_date: new Date().toISOString().slice(0, 10),
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    const admin = serviceClient();
    await admin.rpc('generate_routine_occurrences', {
      p_through: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
    });
    const { count: before } = await admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('routine_template_id', String(created.routine_template_id));
    expect(before ?? 0).toBeGreaterThan(0);

    const paused = (
      await manager.rpc('set_routine_template_active', {
        p_template_id: created.routine_template_id,
        p_active: false,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(paused).toMatchObject({ ok: true, code: 'routine_paused' });

    await admin.rpc('generate_routine_occurrences', {
      p_through: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
    });
    const { count: after } = await admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('routine_template_id', String(created.routine_template_id));

    // Nothing new, and nothing removed.
    expect(after).toBe(before);
  });

  it('lets the owner or their manager change the cadence', async () => {
    const manager = await signInAs('izzul');
    const created = (
      await manager.rpc('create_routine_template', {
        ...shape,
        p_title: 'Cadence change',
        p_frequency: 'weekly',
        p_interval_count: 1,
        p_weekdays: [3],
        p_day_of_month: null,
        p_start_date: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    const updated = (
      await manager.rpc('update_routine_template', {
        p_template_id: created.routine_template_id,
        p_title: 'Cadence change',
        p_description: null,
        p_frequency: 'monthly',
        p_interval_count: 6,
        p_weekdays: null,
        p_monthly_mode: 'day_of_month',
        p_day_of_month: 1,
        p_nth_weekday: null,
        p_nth_weekday_dow: null,
        p_month_of_year: null,
        p_due_time: '09:00',
        // v62: the pattern now carries its own anchor, so an edit states it.
        p_start_date: new Date().toISOString().slice(0, 10),
        p_ends_mode: 'never',
        p_ends_after_count: null,
        p_ends_on_date: null,
        p_evidence_required: false,
        p_requires_completion_review: false,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;
    expect(updated).toMatchObject({ ok: true, code: 'routine_updated' });

    const { data: row } = await serviceClient()
      .from('routine_templates')
      .select('frequency, interval_count, weekday, day_of_month')
      .eq('id', String(created.routine_template_id))
      .single();

    expect(row?.frequency).toBe('monthly');
    expect(row?.interval_count).toBe(6);
    // The weekly-only field is cleared, so the schedule cannot be ambiguous.
    expect(row?.weekday).toBeNull();
    expect(row?.day_of_month).toBe(1);
  });

  it('refuses to set up a routine for somebody a person does not manage', async () => {
    const employee = await signInAs('amer');
    const refused = (
      await employee.rpc('create_routine_template', {
        ...shape,
        p_title: 'Not mine to schedule',
        p_owner_id: PEOPLE.izzah.id,
        p_frequency: 'daily',
        p_interval_count: 1,
        p_weekdays: null,
        p_day_of_month: null,
        p_start_date: null,
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Rpc;

    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('not_authorised');
  });
});

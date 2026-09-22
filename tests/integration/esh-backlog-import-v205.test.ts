import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v205 — a backlog staged, reconciled and released against the real database.
 *
 * The scale matters here in a way it does not in a unit test: a hundred rows
 * with the problems a real register has, released in one transaction, with
 * each owner hearing once.
 */

describe('v205 backlog import', () => {
  it('stages a hundred mixed rows, reconciles every one and releases the reviewed ones', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const izzul = await signInAs('izzul');
    const service = serviceClient();
    const { data: departments } = await izzul.from('departments').select('id,code');
    const ops = departments?.find((department) => department.code === 'OPS');
    expect(ops).toBeTruthy();

    const started = await izzul.rpc('esh_import_start', {
      p_source_name: `backlog-${suffix}.xlsx`,
      p_source_hash: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      p_source_register: `Register ${suffix}`,
      p_storage_path: `imports/${suffix}/backlog.xlsx`,
      p_sheet_name: 'Backlog',
      p_sheet_path: 'xl/worksheets/sheet1.xml',
      p_header_line: 1,
      p_date_convention: 'dmy',
      p_mapping: { reference: 0, description: 1 },
      p_source_rows: 104,
    });
    expect(started.error).toBeNull();
    expect(started.data).toMatchObject({ ok: true });
    const batchId = started.data.batch_id as string;

    // A hundred good rows, spread over four owners, plus the four kinds of
    // trouble a real register has: a blank line, a missing address, a missing
    // corrective action and an unreadable date.
    const rows: Array<Record<string, unknown>> = [];
    for (let index = 1; index <= 100; index += 1) {
      rows.push({
        line: index + 1,
        raw: { 'Finding no': `BL-${index}`, Detail: `Condition ${index}` },
        mapped: {
          reference: `BL-${suffix}-${index}`,
          description: `Condition ${index} needs correcting`,
          action: 'Correct it',
          department: 'OPS',
          owner_email: `owner${index % 4}.${suffix}@example.com`,
          reported_on: '2026-03-02',
          due_on: '2026-04-01',
          priority: index % 3 === 0 ? 'urgent' : 'normal',
        },
      });
    }
    rows.push({ line: 102, raw: {}, mapped: {} });
    rows.push({
      line: 103,
      raw: { 'Finding no': 'BL-NAME' },
      mapped: {
        reference: `BL-${suffix}-name`,
        description: 'Named but not addressed',
        action: 'Correct it',
        department: 'OPS',
        owner_name: 'Rosli bin Ahmad',
        reported_on: '2026-03-02',
        due_on: '2026-04-02',
        priority: 'normal',
      },
    });
    rows.push({
      line: 104,
      raw: { 'Finding no': 'BL-NOACTION' },
      mapped: {
        reference: `BL-${suffix}-noaction`,
        description: 'No corrective action in the file',
        department: 'OPS',
        owner_email: `owner0.${suffix}@example.com`,
        reported_on: '2026-03-02',
        due_on: '2026-04-03',
        priority: 'normal',
      },
    });
    rows.push({
      line: 105,
      raw: { 'Finding no': 'BL-BADDATE' },
      mapped: {
        reference: `BL-${suffix}-baddate`,
        description: 'The target date could not be read',
        action: 'Correct it',
        department: 'OPS',
        owner_email: `owner0.${suffix}@example.com`,
        reported_on: '2026-03-02',
        due_on: 'sometime in April',
        priority: 'normal',
      },
    });

    const staged = await izzul.rpc('esh_import_stage', { p_batch_id: batchId, p_rows: rows });
    expect(staged.error).toBeNull();
    expect(staged.data).toMatchObject({ ok: true, state: 'staged' });
    expect(staged.data.counts).toMatchObject({ ready: 100, blocked: 3, ignored: 1 });
    expect(staged.data.needs_assignment).toBe(1);

    // Staging is not work: nothing exists, nothing is counted, nobody is told.
    const findingsBefore = await service
      .from('esh_findings')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'import')
      .eq('source_register', `Register ${suffix}`);
    expect(findingsBefore.count).toBe(0);

    const { data: blocked } = await izzul
      .from('esh_import_rows')
      .select('source_line, problems, needs_assignment')
      .eq('batch_id', batchId)
      .eq('outcome', 'blocked')
      .order('source_line');
    expect(blocked?.map((row) => row.source_line)).toEqual([103, 104, 105]);
    expect(blocked?.[0]?.needs_assignment).toBe(true);
    expect(blocked?.[1]?.problems).toContain('action_missing');
    expect(blocked?.[2]?.problems).toContain('due_unreadable');

    // The decisions that make them releasable.
    const decided = await izzul.rpc('esh_import_set_owner_email', {
      p_batch_id: batchId,
      p_source_name: 'Rosli bin Ahmad',
      p_email: `rosli.${suffix}@example.com`,
    });
    expect(decided.data).toMatchObject({ ok: true });

    const { data: staged104 } = await izzul
      .from('esh_import_rows')
      .select('id')
      .eq('batch_id', batchId)
      .eq('source_line', 104)
      .single();
    const amended = await izzul.rpc('esh_import_amend_row', {
      p_row_id: staged104!.id,
      p_patch: { action: 'Service and retag it' },
    });
    expect(amended.data).toMatchObject({ ok: true, outcome: 'ready' });

    const { data: ready } = await izzul
      .from('esh_import_rows')
      .select('id')
      .eq('batch_id', batchId)
      .eq('outcome', 'ready');
    expect(ready?.length).toBe(102);

    const released = await izzul.rpc('esh_import_release', {
      p_batch_id: batchId,
      p_row_ids: ready!.map((row) => row.id),
      p_followup_from: '2026-09-25T01:00:00.000Z',
      p_idempotency_key: `v205-${suffix}`,
    });
    expect(released.error).toBeNull();
    expect(released.data).toMatchObject({ ok: true, released: 102 });

    // Five owners in all: four from the hundred, plus the one decided by name.
    expect(released.data.owners).toBe(5);
    const summaries = await service
      .from('esh_notification_outbox')
      .select('event_type, recipient_principal_id')
      .eq('import_batch_id', batchId);
    expect(summaries.data?.length).toBe(5);
    expect(new Set(summaries.data?.map((row) => row.event_type))).toEqual(
      new Set(['import_assignment']),
    );

    // Old deadlines stay old, and following up starts when the release said.
    const { data: actions } = await service
      .from('esh_finding_actions')
      .select('due_at, followup_active_from, finding_id')
      .in(
        'finding_id',
        (
          await service
            .from('esh_findings')
            .select('id')
            .eq('source_register', `Register ${suffix}`)
        ).data!.map((finding) => finding.id),
      );
    expect(actions?.length).toBe(102);
    expect(actions?.every((action) => String(action.due_at).startsWith('2026-04'))).toBe(true);
    expect(
      actions?.every((action) => String(action.followup_active_from).startsWith('2026-09-25')),
    ).toBe(true);

    // The same release again is the same release.
    const again = await izzul.rpc('esh_import_release', {
      p_batch_id: batchId,
      p_row_ids: ready!.map((row) => row.id),
      p_followup_from: '2026-09-25T01:00:00.000Z',
      p_idempotency_key: `v205-${suffix}`,
    });
    expect(again.data).toMatchObject({ ok: true, released: 102 });
    const total = await service
      .from('esh_findings')
      .select('id', { count: 'exact', head: true })
      .eq('source_register', `Register ${suffix}`);
    expect(total.count).toBe(102);

    // And the same file cannot arrive twice as two imports.
    const { data: batch } = await service
      .from('esh_import_batches')
      .select('source_hash')
      .eq('id', batchId)
      .single();
    const duplicate = await izzul.rpc('esh_import_start', {
      p_source_name: `backlog-${suffix}-copy.xlsx`,
      p_source_hash: batch!.source_hash,
      p_source_register: `Register ${suffix}`,
      p_storage_path: `imports/${suffix}/copy.xlsx`,
      p_sheet_name: 'Backlog',
      p_sheet_path: 'xl/worksheets/sheet1.xml',
      p_header_line: 1,
      p_date_convention: 'dmy',
      p_mapping: {},
      p_source_rows: 104,
    });
    expect(duplicate.data).toMatchObject({ ok: false, code: 'already_imported' });
  }, 120_000);

  it('refuses to import for somebody whose Finding access does not coordinate', async () => {
    const employee = await signInAs('amer');
    const refused = await employee.rpc('esh_import_start', {
      p_source_name: 'not-mine.xlsx',
      p_source_hash: 'f'.repeat(64),
      p_source_register: 'Register',
      p_storage_path: 'imports/x.xlsx',
      p_sheet_name: 'Sheet1',
      p_sheet_path: 'xl/worksheets/sheet1.xml',
      p_header_line: 1,
      p_date_convention: 'dmy',
      p_mapping: {},
      p_source_rows: 1,
    });
    expect(refused.data).toMatchObject({ ok: false, code: 'not_permitted' });
    expect(PEOPLE.amer.id).toBeTruthy();
  });
});

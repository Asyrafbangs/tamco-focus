import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v285 — the import history, where a swallowed read could duplicate a register.
 *
 * `listImportBatches` logged a failed read and returned `[]`. The import
 * screen renders an empty list as "No backlog has been imported yet.", and a
 * coordinator who believes that does the obvious thing: imports the register
 * again. Of everything the swallowed reads in this module could cause, a
 * duplicated backlog is the one that cannot be undone by reloading the page.
 *
 * It lives in `src/server/esh/import.ts` rather than `queries.ts`, which is
 * the only reason it is a file of its own; the rule is the one from v282 and
 * v283, and the shape of these cases is `esh-swallowed-reads-v285`'s.
 */

type Answer = { data: unknown; error: { code?: string; message: string } | null };

/** What PostgREST hands back when the gateway, not the query, is the problem. */
const UPSTREAM_502: Answer = {
  data: null,
  error: { code: 'PGRST000', message: 'An invalid response was received from the upstream server' },
};

const state = vi.hoisted(() => ({
  tables: new Map<string, { data: unknown; error: { code?: string; message: string } | null }>(),
}));

vi.mock('@/lib/supabase/server', () => {
  const builderFor = (table: string) => {
    const answer = () => state.tables.get(table) ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const step of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit']) {
      builder[step] = () => builder;
    }
    builder.maybeSingle = async () => answer();
    builder.then = (
      resolve: (value: ReturnType<typeof answer>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(answer()).then(resolve, reject);
    return builder;
  };

  return {
    createSupabaseServerClient: async () => ({ from: (table: string) => builderFor(table) }),
  };
});

import { listImportBatches } from '@/server/esh/import';

const A_BATCH = {
  id: 'f0c05700-0000-4000-a000-000000000001',
  source_name: 'ESH register 2025.xlsx',
  source_register: 'ESH inspection',
  sheet_name: 'Findings',
  state: 'staged',
  source_rows: 412,
  created_at: '2026-10-01T01:00:00Z',
  released_at: null,
};

beforeEach(() => {
  state.tables.clear();
  // The console.error is the production behaviour under test, not noise to fix.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v285 listImportBatches, when the read fails', () => {
  it('throws rather than reporting that no backlog has been imported', async () => {
    state.tables.set('esh_import_batches', UPSTREAM_502);

    await expect(listImportBatches()).rejects.toThrow(/could not be read/);
  });

  it('names the failure rather than leaving it in the log', async () => {
    state.tables.set('esh_import_batches', UPSTREAM_502);

    await expect(listImportBatches()).rejects.toThrow(/PGRST000.*upstream server/);
  });

  /*
   * Asserted directly rather than inferred from the rejection: `[]` is the
   * answer the screen turns into "No backlog has been imported yet.", which is
   * the sentence that invites the duplicate import.
   */
  it('does not resolve to an empty list', async () => {
    state.tables.set('esh_import_batches', UPSTREAM_502);

    const outcome = await listImportBatches().then(
      (batches) => ({ resolved: batches }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
  });
});

describe('v285 listImportBatches, when the read succeeds', () => {
  /*
   * Without this, the cases above would pass on a function that threw at
   * everything — including on the first visit to the screen, which is exactly
   * when "No backlog has been imported yet." is true and wanted.
   */
  it('returns an empty list when nothing genuinely has been imported', async () => {
    state.tables.set('esh_import_batches', { data: [], error: null });

    await expect(listImportBatches()).resolves.toEqual([]);
  });

  it('returns the batches that are there', async () => {
    state.tables.set('esh_import_batches', { data: [A_BATCH], error: null });
    state.tables.set('esh_import_rows', {
      data: [
        { batch_id: A_BATCH.id, outcome: 'ready' },
        { batch_id: A_BATCH.id, outcome: 'ready' },
        { batch_id: A_BATCH.id, outcome: 'blocked' },
      ],
      error: null,
    });

    const batches = await listImportBatches();

    expect(batches).toHaveLength(1);
    expect(batches[0]?.sourceName).toBe('ESH register 2025.xlsx');
    expect(batches[0]?.sourceRows).toBe(412);
  });
});

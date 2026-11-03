import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v285 — the rest of the reads that reported a failure as "there is nothing here".
 *
 * v282 and v283 established the rule on two reads: a read that FAILED and a
 * read that returned NOTHING are different facts, and conflating them lets an
 * outage make a false statement about the data. v284 proved those two call
 * sites still call the helper that enforces it.
 *
 * `src/server/esh/` had eleven more reads doing exactly what v282 and v283
 * had just been fixed for: log the error, return `[]` or `null`. One of them
 * had already done measurable damage. During a local gate run, local Supabase
 * answered `esh_admin_contacts` with a gateway 502 under suite load;
 * `listEmailContacts` returned `[]`; the administration screen then had no
 * contact to select, so the ESH access form was never rendered and the page
 * fell back to "Select a person"; `esh-identity-access-v203` failed looking
 * for a control inside that form, and the failure read as a product bug in a
 * feature nobody had touched.
 *
 * This file covers the six reads in `queries.ts` that now throw. Each has two
 * cases that must both hold, because either alone is satisfied by a wrong
 * implementation: a failed read must throw, and a genuinely empty answer must
 * still come back empty. The second is what keeps the first from passing on a
 * function that throws at everything.
 *
 * `esh-import-history-v285` covers the seventh, in `import.ts`.
 * `esh-reported-reads-v285` covers the three that report instead of throwing.
 */

type Answer = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

const EMPTY: Answer = { data: [], error: null };

/** What PostgREST hands back when the gateway, not the query, is the problem. */
const UPSTREAM_502: Answer = {
  data: null,
  error: { code: 'PGRST000', message: 'An invalid response was received from the upstream server' },
};

const state = vi.hoisted(() => ({
  /** One answer per table, and one per RPC. Anything unnamed answers empty. */
  tables: new Map<string, { data: unknown; error: { code?: string; message: string } | null }>(),
  rpcs: new Map<string, { data: unknown; error: { code?: string; message: string } | null }>(),
  /** Every RPC asked for, in order, so a retry is visible. */
  rpcCalls: [] as string[],
}));

/*
 * A query builder that answers whatever its table was given.
 *
 * The six functions under test reach their read in six different ways —
 * `.maybeSingle()`, a plain await of the builder, two `.order()`s, an `.in()`
 * after a conditional `.is()` — so the builder accepts the whole vocabulary
 * and is itself awaitable. What matters to these tests is only which table
 * was asked and what came back.
 */
vi.mock('@/lib/supabase/server', () => {
  const answerFor = (table: string) =>
    state.tables.get(table) ?? { data: [], error: null, count: 0 };

  const builderFor = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const step of [
      'select',
      'eq',
      'neq',
      'in',
      'is',
      'not',
      'gte',
      'lte',
      'order',
      'limit',
      'range',
      'filter',
      'or',
    ]) {
      builder[step] = () => builder;
    }
    builder.maybeSingle = async () => answerFor(table);
    builder.single = async () => answerFor(table);
    builder.then = (
      resolve: (value: ReturnType<typeof answerFor>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(answerFor(table)).then(resolve, reject);
    return builder;
  };

  return {
    createSupabaseServerClient: async () => ({
      from: (table: string) => builderFor(table),
      rpc: async (name: string) => {
        state.rpcCalls.push(name);
        /*
         * A queue of answers, so a retry can be given a different one. The
         * last answer stands for every further call.
         */
        const queued = state.rpcs.get(name);
        if (Array.isArray(queued)) {
          return queued.length > 1 ? (queued.shift() as Answer) : (queued[0] as Answer);
        }
        return queued ?? { data: [], error: null };
      },
    }),
  };
});

import { NO_ESH_ACCESS, type EshAccess } from '@/domain/esh-findings';
import {
  getDepartmentsInScope,
  getFollowupSettings,
  getVerifiers,
  listDepartmentEscalationDefaults,
  listEmailContacts,
  listReviewedConnections,
  listVerificationQueue,
} from '@/server/esh/queries';

/** Answers queued for one RPC, taken in order, the last one repeating. */
function answerRpc(name: string, ...answers: Answer[]) {
  state.rpcs.set(name, answers as never);
}

function answerTable(table: string, answer: Answer) {
  state.tables.set(table, answer);
}

const A_COORDINATOR: EshAccess = {
  ...NO_ESH_ACCESS,
  enabled: true,
  preset: 'coordinator',
  scopeAll: true,
  canCoordinate: true,
};

const A_DEPARTMENT = 'f0c05100-0000-4000-a000-000000000001';

beforeEach(() => {
  state.tables.clear();
  state.rpcs.clear();
  state.rpcCalls.length = 0;
  // The console.error is the production behaviour under test, not noise to fix.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v285 listEmailContacts — the read that caused the false browser failure', () => {
  it('throws rather than reporting an empty contact directory', async () => {
    answerRpc('esh_admin_contacts', UPSTREAM_502);

    await expect(listEmailContacts('')).rejects.toThrow(/could not be read/);
  });

  it('names the failure, so the cause reaches the reader and not only the log', async () => {
    answerRpc('esh_admin_contacts', UPSTREAM_502);

    await expect(listEmailContacts('')).rejects.toThrow(/PGRST000.*upstream server/);
  });

  /*
   * Asserted directly rather than inferred from the rejection. `[]` is the
   * specific wrong answer this fix exists to prevent: it is what dropped the
   * selected contact, took the access form off the page and failed a browser
   * case on a feature nobody had changed.
   */
  it('does not resolve to an empty list', async () => {
    answerRpc('esh_admin_contacts', UPSTREAM_502);

    const outcome = await listEmailContacts('').then(
      (contacts) => ({ resolved: contacts }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
  });

  // The retry is here for the same reason it is on `getEshAccess`: a gateway
  // 502 often does not survive being asked again. Five were absorbed this way
  // in the gate run that prompted this change.
  it('asks a second time before giving up, and takes the answer when it arrives', async () => {
    answerRpc('esh_admin_contacts', UPSTREAM_502, {
      data: [
        {
          id: 'c0c05100-0000-4000-a000-000000000001',
          staff_user_id: null,
          display_email: 'owner@tamco.com.my',
          display_name: 'An owner',
          status: 'active',
          access_enabled: true,
          created_at: '2026-11-01T00:00:00Z',
        },
      ],
      error: null,
    });

    const contacts = await listEmailContacts('');

    expect(state.rpcCalls.filter((name) => name === 'esh_admin_contacts')).toHaveLength(2);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.email).toBe('owner@tamco.com.my');
  });

  it('gives up after the second failure rather than asking indefinitely', async () => {
    answerRpc('esh_admin_contacts', UPSTREAM_502);

    await expect(listEmailContacts('')).rejects.toThrow(/could not be read/);
    expect(state.rpcCalls.filter((name) => name === 'esh_admin_contacts')).toHaveLength(2);
  });

  /*
   * Without this, every case above would pass on a function that threw at
   * everything. A directory with nobody in it — a search matching nothing,
   * most often — is still an empty list, and the screen still says so.
   */
  it('returns an empty list for a search that genuinely matches nobody', async () => {
    answerRpc('esh_admin_contacts', EMPTY);

    await expect(listEmailContacts('nobody-by-this-name')).resolves.toEqual([]);
  });
});

describe('v285 getDepartmentsInScope', () => {
  it('throws rather than reporting an organisation with no departments', async () => {
    answerTable('departments', UPSTREAM_502);

    await expect(getDepartmentsInScope(A_COORDINATOR)).rejects.toThrow(/could not be read/);
  });

  it('does not resolve to an empty list', async () => {
    answerTable('departments', UPSTREAM_502);

    const outcome = await getDepartmentsInScope(A_COORDINATOR).then(
      (departments) => ({ resolved: departments }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
  });

  /*
   * The companion, and the stronger half of it: a department that is there
   * comes back. A function that threw at everything would fail this, and so
   * would one that returned `[]` regardless.
   */
  it('returns the departments when the read answers', async () => {
    answerTable('departments', {
      data: [{ id: A_DEPARTMENT, name: 'Maintenance' }],
      error: null,
    });

    await expect(getDepartmentsInScope(A_COORDINATOR)).resolves.toEqual([
      { id: A_DEPARTMENT, name: 'Maintenance' },
    ]);
  });

  it('returns an empty list when there genuinely are no active departments', async () => {
    answerTable('departments', EMPTY);

    await expect(getDepartmentsInScope(A_COORDINATOR)).resolves.toEqual([]);
  });

  /*
   * Scope is not a failure. A coordinator who covers nothing sees nothing, and
   * that is the database's answer applied, not an unanswered read.
   */
  it('still returns nothing for a reader whose scope excludes every department', async () => {
    answerTable('departments', {
      data: [{ id: A_DEPARTMENT, name: 'Maintenance' }],
      error: null,
    });

    await expect(
      getDepartmentsInScope({ ...A_COORDINATOR, scopeAll: false, departmentIds: [] }),
    ).resolves.toEqual([]);
  });
});

describe('v285 getVerifiers', () => {
  it('throws rather than reporting an organisation with no verifiers', async () => {
    answerRpc('esh_list_verifiers', UPSTREAM_502);

    await expect(getVerifiers()).rejects.toThrow(/could not be read/);
  });

  it('does not resolve to an empty list', async () => {
    answerRpc('esh_list_verifiers', UPSTREAM_502);

    const outcome = await getVerifiers().then(
      (verifiers) => ({ resolved: verifiers }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
  });

  it('returns the verifiers when the read answers', async () => {
    answerRpc('esh_list_verifiers', {
      data: [
        {
          user_id: 'f0c05300-0000-4000-a000-000000000001',
          full_name: 'A verifier',
          email: 'verifier@tamco.com.my',
        },
      ],
      error: null,
    });

    await expect(getVerifiers()).resolves.toEqual([
      {
        userId: 'f0c05300-0000-4000-a000-000000000001',
        fullName: 'A verifier',
        email: 'verifier@tamco.com.my',
      },
    ]);
  });

  it('returns an empty list when nobody genuinely holds the role', async () => {
    answerRpc('esh_list_verifiers', EMPTY);

    await expect(getVerifiers()).resolves.toEqual([]);
  });
});

describe('v285 getFollowupSettings', () => {
  const A_POLICY = {
    data: {
      version: 3,
      pre_due_days: 3,
      remind_on_due: true,
      overdue_every_days: 2,
      level_days: [7, 14],
      review_reminder_days: 2,
      catch_up: 'coalesce',
    },
    error: null,
  };
  const A_CALENDAR = {
    data: { working_weekdays: [1, 2, 3, 4, 5], confirmed_through: '2026-12-31' },
    error: null,
  };

  const configured = () => {
    answerTable('esh_followup_policies', A_POLICY);
    answerTable('esh_working_calendars', A_CALENDAR);
    answerTable('organizations', { data: { timezone: 'Asia/Kuala_Lumpur' }, error: null });
  };

  it('throws when the policy read fails', async () => {
    configured();
    answerTable('esh_followup_policies', UPSTREAM_502);

    await expect(getFollowupSettings()).rejects.toThrow(/could not be read/);
  });

  it('throws when any one of the five reads fails, not only the first', async () => {
    configured();
    answerTable('esh_followup_policy_rules', UPSTREAM_502);

    await expect(getFollowupSettings()).rejects.toThrow(/PGRST000/);
  });

  /*
   * The distinction this function existed to blur. New finding reads
   * `followup?.levelDays ?? []`, so `null` from a failed read rendered a form
   * that quietly stopped saying when each escalation level is told —
   * configured follow-up, presented as none.
   */
  it('does not resolve to null on a failed read', async () => {
    configured();
    answerTable('esh_working_calendars', UPSTREAM_502);

    const outcome = await getFollowupSettings().then(
      (settings) => ({ resolved: settings }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
  });

  /*
   * The companion that matters most in this case, because `null` has to keep
   * one of its two old meanings: an install where nobody has configured the
   * policy yet is not a failure, and the settings screen still explains that
   * nothing can be changed until the policy and calendar exist.
   */
  it('returns null when the policy genuinely has not been configured', async () => {
    configured();
    answerTable('esh_followup_policies', { data: null, error: null });

    await expect(getFollowupSettings()).resolves.toBeNull();
  });

  it('returns null when the working calendar genuinely has not been confirmed', async () => {
    configured();
    answerTable('esh_working_calendars', { data: null, error: null });

    await expect(getFollowupSettings()).resolves.toBeNull();
  });

  it('returns the settings when every read answers', async () => {
    configured();

    const settings = await getFollowupSettings();

    expect(settings?.levelDays).toEqual([7, 14]);
    expect(settings?.timeZone).toBe('Asia/Kuala_Lumpur');
  });
});

describe('v285 listDepartmentEscalationDefaults', () => {
  it('throws rather than reporting a department with no escalation route', async () => {
    answerTable('esh_department_escalation_defaults', UPSTREAM_502);

    await expect(listDepartmentEscalationDefaults()).rejects.toThrow(/could not be read/);
  });

  /*
   * The departments read is the one whose error used to be dropped: the log
   * named only `rows.error`, so a failure here printed the prefix and an empty
   * string, and the function returned `[]` either way.
   */
  it('throws when the departments half of the read fails', async () => {
    answerTable('departments', UPSTREAM_502);

    await expect(listDepartmentEscalationDefaults()).rejects.toThrow(/PGRST000/);
  });

  it('returns the routes a department has when both reads answer', async () => {
    answerTable('departments', { data: [{ id: A_DEPARTMENT, name: 'Maintenance' }], error: null });
    answerTable('esh_department_escalation_defaults', {
      data: [{ department_id: A_DEPARTMENT, level: 1, email: 'supervisor@tamco.com.my' }],
      error: null,
    });

    await expect(listDepartmentEscalationDefaults()).resolves.toEqual([
      {
        departmentId: A_DEPARTMENT,
        departmentName: 'Maintenance',
        levels: [{ level: 1, email: 'supervisor@tamco.com.my' }],
      },
    ]);
  });

  it('returns an empty route for a department that genuinely has none', async () => {
    answerTable('departments', { data: [{ id: A_DEPARTMENT, name: 'Maintenance' }], error: null });
    answerTable('esh_department_escalation_defaults', EMPTY);

    await expect(listDepartmentEscalationDefaults()).resolves.toEqual([
      { departmentId: A_DEPARTMENT, departmentName: 'Maintenance', levels: [] },
    ]);
  });
});

describe('v285 listVerificationQueue', () => {
  const A_SUBMISSION = {
    id: 'f0c05400-0000-4000-a000-000000000001',
    action_id: 'f0c05500-0000-4000-a000-000000000001',
    version: 1,
    submitted_at: '2026-11-01T02:00:00Z',
    owner_email: 'owner@tamco.com.my',
    evidence_asset_ids: ['f0c05600-0000-4000-a000-000000000001'],
  };
  const ITS_ACTION = {
    finding_id: 'f0c05200-0000-4000-a000-000000000001',
    action_id: A_SUBMISSION.action_id,
    reference: 'ESH-2026-0001',
    title: 'A guard was missing from the press',
    location: 'Press shop',
    department_name: 'Maintenance',
    priority: 'high',
  };

  it('throws rather than reporting an empty verification queue', async () => {
    answerTable('esh_action_submissions', UPSTREAM_502);

    await expect(listVerificationQueue()).rejects.toThrow(/could not be read/);
  });

  it('does not resolve to an empty list', async () => {
    answerTable('esh_action_submissions', UPSTREAM_502);

    const outcome = await listVerificationQueue().then(
      (rows) => ({ resolved: rows }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
  });

  /*
   * The second read's error was discarded outright — not logged, not returned.
   * Every submission is matched to this result by action and a submission that
   * does not match is dropped, so a failure here emptied the queue with the
   * submissions already in hand to prove it was not empty.
   */
  it('throws when the second read fails, with submissions already in hand', async () => {
    answerTable('esh_action_submissions', { data: [A_SUBMISSION], error: null });
    answerTable('esh_action_register_rows', UPSTREAM_502);

    await expect(listVerificationQueue()).rejects.toThrow(/could not be read/);
  });

  it('returns the queue when both reads answer', async () => {
    answerTable('esh_action_submissions', { data: [A_SUBMISSION], error: null });
    answerTable('esh_action_register_rows', { data: [ITS_ACTION], error: null });

    const rows = await listVerificationQueue();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.reference).toBe('ESH-2026-0001');
    expect(rows[0]?.files).toBe(1);
  });

  it('returns an empty queue when nothing is genuinely waiting', async () => {
    answerTable('esh_action_submissions', EMPTY);

    await expect(listVerificationQueue()).resolves.toEqual([]);
  });

  /*
   * A submission whose action is outside the department asked for is filtered,
   * not failed: the second read answered, and the answer was that this row is
   * not in that department.
   */
  it('returns an empty queue when the department filter genuinely excludes everything', async () => {
    answerTable('esh_action_submissions', { data: [A_SUBMISSION], error: null });
    answerTable('esh_action_register_rows', EMPTY);

    await expect(listVerificationQueue(A_DEPARTMENT)).resolves.toEqual([]);
  });
});

/*
 * The read the original list of twelve missed, found by sweeping for a
 * `console.error` followed by a `return [] / null / 0` rather than by trusting
 * the list. It is the same defect in the same file.
 */
describe('v285 listReviewedConnections', () => {
  const A_FINDING = 'f0c05200-0000-4000-a000-000000000001';
  const ANOTHER_FINDING = 'f0c05200-0000-4000-a000-000000000002';
  const A_LINK = {
    finding_id: A_FINDING,
    other_finding_id: ANOTHER_FINDING,
    kind: 'recurred_as',
    occurred_at: '2026-10-02T01:00:00Z',
    note: null,
  };
  const BOTH_FINDINGS = {
    data: [
      { id: A_FINDING, reference: 'ESH-2026-0001', title: 'A guard was missing from the press' },
      { id: ANOTHER_FINDING, reference: 'ESH-2026-0009', title: 'The same guard, missing again' },
    ],
    error: null,
  };

  /*
   * Patterns splits this list into recurred, reported again and related, and
   * shows its "nothing yet" card when all three are empty. So `[]` told ESH
   * that no finding has come back, nothing was reported twice and nothing is
   * related to anything — on the page whose entire subject is those links.
   */
  it('throws rather than reporting a register with nothing connected in it', async () => {
    answerTable('esh_finding_connections', UPSTREAM_502);

    await expect(listReviewedConnections()).rejects.toThrow(/could not be read/);
  });

  it('does not resolve to an empty list', async () => {
    answerTable('esh_finding_connections', UPSTREAM_502);

    const outcome = await listReviewedConnections().then(
      (connections) => ({ resolved: connections }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
  });

  /*
   * The second read's error was discarded, and the function's own drop rule
   * hid it: a pair whose far end does not resolve is dropped on purpose,
   * because the view should already have excluded it. That reasoning holds
   * only for a read that ANSWERED — when it fails nothing resolves, every
   * pair drops, and the result is an empty list again.
   */
  it('throws when the findings behind the links cannot be read', async () => {
    answerTable('esh_finding_connections', { data: [A_LINK], error: null });
    answerTable('esh_findings', UPSTREAM_502);

    await expect(listReviewedConnections()).rejects.toThrow(/PGRST000/);
  });

  it('resolves both ends when both reads answer', async () => {
    answerTable('esh_finding_connections', { data: [A_LINK], error: null });
    answerTable('esh_findings', BOTH_FINDINGS);

    const connections = await listReviewedConnections();

    expect(connections).toHaveLength(1);
    expect(connections[0]?.kind).toBe('recurred_as');
    expect(connections[0]?.finding.reference).toBe('ESH-2026-0001');
    expect(connections[0]?.other.reference).toBe('ESH-2026-0009');
  });

  it('returns an empty list when nothing genuinely has been connected', async () => {
    answerTable('esh_finding_connections', EMPTY);

    await expect(listReviewedConnections()).resolves.toEqual([]);
  });

  /*
   * And the deliberate drop is preserved, which is the half that must not be
   * lost: a pair whose far end the reader may not see is still dropped, and
   * the stricter of the two rules still wins.
   */
  it('still drops a pair whose far end the reader cannot see', async () => {
    answerTable('esh_finding_connections', { data: [A_LINK], error: null });
    answerTable('esh_findings', {
      data: [
        { id: A_FINDING, reference: 'ESH-2026-0001', title: 'A guard was missing from the press' },
      ],
      error: null,
    });

    await expect(listReviewedConnections()).resolves.toEqual([]);
  });
});

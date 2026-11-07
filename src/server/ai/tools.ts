import 'server-only';

import { z } from 'zod';

import {
  AGENT_LIMITS,
  ToolInputError,
  asEvidence,
  capRows,
  findingSource,
  taskSource,
  type SourceLink,
} from '@/domain/ai';
import { getEshAccess } from '@/server/esh/access';
import {
  getFindingDetail,
  getHazardDistribution,
  listRegister,
  listVerificationQueue,
} from '@/server/esh/queries';
import { getMyTasks, getStepsIOwe, getTaskDetail, getTeamAvailableWork } from '@/server/queries';

/**
 * Everything the assistant can read — and nothing else.
 *
 * Three rules hold this layer together, and each one is a test in
 * `tests/unit/ai-tools-*`:
 *
 * 1. **No new permission logic.** Every tool calls a reader the application
 *    already uses, which runs on the caller's own Supabase session. Row-level
 *    security decides what comes back. A tool that filtered rows itself would
 *    be a second opinion about who may see what, and the two would drift.
 *
 * 2. **No service-role client, ever.** Nothing in this file may import
 *    `createSupabaseServiceRoleClient`. That client bypasses RLS entirely; in
 *    an agent's hands it is the difference between "answer about your work"
 *    and "answer about anyone's".
 *
 * 3. **Read-only, in Phase 1.** No tool creates, edits, closes or reassigns
 *    anything. An investigator that can also act is a different risk, and it
 *    is not this one.
 *
 * What comes back is wrapped by `asEvidence` before the model reads it, so a
 * sentence written inside a finding cannot pass for an instruction.
 */

/** Who is asking, resolved once per turn rather than per tool call. */
export interface ToolCaller {
  userId: string;
  fullName: string;
  timezone: string;
}

export interface ToolOutcome {
  /** What the model reads: fenced, labelled, never raw prose. */
  evidence: string;
  /** Records actually returned, for the citations under the answer. */
  sources: SourceLink[];
  rows: number;
}

export interface AgentTool {
  name: string;
  description: string;
  schema: z.ZodType;
  /** JSON Schema for the API, derived from the same Zod shape. */
  inputSchema: Record<string, unknown>;
  run(input: unknown, caller: ToolCaller): Promise<ToolOutcome>;
}

export { ToolInputError };

function parse<T>(schema: z.ZodType<T>, input: unknown, toolName: string): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new ToolInputError(
      `${toolName} was called with arguments it cannot use: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

const UUID = z.string().uuid();

/* ---------------------------------------------------------------- tasks -- */

const myWorkSchema = z.object({});

const myWork: AgentTool = {
  name: 'list_my_tasks',
  description:
    "The signed-in person's own tasks: title, status, due date, priority and who else is involved. Use this before answering anything about their workload, their deadlines or what they should do next.",
  schema: myWorkSchema,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run(input, caller) {
    parse(myWorkSchema, input, 'list_my_tasks');
    const tasks = await getMyTasks(caller.userId);
    const rows = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt ?? null,
      workClass: task.workClass,
      focusBucket: task.focusBucket ?? null,
    }));
    const capped = capRows(rows, AGENT_LIMITS.maxRowsPerTool);
    return {
      evidence: asEvidence('list_my_tasks', capped),
      sources: capped.rows.map((row) => taskSource(row.id, row.title)),
      rows: capped.shown,
    };
  },
};

const taskDetailSchema = z.object({ task_id: UUID });

const taskDetail: AgentTool = {
  name: 'get_task_detail',
  description:
    'One task in full: its description, steps, who owns it, its history, any barrier raised against it and what it is waiting on. Use this before attributing a delay to anybody.',
  schema: taskDetailSchema,
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'The task id, as given by another tool' },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
  async run(input, caller) {
    const { task_id: taskId } = parse(taskDetailSchema, input, 'get_task_detail');
    const detail = await getTaskDetail(taskId, caller.userId);
    if (!detail) {
      return {
        evidence: asEvidence('get_task_detail', {
          found: false,
          note: 'No task with that id is visible to this person. It may not exist, or it may belong to somebody whose work they cannot see.',
        }),
        sources: [],
        rows: 0,
      };
    }
    return {
      evidence: asEvidence('get_task_detail', detail),
      sources: [taskSource(detail.task.id, detail.task.title)],
      rows: 1,
    };
  },
};

const owedSchema = z.object({
  horizon_days: z.number().int().min(1).max(90).default(14),
});

const owedSteps: AgentTool = {
  name: 'list_steps_i_owe',
  description:
    "Steps this person owes on other people's tasks within a horizon, with their dates. This is the half of somebody's workload that does not appear in their own task list.",
  schema: owedSchema,
  inputSchema: {
    type: 'object',
    properties: {
      horizon_days: { type: 'integer', minimum: 1, maximum: 90, description: 'Days ahead to look' },
    },
    additionalProperties: false,
  },
  async run(input, caller) {
    const { horizon_days: horizon } = parse(owedSchema, input, 'list_steps_i_owe');
    const steps = await getStepsIOwe(caller.userId, horizon);
    const capped = capRows(steps, AGENT_LIMITS.maxRowsPerTool);
    return {
      evidence: asEvidence('list_steps_i_owe', capped),
      sources: capped.rows.map((step) => taskSource(step.taskId, step.title)),
      rows: capped.shown,
    };
  },
};

const teamSchema = z.object({});

const teamWorkload: AgentTool = {
  name: 'list_team_workload',
  description:
    'Work visible across the team this person may see. Empty for somebody who manages nobody — that is an answer, not a failure. Use it to check whether a delay is one person or a queue.',
  schema: teamSchema,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run(input, caller) {
    parse(teamSchema, input, 'list_team_workload');
    const work = await getTeamAvailableWork(caller.userId);
    const rows = Array.isArray(work) ? work : [];
    const capped = capRows(rows, AGENT_LIMITS.maxRowsPerTool);
    return {
      evidence: asEvidence('list_team_workload', capped),
      sources: [],
      rows: capped.shown,
    };
  },
};

/* ------------------------------------------------------------- findings -- */

const registerSchema = z.object({
  filter: z
    .enum([
      'attention',
      'open',
      'unprotected',
      'overdue',
      'verification',
      'unassessed',
      'closed',
      'all',
    ])
    .default('open'),
  search: z.string().max(200).default(''),
});

const searchFindings: AgentTool = {
  name: 'search_findings',
  description:
    'ESH findings this person is authorised to see, by filter and free text. Filters: attention, open, unprotected (significant risk with nothing verified protecting people), overdue, verification, unassessed, closed, all. ' +
    'The free text is a literal substring match on the reference, title, description and location — not a search engine. A phrase like "electrical testing" or "200t press Assembly 2" matches only if those exact characters appear in one field, so multi-word phrases usually match nothing even when the records exist. ' +
    'Risk level and status are NOT text: searching "critical" does not find critical findings. To count or survey by risk, severity or theme, call this with a filter and NO search text, then read the rows and count them yourself.',
  schema: registerSchema,
  inputSchema: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        enum: [
          'attention',
          'open',
          'unprotected',
          'overdue',
          'verification',
          'unassessed',
          'closed',
          'all',
        ],
      },
      search: { type: 'string', maxLength: 200 },
    },
    additionalProperties: false,
  },
  async run(input) {
    const { filter, search } = parse(registerSchema, input, 'search_findings');
    const access = await getEshAccess();
    if (!access.enabled) {
      return {
        evidence: asEvidence('search_findings', {
          authorised: false,
          note: 'This person does not have Finding Management access, so no findings can be read for them.',
        }),
        sources: [],
        rows: 0,
      };
    }
    const register = await listRegister({
      filter: filter === 'all' || filter === 'closed' ? (filter as never) : filter,
      search,
      departmentId: null,
      closedSince: new Date(Date.now() - 180 * 86_400_000).toISOString(),
      closedUntil: null,
      page: 0,
    });
    if (register.failed) {
      return {
        evidence: asEvidence('search_findings', {
          failed: true,
          note: 'The register could not be read. Do not report this as "no findings" — it is not known whether there are any.',
        }),
        sources: [],
        rows: 0,
      };
    }
    /*
     * A text search that matched nothing is not an empty register, and until
     * v298 the model had no way to tell the difference.
     *
     * The match is a literal `ilike '*term*'`. Asked how many critical
     * findings were open, the model searched the word "critical", matched
     * none of the sixteen - risk level is a column, not prose - and told a
     * manager there were none. There were four, two of them overdue. The
     * same mechanism produced "no evidence of a recurring electrical
     * problem" over three Test Bay 3 earthing findings, and "I cannot count
     * the hazards at the 200t press" over two linked reports of one.
     *
     * So when text matched nothing, the same filter is counted again without
     * it. One number - "0 of 16 open findings matched this text" - is the
     * difference between a false all-clear and a search to try differently.
     * It costs a second count only in the case that was already wrong.
     */
    let unmatchedTotal: number | null = null;
    if (search.trim() !== '' && register.total === 0) {
      const withoutText = await listRegister({
        filter: filter === 'all' || filter === 'closed' ? (filter as never) : filter,
        search: '',
        departmentId: null,
        closedSince: new Date(Date.now() - 180 * 86_400_000).toISOString(),
        closedUntil: null,
        page: 0,
      });
      if (!withoutText.failed) unmatchedTotal = withoutText.total;
    }
    const capped = capRows(register.rows, AGENT_LIMITS.maxRowsPerTool);
    return {
      evidence: asEvidence('search_findings', {
        // `total` is the register's own count and `shown` is what fits in the
        // payload. Both are given, so a count in the answer can be the real
        // one rather than however many rows happened to be sent.
        total: register.total,
        shown: capped.shown,
        truncated: capped.truncated,
        ...(unmatchedTotal === null
          ? {}
          : {
              searchMatchedNothing: {
                searched: search,
                matched: 0,
                recordsUnderThisFilter: unmatchedTotal,
                note:
                  `The text "${search}" matched none of the ${unmatchedTotal} finding(s) under ` +
                  'this filter. That is a failed text match, NOT an empty register. Do not ' +
                  'report this as "there are none" or "I found no evidence". Call this tool ' +
                  'again with the same filter and no search text, then read the rows.',
              },
            }),
        rows: capped.rows,
      }),
      sources: capped.rows.map((row) => findingSource(row.findingId, row.reference, row.title)),
      rows: capped.shown,
    };
  },
};

const findingSchema = z.object({ finding_id: UUID });

const findingDetail: AgentTool = {
  name: 'get_finding_detail',
  description:
    'One finding in full: what was found, its risk, its corrective action and owner, its due date, what has been submitted, its verification state, its interim protection and its history. Use this before saying why a finding is late or recurring.',
  schema: findingSchema,
  inputSchema: {
    type: 'object',
    properties: { finding_id: { type: 'string' } },
    required: ['finding_id'],
    additionalProperties: false,
  },
  async run(input) {
    const { finding_id: findingId } = parse(findingSchema, input, 'get_finding_detail');
    const detail = await getFindingDetail(findingId);
    if (!detail) {
      return {
        evidence: asEvidence('get_finding_detail', {
          found: false,
          note: 'No finding with that id is visible to this person.',
        }),
        sources: [],
        rows: 0,
      };
    }
    return {
      evidence: asEvidence('get_finding_detail', detail),
      sources: [findingSource(detail.id, detail.reference, detail.title)],
      rows: 1,
    };
  },
};

const verificationSchema = z.object({});

const verificationQueue: AgentTool = {
  name: 'list_verification_queue',
  description:
    'Corrections submitted by Action Owners and waiting for an ESH decision, oldest first. A long queue here is a cause of "nothing is moving" that has nothing to do with the owners.',
  schema: verificationSchema,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run(input) {
    parse(verificationSchema, input, 'list_verification_queue');
    const rows = await listVerificationQueue();
    const capped = capRows(rows, AGENT_LIMITS.maxRowsPerTool);
    return {
      evidence: asEvidence('list_verification_queue', capped),
      sources: capped.rows.map((row) => findingSource(row.findingId, row.reference, row.title)),
      rows: capped.shown,
    };
  },
};

const hazardSchema = z.object({});

const hazardPatterns: AgentTool = {
  name: 'get_hazard_distribution',
  description:
    'How findings fall across hazard categories, with the number nobody has classified. Use it for "is this recurring" questions before claiming a pattern.',
  schema: hazardSchema,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run(input) {
    parse(hazardSchema, input, 'get_hazard_distribution');
    const distribution = await getHazardDistribution();
    if (distribution.failed) {
      return {
        evidence: asEvidence('get_hazard_distribution', {
          failed: true,
          note: 'The distribution could not be read. It is not known whether a pattern exists.',
        }),
        sources: [],
        rows: 0,
      };
    }
    return {
      evidence: asEvidence('get_hazard_distribution', distribution),
      sources: [],
      rows: distribution.rows.length,
    };
  },
};

export const AGENT_TOOLS: readonly AgentTool[] = [
  myWork,
  taskDetail,
  owedSteps,
  teamWorkload,
  searchFindings,
  findingDetail,
  verificationQueue,
  hazardPatterns,
];

export function toolByName(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}

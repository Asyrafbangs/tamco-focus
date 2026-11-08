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
import { resolvePeriod } from '@/domain/period';
import type { ActivityEvent } from '@/domain/team-activity';
import {
  getMyTasks,
  getStepsIOwe,
  getTaskDetail,
  getLatestTaskUpdates,
  getTeamLoad,
  getVisibleTeamTasks,
} from '@/server/queries';
import { getTeamActivity } from '@/server/team-activity';

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
    'The signed-in person\'s own tasks: title, status, due date, priority and who else is involved. Use this before answering anything about their workload, their deadlines or what they should do next. It holds TASKS ONLY — ESH findings are separate records and none of them are in here, so for "what should I prioritise", "what needs my attention", "am I behind" or anything that weighs the person\'s whole workload, read the finding register as well before answering.',
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
    "Steps this person owes on other people's tasks within a horizon, with their dates. This is the half of somebody's workload that does not appear in their own task list. Still tasks: an ESH finding assigned to them is not here either, so a question about everything on their plate needs the finding register too.",
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

/**
 * v302 — this tool answered "nobody" to everybody, for every team.
 *
 * It called `getTeamAvailableWork`, which returns `{ groups, failed }`, and
 * then wrote `Array.isArray(work) ? work : []`. An object is not an array, so
 * the branch was dead: the tool returned **zero rows on every call**, whatever
 * the team was doing, and the model — correctly reading the empty result as
 * the only evidence it had — told a head of department his team had no visible
 * workload. The same expression discarded `failed`, so a failed query would
 * have arrived as the same emptiness, which is the one thing
 * `getTeamAvailableWork`'s own comment says must never happen.
 *
 * The source is now `team_load_summary` through `getTeamLoad`, which is what
 * this tool's description has always promised: one row per person the caller
 * may see, carrying their counts, so "is the delay one person or a queue" is a
 * question the rows can actually answer. The previous source could not — it
 * listed `status = 'backlog'` work only, so a team whose work was all in
 * progress read as a team with nothing on.
 *
 * Visibility stays in the database. `team_load_summary` is RLS-scoped, so the
 * rows are the people this caller is permitted to see and no filtering is
 * repeated here. An empty result still means "manages nobody", and a failed
 * read throws, which the agent loop reports to the model as a failed tool
 * rather than as an empty one.
 */
const teamWorkload: AgentTool = {
  name: 'list_team_workload',
  description:
    'The team’s workload AS IT STANDS RIGHT NOW, one row per person the caller may see: work available to them, overdue, stale, open barriers, this week’s routines, decisions waiting on them. It holds no history — for what anybody DID over a week, a month or any past period, including "what have they achieved", use list_team_activity instead. Empty for somebody who manages nobody — that is an answer, not a failure.',
  schema: teamSchema,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run(input, caller) {
    parse(teamSchema, input, 'list_team_workload');
    const team = await getTeamLoad(caller.userId);
    const rows = team.map((person) => ({
      person: person.fullName,
      employee_id: person.employeeId,
      available_work: person.availableWorkCount,
      overdue: person.overdueCount,
      stale: person.staleCount,
      open_barriers: person.openBarrierCount,
      routines_this_week: person.routinesThisWeek,
      routines_completed_this_week: person.routinesCompletedThisWeek,
      routines_overdue: person.routinesOverdue,
      decisions_pending: person.decisionsPending,
    }));
    const capped = capRows(rows, AGENT_LIMITS.maxRowsPerTool);
    return {
      evidence: asEvidence('list_team_workload', capped),
      sources: [],
      rows: capped.shown,
    };
  },
};

const teamTasksSchema = z.object({
  scope: z.enum(['all', 'overdue', 'due_soon', 'blocked', 'in_review']).default('all'),
});

/**
 * v306 — the team's actual work, which nothing could see.
 *
 * The assistant was asked to help manage a team and could only count. Every
 * team tool returned FIGURES PER PERSON - four overdue, two stale, three
 * routines - and none returned a task. So "what is my team's workload this
 * week" had exactly one shape of answer available to it: rank the people by
 * their numbers and suggest chasing whoever is worst. It was not being
 * unhelpful. It was describing the only thing it had been shown.
 *
 * `getVisibleTeamTasks` is what the My Team screen reads: backlog, active and
 * paused work for everybody the caller may see, by the same `task_overview`
 * row-level security, ordered by due date. The data existed; nothing had put
 * it in front of the model.
 *
 * **The fields are chosen for a decision, not for a dashboard.** Due date and
 * overdue say when; urgency and mandatory say how much it matters; barriers
 * and delegated steps say what is in the way; checklist progress and evidence
 * say how much is left and what finishing requires; review status separates
 * "submitted" from "accepted", which a manager must not conflate. What is NOT
 * here is an effort estimate, because this product holds none - and a
 * recommendation built on an invented one is worse than no recommendation.
 *
 * Every row returned is also a source, so the table in an answer has a record
 * behind each line rather than a name the reader has to go and find.
 */
const teamTasks: AgentTool = {
  name: 'list_team_tasks',
  description:
    'The team’s actual open work, one row per TASK rather than per person: title, owner, status, due date, whether it is overdue or has gone stale, urgency, whether it is mandatory, progress, open barriers, delegated steps still owed, checklist progress, what completion requires as evidence, whether it is waiting on review, and THE LAST UPDATE ITS OWNER WROTE - who wrote it, when, and what it said. The update is usually the answer to "why has this not moved": a job with no progress for a fortnight whose last note says the part is on order is not the same as one nobody has touched. Use it for ANY question about the team’s workload, priorities, what to do first, who is overloaded, what can be postponed or what needs a decision — those are questions about work, and list_team_workload only holds counts. scope: all (default), overdue, due_soon (the next seven days), blocked (open barriers or overdue delegated steps), in_review (submitted and awaiting a decision). It holds no effort or duration estimate because the product records none.',
  schema: teamTasksSchema,
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['all', 'overdue', 'due_soon', 'blocked', 'in_review'],
        description: 'Which slice of the team’s open work to return',
      },
    },
    additionalProperties: false,
  },
  async run(input, caller) {
    const { scope } = parse(teamTasksSchema, input, 'list_team_tasks');
    const tasks = await getVisibleTeamTasks(caller.userId);

    const soon = Date.now() + 7 * 86_400_000;
    const matches = tasks.filter((task) => {
      if (scope === 'overdue') return task.isOverdue;
      if (scope === 'blocked') return task.openBarrierCount > 0 || task.delegatedOverdueCount > 0;
      if (scope === 'in_review') return task.reviewStatus === 'pending';
      if (scope === 'due_soon') {
        return task.dueAt ? new Date(task.dueAt).getTime() <= soon : false;
      }
      return true;
    });

    /*
     * Ordered for a decision rather than by date alone: what is already late
     * first, then what is mandatory, then by due date, so a truncated result
     * keeps the rows a manager would have wanted.
     */
    const ordered = [...matches].sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      if (a.isMandatory !== b.isMandatory) return a.isMandatory ? -1 : 1;
      const left = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const right = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return left - right;
    });

    const capped = capRows(ordered, AGENT_LIMITS.maxRowsPerTool);
    /*
     * v307 — what the owner last WROTE, not just when they last wrote.
     *
     * The rows already said "no update for twelve days", which tells a
     * manager that something is quiet and nothing about why. "Waiting on the
     * contractor's quote since 20 October" is the difference between a person
     * who is behind and a job blocked on somebody outside the team, and it is
     * the sentence a manager would have read first on the screen.
     *
     * One query for the rows being shown, after the cap rather than before,
     * so the narrative is fetched for twenty-five tasks and never five
     * hundred. Trimmed to 240 characters: enough for the situation, short of
     * letting one person's essay crowd out the other eight jobs.
     */
    const updates = await getLatestTaskUpdates(capped.rows.map((task) => task.id));
    const rows = capped.rows.map((task) => ({
      task: task.title,
      owner: task.ownerName,
      status: task.status,
      work_class: task.workClass,
      due: task.dueAt,
      overdue: task.isOverdue,
      stale_no_update: task.isStale,
      urgency: task.urgency,
      mandatory: task.isMandatory,
      progress_percent: task.progressPercent,
      open_barriers: task.openBarrierCount,
      delegated_steps_open: task.delegatedOpenCount,
      delegated_steps_overdue: task.delegatedOverdueCount,
      checklist: `${task.checklistCompleted}/${task.checklistTotal}`,
      evidence_required: task.completionEvidenceRule,
      evidence_attached: task.evidenceCount,
      awaiting_review: task.reviewStatus === 'pending',
      assigned_by: task.assignedByName,
      last_update: (() => {
        const update = updates.get(task.id);
        if (!update) return null;
        const words = update.body.replace(/\s+/g, ' ').trim();
        return {
          by: update.authorName,
          at: update.createdAt,
          said: words.length > 240 ? `${words.slice(0, 240)}…` : words,
        };
      })(),
    }));

    return {
      evidence: asEvidence('list_team_tasks', {
        scope,
        note: 'No effort, duration or capacity estimate exists in this product. Do not infer one.',
        ...capped,
        rows,
      }),
      sources: capped.rows.map((task) => taskSource(task.id, task.title)),
      rows: capped.shown,
    };
  },
};

const PERIOD_KEYS = ['7', '14', '30', '60', '90', 'this-month', 'last-month', 'all'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const activitySchema = z.object({
  period: z.enum(PERIOD_KEYS).default('7'),
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
});

/**
 * v303 — what the team actually did, which nothing could answer before.
 *
 * A head of department asked "tell me about my team load last week, what have
 * they achieved so far" and got a true but useless reply: a snapshot of right
 * now, and "I cannot establish last week's load from this record alone". It
 * was right. `team_load_summary` holds live counts and no history, so no
 * amount of prompting could have produced the answer — the data was not on
 * the table.
 *
 * It was on the table elsewhere. `getTeamActivity` is what the My Team screen
 * reads: audit events plus completions, over a period, scoped by the same
 * `getTeamLoad` every other team view uses, so this makes no new claim about
 * who may see whose work.
 *
 * **Aggregated per person rather than listed as events.** A week of six
 * people runs to hundreds of events and `maxRowsPerTool` is 25, so a raw list
 * would be truncated into a misleading sample - and the question is "what did
 * they achieve", which is a count and a few titles, not a log. People with no
 * recorded activity are returned with zeros rather than left out, because
 * "nobody recorded anything for X last week" is usually the finding.
 */
const teamActivity: AgentTool = {
  name: 'list_team_activity',
  description:
    'What each PERSON on the team did over a past period: work completed, contributions to others’ work, routines done, items submitted for review, progress updates, evidence added, barriers raised and resolved, plus the titles of what they completed. Use it ONLY when the question is about OTHER PEOPLE over a PAST period: "what has my team achieved", "how did last week go", "who has been quiet". Do not call it for what the caller should do or prioritise, for their own work, or for why one task or finding is late — those are answered from their task list and the finding register, and a step spent here is a step not spent reading the register. Period is one of 7, 14, 30, 60, 90, this-month, last-month, all (days back unless named), or give from and to as YYYY-MM-DD for an exact range such as one past week. A person with nothing recorded is returned with zeros.',
  schema: activitySchema,
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: [...PERIOD_KEYS],
        description: 'Days back, or a named period. Ignored when from/to are given.',
      },
      from: { type: 'string', description: 'Start date, YYYY-MM-DD, inclusive' },
      to: { type: 'string', description: 'End date, YYYY-MM-DD, inclusive' },
    },
    additionalProperties: false,
  },
  async run(input, caller) {
    const { period: key, from, to } = parse(activitySchema, input, 'list_team_activity');
    const period = resolvePeriod(
      from || to ? 'custom' : key,
      from,
      to,
      new Date(),
      '7',
      caller.timezone,
    );
    const activity = await getTeamActivity(caller.userId, period, caller.timezone);
    /*
     * Thrown, not reported as an empty week. The loop hands the model a
     * failed tool, which rule 9 obliges it to say out loud; returning zeros
     * would tell somebody their team did nothing.
     */
    if (activity.failed) throw new Error('TEAM_ACTIVITY_UNAVAILABLE');

    const tally = new Map<
      string,
      {
        person: string;
        completed: number;
        contributed: number;
        routines_done: number;
        submitted_for_review: number;
        progress_updates: number;
        evidence_added: number;
        barriers_raised: number;
        barriers_resolved: number;
        date_or_priority_changes: number;
        findings_raised: number;
        completed_titles: string[];
        last_activity: string | null;
      }
    >();
    for (const person of activity.team) {
      tally.set(person.userId, {
        person: person.fullName,
        completed: 0,
        contributed: 0,
        routines_done: 0,
        submitted_for_review: 0,
        progress_updates: 0,
        evidence_added: 0,
        barriers_raised: 0,
        barriers_resolved: 0,
        date_or_priority_changes: 0,
        findings_raised: 0,
        completed_titles: [],
        last_activity: null,
      });
    }

    /*
     * One person finishing one piece of work counts once.
     *
     * The source merges three queries, and a task can arrive from two of
     * them: `task_overview` as the owner's completion and
     * `completed_contributions` as that same person's contribution to it.
     * Counted naively, somebody who finished three tasks reads as having
     * finished six, and the titles list repeats itself - a figure a head of
     * department would take to a review. `getTeamActivityCount` has always
     * de-duplicated for exactly this reason ("one person on one task for an
     * afternoon is one card"), so this agrees with the screen rather than
     * inventing a second arithmetic.
     *
     * Ranked rather than first-wins, because the events arrive in query
     * order: completion outranks a routine occurrence, which outranks a
     * contribution, so the stronger description of the same work survives
     * whichever query reported it first.
     */
    const RANK: Record<string, number> = { completed: 3, routine: 2, contribution: 1 };
    const achievements = new Map<
      string,
      { personId: string; kind: string; event: ActivityEvent }
    >();

    const finished: SourceLink[] = [];
    for (const one of activity.events) {
      const row = tally.get(one.personId);
      if (!row) continue;
      if (RANK[one.kind]) {
        const key = `${one.personId}|${one.taskId}`;
        const held = achievements.get(key);
        if (!held || (RANK[one.kind] ?? 0) > (RANK[held.kind] ?? 0)) {
          achievements.set(key, { personId: one.personId, kind: one.kind, event: one });
        }
      } else if (one.kind === 'submitted') row.submitted_for_review += 1;
      else if (one.kind === 'step' || one.kind === 'note') row.progress_updates += 1;
      else if (one.kind === 'evidence') row.evidence_added += 1;
      else if (one.kind === 'blocked') row.barriers_raised += 1;
      else if (one.kind === 'unblocked') row.barriers_resolved += 1;
      else if (one.kind === 'due' || one.kind === 'priority') row.date_or_priority_changes += 1;
      else if (one.kind === 'finding') row.findings_raised += 1;
      /*
       * The latest, by comparison. The three queries are concatenated rather
       * than merged in time order, so "the first one seen" is whichever query
       * ran first - which would have reported a fortnight-old audit event as
       * somebody's most recent activity.
       */
      if (!row.last_activity || one.at > row.last_activity) row.last_activity = one.at;
    }

    for (const { personId, kind, event: one } of achievements.values()) {
      const row = tally.get(personId);
      if (!row) continue;
      if (kind === 'completed') row.completed += 1;
      else if (kind === 'routine') row.routines_done += 1;
      else row.contributed += 1;
      if (row.completed_titles.length < 4) row.completed_titles.push(one.taskTitle);
      if (finished.length < 8 && one.taskId) finished.push(taskSource(one.taskId, one.taskTitle));
    }

    const rows = [...tally.values()].sort(
      (a, b) =>
        b.completed +
          b.contributed +
          b.routines_done -
          (a.completed + a.contributed + a.routines_done) || a.person.localeCompare(b.person),
    );
    const capped = capRows(rows, AGENT_LIMITS.maxRowsPerTool);
    return {
      /*
       * The period travels with the rows. Without it the model has counts and
       * no range to attribute them to, and "last week" is exactly the thing
       * the answer has to be precise about.
       */
      evidence: asEvidence('list_team_activity', {
        period: period.label,
        since: period.since,
        until: period.until ?? 'now',
        ...capped,
      }),
      sources: finished,
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
  searchFindings,
  findingDetail,
  verificationQueue,
  hazardPatterns,
  /*
   * v304 — the team views come last, and the order is not cosmetic.
   *
   * Measured across three full runs: the finding register was read in six of
   * the sixteen scenarios that provide it, and `list_team_activity` was
   * called in two to four scenarios that do not need it - including "why are
   * six actions late" and "help me prepare for my review", where the answer
   * then missed the finding entirely. Adding a ninth tool made the register
   * harder to reach, which is a cost of the feature rather than a bug in it.
   *
   * Tool order is one of the few levers that does not spend prompt budget or
   * compete for the model's attention as another instruction. The register
   * and its detail are what most questions here need; the team views are for
   * the minority that ask about other people.
   */
  teamWorkload,
  teamTasks,
  teamActivity,
];

export function toolByName(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}

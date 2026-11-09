import 'server-only';

import {
  buildAiBrief,
  type AiBriefSnapshot,
  type BriefChecklistAction,
  type BriefFinding,
  type BriefTask,
  type SourceCoverage,
} from '@/domain/ai-brief';
import type { TaskOverview } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';
import { getEshAccess } from '@/server/esh/access';
import { listRegister } from '@/server/esh/queries';
import { getLatestTaskUpdates, getMyTasks, getVisibleTeamTasks } from '@/server/queries';

/**
 * Gathering the AI brief: the product's own reads, nothing more.
 *
 * v317. Every record in the brief arrives through a query the screens already
 * use, called with the caller's own client, so row-level security decides what
 * is in it exactly as it decides what is on screen. There is no service-role
 * client here and no new table: an export that could see more than the
 * exporter would be a permission bypass wearing a convenience feature's
 * clothes.
 *
 * A read that fails does not throw. The brief is a management document, and
 * one missing section is worth having with the gap named - whereas an error
 * page is worth nothing, and silently dropping the register would read as a
 * team with no findings. Every source reports its own coverage.
 */

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';

function taskLink(id: string): string | null {
  return APP_BASE ? `${APP_BASE}/work?task=${id}` : null;
}

function findingLink(id: string): string | null {
  return APP_BASE ? `${APP_BASE}/findings/${id}` : null;
}

/**
 * The open checklist actions on a set of tasks, with what each one needs.
 *
 * Read here rather than in `queries.ts` because this shape belongs to the
 * brief: the screens read a single task's checklist when somebody opens it,
 * and the assistant reads only the wording. This wants the wording plus the
 * state, the assignee, the date and the dependency, for every visible task at
 * once.
 *
 * `state <> 'completed'` is the product's own definition of a finished step -
 * `task_overview.checklist_completed` counts exactly that - so what comes back
 * always matches the open count on the row beside it.
 */
async function openChecklistActions(taskIds: readonly string[]): Promise<{
  actions: Map<string, BriefChecklistAction[]>;
  count: number;
  failure: string | null;
}> {
  const actions = new Map<string, BriefChecklistAction[]>();
  if (taskIds.length === 0) return { actions, count: 0, failure: null };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('task_checklist_items')
    .select('task_id, action, position, state, due_at, evidence_rule, depends_on_item_id')
    .in('task_id', [...taskIds])
    .neq('state', 'completed')
    .order('position', { ascending: true })
    .limit(1000);

  if (error) {
    console.error(`[ai-brief:checklist] ${error.code ?? 'unknown'}: ${error.message}`);
    return {
      actions,
      count: 0,
      failure:
        'The checklist actions could not be read, so the steps inside each task are missing.',
    };
  }

  let count = 0;
  for (const row of data ?? []) {
    const action = typeof row.action === 'string' ? row.action.trim() : '';
    if (!action) continue;
    const key = String(row.task_id);
    const held = actions.get(key) ?? [];
    held.push({
      action,
      state: String(row.state ?? 'open'),
      dueAt: row.due_at ? String(row.due_at) : null,
      evidenceRule: row.evidence_rule ? String(row.evidence_rule) : null,
      /*
       * Named as a dependency rather than resolved to the other step's words:
       * one more lookup per row, for a sentence the reader can already infer
       * from "waiting on another step". The id is there if they want it.
       */
      blockedBy: row.depends_on_item_id ? 'another step on this task' : null,
    });
    actions.set(key, held);
    count += 1;
  }
  return { actions, count, failure: null };
}

function asBriefTask(
  task: TaskOverview,
  actions: BriefChecklistAction[] | undefined,
  update: { authorName: string; body: string; createdAt: string } | undefined,
): BriefTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    owner: task.ownerName,
    status: task.status,
    workClass: task.workClass,
    urgency: task.urgency,
    mandatory: task.isMandatory,
    dueAt: task.dueAt,
    isOverdue: task.isOverdue,
    isStale: task.isStale,
    progressPercent: task.progressPercent,
    checklistCompleted: task.checklistCompleted,
    checklistTotal: task.checklistTotal,
    openBarrierCount: task.openBarrierCount,
    delegatedOpenCount: task.delegatedOpenCount,
    delegatedOverdueCount: task.delegatedOverdueCount,
    evidenceRule: task.completionEvidenceRule,
    reviewStatus: task.reviewStatus,
    assignedBy: task.assignedByName,
    link: taskLink(task.id),
    actions: actions ?? [],
    latestUpdate: update
      ? { author: update.authorName, at: update.createdAt.slice(0, 10), body: update.body }
      : null,
  };
}

export interface AiBriefResult {
  markdown: string;
  snapshot: AiBriefSnapshot;
}

export async function gatherAiBrief(): Promise<AiBriefResult> {
  const profile = await requireProfile();
  const takenAt = new Date();
  const coverage: SourceCoverage[] = [];

  /*
   * The two task reads run together; the register is asked for separately
   * because its access gate decides whether to ask at all.
   */
  const [teamResult, mineResult] = await Promise.allSettled([
    getVisibleTeamTasks(profile.id),
    getMyTasks(profile.id),
  ]);

  const teamTasks = teamResult.status === 'fulfilled' ? teamResult.value : [];
  const myTasks = mineResult.status === 'fulfilled' ? mineResult.value : [];

  const allIds = [...teamTasks, ...myTasks].map((task) => task.id);
  const [updateResult, checklistResult] = await Promise.allSettled([
    getLatestTaskUpdates(allIds),
    openChecklistActions(allIds),
  ]);

  const updates =
    updateResult.status === 'fulfilled' ? updateResult.value : new Map<string, never>();
  const checklist =
    checklistResult.status === 'fulfilled'
      ? checklistResult.value
      : {
          actions: new Map<string, BriefChecklistAction[]>(),
          count: 0,
          failure: 'The checklist actions could not be read.',
        };

  coverage.push({
    source: 'Team tasks (open)',
    included: teamTasks.length,
    available: teamTasks.length,
    failure:
      teamResult.status === 'rejected'
        ? 'The team task list could not be read. This is NOT the same as the team having no work.'
        : null,
  });
  coverage.push({
    source: 'My own work (open)',
    included: myTasks.length,
    available: myTasks.length,
    failure: mineResult.status === 'rejected' ? 'Your own task list could not be read.' : null,
  });
  coverage.push({
    source: 'Checklist actions (open)',
    included: checklist.count,
    failure: checklist.failure,
  });
  coverage.push({
    source: 'Latest employee updates',
    included: updates.size,
    available: allIds.length,
    note: `(one per task, where anybody has written one)`,
    failure:
      updateResult.status === 'rejected'
        ? 'The latest updates could not be read, so what people wrote is missing.'
        : null,
  });

  /*
   * The register, and the one thing a register row cannot tell you.
   *
   * `unprotected` is the product's own predicate for a high or critical
   * finding with nothing verified standing between people and the hazard. It
   * is asked as a second, narrower read of the same view rather than
   * recomputed here, so the brief and the ESH dashboard cannot disagree.
   */
  let findings: BriefFinding[] = [];
  let restrictedFindingsExcluded = 0;
  let eshUnavailable: string | null = null;

  const access = await getEshAccess().catch(() => null);
  if (!access) {
    eshUnavailable = 'the ESH access check could not be read, so the register was not asked for.';
    coverage.push({ source: 'ESH findings (open)', included: 0, failure: eshUnavailable });
  } else if (!access.enabled) {
    eshUnavailable = 'this account is not authorised for the ESH register.';
    coverage.push({
      source: 'ESH findings (open)',
      included: 0,
      note: '(not authorised for this account)',
    });
  } else {
    const closedSince = new Date(takenAt.getTime() - 180 * 86_400_000).toISOString();
    const [openResult, unprotectedResult] = await Promise.allSettled([
      listRegister({
        filter: 'open',
        search: '',
        departmentId: null,
        closedSince,
        closedUntil: null,
        page: 0,
      }),
      listRegister({
        filter: 'unprotected',
        search: '',
        departmentId: null,
        closedSince,
        closedUntil: null,
        page: 0,
      }),
    ]);

    const open = openResult.status === 'fulfilled' ? openResult.value : null;
    const unprotected = unprotectedResult.status === 'fulfilled' ? unprotectedResult.value : null;
    const unprotectedIds = new Set(
      unprotected && !unprotected.failed ? unprotected.rows.map((row) => row.findingId) : [],
    );

    if (!open || open.failed) {
      coverage.push({
        source: 'ESH findings (open)',
        included: 0,
        failure:
          'The findings register could not be read. Treat this as unknown: it reads exactly like ' +
          'a team with no findings, and it is not that.',
      });
    } else {
      /*
       * The product's own confidentiality rule, applied before anything is
       * counted. The finding form says a restricted finding is "kept out of
       * leadership reports and their counts", and this is such a report.
       */
      const visible = open.rows.filter((row) => !row.isRestricted);
      restrictedFindingsExcluded = open.rows.length - visible.length;

      findings = visible.map((row) => ({
        id: row.findingId,
        reference: row.reference,
        title: row.title,
        riskLevel: row.riskLevel,
        status: row.status,
        actionState: row.actionState,
        actionTitle: row.actionTitle,
        owner: row.ownerEmail,
        dueAt: row.dueAt,
        isOverdue: row.isOverdue,
        department: row.departmentName,
        hazard: row.hazardLabel,
        noVerifiedInterimControl: unprotectedIds.has(row.findingId),
        link: findingLink(row.findingId),
      }));

      coverage.push({
        source: 'ESH findings (open)',
        included: findings.length,
        available: open.total,
        note:
          restrictedFindingsExcluded > 0
            ? `(${restrictedFindingsExcluded} restricted finding(s) excluded by product rule)`
            : undefined,
      });
      coverage.push({
        source: 'Interim protection check',
        included: unprotectedIds.size,
        failure:
          !unprotected || unprotected.failed
            ? 'Whether a verified interim control is in place could not be read. For a high or ' +
              'critical finding, treat that as UNKNOWN and establish it before planning anything else.'
            : null,
        note:
          !unprotected || unprotected.failed
            ? undefined
            : '(significant findings with none verified)',
      });
    }
  }

  const snapshot: AiBriefSnapshot = {
    takenAt: takenAt.toISOString(),
    timezone: profile.timezone,
    preparedFor: profile.full_name,
    viewerRole: profile.role === 'team_member' ? 'team member view' : `${profile.role} view`,
    teamTasks: teamTasks.map((task) =>
      asBriefTask(task, checklist.actions.get(task.id), updates.get(task.id)),
    ),
    myTasks: myTasks.map((task) =>
      asBriefTask(task, checklist.actions.get(task.id), updates.get(task.id)),
    ),
    findings,
    coverage,
    restrictedFindingsExcluded,
    eshUnavailable,
  };

  return { markdown: buildAiBrief(snapshot), snapshot };
}

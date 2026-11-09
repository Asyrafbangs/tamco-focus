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
import { listRegister, REGISTER_PAGE_SIZE, type RegisterListRow } from '@/server/esh/queries';
import { getLatestTaskUpdatesComplete, listOpenTasksComplete } from '@/server/queries';

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
  /** Rows that arrived, whether or not they carried wording to include. */
  fetched: number;
  total: number;
  complete: boolean;
  failure: string | null;
}> {
  const actions = new Map<string, BriefChecklistAction[]>();
  if (taskIds.length === 0) {
    return { actions, count: 0, fetched: 0, total: 0, complete: true, failure: null };
  }

  const PAGE = 1000;
  const MAX_PAGES = 10;
  const supabase = await createSupabaseServerClient();
  let count = 0;
  let fetched = 0;
  let total = 0;
  let ranOut = false;

  for (let page = 0; page < MAX_PAGES && !ranOut; page += 1) {
    const from = page * PAGE;
    const {
      data,
      count: matched,
      error,
    } = await supabase
      .from('task_checklist_items')
      .select('id, task_id, action, position, state, due_at, evidence_rule, depends_on_item_id', {
        count: 'exact',
      })
      .in('task_id', [...taskIds])
      .neq('state', 'completed')
      .order('task_id', { ascending: true })
      .order('position', { ascending: true })
      /* Unique last key: `position` repeats across tasks, and ties would make
       * offset paging drop a step and duplicate another. */
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      console.error(`[ai-brief:checklist] ${error.code ?? 'unknown'}: ${error.message}`);
      return {
        actions,
        count,
        fetched,
        total,
        complete: false,
        failure:
          'The checklist actions could not be read, so the steps inside each task are missing.',
      };
    }

    if (matched !== null && matched !== undefined) total = matched;
    const rows = data ?? [];
    fetched += rows.length;

    for (const row of rows) {
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

    if (rows.length < PAGE) ranOut = true;
  }

  /* Measured against the count, not against the last page being small. */
  const counted = Math.max(total, fetched);
  return { actions, count, fetched, total: counted, complete: fetched >= counted, failure: null };
}

/**
 * v317 — the whole register for one filter, not its first page.
 *
 * `listRegister` is the screen's read and pages at fifty, which is right for
 * a screen and wrong for an export: a team with sixty open findings would
 * have had ten of them silently absent, and - worse - a high-risk finding on
 * page two would have been absent from the unprotected set and therefore
 * described in the brief as protected. The filter, the ordering and the
 * permission scope are unchanged; only the number of pages asked for is.
 *
 * `total` comes from the view's own exact count, so a short walk can be
 * reported as a number rather than guessed at.
 */
async function listRegisterComplete(
  filter: 'open' | 'unprotected',
  closedSince: string,
): Promise<{ rows: RegisterListRow[]; total: number; complete: boolean; failed: boolean }> {
  const MAX_PAGES = 20;
  const rows: RegisterListRow[] = [];
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listRegister({
      filter,
      search: '',
      departmentId: null,
      closedSince,
      closedUntil: null,
      page,
    });
    if (result.failed) return { rows, total, complete: false, failed: true };
    total = result.total;
    rows.push(...result.rows);
    /*
     * `complete` is measured against the counted total, never against the page
     * running short. A page can come back short while the count says there is
     * more - a row filtered out underneath us, a count taken a moment earlier
     * - and "the last page was small" is not evidence that nothing is missing.
     */
    if (result.rows.length < REGISTER_PAGE_SIZE || rows.length >= total) break;
  }

  const counted = Math.max(total, rows.length);
  return { rows, total: counted, complete: rows.length >= counted, failed: false };
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
    listOpenTasksComplete({ viewerId: profile.id, scope: 'team' }),
    listOpenTasksComplete({ viewerId: profile.id, scope: 'mine' }),
  ]);

  const team =
    teamResult.status === 'fulfilled' ? teamResult.value : { tasks: [], total: 0, complete: false };
  const mine =
    mineResult.status === 'fulfilled' ? mineResult.value : { tasks: [], total: 0, complete: false };
  const teamTasks = team.tasks;
  const myTasks = mine.tasks;

  const allIds = [...teamTasks, ...myTasks].map((task) => task.id);
  const [updateResult, checklistResult] = await Promise.allSettled([
    getLatestTaskUpdatesComplete(allIds),
    openChecklistActions(allIds),
  ]);

  const updateRead =
    updateResult.status === 'fulfilled'
      ? updateResult.value
      : { updates: new Map<string, never>(), unverified: allIds.length, failed: true };
  const updates = updateRead.updates;
  const checklist =
    checklistResult.status === 'fulfilled'
      ? checklistResult.value
      : {
          actions: new Map<string, BriefChecklistAction[]>(),
          count: 0,
          fetched: 0,
          total: 0,
          complete: false,
          failure: 'The checklist actions could not be read.',
        };

  coverage.push({
    source: 'Team tasks (open)',
    included: teamTasks.length,
    available: teamResult.status === 'fulfilled' ? team.total : undefined,
    failure:
      teamResult.status === 'rejected'
        ? 'The team task list could not be read. This is NOT the same as the team having no work.'
        : null,
  });
  coverage.push({
    source: 'My own work (open)',
    included: myTasks.length,
    available: mineResult.status === 'fulfilled' ? mine.total : undefined,
    failure: mineResult.status === 'rejected' ? 'Your own task list could not be read.' : null,
  });
  coverage.push({
    source: 'Checklist actions (open)',
    included: checklist.count,
    available: checklist.failure ? undefined : checklist.total,
    failure: checklist.failure,
    shortfall: checklist.failure
      ? null
      : !checklist.complete
        ? `${checklist.total - checklist.fetched} of ${checklist.total} open steps were not ` +
          `read, so the steps shown inside each task are not all of them.`
        : checklist.count < checklist.total
          ? `${checklist.total - checklist.count} of ${checklist.total} open steps carry no ` +
            `wording, so there is nothing in them to include.`
          : null,
  });
  coverage.push({
    source: 'Latest employee updates',
    included: updates.size,
    /*
     * Not `allIds.length`: that is the number of tasks asked about, not the
     * number that have anything written on them, and printing it as the
     * available total made a quiet team look like a failed read. When the walk
     * finishes, every task with an update has one here, and that - not a row
     * count - is what makes this figure verified.
     */
    available: updateRead.failed || updateRead.unverified > 0 ? undefined : updates.size,
    note: `(one per task, from ${allIds.length} task(s); tasks nobody has written on have none)`,
    failure: updateRead.failed
      ? 'The latest updates could not be read, so what people wrote is missing.'
      : null,
    shortfall:
      !updateRead.failed && updateRead.unverified > 0
        ? `${updateRead.unverified} task(s) could not be walked to the end, so whether anybody ` +
          `has written on them is unknown rather than no.`
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
      /*
       * Nought of nought, verified: this account may not look, so there is
       * nothing uncounted. Left undefined it would read "total not verified",
       * which would be a gap where there is only a permission boundary.
       */
      available: 0,
      note: '(not authorised for this account)',
    });
  } else {
    const closedSince = new Date(takenAt.getTime() - 180 * 86_400_000).toISOString();
    const [openResult, unprotectedResult] = await Promise.allSettled([
      listRegisterComplete('open', closedSince),
      listRegisterComplete('unprotected', closedSince),
    ]);

    const open = openResult.status === 'fulfilled' ? openResult.value : null;
    const unprotected = unprotectedResult.status === 'fulfilled' ? unprotectedResult.value : null;

    /*
     * The one place the confidentiality rule could have leaked back in.
     *
     * The register body drops restricted findings, but this set feeds the
     * interim-protection summary - a count, and the product's rule covers
     * "leadership reports and their counts" without exception. A restricted
     * finding left in here would be counted in the brief while being absent
     * from it, which is both a disclosure and an arithmetic that does not add
     * up. Filtered on the same predicate as the body, from the same field.
     */
    const unprotectedVisible =
      unprotected && !unprotected.failed ? unprotected.rows.filter((row) => !row.isRestricted) : [];
    const unprotectedRestricted =
      unprotected && !unprotected.failed ? unprotected.rows.length - unprotectedVisible.length : 0;
    const unprotectedIds = new Set(unprotectedVisible.map((row) => row.findingId));

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
        /*
         * The total with restricted findings taken out of it, because the
         * product's rule covers counts as well as content. The number dropped
         * is stated once, in the note, and appears in no other figure.
         */
        available: open.complete ? open.total - restrictedFindingsExcluded : undefined,
        shortfall: open.complete
          ? null
          : `The register walk stopped at its page ceiling: ${open.total - open.rows.length} of ` +
            `${open.total} open findings were not read.`,
        note:
          restrictedFindingsExcluded > 0
            ? `(${restrictedFindingsExcluded} restricted finding(s) excluded by product rule, ` +
              `from this count and from every other count in this brief)`
            : undefined,
      });

      const unprotectedRead = unprotected && !unprotected.failed ? unprotected : null;
      coverage.push({
        source: 'Interim protection check',
        included: unprotectedIds.size,
        available: unprotectedRead?.complete
          ? unprotectedRead.total - unprotectedRestricted
          : undefined,
        failure: unprotectedRead
          ? null
          : 'Whether a verified interim control is in place could not be read. For a high or ' +
            'critical finding, treat that as UNKNOWN and establish it before planning anything else.',
        shortfall:
          unprotectedRead && !unprotectedRead.complete
            ? `Only ${unprotectedRead.rows.length} of ${unprotectedRead.total} significant ` +
              `findings were checked for an interim control. Any finding below is therefore ` +
              `"not known to be unprotected", which is not the same as protected.`
            : null,
        note: unprotectedRead ? '(significant findings with none verified)' : undefined,
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

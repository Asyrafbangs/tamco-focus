'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { AttachmentPicker } from '@/components/ui/AttachmentPicker';
import { Modal } from '@/components/ui/Modal';
import { MenuDropdown } from '@/components/ui/MenuDropdown';
import { SideDrawer } from '@/components/ui/SideDrawer';
import { AttachmentViewer, canPreview } from './AttachmentViewer';
import { RoutineOutcomePanel } from './RoutineOutcomePanel';
import {
  ageChips,
  dueInputValue,
  formatCompactDuration,
  formatDue,
  overdueAgeMs,
} from '@/domain/duration';
import { barrierAction, barrierViewLabel } from '@/domain/barriers';
import {
  ACTIVATION_REASON_OPTIONS,
  canOfferActivate,
  canOfferMoveOut,
  validateActivationReason,
} from '@/domain/focus';
import {
  BARRIER_IMPACT_LABELS,
  TASK_STATUS_LABELS,
  WORK_CLASS_LABELS,
  type ActivationReason,
  type BarrierImpact,
  type OperationResult,
} from '@/domain/types';
import {
  addBarrierToMeetingQueue,
  cancelTask,
  deleteTask,
  updateTaskDetails,
  changeTaskDueDate,
  completeChecklistItem,
  completeChecklistItemWithEvidence,
  addChecklistStep,
  completeTask,
  convertQuickAction,
  decideCompletionReview,
  moveTaskToAvailable,
  postTaskUpdate,
  postBarrierResponse,
  raiseBarrier,
  removeChecklistStep,
  reassignTask,
  recordRoutineFinding,
  reopenChecklistItem,
  resolveBarrier,
  resumeTask,
  updateChecklistStep,
} from '@/server/actions/task-actions';
import type { TaskDetail, TaskDetailAttachment } from '@/server/queries';

import { BarrierActionPanel, type BarrierResponseKind } from './BarrierActionPanel';
import { BarrierDetailPanel } from './BarrierDetailPanel';
import { TaskActivityHistory } from './TaskActivityHistory';
import { TaskChecklistPanel } from './TaskChecklistPanel';
import { TaskRowActions } from './TaskRowActions';

interface TaskDetailDrawerProps {
  detail: TaskDetail;
  closeHref: string;
  timeZone: string;
  staleThresholdDays: number;
  /** Every active team member; empty when the viewer may not assign (v45 §1). */
  assignablePeople: Array<{ id: string; name: string; isPrimaryOwner: boolean }>;
  viewerId: string;
  /** Set when the viewer arrived from a notification or Needs Attention (v46 §3). */
  attentionBarrierId: string | null;
}

function idempotencyKey() {
  return crypto.randomUUID();
}

function formatMoment(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function formatClock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(value));
}

/** Master spec §16.4 — severity decides whether follow-up work is raised. */
const FINDING_SEVERITY_LABEL: Record<string, string> = {
  minor: 'Minor',
  significant: 'Significant',
  immediate_risk: 'Immediate risk',
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * Says which steps are blocking, not merely that something is.
 *
 * `complete_task` already returns the outstanding items and the steps whose
 * required evidence is missing, and the drawer threw that away and printed the
 * bare sentence. "This work cannot be completed yet" with nothing named is not
 * a refusal anybody can act on — least of all when the step in question is a
 * ticked-off one whose attachment was never added, which looks finished.
 */
function blockingDetail(result: { message: string; detail?: Record<string, unknown> }): string {
  const detail = result.detail ?? {};
  const asNames = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(String).filter(Boolean) : [];

  const incomplete = asNames(detail.incomplete_items);
  const missingEvidence = asNames(detail.missing_evidence);
  if (incomplete.length === 0 && missingEvidence.length === 0) return result.message;

  const parts: string[] = [];
  if (incomplete.length) parts.push(`still to do: ${incomplete.join(', ')}`);
  if (missingEvidence.length) parts.push(`needs evidence: ${missingEvidence.join(', ')}`);
  return `${result.message} ${parts.join('; ')}.`;
}

export function TaskDetailDrawer({
  detail,
  closeHref,
  timeZone,
  staleThresholdDays,
  assignablePeople,
  viewerId,
  attentionBarrierId,
}: TaskDetailDrawerProps) {
  const router = useRouter();
  const task = detail.task;
  const [pending, startTransition] = useTransition();
  /*
   * One drawer, three disclosures, at most one open.
   *
   * Tabs made the drawer three screens and forced a choice before anything was
   * visible: a person opening a task landed on Overview and had to know that
   * the work itself lived behind "Checklist". Sections say what is inside them
   * on their own summary line, so the choice is informed and closing one is the
   * same gesture as opening it.
   */
  const [openSection, setOpenSection] = useState<'steps' | 'updates' | 'details' | null>(null);
  const toggleSection = (section: 'steps' | 'updates' | 'details') =>
    setOpenSection((current) => (current === section ? null : section));
  // The composer is a disclosure of its own, opened by the button that names
  // it and closed by posting, so the drawer returns to its resting shape.
  const [composerOpen, setComposerOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const [ageInfoOpen, setAgeInfoOpen] = useState(false);
  const [dueEditorOpen, setDueEditorOpen] = useState(false);
  // Section I. Content only — there is deliberately no owner field here, so
  // this form cannot move accountability even by mistake. That is Reassign.
  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /*
   * One piece of state per dialog the ••• menu defers to. The menu itself now
   * holds no forms, so everything that needs typing or a confirmation has a
   * modal of its own and the panel never has to scroll.
   */
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? '');
  const [dueDateOnlyDraft, setDueDateOnlyDraft] = useState(task.dueIsDateOnly);
  const [dueDraft, setDueDraft] = useState(dueInputValue(task.dueAt, task.dueIsDateOnly, timeZone));
  const [evidenceDialog, setEvidenceDialog] = useState<{
    itemId: string;
    action: string;
    mode: 'attach' | 'complete';
  } | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  /*
   * The file being read, if any. Held here rather than in the attachment list
   * because it changes what the whole drawer is: full width, the file's name
   * in the header, and the task's own fields out of the way until it closes.
   */
  const [viewingFile, setViewingFile] = useState<TaskDetailAttachment | null>(null);
  const [taskVersion, setTaskVersion] = useState(task.version);
  const [resumeReason, setResumeReason] = useState<ActivationReason | null>(null);
  const [resumeNote, setResumeNote] = useState('');
  const [resumeNeedsReason, setResumeNeedsReason] = useState(false);
  const openBarrier = detail.barriers.find((item) => item.status === 'open');

  /*
   * v46 §40-41 — who is this barrier's problem right now?
   *
   * The same open barrier is three different situations depending on who is
   * looking: something I am waiting for, something waiting for me, or
   * background. Deriving it once here keeps the header, the panel and the
   * history from disagreeing about which of the three it is.
   */
  const myPendingBarrier =
    detail.barriers.find(
      (item) => item.status === 'open' && item.actionPending && item.actionRequiredFromViewer,
    ) ?? null;

  // Attention mode only holds if the request really is still outstanding for
  // this viewer. A stale link — already answered, or resolved while the email
  // sat unread — falls back to the ordinary task rather than presenting a form
  // for an action nobody needs.
  const attentionBarrier =
    (attentionBarrierId
      ? (detail.barriers.find(
          (item) =>
            item.id === attentionBarrierId &&
            item.status === 'open' &&
            item.actionPending &&
            item.actionRequiredFromViewer,
        ) ?? null)
      : null) ?? null;

  const actionableBarrier = attentionBarrier ?? myPendingBarrier;
  const inAttentionMode = attentionBarrier !== null;
  const [barrierPanelOpen, setBarrierPanelOpen] = useState(inAttentionMode);

  /*
   * v47 §3-4 — "View request" has to go somewhere.
   *
   * It previously scrolled to the Barriers heading, which on a task with three
   * barriers lands you at a list and asks you to find yours again. Naming the
   * barrier means the panel itself scrolls into view and takes focus.
   */
  const [revealedBarrierId, setRevealedBarrierId] = useState<string | null>(
    attentionBarrierId ?? null,
  );
  const checklistCompleted = detail.checklist.filter((item) => item.state === 'completed').length;
  const checklistRemaining = detail.checklist.length - checklistCompleted;
  const viewerStepsRemaining = detail.checklist.filter(
    (item) => item.state !== 'completed' && item.assignedTo === viewerId,
  ).length;
  const stepsSummary =
    detail.checklist.length === 0
      ? 'None yet — add one to break this down'
      : viewerStepsRemaining > 0
        ? `${viewerStepsRemaining} ${viewerStepsRemaining === 1 ? 'step needs' : 'steps need'} you`
        : checklistRemaining > 0
          ? `${checklistRemaining} remaining`
          : 'All steps complete';
  /*
   * Shown with no steps on it, for anybody who can add one.
   *
   * Hiding the section when the list was empty removed the only route to
   * creating a step, so work saved without one could never gain any - and the
   * commonest way to end up there is simply forgetting at capture. A
   * contributor still sees nothing, because an empty section they cannot act
   * on is the padding this rule was written to avoid.
   */
  const showSteps = detail.checklist.length > 0 || detail.capabilities.canEdit;
  /*
   * Updates are what a person chose to say. Evidence-only posts are the
   * by-product of attaching a file to a step and belong in the record, not in
   * a feed somebody is expected to read.
   */
  const writtenUpdates = detail.updates.filter(
    (update) => !update.isEvidenceOnly && update.body && update.body.trim().length > 0,
  );
  /*
   * What was attached to each update, beside the words it came with.
   *
   * The files were reachable only from Activity history, which is the record
   * rather than the reading list - so an update posted WITH a photo showed the
   * sentence and hid the photo, and the one place somebody would look for it
   * was the one place it was not.
   */
  const attachmentsByUpdate = new Map<string, TaskDetailAttachment[]>();
  for (const file of detail.attachments) {
    if (!file.updateId) continue;
    const held = attachmentsByUpdate.get(file.updateId) ?? [];
    held.push(file);
    attachmentsByUpdate.set(file.updateId, held);
  }
  const ownerName =
    detail.participants.find((person) => person.id === task.primaryOwnerId)?.fullName ??
    'Unassigned';
  /*
   * Finished work is a record, not a workspace.
   *
   * Opened from Completed, the drawer offered the whole working apparatus -
   * Add update, Need support, ticking steps - on something already delivered.
   * The procedures refuse most of it anyway; what somebody wants here is to
   * read what happened.
   */
  const isClosed = task.status === 'completed' || task.status === 'cancelled';
  /*
   * A routine occurrence is not a small piece of Focus work.
   *
   * Focus work runs for days and accumulates decisions, so it needs updates,
   * barriers and a next thing to do. An inspection, a site visit or a monthly
   * check has two honest outcomes - it was done, or it genuinely did not apply
   * this time - and everything else about it the system already knows. Putting
   * the general working apparatus on it turns a two-minute job into a form.
   */
  const isRoutineOccurrence = Boolean(task.routineTemplateId);
  /*
   * Mirrors what `complete_task` will accept, so the control appears exactly
   * when pressing it would succeed. The procedure refuses on incomplete
   * checklist steps and on required evidence with no attachment; it accepts
   * from active, backlog and paused.
   */
  const attachmentsByChecklist = new Map<string, number>();
  for (const attachment of detail.attachments) {
    if (attachment.checklistItemId) {
      attachmentsByChecklist.set(
        attachment.checklistItemId,
        (attachmentsByChecklist.get(attachment.checklistItemId) ?? 0) + 1,
      );
    }
  }

  /*
   * Required evidence is judged on the attachment, not on the tick.
   *
   * This used to count only items that were still open, while `complete_task`
   * counts every item marked `evidence_rule = 'required'` that carries no
   * attachment — completed or not. A step ticked off without its evidence
   * therefore looked finished here and was refused there, so Mark done was
   * offered, pressed, and answered with a flat "This work cannot be completed
   * yet" that named nothing.
   */
  const evidenceOutstanding = detail.checklist.filter(
    (item) => item.evidenceRule === 'required' && !attachmentsByChecklist.get(item.id),
  );
  const checklistOutstanding = detail.checklist.length - checklistCompleted;

  /*
   * Why this cannot be marked done, in words, before anybody presses anything.
   *
   * The refusal used to arrive only after the click, as "This work cannot be
   * completed yet" with nothing named. Somebody looking at a Quick Action with
   * no checklist on screen had no way to know a checklist existed, let alone
   * which step was unfinished — the Quick Action panel hides checklists by
   * design, so the blocking steps were invisible and the work was stuck for
   * good.
   */
  const completionBlockers: string[] = [
    ...detail.checklist
      .filter((item) => item.state !== 'completed')
      .map((item) => `“${item.action}” is not finished`),
    ...detail.checklist
      .filter((item) => item.evidenceRule === 'required' && !attachmentsByChecklist.get(item.id))
      .map((item) => `“${item.action}” needs evidence attached`),
  ];

  const readyToComplete =
    detail.capabilities.canComplete &&
    (task.status === 'active' || task.status === 'backlog' || task.status === 'paused') &&
    checklistOutstanding === 0 &&
    evidenceOutstanding.length === 0;

  const taskOverdueMs = overdueAgeMs(task);
  const ageDetails = ageChips(task, { staleThresholdDays });

  /**
   * The one place a barrier response is submitted (v46 §29, §52).
   *
   * Every entry route — notification, My Day, My Team, opening the task — ends
   * here, so the transaction rules, the wording and the revalidation cannot
   * differ by how somebody arrived.
   */
  function respondToBarrier(barrierId: string, text: string, kind: BarrierResponseKind) {
    setMessage(null);
    startTransition(async () => {
      const result = await postBarrierResponse({
        barrierId,
        message: text,
        kind,
        idempotencyKey: idempotencyKey(),
      });
      if (finish(result, 'Response sent. The barrier stays open.')) {
        setBarrierPanelOpen(false);
      }
    });
  }

  function queueBarrier(barrierId: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await addBarrierToMeetingQueue({
        barrierId,
        idempotencyKey: idempotencyKey(),
      });
      finish(
        result,
        result.code === 'meeting_queue_item_exists'
          ? 'Already in the Meeting Queue.'
          : 'Added to the Meeting Queue.',
      );
    });
  }

  /*
   * v47 §3, §65 — "View request" has to actually show the request.
   *
   * The collapsed drawer hides every overview section, Barriers included, as
   * deliberate progressive disclosure. That made this button scroll to
   * something with `display: none` — it appeared to do nothing at all, which is
   * the one outcome a visible control may never have. Asking to see the request
   * is a good enough reason to open the drawer that contains it.
   */
  function revealBarrier(barrierId: string) {
    setDrawerExpanded(true);
    /*
     * v84 moved Barriers inside Details, which is closed by default - so this
     * marked a record that was never rendered and the button did nothing at
     * all. Asking to see the request is reason enough to open the section that
     * holds it.
     */
    setOpenSection('details');
    setRevealedBarrierId(barrierId);
    requestAnimationFrame(() => {
      document.getElementById('barriers-heading')?.scrollIntoView({ block: 'center' });
    });
  }

  function finish(result: OperationResult, success: string) {
    if (result.ok) {
      setMessage({ tone: 'success', text: success });
      router.refresh();
      return true;
    }
    setMessage({ tone: 'error', text: blockingDetail(result) });
    return false;
  }

  function submitUpdate(form: HTMLFormElement) {
    const data = new FormData(form);
    data.set('taskId', task.id);
    data.set('idempotencyKey', idempotencyKey());

    /*
     * v43 sections 12, 26, 27.
     *
     * An update says what changed and nothing else — it can no longer carry a
     * next action, so posting one cannot quietly rewrite the plan.
     *
     * Evidence-only is inferred rather than declared: files with no words is
     * what an evidence-only update IS, and asking somebody to also tick a box
     * saying so was asking them to classify their own bookkeeping.
     */
    const body = String(data.get('body') ?? '').trim();
    const hasFiles = data.getAll('files').some((value) => value instanceof File && value.size > 0);
    data.delete('nextAction');
    if (!body && hasFiles) data.set('evidenceOnly', 'true');

    setMessage(null);
    startTransition(async () => {
      const result = await postTaskUpdate(data);
      if (finish(result, !body && hasFiles ? 'Evidence added.' : 'Update posted.')) {
        setTaskVersion((current) => current + 1);
        form.reset();
        // Posting is the end of the errand, so the composer folds away and the
        // drawer returns to its resting shape.
        setComposerOpen(false);
      }
    });
  }

  function openDueEditor() {
    setDueDateOnlyDraft(task.dueIsDateOnly);
    setDueDraft(dueInputValue(task.dueAt, task.dueIsDateOnly, timeZone));
    setDueEditorOpen(true);
  }

  function attachChecklistEvidence(form: HTMLFormElement, checklistItemId: string) {
    const data = new FormData(form);
    data.set('taskId', task.id);
    data.set('checklistItemId', checklistItemId);
    data.set('evidenceOnly', 'true');
    data.set('idempotencyKey', idempotencyKey());
    setMessage(null);
    startTransition(async () => {
      const result = await postTaskUpdate(data);
      if (finish(result, 'Evidence attached.')) {
        form.reset();
        setEvidenceDialog(null);
      }
    });
  }

  function completeRequiredChecklistItem(form: HTMLFormElement, checklistItemId: string) {
    const data = new FormData(form);
    data.set('taskId', task.id);
    data.set('itemId', checklistItemId);
    data.set('idempotencyKey', idempotencyKey());
    setMessage(null);
    startTransition(async () => {
      const result = await completeChecklistItemWithEvidence(data);
      if (finish(result, 'Evidence saved and checklist item completed.')) {
        form.reset();
        setEvidenceDialog(null);
      }
    });
  }

  /*
   * Moving work back to Available is a single, reversible step with nothing to
   * ask, so it runs straight from the menu rather than opening a dialog. The
   * menu closes itself on any click inside it, so the feedback lands on the
   * drawer where the rest of it does.
   */
  function runMoveToAvailable() {
    setMessage(null);
    startTransition(async () => {
      const result = await moveTaskToAvailable({
        taskId: task.id,
        expectedVersion: taskVersion,
        idempotencyKey: idempotencyKey(),
      });
      if (finish(result, 'Moved to Available. The work is still yours to pick up.')) {
        setTaskVersion((current) => current + 1);
      }
    });
  }

  function runResume() {
    const validation = resumeNeedsReason
      ? validateActivationReason(resumeReason, resumeNote)
      : { valid: true as const };
    if (!validation.valid) {
      setMessage({ tone: 'error', text: validation.message });
      return;
    }
    startTransition(async () => {
      const result = await resumeTask({
        taskId: task.id,
        expectedVersion: task.version,
        reasonCode: resumeReason,
        reasonNote: resumeNote || null,
        idempotencyKey: idempotencyKey(),
      });
      if (!result.ok && result.code === 'reason_required') {
        setResumeNeedsReason(true);
        setMessage({ tone: 'error', text: result.message });
        return;
      }
      finish(result, 'Work resumed.');
    });
  }

  /*
   * v40 section 10 — a Quick Action is a same-day errand with no focus slot.
   * It gets a small screen: what it is, when it is due, and Mark done. Barriers,
   * checklists, the updates feed, next-action management and the evidence
   * ecosystem all belong to sustained work, and showing them here taught people
   * that a two-minute errand carries the same governance as a project.
   *
   * When an errand turns out not to be one, the answer is Convert, not a bigger
   * Quick Action.
   */
  if (task.workClass === 'quick_action' && task.status !== 'completed') {
    return (
      <SideDrawer
        closeHref={closeHref}
        closeLabel="Close task detail"
        className="task-detail-drawer quick-action-drawer"
        eyebrow="Quick Action"
        title={task.title}
        titleId="task-detail-title"
      >
        <div className="task-detail-scroll">
          {message && (
            <div
              className={`notice ${message.tone === 'error' ? 'error' : 'success'}`}
              role="status"
            >
              <p>{message.text}</p>
            </div>
          )}

          <div className="quick-action-facts">
            <span className="pill">{formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}</span>
            <span className="pill">No focus slot</span>
          </div>

          {completionBlockers.length > 0 && (
            <div className="notice warning completion-blockers" role="status">
              <strong>This cannot be marked done yet</strong>
              <ul>
                {completionBlockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p>
                A Quick Action does not show steps, because it is meant to be a single errand.
                Convert it to an Operational Action below to work through them, and it can be
                completed from there.
              </p>
            </div>
          )}

          <div className="quick-action-primary">
            {/* Disabled rather than hidden: the errand still has one obvious
                action, and removing it would leave the panel looking as though
                completing were somebody else's job. The reasons are listed
                immediately above, so the disabled state is explained. */}
            <button
              type="button"
              className="btn primary"
              disabled={pending || completionBlockers.length > 0}
              aria-busy={pending}
              onClick={() => {
                setMessage(null);
                startTransition(async () => {
                  const result = await completeTask({
                    taskId: task.id,
                    expectedVersion: Math.max(taskVersion, task.version),
                    idempotencyKey: idempotencyKey(),
                  });
                  if (finish(result, 'Quick Action completed.')) {
                    router.push(closeHref);
                  }
                });
              }}
            >
              Mark done
            </button>
          </div>

          <details className="quick-action-secondary">
            <summary>Something changed?</summary>
            <p>
              If this now needs several days, evidence, collaboration, coordination or continued
              follow-up, it is no longer a Quick Action. Converting it moves it to Available as an
              Operational Action, with the full workflow — and you decide when to activate it.
            </p>
            <div className="field">
              <label htmlFor="quick-due">Edit due date</label>
              <div className="actions">
                <input
                  id="quick-due"
                  type="date"
                  value={dueDraft}
                  onChange={(event) => setDueDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="btn small"
                  disabled={pending || !dueDraft}
                  aria-busy={pending || !dueDraft}
                  onClick={() => {
                    setMessage(null);
                    startTransition(async () => {
                      const result = await changeTaskDueDate({
                        taskId: task.id,
                        expectedVersion: Math.max(taskVersion, task.version),
                        dueValue: dueDraft,
                        dueIsDateOnly: true,
                        idempotencyKey: idempotencyKey(),
                      });
                      if (finish(result, 'Due date updated.') && result.ok && result.version) {
                        setTaskVersion(result.version);
                      }
                    });
                  }}
                >
                  Save date
                </button>
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn small"
                disabled={pending}
                aria-busy={pending}
                onClick={() => {
                  setMessage(null);
                  startTransition(async () => {
                    const result = await convertQuickAction({
                      taskId: task.id,
                      expectedVersion: Math.max(taskVersion, task.version),
                      idempotencyKey: idempotencyKey(),
                    });
                    if (
                      finish(result, 'Converted. It is now in Available as an Operational Action.')
                    ) {
                      router.push('/work?tab=available');
                    }
                  });
                }}
              >
                Convert to Operational Action
              </button>
            </div>
          </details>
        </div>
      </SideDrawer>
    );
  }

  return (
    <SideDrawer
      closeHref={closeHref}
      closeLabel="Close task detail"
      className={`task-detail-drawer${drawerExpanded ? ' expanded' : ''}${
        viewingFile ? ' viewing-file' : ''
      }`}
      eyebrow={viewingFile ? 'Attachment' : WORK_CLASS_LABELS[task.workClass]}
      title={viewingFile ? viewingFile.fileName : task.title}
      titleId="task-detail-title"
      actions={
        viewingFile ? (
          <>
            {/* Reading it in the page does not stop anybody wanting a copy. */}
            <a
              className="btn small"
              href={`/api/attachments/${viewingFile.id}`}
              download={viewingFile.fileName}
            >
              Download
            </a>
            <button type="button" className="btn small ghost" onClick={() => setViewingFile(null)}>
              Collapse
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn small ghost drawer-expand-toggle"
            aria-pressed={drawerExpanded}
            onClick={() => setDrawerExpanded((current) => !current)}
          >
            {drawerExpanded ? 'Restore' : 'Expand'}
          </button>
        )
      }
    >
      {/* The task's own fields are not hidden with CSS but simply not
          rendered: a file is being read, and everything else on the screen is
          a different subject. Collapsing brings them back untouched - the
          composer and its draft live above this point, so nothing holding
          unsaved work is unmounted. */}
      {viewingFile && (
        <AttachmentViewer
          key={viewingFile.id}
          file={viewingFile}
          onClose={() => setViewingFile(null)}
        />
      )}

      <div className="task-detail-scroll" hidden={Boolean(viewingFile)}>
        {/*
          v46 §5, §38-42 — the barrier surface, and only one of them at a time.

          This used to say "Barrier open", quote the description, and offer
          "Raise barrier" beside it — which invited somebody to raise a second
          barrier about the problem they were already looking at. What a person
          needs here depends entirely on whether the barrier is waiting for
          them, and that is what decides which of these appears.
        */}
        {actionableBarrier ? (
          <section className="barrier-exception owed" aria-label="Action required">
            <div className="barrier-exception-copy">
              <strong>
                <span aria-hidden="true">🔴</span>{' '}
                {barrierAction(actionableBarrier.actionType).noun} needed from you
              </strong>
              <p>
                {actionableBarrier.raisedByName} is waiting for your{' '}
                {barrierAction(actionableBarrier.actionType).noun.toLowerCase()}.
              </p>
            </div>
            {!barrierPanelOpen && (
              <button
                type="button"
                className="btn small primary"
                onClick={() => setBarrierPanelOpen(true)}
              >
                Respond
              </button>
            )}
          </section>
        ) : openBarrier ? (
          <section className="barrier-exception waiting" aria-label="Barrier status">
            <div className="barrier-exception-copy">
              <strong>
                <span aria-hidden="true">{openBarrier.actionPending ? '🟠' : '✓'}</span>{' '}
                {openBarrier.actionPending
                  ? `Waiting for ${openBarrier.actionRequiredFromName ?? 'a response'}`
                  : `${barrierAction(openBarrier.actionType).answeredHeadline}${
                      openBarrier.actionRequiredFromName
                        ? ` from ${openBarrier.actionRequiredFromName}`
                        : ''
                    }`}
              </strong>
              {/*
                v47 §33-36 — say which of four situations this is. "Waiting"
                alone leaves the person who asked with no way to tell whether
                anybody has picked it up, and therefore no way to decide
                whether to chase it today.
              */}
              <p>
                {openBarrier.actionPending && openBarrier.scheduledDiscussionAt
                  ? `Discussion scheduled: ${formatMoment(openBarrier.scheduledDiscussionAt, timeZone)}`
                  : openBarrier.actionPending && openBarrier.inMeetingQueue
                    ? `${barrierAction(openBarrier.actionType).noun} will be discussed — in the Meeting Queue`
                    : `${barrierAction(openBarrier.actionType).noun} requested: ${openBarrier.supportNeeded}`}
              </p>
              {!openBarrier.actionPending && <p>The barrier remains open.</p>}
            </div>
            <button
              type="button"
              className="btn small"
              onClick={() => revealBarrier(openBarrier.id)}
            >
              {barrierViewLabel(openBarrier.responses.length > 0, openBarrier.actionPending)}
            </button>
          </section>
        ) : null}

        {/*
          §10, §41 — the requested action, before anything else on the screen.
          Arriving from a notification, the response box is already here and
          already focused; there is no second click to find it.
        */}
        {actionableBarrier && barrierPanelOpen && (
          <BarrierActionPanel
            barrier={actionableBarrier}
            requesterName={actionableBarrier.raisedByName}
            timeZone={timeZone}
            pending={pending}
            autoFocus={inAttentionMode}
            inMeetingQueue={actionableBarrier.inMeetingQueue}
            onRespond={(text, kind) => respondToBarrier(actionableBarrier.id, text, kind)}
            onAddToMeetingQueue={() => queueBarrier(actionableBarrier.id)}
          />
        )}

        <Modal
          open={ageInfoOpen}
          title="Task-age indicators"
          className="task-age-modal"
          onClose={() => setAgeInfoOpen(false)}
        >
          <div className="modal-head">
            <div>
              <strong>Task-age indicators</strong>
              <span>How the compact duration indicators are calculated.</span>
            </div>
            <button
              type="button"
              className="btn small"
              aria-label="Close task-age indicators"
              onClick={() => setAgeInfoOpen(false)}
            >
              &times;
            </button>
          </div>
          <div className="modal-body task-age-explanation">
            {ageDetails.map((age) => (
              <div key={age.label} className="task-age-explanation-row">
                <strong>{age.label}</strong>
                <span>{age.explanation}</span>
              </div>
            ))}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn primary" onClick={() => setAgeInfoOpen(false)}>
              Understood
            </button>
          </div>
        </Modal>

        <Modal
          open={completeOpen}
          title="Complete task"
          className="task-due-modal"
          onClose={() => setCompleteOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await completeTask({
                  taskId: task.id,
                  expectedVersion: Math.max(taskVersion, task.version),
                  completionNote: String(data.get('completionNote') ?? '') || null,
                  idempotencyKey: idempotencyKey(),
                });
                if (finish(result, 'Completion recorded.')) setCompleteOpen(false);
              });
            }}
          >
            <div className="modal-head">
              <div>
                <strong>Complete task</strong>
                <span>This records the result and closes the work.</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close completion form"
                onClick={() => setCompleteOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor={`complete-note-${task.id}`}>Completion note — optional</label>
                <textarea id={`complete-note-${task.id}`} name="completionNote" rows={3} />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setCompleteOpen(false)}>
                Not yet
              </button>
              <button type="submit" className="btn primary" disabled={pending} aria-busy={pending}>
                {pending ? 'Completing…' : 'Complete task'}
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          open={deleteOpen}
          title="Move to Bin"
          className="task-due-modal"
          onClose={() => setDeleteOpen(false)}
        >
          <div>
            <div className="modal-head">
              <div>
                <strong>Move this work to the Bin?</strong>
                <span>Use this when the work was created by mistake.</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close the Bin confirmation"
                onClick={() => setDeleteOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="notice" role="status">
                <p>
                  This is for work that should never have existed — a duplicate, or something
                  captured by mistake. If the work was real and is simply not going ahead,{' '}
                  <strong>cancel it instead</strong>, so the reason stays on the record.
                </p>
              </div>
              <p className="muted">
                You can restore it later. Its history, checklist and attachments are kept, and
                nothing is removed permanently.
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setDeleteOpen(false)}>
                Back
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={pending}
                aria-busy={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await deleteTask({
                      taskId: task.id,
                      expectedVersion: Math.max(taskVersion, task.version),
                      idempotencyKey: idempotencyKey(),
                    });
                    if (finish(result, 'Moved to the Bin.')) setDeleteOpen(false);
                  });
                }}
              >
                {pending ? 'Moving…' : 'Move to Bin'}
              </button>
            </div>
          </div>
        </Modal>

        {/*
          Cancel, Reassign and Resume each used to be a form inside the •••
          menu, which is what made that panel scroll and what put a reason
          textarea next to a delete button. Each is now a dialog: one question,
          asked where it is being answered, with the work it applies to named
          so nobody acts on the wrong task.
        */}
        <Modal
          open={cancelOpen}
          title="Cancel work"
          className="task-due-modal"
          onClose={() => setCancelOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const reason = String(new FormData(form).get('cancelReason') ?? '');
              setMessage(null);
              startTransition(async () => {
                if (
                  finish(
                    await cancelTask({
                      taskId: task.id,
                      expectedVersion: taskVersion,
                      reason,
                      idempotencyKey: idempotencyKey(),
                    }),
                    'Work cancelled. It stays on the record with your reason.',
                  )
                ) {
                  form.reset();
                  setTaskVersion((current) => current + 1);
                  setCancelOpen(false);
                }
              });
            }}
          >
            <div className="modal-head">
              <div>
                <strong>Cancel this work?</strong>
                <span>{task.title}</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close the cancellation dialog"
                onClick={() => setCancelOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor={`cancel-${task.id}`}>Why is this work no longer needed?</label>
                <textarea id={`cancel-${task.id}`} name="cancelReason" rows={3} required />
              </div>
              <p className="muted">
                The work stays in history with your reason. Use this when it was right to create but
                should not go ahead.
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setCancelOpen(false)}>
                Back
              </button>
              <button type="submit" className="btn danger" disabled={pending} aria-busy={pending}>
                {pending ? 'Cancelling…' : 'Cancel work'}
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          open={reassignOpen}
          title="Reassign owner"
          className="task-due-modal"
          onClose={() => setReassignOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const newOwnerId = String(new FormData(form).get('newOwnerId') ?? '');
              if (!newOwnerId) return;
              setMessage(null);
              startTransition(async () => {
                const result = (await reassignTask({
                  taskId: task.id,
                  expectedVersion: taskVersion,
                  newOwnerId,
                  idempotencyKey: idempotencyKey(),
                })) as OperationResult<{
                  workload_review_needed?: boolean;
                  active_count?: number;
                  recommended_target?: number;
                  status?: string;
                }>;
                const success =
                  result.ok && result.workload_review_needed
                    ? `Owner changed. Work remains ${result.status ?? task.status}; workload review needed (${result.active_count ?? 'over'}/${result.recommended_target ?? 'target'} Active).`
                    : `Owner changed. Work remains ${result.ok ? (result.status ?? task.status) : task.status}.`;
                if (finish(result, success)) {
                  setTaskVersion((current) => current + 1);
                  setReassignOpen(false);
                }
              });
            }}
          >
            <div className="modal-head">
              <div>
                <strong>Change the primary owner</strong>
                <span>{task.title}</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close the reassignment dialog"
                onClick={() => setReassignOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor={`reassign-${task.id}`}>Who should carry this work?</label>
                <select id={`reassign-${task.id}`} name="newOwnerId" defaultValue="">
                  <option value="">Choose a person</option>
                  {assignablePeople
                    .filter((person) => person.id !== task.primaryOwnerId)
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setReassignOpen(false)}>
                Back
              </button>
              <button type="submit" className="btn primary" disabled={pending} aria-busy={pending}>
                {pending ? 'Reassigning…' : 'Reassign work'}
              </button>
            </div>
          </form>
        </Modal>

        {/*
          Resume exists because work paused before this change has to stay
          recoverable. Pause itself is gone from the menu — "not carrying this"
          and "carrying it but not working on it" cost more to explain than the
          distinction was worth — but nothing may strand a task already paused.
        */}
        <Modal
          open={resumeOpen}
          title="Resume work"
          className="task-due-modal"
          onClose={() => setResumeOpen(false)}
        >
          <div>
            <div className="modal-head">
              <div>
                <strong>Resume this work?</strong>
                <span>{task.title}</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close the resume dialog"
                onClick={() => setResumeOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              {resumeNeedsReason && (
                <>
                  <div className="field">
                    <label htmlFor={`resume-reason-${task.id}`}>
                      Why is this additional focus needed now?
                    </label>
                    <select
                      id={`resume-reason-${task.id}`}
                      value={resumeReason ?? ''}
                      onChange={(event) =>
                        setResumeReason((event.target.value || null) as ActivationReason | null)
                      }
                    >
                      <option value="">Select a reason</option>
                      {ACTIVATION_REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {resumeReason === 'other' && (
                    <div className="field">
                      <label htmlFor={`resume-note-${task.id}`}>Add a short note</label>
                      <textarea
                        id={`resume-note-${task.id}`}
                        value={resumeNote}
                        onChange={(event) => setResumeNote(event.target.value)}
                        rows={2}
                      />
                    </div>
                  )}
                </>
              )}
              <p className="muted">It returns to your Active work.</p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setResumeOpen(false)}>
                Back
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={runResume}
                disabled={pending}
                aria-busy={pending}
              >
                {pending ? 'Resuming…' : 'Resume work'}
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          open={editOpen}
          title="Edit task"
          className="task-due-modal"
          onClose={() => setEditOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await updateTaskDetails({
                  taskId: task.id,
                  expectedVersion: Math.max(taskVersion, task.version),
                  title: titleDraft.trim(),
                  description: descriptionDraft.trim() || null,
                  idempotencyKey: idempotencyKey(),
                });
                if (finish(result, 'Task updated and added to Recent activity.')) {
                  // The procedure returns `unchanged` without bumping the
                  // version when nothing actually differs, so tracking it
                  // optimistically has to respect that or the next edit would
                  // fail a version check that was never really out of date.
                  setTaskVersion((current) =>
                    result.ok && result.code !== 'unchanged' ? current + 1 : current,
                  );
                  setEditOpen(false);
                }
              });
            }}
          >
            <div className="modal-head">
              <div>
                <strong>Edit task</strong>
                <span>Changing who owns this is a separate action.</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close task editor"
                onClick={() => setEditOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor={`edit-title-${task.id}`}>Title</label>
                <input
                  id={`edit-title-${task.id}`}
                  value={titleDraft}
                  maxLength={200}
                  required
                  onChange={(event) => setTitleDraft(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`edit-description-${task.id}`}>Details</label>
                <textarea
                  id={`edit-description-${task.id}`}
                  value={descriptionDraft}
                  rows={5}
                  maxLength={4000}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={pending || titleDraft.trim().length === 0}
                aria-busy={pending}
              >
                {pending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          open={dueEditorOpen}
          title="Edit due date"
          className="task-due-modal"
          onClose={() => setDueEditorOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const reason = String(new FormData(form).get('reason') ?? '').trim();
              startTransition(async () => {
                const result = await changeTaskDueDate({
                  taskId: task.id,
                  expectedVersion: Math.max(taskVersion, task.version),
                  dueValue: dueDraft,
                  dueIsDateOnly: dueDateOnlyDraft,
                  reason: reason || null,
                  idempotencyKey: idempotencyKey(),
                });
                if (finish(result, 'Due date changed and added to Recent activity.')) {
                  setTaskVersion((current) =>
                    result.ok ? (result.version ?? current + 1) : current,
                  );
                  setDueEditorOpen(false);
                }
              });
            }}
          >
            <div className="modal-head">
              <div>
                <strong>Edit due date</strong>
                <span>The previous commitment remains in task history.</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close due-date editor"
                onClick={() => setDueEditorOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body due-date-form">
              <div className="due-current-value">
                <span>Current due date</span>
                <strong>{formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}</strong>
              </div>
              <div className="field">
                <label htmlFor={`due-type-${task.id}`}>Commitment type</label>
                <select
                  id={`due-type-${task.id}`}
                  value={dueDateOnlyDraft ? 'date' : 'datetime'}
                  onChange={(event) => {
                    const dateOnly = event.target.value === 'date';
                    setDueDateOnlyDraft(dateOnly);
                    setDueDraft(dueInputValue(task.dueAt, dateOnly, timeZone));
                  }}
                >
                  <option value="date">Date only</option>
                  <option value="datetime">Date and time</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`new-due-${task.id}`}>New due date</label>
                <input
                  id={`new-due-${task.id}`}
                  type={dueDateOnlyDraft ? 'date' : 'datetime-local'}
                  value={dueDraft}
                  onChange={(event) => setDueDraft(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor={`due-reason-${task.id}`}>Reason (optional)</label>
                <textarea id={`due-reason-${task.id}`} name="reason" rows={2} maxLength={1000} />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setDueEditorOpen(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={pending || !dueDraft}
                aria-busy={pending || !dueDraft}
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          open={Boolean(evidenceDialog)}
          title={evidenceDialog?.mode === 'complete' ? 'Complete with evidence' : 'Add evidence'}
          className="checklist-evidence-modal"
          onClose={() => setEvidenceDialog(null)}
        >
          <form
            key={evidenceDialog ? `${evidenceDialog.itemId}-${evidenceDialog.mode}` : 'closed'}
            onSubmit={(event) => {
              event.preventDefault();
              if (!evidenceDialog) return;
              if (evidenceDialog.mode === 'complete') {
                completeRequiredChecklistItem(event.currentTarget, evidenceDialog.itemId);
              } else {
                attachChecklistEvidence(event.currentTarget, evidenceDialog.itemId);
              }
            }}
          >
            <div className="modal-head">
              <div>
                <strong>
                  {evidenceDialog?.mode === 'complete' ? 'Complete with evidence' : 'Add evidence'}
                </strong>
                <span>{evidenceDialog?.action}</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close evidence form"
                onClick={() => setEvidenceDialog(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body compact-evidence-form">
              <AttachmentPicker
                label="Choose file / photo / screenshot"
                multiple={false}
                required
                disabled={pending}
                hint="PDF, document, photo, or screenshot · up to 10 MB"
              />
              {evidenceDialog?.mode === 'complete' ? (
                <div className="field">
                  <label htmlFor={`completion-note-${evidenceDialog.itemId}`}>
                    Completion note (optional)
                  </label>
                  <textarea
                    id={`completion-note-${evidenceDialog.itemId}`}
                    name="completionNote"
                    rows={3}
                    maxLength={2000}
                  />
                </div>
              ) : null}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setEvidenceDialog(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={pending} aria-busy={pending}>
                {pending
                  ? 'Saving…'
                  : evidenceDialog?.mode === 'complete'
                    ? 'Save evidence & complete'
                    : 'Save evidence'}
              </button>
            </div>
          </form>
        </Modal>

        {message && (
          <div className={`notice ${message.tone === 'error' ? 'error' : 'success'}`} role="status">
            <strong>{message.tone === 'error' ? 'Action needed' : 'Saved'}</strong>
            <p>{message.text}</p>
          </div>
        )}

        <Modal open={barrierOpen} title="Raise Barrier" onClose={() => setBarrierOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              startTransition(async () => {
                const result = await raiseBarrier({
                  taskId: task.id,
                  description: String(data.get('description') ?? ''),
                  supportNeeded: String(data.get('supportNeeded') ?? ''),
                  impact: String(data.get('impact')) as BarrierImpact,
                  actionType: String(data.get('actionType') ?? 'support') as
                    'decision' | 'approval' | 'support' | 'escalation' | 'other',
                  actionRequiredFrom: String(data.get('actionRequiredFrom') ?? '') || null,
                  // §28 — a barrier answers "who needs to act?", not "which
                  // meeting should this appear in?". Meeting Queue remains its
                  // own feature; it is no longer wired into asking for help.
                  addToMeetingQueue: false,
                  idempotencyKey: idempotencyKey(),
                });
                if (finish(result, 'Request sent. The person you named has been notified.')) {
                  // v44 section 36 — only clear the form once the request is
                  // safely away. On failure the words somebody just wrote about
                  // a blocked job must survive, not be thrown back at them.
                  form.reset();
                  setBarrierOpen(false);
                }
              });
            }}
          >
            {/*
              v44 section 14 — five questions, because a barrier that cannot
              answer them is not a request, it is a complaint:

                what is blocking the work, what kind of action is needed, what
                exactly you need from them, who has to act, and what happens if
                nobody does.

              The old form asked two of these and guessed the recipient, which
              is why barriers reached a manager's list saying nothing about what
              they were supposed to do with it.
            */}
            <div className="modal-head">
              <div>
                <strong>Ask for what you need</strong>
                <span>
                  Use this when work cannot progress normally and somebody else has to act.
                </span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close Ask for what you need"
                onClick={() => setBarrierOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor={`barrier-${task.id}`}>What is blocking the work?</label>
                <textarea
                  id={`barrier-${task.id}`}
                  name="description"
                  rows={3}
                  required
                  maxLength={2000}
                  placeholder="Example: Operations has not approved the shutdown window, so the contractor cannot continue."
                />
              </div>

              <div className="field">
                <label htmlFor={`action-type-${task.id}`}>What needs to happen?</label>
                {/*
                  v45 §23-24 — four visible chips, not a dropdown. Four options
                  do not deserve a menu, and seeing them makes the choice
                  quicker than opening one.

                  Escalation is gone: it describes how a request is routed, not
                  what the person needs. Mixing it in made "what do you need?"
                  answerable with something that is not a need.
                */}
                <div
                  className="request-type-chips"
                  role="radiogroup"
                  aria-label="What needs to happen?"
                >
                  {(
                    [
                      ['approval', 'Approval'],
                      ['decision', 'Decision'],
                      ['support', 'Support'],
                      ['other', 'Other'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="request-type-chip">
                      <input
                        type="radio"
                        name="actionType"
                        value={value}
                        defaultChecked={value === 'decision'}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label htmlFor={`support-${task.id}`}>What do you need from them?</label>
                <textarea
                  id={`support-${task.id}`}
                  name="supportNeeded"
                  rows={2}
                  required
                  maxLength={2000}
                  placeholder="Example: Confirm whether the shutdown can proceed this Friday, or give another date."
                />
              </div>

              <div className="field">
                <label htmlFor={`recipient-${task.id}`}>Who needs to act?</label>
                <select id={`recipient-${task.id}`} name="actionRequiredFrom" defaultValue="">
                  <option value="">My manager</option>
                  {assignablePeople
                    .filter((person) => !person.isPrimaryOwner)
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                </select>
                <small>
                  Only people you are authorised to ask. Leave as My manager if you are not sure.
                </small>
              </div>

              <div className="field">
                <label htmlFor={`impact-${task.id}`}>
                  Impact <span className="optional-label">Optional</span>
                </label>
                <select id={`impact-${task.id}`} name="impact" required defaultValue="may_delay">
                  {Object.entries(BARRIER_IMPACT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>
                  Only &ldquo;work cannot continue&rdquo; pauses the task. The others leave it
                  running.
                </small>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setBarrierOpen(false)}>
                Cancel
              </button>
              {/* "Send request", not "Submit barrier": the intent is to ask
                  somebody for something, not to record a status. */}
              <button className="btn primary" disabled={pending} aria-busy={pending}>
                {pending ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        </Modal>

        {/*
          The task in one line: what state it is in, when it is due, how far
          through its Steps it is. Everything that used to sit up here and is
          not one of those three moved into Details or the menu below.
        */}
        <div className="task-status-line" aria-label="Task status">
          <span className="task-status-state">
            <span className={`metadata-dot ${task.status}`} aria-hidden="true" />
            {TASK_STATUS_LABELS[task.status]}
          </span>
          <span>
            {task.routineTemplateId ? 'Occurrence' : 'Due'}{' '}
            {formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}
          </span>
          {taskOverdueMs > 0 ? (
            <span className="task-status-overdue">
              {formatCompactDuration(taskOverdueMs)} overdue
            </span>
          ) : null}
          {detail.checklist.length > 0 ? (
            <span>
              {checklistCompleted}/{detail.checklist.length} complete
            </span>
          ) : null}
          {task.isMandatory ? <span>Mandatory</span> : null}
          <button
            type="button"
            className="task-age-info"
            aria-label="Show task-age details"
            title="Show task-age details"
            onClick={() => setAgeInfoOpen(true)}
          >
            i
          </button>
        </div>

        {/*
          The two things somebody opening their own work normally wants. Both
          say what they do; neither is a disclosure to be discovered.
        */}
        {isClosed && (
          <p className="task-closed-note">
            {task.status === 'completed' ? 'Completed' : 'Cancelled'}
            {task.completedAt ? ` ${formatMoment(task.completedAt, timeZone)}` : ''}. This is a
            record of what happened, so it is read-only.
          </p>
        )}

        {detail.routine && (
          <RoutineOutcomePanel
            taskId={task.id}
            taskVersion={Math.max(taskVersion, task.version)}
            routine={detail.routine}
            status={task.status}
            stepsTotal={detail.checklist.length}
            stepsCompleted={checklistCompleted}
            evidenceCount={detail.attachments.filter((file) => file.isEvidence).length}
            canAct={detail.capabilities.canContribute && !isClosed}
            canDecide={detail.capabilities.canEdit}
            readyToComplete={readyToComplete}
            blockers={completionBlockers}
            pending={pending}
            timeZone={timeZone}
            onAddNote={() => setComposerOpen((current) => !current)}
            noteOpen={composerOpen}
            onCompleted={(message) => {
              setMessage({ tone: 'success', text: message });
              router.refresh();
            }}
            onFailed={(message) => setMessage({ tone: 'error', text: message })}
          />
        )}

        {!isRoutineOccurrence && detail.capabilities.canContribute && !isClosed && (
          <div className="task-primary-actions">
            <button
              type="button"
              className="btn primary"
              aria-expanded={composerOpen}
              onClick={() => setComposerOpen((current) => !current)}
            >
              + Add update
            </button>
            {/*
              v46 §39 - not offered while a barrier is already open.

              The panel above already says who the work is waiting for and
              offers to show the request. Leaving this here invited somebody to
              raise a second barrier about the problem they were looking at,
              which is what the callout it replaced was careful not to do.
            */}
            {!openBarrier && (
              <button type="button" className="btn" onClick={() => setBarrierOpen(true)}>
                Need support
              </button>
            )}
          </div>
        )}

        {composerOpen && detail.capabilities.canContribute && !isClosed && (
          <form
            className="task-update-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitUpdate(event.currentTarget);
            }}
          >
            <div className="update-form-grid">
              <div className="field">
                <label htmlFor={`update-${task.id}`}>What changed?</label>
                <textarea
                  id={`update-${task.id}`}
                  name="body"
                  rows={4}
                  maxLength={4000}
                  placeholder="Describe the meaningful progress, result or issue."
                />
              </div>
            </div>

            {/*
                v43 sections 11-15. Four controls left this form:

                  "What happens next?"  — Next action has one home, in Overview.
                                          Two places to edit it meant an update
                                          could silently rewrite the plan.
                  "This is evidence only" — inferred now (section 27): no text
                                          plus attachments IS an evidence-only
                                          update. That was bookkeeping dressed
                                          up as a question.
                  "Need help"           — a second route to Raise barrier, which
                                          already sits at the top of the drawer.
                  "Mention participants" — a participant model duplicating the
                                          owner, assignees, contributors and
                                          manager the task already knows about.

                What is left is the question the form is for: what changed.
              */}
            <div className="update-composer-footer">
              {/* "Add files" rather than "Attach": it names the action and the object,
                    and keeping the visible text identical to the accessible name
                    satisfies WCAG 2.5.3 Label in Name. */}
              <AttachmentPicker label="Add files" disabled={pending} />
              <button className="btn small primary" disabled={pending} aria-busy={pending}>
                {pending ? 'Posting…' : 'Post update'}
              </button>
            </div>
            <p className="update-composer-note">
              For what the system cannot know: a result, a decision, an explanation. Completing a
              step records itself.
            </p>
          </form>
        )}

        {/*
          Steps: the only record of what is left to do.

          Absent entirely when there are none, rather than an empty box holding
          the layout open. Work with nothing to tick is updated and completed
          directly.
        */}
        {showSteps && (
          <section className="task-accordion">
            <button
              type="button"
              className="task-accordion-summary"
              aria-expanded={openSection === 'steps'}
              aria-controls={`task-steps-${task.id}`}
              onClick={() => toggleSection('steps')}
            >
              <span className="task-accordion-copy">
                <strong>
                  Steps
                  {detail.checklist.length > 0 ? (
                    <>
                      {' '}
                      <span className="task-accordion-count">
                        {checklistCompleted}/{detail.checklist.length}
                      </span>
                    </>
                  ) : null}
                </strong>
                <small>{stepsSummary}</small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            {openSection === 'steps' && (
              <div className="task-accordion-body" id={`task-steps-${task.id}`}>
                <TaskChecklistPanel
                  assignees={assignablePeople}
                  onAddStep={(step) => {
                    setMessage(null);
                    /*
                     * v45 §4 — confirm the consequence, not the storage.
                     *
                     * "Step added." leaves the one question the author actually has
                     * unanswered: does Amer know? Handing somebody work silently is
                     * how a step sits untouched for a week while both people assume
                     * the other is on it. When the step goes to someone else, say who
                     * has it and that they were told.
                     */
                    const assignee = assignablePeople.find(
                      (person) => person.id === step.assignedTo,
                    );
                    const delegated = Boolean(step.assignedTo) && step.assignedTo !== viewerId;
                    const firstName = assignee
                      ? (assignee.name.split(' ')[0] ?? assignee.name)
                      : null;

                    startTransition(async () => {
                      finish(
                        await addChecklistStep({
                          taskId: task.id,
                          action: step.action,
                          assignedTo: step.assignedTo || null,
                          evidenceRule: step.evidenceRule,
                          dueDate: step.dueDate,
                          dependsOnItemId: step.dependsOnItemId,
                        }),
                        delegated && firstName
                          ? `Step assigned to ${firstName}. ${firstName} has been notified.`
                          : 'Step added.',
                      );
                    });
                  }}
                  onEditStep={(step) => {
                    setMessage(null);
                    const previous = detail.checklist.find((item) => item.id === step.itemId);
                    const reassigned =
                      Boolean(previous) && previous?.assignedTo !== step.assignedTo;
                    const assignee = assignablePeople.find(
                      (person) => person.id === step.assignedTo,
                    );
                    const firstName = assignee
                      ? (assignee.name.split(' ')[0] ?? assignee.name)
                      : null;

                    startTransition(async () => {
                      finish(
                        await updateChecklistStep({
                          itemId: step.itemId,
                          action: step.action,
                          assignedTo: step.assignedTo,
                          evidenceRule: step.evidenceRule,
                          dueDate: step.dueDate,
                          dependsOnItemId: step.dependsOnItemId,
                          idempotencyKey: idempotencyKey(),
                        }),
                        // Reassignment is the change with a consequence for somebody
                        // else, so it is the one the confirmation names.
                        reassigned && firstName && step.assignedTo !== viewerId
                          ? `Step updated and assigned to ${firstName}. ${firstName} has been notified.`
                          : 'Step updated.',
                      );
                    });
                  }}
                  onRemoveStep={(item) => {
                    setMessage(null);
                    startTransition(async () => {
                      finish(
                        await removeChecklistStep({
                          itemId: item.id,
                          idempotencyKey: idempotencyKey(),
                        }),
                        'Step removed.',
                      );
                    });
                  }}
                  items={detail.checklist}
                  attachmentsByChecklist={attachmentsByChecklist}
                  canEdit={detail.capabilities.canEdit && !isClosed}
                  readOnly={isClosed}
                  pending={pending}
                  timeZone={timeZone}
                  onComplete={(itemId) =>
                    startTransition(async () => {
                      finish(
                        await completeChecklistItem({
                          itemId,
                          idempotencyKey: idempotencyKey(),
                        }),
                        'Step completed.',
                      );
                    })
                  }
                  onReopen={(itemId) =>
                    startTransition(async () => {
                      finish(
                        await reopenChecklistItem({
                          itemId,
                          reason: 'Reopened from task detail.',
                        }),
                        'Step reopened.',
                      );
                    })
                  }
                  onEvidence={(item, mode) =>
                    setEvidenceDialog({ itemId: item.id, action: item.action, mode })
                  }
                />
              </div>
            )}
          </section>
        )}

        {/*
          Only what a person wrote. Everything the system did to this task -
          created, classified, activated, steps ticked - is in Details under
          Activity history, where a record belongs, rather than in a feed people
          are meant to read.
        */}
        {(!isRoutineOccurrence || writtenUpdates.length > 0) && (
          <section className="task-accordion">
            <button
              type="button"
              className="task-accordion-summary"
              aria-expanded={openSection === 'updates'}
              aria-controls={`task-updates-${task.id}`}
              onClick={() => toggleSection('updates')}
            >
              <span className="task-accordion-copy">
                <strong>
                  Updates <span className="task-accordion-count">{writtenUpdates.length}</span>
                </strong>
                <small>
                  {writtenUpdates[0]
                    ? `Latest · ${formatClock(writtenUpdates[0].createdAt, timeZone)}`
                    : 'No updates yet'}
                </small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            {openSection === 'updates' && (
              <div className="task-accordion-body" id={`task-updates-${task.id}`}>
                {writtenUpdates.length === 0 ? (
                  <p className="muted">
                    Nothing written yet. Add an update when there is something to tell people that
                    the task does not already say by itself.
                  </p>
                ) : (
                  <div className="task-update-list">
                    {writtenUpdates.map((update) => {
                      const files = attachmentsByUpdate.get(update.id) ?? [];
                      return (
                        <article key={update.id} className="task-written-update">
                          <p>{update.body}</p>
                          {files.length > 0 && (
                            <div className="task-update-files">
                              {files.map((file) =>
                                canPreview(file.mimeType) ? (
                                  <button
                                    key={file.id}
                                    type="button"
                                    className="task-update-file"
                                    onClick={() => setViewingFile(file)}
                                  >
                                    {file.fileName}
                                  </button>
                                ) : (
                                  <Link
                                    key={file.id}
                                    href={`/api/attachments/${file.id}`}
                                    target="_blank"
                                    className="task-update-file"
                                  >
                                    {file.fileName}
                                  </Link>
                                ),
                              )}
                            </div>
                          )}
                          <span className="muted">
                            {update.authorName} · {formatMoment(update.createdAt, timeZone)}
                          </span>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="task-accordion">
          <button
            type="button"
            className="task-accordion-summary"
            aria-expanded={openSection === 'details'}
            onClick={() => toggleSection('details')}
          >
            <span className="task-accordion-copy">
              <strong>Details</strong>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          {openSection === 'details' && (
            <div className="task-accordion-body">
              <div className="task-detail-facts">
                <div>
                  <p className="eyebrow">Owner</p>
                  <p>{ownerName}</p>
                </div>
                <div>
                  <p className="eyebrow">Urgency</p>
                  <p>{task.urgency[0]?.toUpperCase() + task.urgency.slice(1)}</p>
                </div>
                <div>
                  <p className="eyebrow">Created</p>
                  <p>{formatMoment(task.createdAt, timeZone)}</p>
                </div>
                <div>
                  <p className="eyebrow">Type</p>
                  <p>{WORK_CLASS_LABELS[task.workClass]}</p>
                </div>
              </div>
              {task.description && (
                <section className="detail-section" aria-labelledby="task-context-heading">
                  <p className="eyebrow" id="task-context-heading">
                    Task context
                  </p>
                  <p>{task.description}</p>
                </section>
              )}
              {task.routineTemplateId && detail.capabilities.canContribute && (
                <section className="detail-section" aria-labelledby="findings-heading">
                  <h3 id="findings-heading">Findings</h3>

                  {detail.routineFindings.length > 0 && (
                    <div className="finding-list">
                      {detail.routineFindings.map((finding) => (
                        <article key={finding.id} className="finding-row">
                          <span
                            className={`flag ${
                              finding.severity === 'immediate_risk'
                                ? 'red'
                                : finding.severity === 'significant'
                                  ? 'amber'
                                  : 'neutral'
                            }`}
                          >
                            {FINDING_SEVERITY_LABEL[finding.severity]}
                          </span>
                          <div>
                            <strong>{finding.description}</strong>
                            <span>
                              {finding.recordedByName} ·{' '}
                              {formatMoment(finding.recordedAt, timeZone)}
                            </span>
                            {finding.createdTaskId && (
                              <Link
                                href={`/work?task=${finding.createdTaskId}`}
                                className="btn small"
                              >
                                Open the work this raised
                              </Link>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}

                  <form
                    className="detail-lifecycle-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const data = new FormData(form);
                      const severity = String(data.get('severity') ?? 'minor') as
                        'minor' | 'significant' | 'immediate_risk';
                      const description = String(data.get('description') ?? '');
                      const followUpOwnerId = String(data.get('followUpOwnerId') ?? '');
                      setMessage(null);
                      startTransition(async () => {
                        if (
                          finish(
                            await recordRoutineFinding({
                              occurrenceTaskId: task.id,
                              severity,
                              description,
                              followUpOwnerId: followUpOwnerId || null,
                            }),
                            severity === 'minor'
                              ? 'Finding recorded against this occurrence.'
                              : 'Finding recorded, and follow-up work raised in Available.',
                          )
                        ) {
                          form.reset();
                        }
                      });
                    }}
                  >
                    <label htmlFor={`finding-severity-${task.id}`}>What did you find?</label>
                    <select id={`finding-severity-${task.id}`} name="severity" defaultValue="minor">
                      <option value="minor">Minor — corrected during this check</option>
                      <option value="significant">Significant — needs follow-up work</option>
                      <option value="immediate_risk">Immediate risk — needs action now</option>
                    </select>

                    <label htmlFor={`finding-description-${task.id}`}>Describe it</label>
                    <textarea
                      id={`finding-description-${task.id}`}
                      name="description"
                      rows={2}
                      maxLength={2000}
                      required
                    />

                    {assignablePeople.length > 0 && (
                      <>
                        <label htmlFor={`finding-owner-${task.id}`}>
                          Who should own the follow-up?{' '}
                          <span className="optional-label">Optional</span>
                        </label>
                        <select
                          id={`finding-owner-${task.id}`}
                          name="followUpOwnerId"
                          defaultValue=""
                        >
                          <option value="">Decide later</option>
                          {assignablePeople.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </>
                    )}

                    <button className="btn small primary" disabled={pending} aria-busy={pending}>
                      Record finding
                    </button>
                  </form>
                </section>
              )}
              <section className="detail-section" aria-labelledby="attachments-heading">
                <h3 id="attachments-heading">Attachments and evidence</h3>
                {detail.attachments.length > 0 ? (
                  <div className="attachment-list">
                    {detail.attachments.map((attachment) => {
                      const body = (
                        <>
                          <span>
                            <strong>{attachment.fileName}</strong>
                            <small>
                              {attachment.uploadedByName} ·{' '}
                              {formatMoment(attachment.createdAt, timeZone)}
                            </small>
                          </span>
                          <span>
                            {formatBytes(attachment.byteSize)}
                            {attachment.isEvidence ? ' · Evidence' : ''}
                          </span>
                        </>
                      );
                      /*
                       * A spreadsheet or a document has no in-page renderer, so
                       * the row stays a download for those. Offering a preview
                       * that cannot preview is worse than the download it
                       * replaced.
                       */
                      return canPreview(attachment.mimeType) ? (
                        <button
                          key={attachment.id}
                          type="button"
                          className="attachment-row"
                          onClick={() => setViewingFile(attachment)}
                        >
                          {body}
                        </button>
                      ) : (
                        <Link
                          key={attachment.id}
                          href={`/api/attachments/${attachment.id}`}
                          target="_blank"
                          className="attachment-row"
                        >
                          {body}
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted">No files are attached.</p>
                )}
              </section>
              <section className="detail-section" aria-labelledby="barriers-heading">
                <h3 id="barriers-heading">Barriers</h3>
                {detail.barriers.map((barrier) => (
                  <BarrierDetailPanel
                    key={barrier.id}
                    barrier={barrier}
                    timeZone={timeZone}
                    canEdit={detail.capabilities.canEdit}
                    pending={pending}
                    highlighted={barrier.id === revealedBarrierId}
                    onResolve={(form, note) => {
                      startTransition(async () => {
                        if (
                          finish(
                            await resolveBarrier({ barrierId: barrier.id, resolutionNote: note }),
                            'Barrier resolved.',
                          )
                        )
                          form.reset();
                      });
                    }}
                  />
                ))}
                {detail.barriers.length === 0 && (
                  <p className="muted">No barriers have been raised.</p>
                )}
              </section>
              {task.reviewStatus === 'pending' && detail.capabilities.canReview && (
                /*
            Deliberately not `detail-section`. Combined with
            `drawer-panel-overview` that class is hidden until the drawer is
            expanded — the same rule that once hid Complete and then Delete. A
            completion waiting on a manager's decision is the last thing that
            should be behind Expand.
          */
                <section className="review-panel" aria-labelledby="review-heading">
                  <h3 id="review-heading">Completion review</h3>
                  <p>Opening evidence records that it was viewed. It does not accept completion.</p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const submitter = (event.nativeEvent as SubmitEvent)
                        .submitter as HTMLButtonElement | null;
                      startTransition(async () => {
                        finish(
                          await decideCompletionReview({
                            taskId: task.id,
                            decision: String(submitter?.value) as 'accepted' | 'changes_requested',
                            note: String(data.get('note') ?? '') || null,
                            idempotencyKey: idempotencyKey(),
                          }),
                          'Review decision recorded.',
                        );
                      });
                    }}
                  >
                    <div className="field">
                      <label htmlFor={`review-note-${task.id}`}>Review note</label>
                      <textarea id={`review-note-${task.id}`} name="note" rows={3} />
                    </div>
                    <div className="actions">
                      <button
                        className="btn primary"
                        name="decision"
                        value="accepted"
                        disabled={pending}
                        aria-busy={pending}
                      >
                        Accept Completion
                      </button>
                      <button
                        className="btn danger"
                        name="decision"
                        value="changes_requested"
                        disabled={pending}
                        aria-busy={pending}
                      >
                        Request Changes
                      </button>
                    </div>
                  </form>
                </section>
              )}
              <section className="detail-section detail-two-column">
                <div>
                  <h3>Collaborators</h3>
                  {detail.collaborators.length ? (
                    <ul>
                      {detail.collaborators.map((person) => (
                        <li key={person.id}>
                          {person.fullName}
                          {person.employeeId ? ` · ${person.employeeId}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No collaborators.</p>
                  )}
                </div>
                <div>
                  <h3>Related Work</h3>
                  {detail.relatedWork.length ? (
                    <ul>
                      {detail.relatedWork.map((related) => (
                        <li key={related.id}>
                          <Link href={`/work?task=${related.id}`}>{related.title}</Link> ·{' '}
                          {related.relation}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No related work.</p>
                  )}
                </div>
              </section>
              <details className="task-activity-details">
                <summary>Activity history</summary>
                <TaskActivityHistory
                  activity={detail.activity}
                  updates={detail.updates}
                  attachments={detail.attachments}
                  timeZone={timeZone}
                  /*
                   * Only when there is a decision waiting and this reader is the one
                   * who makes it. The review panel lives on Overview, so from here
                   * the entry had nothing behind it — a manager could read
                   * "Completion submitted" and have no way to act on it.
                   */
                  onOpenReview={
                    task.reviewStatus === 'pending' && detail.capabilities.canReview
                      ? () => {
                          setOpenSection('details');
                          // Once the section is open, put the panel in front of them
                          // rather than leaving it to be hunted for.
                          requestAnimationFrame(() => {
                            document
                              .getElementById(`review-heading`)
                              ?.scrollIntoView({ block: 'center' });
                          });
                        }
                      : undefined
                  }
                />
              </details>
            </div>
          )}
        </section>

        {/*
          Finishing, and everything that is not finishing.

          `Complete work` is disabled rather than hidden while steps remain, so
          the way to end a task is always in the same place; what is missing is
          said when it is pressed rather than kept permanently on screen.
        */}
        <div className="task-detail-footer">
          {/*
            One primary action, chosen by the state the work is in.

            Activating used to be a command inside the ••• menu, which put the
            single most important thing you can do to Available work in the
            administration drawer — and when that menu became commands only it
            went missing altogether, leaving Available work openable but
            unstartable. It is a primary action, so it belongs here, in the
            place Complete work already occupies for Active work.

            `TaskRowActions` rather than a plain button, because activating
            carries the over-target question and the Undo window with it.
          */}
          {isClosed ? (
            <span />
          ) : task.status === 'paused' ? (
            <button
              type="button"
              className="btn primary"
              disabled={pending}
              aria-busy={pending}
              onClick={() => setResumeOpen(true)}
            >
              Resume work
            </button>
          ) : canOfferActivate(task.status) ? (
            <TaskRowActions
              taskId={task.id}
              title={task.title}
              status={task.status}
              version={task.version}
              bucket={task.focusBucket}
              isMandatory={task.isMandatory}
            />
          ) : !isRoutineOccurrence &&
            detail.capabilities.canComplete &&
            task.status !== 'completed' &&
            task.status !== 'cancelled' ? (
            <button
              type="button"
              className="btn primary"
              disabled={!readyToComplete || pending}
              aria-busy={pending}
              /*
               * Disabled rather than shouted about. The old screen carried a
               * permanent box listing everything outstanding, which is the
               * Steps list said twice. The reason is here for anybody who
               * wonders why the button will not press, and `complete_task`
               * still names what is missing to anyone who reaches it another
               * way.
               */
              title={
                readyToComplete
                  ? undefined
                  : completionBlockers.length > 0
                    ? `Not yet: ${completionBlockers.join('; ')}`
                    : undefined
              }
              onClick={() => setCompleteOpen(true)}
            >
              Complete work
            </button>
          ) : (
            <span />
          )}
          {detail.capabilities.canEdit || detail.capabilities.canDelete ? (
            <MenuDropdown
              label="•••"
              ariaLabel="More task actions"
              className="task-admin-menu"
              panelClassName="task-admin-popover"
              minWidth={320}
            >
              {/*
                A menu of commands, and nothing else.

                This panel had grown into a second task-management page: Edit,
                Edit due date, Move out, Pause, Complete task, a cancel reason
                textarea, a delete explanation and two destructive buttons, one
                of them in a red card that was the loudest thing on the screen.
                It scrolled inside itself, `Complete task` duplicated the button
                immediately to its left, and the two destructive actions sat
                next to each other with nothing to tell them apart.

                Everything that needs a reason, a confirmation or any typing now
                opens a modal. What is left is a short list of commands, ordered
                by how ordinary they are: routine administration, then the one
                lifecycle move, then the two exceptional ones.
              */}
              <div role="group" aria-label="Task administration" className="task-admin-commands">
                {detail.capabilities.canEdit && !isClosed ? (
                  <>
                    <button
                      type="button"
                      className="menu-command"
                      onClick={() => {
                        setTitleDraft(task.title);
                        setDescriptionDraft(task.description ?? '');
                        setEditOpen(true);
                      }}
                    >
                      Edit work
                    </button>
                    <button type="button" className="menu-command" onClick={openDueEditor}>
                      Change due date
                    </button>
                  </>
                ) : null}

                {/*
                  "Move out" asked people to work out where to. The server
                  action has always been called `moveTaskToAvailable`, so the
                  menu now says what it does — and what it means: I am not
                  carrying this at the moment, the work is still valid.

                  Pause used to sit beside it, with a reason and a restart date
                  in a form inside this menu. The distinction between "not
                  carrying it" and "carrying it but not working on it" cost more
                  to explain than it was worth, so it is gone. Work already
                  paused can still be resumed, below.
                */}
                {detail.capabilities.canEdit && canOfferMoveOut(task.status) ? (
                  <>
                    <div className="menu-separator" role="separator" />
                    <button
                      type="button"
                      className="menu-command"
                      disabled={pending}
                      onClick={runMoveToAvailable}
                    >
                      Move to Available
                    </button>
                  </>
                ) : null}

                {/*
                  A manager act, and the capability says so, so an owner never
                  sees a control the database would refuse.
                */}
                {detail.capabilities.canReassign && !isClosed && assignablePeople.length > 0 ? (
                  <>
                    <div className="menu-separator" role="separator" />
                    <button
                      type="button"
                      className="menu-command"
                      onClick={() => setReassignOpen(true)}
                    >
                      Reassign owner
                    </button>
                  </>
                ) : null}

                {/*
                  The two exceptional ones, last and quiet. Muted red text
                  rather than a red panel: reachable, never the thing your eye
                  lands on first. Which of the two you want is a question their
                  own dialogs answer, where it is being asked.
                */}
                {(detail.capabilities.canCancel && !isClosed) || detail.capabilities.canDelete ? (
                  <div className="menu-separator" role="separator" />
                ) : null}
                {detail.capabilities.canCancel && !isClosed ? (
                  <button
                    type="button"
                    className="menu-command destructive"
                    onClick={() => setCancelOpen(true)}
                  >
                    Cancel work
                  </button>
                ) : null}
                {detail.capabilities.canDelete ? (
                  <button
                    type="button"
                    className="menu-command destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Move to Bin
                  </button>
                ) : null}
              </div>
            </MenuDropdown>
          ) : null}
        </div>
      </div>
    </SideDrawer>
  );
}

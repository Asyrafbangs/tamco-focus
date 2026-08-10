'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { AttachmentPicker } from '@/components/ui/AttachmentPicker';
import { Modal } from '@/components/ui/Modal';
import { SideDrawer } from '@/components/ui/SideDrawer';
import {
  ageChips,
  dueInputValue,
  formatCompactDuration,
  formatDue,
  formatDueShort,
  overdueAgeMs,
} from '@/domain/duration';
import { barrierAction, barrierViewLabel } from '@/domain/barriers';
import { ACTIVATION_REASON_OPTIONS, validateActivationReason } from '@/domain/focus';
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
  changeTaskDueDate,
  completeChecklistItem,
  completeChecklistItemWithEvidence,
  addChecklistStep,
  completeTask,
  convertQuickAction,
  decideCompletionReview,
  pauseTask,
  postTaskUpdate,
  postBarrierResponse,
  raiseBarrier,
  removeChecklistStep,
  reassignTask,
  recordRoutineFinding,
  reopenChecklistItem,
  resolveBarrier,
  resumeTask,
  setTaskNextAction,
  updateChecklistStep,
} from '@/server/actions/task-actions';
import type { TaskDetail } from '@/server/queries';

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
  const [activeTab, setActiveTab] = useState<'overview' | 'checklist' | 'updates'>('overview');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const [ageInfoOpen, setAgeInfoOpen] = useState(false);
  const [dueEditorOpen, setDueEditorOpen] = useState(false);
  const [dueDateOnlyDraft, setDueDateOnlyDraft] = useState(task.dueIsDateOnly);
  const [dueDraft, setDueDraft] = useState(dueInputValue(task.dueAt, task.dueIsDateOnly, timeZone));
  const [evidenceDialog, setEvidenceDialog] = useState<{
    itemId: string;
    action: string;
    mode: 'attach' | 'complete';
  } | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [nextAction, setNextAction] = useState<string | null>(task.nextAction);
  const [nextActionDraft, setNextActionDraft] = useState(task.nextAction ?? '');
  const [nextActionEditing, setNextActionEditing] = useState(false);
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
  const requiredEvidenceOutstanding = detail.checklist.filter(
    (item) => item.state !== 'completed' && item.evidenceRule === 'required',
  ).length;
  const taskOverdueMs = overdueAgeMs(task);
  const ageDetails = ageChips(task, { staleThresholdDays });

  const attachmentsByChecklist = new Map<string, number>();
  for (const attachment of detail.attachments) {
    if (attachment.checklistItemId) {
      attachmentsByChecklist.set(
        attachment.checklistItemId,
        (attachmentsByChecklist.get(attachment.checklistItemId) ?? 0) + 1,
      );
    }
  }

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
    setActiveTab('overview');
    setDrawerExpanded(true);
    setRevealedBarrierId(barrierId);
  }

  function finish(result: OperationResult, success: string) {
    if (result.ok) {
      setMessage({ tone: 'success', text: success });
      router.refresh();
      return true;
    }
    setMessage({ tone: 'error', text: result.message });
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
      }
    });
  }

  function openNextActionEditor() {
    setNextActionDraft(nextAction ?? '');
    setNextActionEditing(true);
  }

  function openDueEditor() {
    setDueDateOnlyDraft(task.dueIsDateOnly);
    setDueDraft(dueInputValue(task.dueAt, task.dueIsDateOnly, timeZone));
    setDueEditorOpen(true);
  }

  function saveNextAction(markDone: boolean) {
    const cleanAction = nextActionDraft.trim();
    setMessage(null);
    startTransition(async () => {
      const result = await setTaskNextAction({
        taskId: task.id,
        expectedVersion: Math.max(taskVersion, task.version),
        nextAction: markDone ? null : cleanAction,
        markDone,
        idempotencyKey: idempotencyKey(),
      });
      if (
        finish(
          result,
          markDone
            ? 'Next action marked done. Set the next practical action when ready.'
            : 'Next action updated and added to task history.',
        )
      ) {
        const savedAction = markDone ? null : cleanAction;
        setNextAction(savedAction);
        setNextActionDraft(savedAction ?? '');
        setNextActionEditing(false);
        setTaskVersion((current) => (result.ok ? (result.version ?? current + 1) : current));
      }
    });
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

          <div className="quick-action-primary">
            <button
              type="button"
              className="btn primary"
              disabled={pending}
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
      className={`task-detail-drawer${drawerExpanded ? ' expanded' : ''}`}
      eyebrow={WORK_CLASS_LABELS[task.workClass]}
      title={task.title}
      titleId="task-detail-title"
      actions={
        <button
          type="button"
          className="btn small ghost"
          aria-pressed={drawerExpanded}
          onClick={() => setDrawerExpanded((current) => !current)}
        >
          {drawerExpanded ? 'Restore' : 'Expand'}
        </button>
      }
    >
      <div className="task-detail-scroll" data-tab={activeTab}>
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
        ) : detail.capabilities.canContribute ? (
          <section className="barrier-callout" aria-label="Task support">
            <div>
              <strong>Need help?</strong>
              <p>Raise a barrier when progress needs support, a decision or escalation.</p>
            </div>
            <button
              type="button"
              className="btn small barrier-button"
              onClick={() => setBarrierOpen(true)}
            >
              Raise barrier
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

        <nav className="drawer-tabs" aria-label="Task details" role="tablist">
          {(['overview', 'checklist', 'updates'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={activeTab === tab ? 'active' : undefined}
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'overview'
                ? 'Overview'
                : tab === 'checklist'
                  ? `Checklist ${checklistCompleted}/${detail.checklist.length}`
                  : 'Updates'}
            </button>
          ))}
        </nav>

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

        <div className="task-information-line drawer-panel-overview" aria-label="Task information">
          <span className="task-information-segment status">
            <span className={`metadata-dot ${task.status}`} aria-hidden="true" />
            {TASK_STATUS_LABELS[task.status]}
          </span>
          <span className="task-information-segment">
            {task.urgency[0]?.toUpperCase() + task.urgency.slice(1)} urgency
          </span>
          <span className="task-information-segment due">
            {task.routineTemplateId ? 'Occurrence' : 'Due'}{' '}
            {formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}
            {detail.capabilities.canEdit ? (
              <button type="button" className="task-due-edit" onClick={openDueEditor}>
                Edit due
              </button>
            ) : null}
          </span>
          {taskOverdueMs > 0 ? (
            <span className="task-information-segment overdue">
              {formatCompactDuration(taskOverdueMs)} overdue
            </span>
          ) : null}
          <span className="task-information-segment progress">
            <span className="task-metadata-progress" aria-hidden="true">
              <span style={{ width: `${task.progressPercent}%` }} />
            </span>
            {task.progressPercent}%
          </span>
          {detail.checklist.length > 0 ? (
            <span className="task-information-segment">
              {checklistCompleted}/{detail.checklist.length} checklist
            </span>
          ) : null}
          {task.isMandatory ? <span className="task-information-segment">Mandatory</span> : null}
          <span className="task-information-separator" aria-hidden="true">
            ·
          </span>
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

        {task.description && (
          <section
            className="detail-section drawer-panel-overview"
            aria-labelledby="task-context-heading"
          >
            <p className="eyebrow" id="task-context-heading">
              Task context
            </p>
            <p>{task.description}</p>
          </section>
        )}

        <section
          className="task-tab-section next-action-section drawer-panel-overview"
          aria-labelledby="next-action-heading"
        >
          <p className="eyebrow" id="next-action-heading">
            Next action
          </p>
          <div className="next-action-card">
            {!nextActionEditing ? (
              <div className="next-action-view">
                <div className="next-action-copy" aria-live="polite">
                  <strong className={nextAction ? undefined : 'empty'}>
                    {nextAction ?? 'No next action recorded'}
                  </strong>
                  <span>
                    {nextAction
                      ? `${task.routineTemplateId ? 'Occurrence' : 'Due'} ${formatDueShort(
                          task.dueAt,
                          task.dueIsDateOnly,
                          timeZone,
                        )}${taskOverdueMs > 0 ? ` · ${formatCompactDuration(taskOverdueMs)} overdue` : ''}`
                      : 'No practical next action has been recorded.'}
                  </span>
                </div>
                {detail.capabilities.canEdit && (
                  <div className="next-action-actions">
                    {nextAction && (
                      <button
                        type="button"
                        className="btn small"
                        disabled={pending}
                        aria-busy={pending}
                        onClick={() => saveNextAction(true)}
                      >
                        Mark done
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={pending}
                      aria-busy={pending}
                      onClick={openNextActionEditor}
                    >
                      {nextAction ? 'Edit' : '+ Set next action'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <form
                className="next-action-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveNextAction(false);
                }}
              >
                <label htmlFor={`next-action-${task.id}`}>Next action</label>
                <input
                  id={`next-action-${task.id}`}
                  value={nextActionDraft}
                  onChange={(event) => setNextActionDraft(event.target.value)}
                  maxLength={180}
                  required
                  autoFocus
                  placeholder="Example: Print and test the QR code on one first-aid box"
                />
                <span className="help">
                  Start with a verb and describe one action that can be completed or clearly
                  advanced.
                </span>
                <div className="actions">
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => setNextActionEditing(false)}
                  >
                    Cancel
                  </button>
                  <button className="btn small primary" disabled={pending} aria-busy={pending}>
                    {pending ? 'Saving...' : 'Save next action'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>

        {detail.checklist.length > 0 ? (
          <button
            type="button"
            className="checklist-preview-row drawer-panel-overview"
            onClick={() => setActiveTab('checklist')}
          >
            <span>
              <strong>
                Checklist · {checklistCompleted}/{detail.checklist.length} completed
              </strong>
              <small>
                {requiredEvidenceOutstanding > 0
                  ? `${requiredEvidenceOutstanding} item${
                      requiredEvidenceOutstanding === 1 ? '' : 's'
                    } requires evidence`
                  : 'No required evidence outstanding'}
              </small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ) : null}

        {detail.capabilities.canEdit && (
          <section className="detail-section task-lifecycle-section drawer-panel-overview">
            <details className="task-actions-details">
              <summary>More task actions</summary>
              <div className="detail-lifecycle">
                <TaskRowActions
                  taskId={task.id}
                  title={task.title}
                  status={task.status}
                  version={task.version}
                  bucket={task.focusBucket}
                  isMandatory={task.isMandatory}
                />

                {task.status === 'active' && (
                  <>
                    <details>
                      <summary>Pause</summary>
                      <form
                        className="detail-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = event.currentTarget;
                          const data = new FormData(form);
                          const restart = String(data.get('restartAt') ?? '');
                          startTransition(async () => {
                            const result = await pauseTask({
                              taskId: task.id,
                              expectedVersion: task.version,
                              reason: String(data.get('reason') ?? ''),
                              restartAt: restart ? new Date(restart).toISOString() : null,
                              idempotencyKey: idempotencyKey(),
                            });
                            finish(result, 'Work paused with restart information recorded.');
                          });
                        }}
                      >
                        <div className="field">
                          <label htmlFor={`pause-reason-${task.id}`}>Why pause?</label>
                          <textarea
                            id={`pause-reason-${task.id}`}
                            name="reason"
                            required
                            rows={2}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`restart-${task.id}`}>Restart or review at</label>
                          <input
                            id={`restart-${task.id}`}
                            name="restartAt"
                            type="datetime-local"
                            required
                          />
                        </div>
                        <button className="btn small" disabled={pending} aria-busy={pending}>
                          Pause work
                        </button>
                      </form>
                    </details>
                    <details>
                      <summary>Complete</summary>
                      <form
                        className="detail-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          startTransition(async () => {
                            const result = await completeTask({
                              taskId: task.id,
                              expectedVersion: task.version,
                              completionNote: String(data.get('completionNote') ?? '') || null,
                              idempotencyKey: idempotencyKey(),
                            });
                            finish(result, 'Completion recorded.');
                          });
                        }}
                      >
                        <div className="field">
                          <label htmlFor={`complete-note-${task.id}`}>Completion note</label>
                          <textarea
                            id={`complete-note-${task.id}`}
                            name="completionNote"
                            rows={2}
                          />
                        </div>
                        <button
                          className="btn small primary"
                          disabled={pending}
                          aria-busy={pending}
                        >
                          Complete task
                        </button>
                      </form>
                    </details>
                  </>
                )}

                {task.status === 'paused' && (
                  <div className="detail-form">
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
                              setResumeReason(
                                (event.target.value || null) as ActivationReason | null,
                              )
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
                    <button
                      type="button"
                      className="btn primary"
                      onClick={runResume}
                      disabled={pending}
                      aria-busy={pending}
                    >
                      Resume work
                    </button>
                  </div>
                )}

                {/*
                  v52 — the two ends of the lifecycle that had no way in.
                  
                  `cancelled` has always existed in the status enum and
                  `cancel_task` has always been written, but nothing called it:
                  work captured by mistake could only be completed, which puts
                  a lie in the record, or left in Available for ever.
                */}
                {detail.capabilities.canCancel &&
                  task.status !== 'completed' &&
                  task.status !== 'cancelled' && (
                    <form
                      className="detail-lifecycle-form"
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
                          }
                        });
                      }}
                    >
                      <label htmlFor={`cancel-${task.id}`}>
                        Cancel this work — why is it no longer needed?
                      </label>
                      <textarea id={`cancel-${task.id}`} name="cancelReason" rows={2} required />
                      <button className="btn small danger" disabled={pending} aria-busy={pending}>
                        Cancel work
                      </button>
                    </form>
                  )}

                {/*
                  Reassignment is a manager act and the capability says so, so
                  an owner never sees a control the database would refuse. It
                  is also the answer to the message an administrator gets when
                  deactivating somebody who still owns open work.
                */}
                {detail.capabilities.canReassign &&
                  task.status !== 'completed' &&
                  task.status !== 'cancelled' &&
                  assignablePeople.length > 0 && (
                    <form
                      className="detail-lifecycle-form"
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
                          }
                        });
                      }}
                    >
                      <label htmlFor={`reassign-${task.id}`}>Change the primary owner</label>
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
                      <button className="btn small" disabled={pending} aria-busy={pending}>
                        Reassign work
                      </button>
                    </form>
                  )}
              </div>
            </details>
          </section>
        )}

        {/*
          v52 — recording what an inspection found (master spec §16.4).

          The table, the procedure and the server action have existed since the
          first build; nothing ever called them. A routine inspection that found
          a problem had nowhere to put it, so the finding lived in somebody's
          head or in an email.

          Severity is the whole decision: a minor finding is corrected inside
          the occurrence, while anything more serious raises linked Available
          work for somebody to own. The procedure enforces that; this form only
          has to ask the question clearly.
        */}
        {task.routineTemplateId && detail.capabilities.canContribute && (
          <section
            className="detail-section drawer-panel-overview"
            aria-labelledby="findings-heading"
          >
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
                        {finding.recordedByName} · {formatMoment(finding.recordedAt, timeZone)}
                      </span>
                      {finding.createdTaskId && (
                        <Link href={`/work?task=${finding.createdTaskId}`} className="btn small">
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
                    Who should own the follow-up? <span className="optional-label">Optional</span>
                  </label>
                  <select id={`finding-owner-${task.id}`} name="followUpOwnerId" defaultValue="">
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
            const assignee = assignablePeople.find((person) => person.id === step.assignedTo);
            const delegated = Boolean(step.assignedTo) && step.assignedTo !== viewerId;
            const firstName = assignee ? (assignee.name.split(' ')[0] ?? assignee.name) : null;

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
            const reassigned = Boolean(previous) && previous?.assignedTo !== step.assignedTo;
            const assignee = assignablePeople.find((person) => person.id === step.assignedTo);
            const firstName = assignee ? (assignee.name.split(' ')[0] ?? assignee.name) : null;

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
          nextAction={nextAction}
          attachmentsByChecklist={attachmentsByChecklist}
          canEdit={detail.capabilities.canEdit}
          canContribute={detail.capabilities.canContribute}
          pending={pending}
          timeZone={timeZone}
          onMarkNextDone={() => saveNextAction(true)}
          onSetNextAction={() => {
            setActiveTab('overview');
            openNextActionEditor();
          }}
          onComplete={(itemId) =>
            startTransition(async () => {
              finish(
                await completeChecklistItem({
                  itemId,
                  idempotencyKey: idempotencyKey(),
                }),
                'Checklist item completed.',
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
                'Checklist item reopened.',
              );
            })
          }
          onEvidence={(item, mode) =>
            setEvidenceDialog({ itemId: item.id, action: item.action, mode })
          }
        />

        <section
          className="task-tab-section drawer-panel-updates"
          aria-labelledby="updates-heading"
        >
          <h3 id="updates-heading">Post an update</h3>

          {/*
            The composer is open as soon as the Updates tab is selected. The tab
            is itself the disclosure section 12.1 asks for — reaching this panel
            is already a deliberate act, so hiding the form behind a second click
            only adds a step. The two-question split is kept: "What happens
            next?" maps onto Do Next, a real concept in the product.
          */}
          {detail.capabilities.canContribute && (
            <form
              key={nextAction ?? 'no-next-action'}
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
                Records what changed. Next action is edited separately, in Overview.
              </p>
            </form>
          )}
          <h3 className="recent-activity-heading">Recent activity</h3>
          <TaskActivityHistory
            activity={detail.activity}
            updates={detail.updates}
            attachments={detail.attachments}
            timeZone={timeZone}
          />
        </section>

        <section
          className="detail-section drawer-panel-overview"
          aria-labelledby="attachments-heading"
        >
          <h3 id="attachments-heading">Attachments and evidence</h3>
          {detail.attachments.length > 0 ? (
            <div className="attachment-list">
              {detail.attachments.map((attachment) => (
                <Link
                  key={attachment.id}
                  href={`/api/attachments/${attachment.id}`}
                  target="_blank"
                  className="attachment-row"
                >
                  <span>
                    <strong>{attachment.fileName}</strong>
                    <small>
                      {attachment.uploadedByName} · {formatMoment(attachment.createdAt, timeZone)}
                    </small>
                  </span>
                  <span>
                    {formatBytes(attachment.byteSize)}
                    {attachment.isEvidence ? ' · Evidence' : ''}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">No files are attached.</p>
          )}
        </section>

        <section
          className="detail-section drawer-panel-overview"
          aria-labelledby="barriers-heading"
        >
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
          {detail.barriers.length === 0 && <p className="muted">No barriers have been raised.</p>}
        </section>

        {task.reviewStatus === 'pending' && detail.capabilities.canReview && (
          <section
            className="detail-section review-panel drawer-panel-overview"
            aria-labelledby="review-heading"
          >
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

        <section className="detail-section detail-two-column drawer-panel-overview">
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
      </div>
    </SideDrawer>
  );
}

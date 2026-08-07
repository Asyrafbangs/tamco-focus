'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { AgeChips } from '@/components/AgeChips';
import { AttachmentPicker } from '@/components/ui/AttachmentPicker';
import { Modal } from '@/components/ui/Modal';
import { ActivityRow, ChecklistItem } from '@/components/ui/ParityPrimitives';
import { SideDrawer } from '@/components/ui/SideDrawer';
import { formatDue } from '@/domain/duration';
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
  completeChecklistItem,
  completeTask,
  decideCompletionReview,
  pauseTask,
  postTaskUpdate,
  raiseBarrier,
  reopenChecklistItem,
  resolveBarrier,
  resumeTask,
  setTaskNextAction,
} from '@/server/actions/task-actions';
import type { TaskDetail } from '@/server/queries';

import { TaskRowActions } from './TaskRowActions';

interface TaskDetailDrawerProps {
  detail: TaskDetail;
  closeHref: string;
  timeZone: string;
  staleThresholdDays: number;
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function eventLabel(eventType: string) {
  return eventType.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function TaskDetailDrawer({
  detail,
  closeHref,
  timeZone,
  staleThresholdDays,
}: TaskDetailDrawerProps) {
  const router = useRouter();
  const task = detail.task;
  const [pending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'overview' | 'checklist' | 'updates'>('overview');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const [ageInfoOpen, setAgeInfoOpen] = useState(false);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [nextAction, setNextAction] = useState<string | null>(task.nextAction);
  const [nextActionDraft, setNextActionDraft] = useState(task.nextAction ?? '');
  const [nextActionEditing, setNextActionEditing] = useState(false);
  const [taskVersion, setTaskVersion] = useState(task.version);
  const [resumeReason, setResumeReason] = useState<ActivationReason | null>(null);
  const [resumeNote, setResumeNote] = useState('');
  const [resumeNeedsReason, setResumeNeedsReason] = useState(false);

  const attachmentsByChecklist = new Map<string, number>();
  for (const attachment of detail.attachments) {
    if (attachment.checklistItemId) {
      attachmentsByChecklist.set(
        attachment.checklistItemId,
        (attachmentsByChecklist.get(attachment.checklistItemId) ?? 0) + 1,
      );
    }
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
    const suppliedNextAction = String(data.get('nextAction') ?? '').trim();
    data.set('taskId', task.id);
    data.set('idempotencyKey', idempotencyKey());
    setMessage(null);
    startTransition(async () => {
      const result = await postTaskUpdate(data);
      if (
        finish(
          result,
          suppliedNextAction ? 'Update posted and Next action refreshed.' : 'Update posted.',
        )
      ) {
        if (suppliedNextAction) {
          setNextAction(suppliedNextAction);
          setNextActionDraft(suppliedNextAction);
        }
        setTaskVersion((current) => current + 1);
        form.reset();
      }
    });
  }

  function openNextActionEditor() {
    setNextActionDraft(nextAction ?? '');
    setNextActionEditing(true);
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
      if (finish(result, 'Evidence attached.')) form.reset();
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
        {detail.capabilities.canContribute && (
          <section
            className={`barrier-callout${
              detail.barriers.some((item) => item.status === 'open') ? ' active' : ''
            }`}
            aria-label="Task support"
          >
            <div>
              <strong>Need support?</strong>
              <p>Raise a barrier before the task becomes overdue.</p>
            </div>
            <button type="button" className="btn small danger" onClick={() => setBarrierOpen(true)}>
              Raise Barrier
            </button>
          </section>
        )}

        <Modal open={ageInfoOpen} title="Task-age indicators" onClose={() => setAgeInfoOpen(false)}>
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
            <div className="task-age-explanation-row">
              <strong>Open age</strong>
              <span>
                Counts from task creation and continues across state changes until the task reaches
                a terminal state.
              </span>
            </div>
            <div className="task-age-explanation-row">
              <strong>Current-state age</strong>
              <span>
                Counts how long the task has remained in its current state and resets when the task
                changes state.
              </span>
            </div>
            <div className="task-age-explanation-row">
              <strong>Overdue age</strong>
              <span>
                Begins only after the due date or due time has passed while the task remains
                incomplete.
              </span>
            </div>
            <div className="task-age-explanation-row">
              <strong>No update</strong>
              <span>
                Shows when no meaningful checklist, progress, evidence, barrier, state, or
                Next-action change was recorded within the configured period.
              </span>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn primary" onClick={() => setAgeInfoOpen(false)}>
              Understood
            </button>
          </div>
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
              {tab === 'overview' ? 'Overview' : tab === 'checklist' ? 'Checklist' : 'Updates'}
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
                  addToMeetingQueue: data.get('meetingQueue') === 'on',
                  idempotencyKey: idempotencyKey(),
                });
                if (finish(result, 'Barrier raised and the relevant people were notified.')) {
                  form.reset();
                  setBarrierOpen(false);
                }
              });
            }}
          >
            <div className="modal-head">
              <div>
                <strong>Raise Barrier</strong>
                <span>Record what is blocking the work and the support you need.</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label="Close Raise Barrier"
                onClick={() => setBarrierOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor={`barrier-${task.id}`}>What is the barrier?</label>
                <textarea
                  id={`barrier-${task.id}`}
                  name="description"
                  rows={3}
                  required
                  maxLength={2000}
                />
              </div>
              <div className="field">
                <label htmlFor={`support-${task.id}`}>What support is needed?</label>
                <textarea
                  id={`support-${task.id}`}
                  name="supportNeeded"
                  rows={2}
                  required
                  maxLength={2000}
                />
              </div>
              <div className="field">
                <label htmlFor={`impact-${task.id}`}>Impact if unresolved</label>
                <select id={`impact-${task.id}`} name="impact" required defaultValue="may_delay">
                  {Object.entries(BARRIER_IMPACT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="check-row">
                <input type="checkbox" name="meetingQueue" /> Add to Meeting Queue
              </label>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setBarrierOpen(false)}>
                Cancel
              </button>
              <button className="btn danger" disabled={pending}>
                {pending ? 'Submitting...' : 'Submit barrier'}
              </button>
            </div>
          </form>
        </Modal>

        <div className="task-metadata-strip drawer-panel-overview" aria-label="Task metadata">
          <span className="task-metadata-chip">
            <span className={`metadata-dot ${task.status}`} aria-hidden="true" />
            <strong>{TASK_STATUS_LABELS[task.status]}</strong>
            <span>Status</span>
          </span>
          <span className="task-metadata-chip">
            <span className="metadata-dot blue" aria-hidden="true" />
            <strong>{formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}</strong>
            <span>{task.routineTemplateId ? 'Occurrence' : 'Due'}</span>
          </span>
          <AgeChips task={task} staleThresholdDays={staleThresholdDays} />
          <button
            type="button"
            className="task-age-info"
            aria-label="Explain task-age indicators"
            title="Explain task-age indicators"
            onClick={() => setAgeInfoOpen(true)}
          >
            i
          </button>
          <span className="task-metadata-chip">
            <span className={`metadata-dot urgency-${task.urgency}`} aria-hidden="true" />
            <strong>{task.urgency[0]?.toUpperCase() + task.urgency.slice(1)}</strong>
            <span>Urgency</span>
          </span>
          <span className="task-metadata-chip progress">
            <span className="task-metadata-progress" aria-hidden="true">
              <span style={{ width: `${task.progressPercent}%` }} />
            </span>
            <strong>{task.progressPercent}%</strong>
            <span>Progress</span>
          </span>
          {task.isMandatory && <span className="flag red">Mandatory</span>}
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
          <h3 id="next-action-heading">Next action</h3>
          <div className="next-action-card">
            {!nextActionEditing ? (
              <div className="next-action-view">
                <div className="next-action-copy" aria-live="polite">
                  <strong className={nextAction ? undefined : 'empty'}>
                    {nextAction ?? 'No next action recorded'}
                  </strong>
                  <span>
                    {nextAction
                      ? `${task.routineTemplateId ? 'Occurrence' : 'Due'}: ${formatDue(
                          task.dueAt,
                          task.dueIsDateOnly,
                          timeZone,
                        )} · Keep this to one practical action sentence.`
                      : 'Add the smallest concrete action that will move this task forward.'}
                  </span>
                  {nextAction && (
                    <small>Marking this action done does not complete the whole task.</small>
                  )}
                </div>
                {detail.capabilities.canEdit && (
                  <div className="next-action-actions">
                    {nextAction && (
                      <button
                        type="button"
                        className="btn small"
                        disabled={pending}
                        onClick={() => saveNextAction(true)}
                      >
                        Mark done
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={pending}
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
                    onClick={() => setNextActionEditing(false)}
                  >
                    Cancel
                  </button>
                  <button className="btn small primary" disabled={pending}>
                    {pending ? 'Saving...' : 'Save next action'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>

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
                        <button className="btn small" disabled={pending}>
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
                        <button className="btn small primary" disabled={pending}>
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
                    >
                      Resume work
                    </button>
                  </div>
                )}
              </div>
            </details>
          </section>
        )}

        <section
          className="task-tab-section drawer-panel-checklist"
          aria-labelledby="checklist-heading"
        >
          <h3 id="checklist-heading">Checklist</h3>
          {nextAction ? (
            <ChecklistItem
              state="ready"
              action={
                detail.capabilities.canEdit ? (
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending}
                    onClick={() => saveNextAction(true)}
                  >
                    Complete
                  </button>
                ) : (
                  <span className="flag blue">Current</span>
                )
              }
            >
              <strong>{nextAction}</strong>
              <span>Current next action · mark done here or update it from Overview.</span>
            </ChecklistItem>
          ) : (
            <div className="next-action-checklist-empty">
              <strong>No next action recorded</strong>
              <span>Set one from Overview or include it with the next progress update.</span>
              {detail.capabilities.canEdit && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setActiveTab('overview');
                    openNextActionEditor();
                  }}
                >
                  + Set next action
                </button>
              )}
            </div>
          )}
          {detail.checklist.map((item) => {
            const evidenceCount = attachmentsByChecklist.get(item.id) ?? 0;
            return (
              <ChecklistItem key={item.id} state={item.state}>
                <div className="checklist-state" aria-hidden="true">
                  {item.state === 'completed' ? '✓' : item.state === 'waiting' ? '…' : '○'}
                </div>
                <div className="checklist-copy">
                  <strong>{item.action}</strong>
                  <span>
                    {item.assignedName ? `Assigned to ${item.assignedName}` : 'Unassigned'}
                    {item.evidenceRule === 'required'
                      ? ' · Evidence required'
                      : item.evidenceRule === 'optional'
                        ? ' · Evidence optional'
                        : ''}
                  </span>
                  {item.completedAt && (
                    <span>
                      Completed {formatMoment(item.completedAt, timeZone)} by {item.completedByName}
                    </span>
                  )}
                  {evidenceCount > 0 && (
                    <span>
                      {evidenceCount} evidence file{evidenceCount === 1 ? '' : 's'} attached
                    </span>
                  )}

                  {detail.capabilities.canContribute &&
                    item.state !== 'completed' &&
                    item.state !== 'waiting' && (
                      <form
                        className="checklist-evidence"
                        onSubmit={(event) => {
                          event.preventDefault();
                          attachChecklistEvidence(event.currentTarget, item.id);
                        }}
                      >
                        <AttachmentPicker
                          label={
                            item.evidenceRule === 'required'
                              ? 'Add required evidence'
                              : 'Add evidence'
                          }
                          required={item.evidenceRule === 'required'}
                          disabled={pending}
                        />
                        <button className="btn small" disabled={pending}>
                          {pending ? 'Uploading…' : 'Upload'}
                        </button>
                      </form>
                    )}
                </div>
                {detail.capabilities.canContribute && item.state === 'ready' && (
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={pending || (item.evidenceRule === 'required' && evidenceCount === 0)}
                    title={
                      item.evidenceRule === 'required' && evidenceCount === 0
                        ? 'Attach required evidence before completing this step'
                        : undefined
                    }
                    onClick={() =>
                      startTransition(async () => {
                        finish(
                          await completeChecklistItem({
                            itemId: item.id,
                            idempotencyKey: idempotencyKey(),
                          }),
                          'Checklist step completed.',
                        );
                      })
                    }
                  >
                    Complete
                  </button>
                )}
                {detail.capabilities.canContribute && item.state === 'completed' && (
                  <button
                    type="button"
                    className="flag green checklist-done-action"
                    aria-label={`Reopen ${item.action}`}
                    title="Reopen this checklist item"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        finish(
                          await reopenChecklistItem({
                            itemId: item.id,
                            reason: 'Reopened from task detail.',
                          }),
                          'Checklist step reopened.',
                        );
                      })
                    }
                  >
                    Done
                  </button>
                )}
              </ChecklistItem>
            );
          })}
        </section>

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
                {detail.capabilities.canEdit ? (
                  <div className="field">
                    <label htmlFor={`update-next-action-${task.id}`}>What happens next?</label>
                    <input
                      id={`update-next-action-${task.id}`}
                      name="nextAction"
                      type="text"
                      maxLength={180}
                      defaultValue={nextAction ?? ''}
                      placeholder="One practical action that moves the task forward"
                    />
                  </div>
                ) : (
                  <p className="muted">
                    The task owner or authorised editor records What happens next.
                  </p>
                )}
              </div>
              <details className="update-options">
                <summary>Update options</summary>
                <label className="check-row">
                  <input type="checkbox" name="evidenceOnly" value="true" /> This is evidence only
                </label>
                {detail.participants.length > 1 && (
                  <fieldset className="mention-list">
                    <legend>Mention participants</legend>
                    {detail.participants.map((person) => (
                      <label key={person.id} className="check-row">
                        <input type="checkbox" name="mentionIds" value={person.id} />{' '}
                        {person.fullName}
                      </label>
                    ))}
                  </fieldset>
                )}
              </details>
              <div className="update-composer-footer">
                {/* "Add files" rather than "Attach": it names the action and the object,
                    and keeping the visible text identical to the accessible name
                    satisfies WCAG 2.5.3 Label in Name. */}
                <AttachmentPicker label="Add files" disabled={pending} />
                <button type="button" className="btn small" onClick={() => setBarrierOpen(true)}>
                  Need support
                </button>
                <button className="btn small primary" disabled={pending}>
                  {pending ? 'Posting…' : 'Post update'}
                </button>
              </div>
            </form>
          )}
          <h3 className="recent-activity-heading">Recent activity</h3>
          <div className="update-history-note">
            <strong>Updates are timestamped automatically</strong>
            <span>A changed next action also updates the task history and stale-work timer.</span>
          </div>
          <div className="activity-list">
            {detail.updates.map((update) => (
              <article key={update.id} className="activity-item">
                <div>
                  <strong>{update.authorName}</strong>
                  <span>{formatMoment(update.createdAt, timeZone)}</span>
                </div>
                <p>{update.body ?? 'Added evidence.'}</p>
                {update.mentionNames.length > 0 && (
                  <small>Mentioned {update.mentionNames.join(', ')}</small>
                )}
                {detail.attachments
                  .filter((attachment) => attachment.updateId === update.id)
                  .map((attachment) => (
                    <Link
                      key={attachment.id}
                      href={`/api/attachments/${attachment.id}`}
                      target="_blank"
                      className="attachment-link"
                    >
                      {attachment.fileName} · {formatBytes(attachment.byteSize)}
                      {attachment.isEvidence ? ' · Evidence' : ''}
                    </Link>
                  ))}
              </article>
            ))}
            {detail.updates.length === 0 && (
              <p className="muted">No updates have been posted yet.</p>
            )}
          </div>
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
            <article key={barrier.id} className={`barrier-record ${barrier.status}`}>
              <div>
                <strong>{BARRIER_IMPACT_LABELS[barrier.impact as BarrierImpact]}</strong>
                <span>
                  {barrier.status === 'open' ? 'Open' : 'Resolved'} ·{' '}
                  {formatMoment(barrier.raisedAt, timeZone)}
                </span>
              </div>
              <p>{barrier.description}</p>
              <p>
                <strong>Support needed:</strong> {barrier.supportNeeded}
              </p>
              {barrier.resolutionNote && (
                <p>
                  <strong>Resolution:</strong> {barrier.resolutionNote}
                </p>
              )}
              {barrier.status === 'open' && detail.capabilities.canEdit && (
                <form
                  className="resolve-barrier"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const note = String(new FormData(form).get('resolutionNote') ?? '');
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
                >
                  <label htmlFor={`resolve-${barrier.id}`}>Resolution note</label>
                  <textarea id={`resolve-${barrier.id}`} name="resolutionNote" required rows={2} />
                  <button className="btn small" disabled={pending}>
                    Resolve barrier
                  </button>
                </form>
              )}
            </article>
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
                <button className="btn primary" name="decision" value="accepted" disabled={pending}>
                  Accept Completion
                </button>
                <button
                  className="btn danger"
                  name="decision"
                  value="changes_requested"
                  disabled={pending}
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

        <section
          className="detail-section drawer-panel-overview"
          aria-labelledby="activity-heading"
        >
          <h3 id="activity-heading">Recent activity</h3>
          <div className="history-list">
            {detail.activity.slice(0, 5).map((event) => (
              <ActivityRow
                key={event.id}
                title={eventLabel(event.eventType)}
                actor={event.actorName}
                timestamp={formatMoment(event.occurredAt, timeZone)}
              />
            ))}
          </div>
          {detail.activity.length > 5 && (
            <details className="full-history">
              <summary>Full history ({detail.activity.length} events)</summary>
              <div className="history-list">
                {detail.activity.slice(5).map((event) => (
                  <ActivityRow
                    key={event.id}
                    title={eventLabel(event.eventType)}
                    actor={event.actorName}
                    timestamp={formatMoment(event.occurredAt, timeZone)}
                  />
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
    </SideDrawer>
  );
}

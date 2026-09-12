'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

import { AttachmentPicker } from '@/components/ui/AttachmentPicker';
import { Modal } from '@/components/ui/Modal';
import { SideDrawer } from '@/components/ui/SideDrawer';
import { ActivityRow, ProgressIndicator, StatusBadge } from '@/components/ui/ParityPrimitives';
import { GOAL_STATUS_LABELS, goalDisplayHealth } from '@/domain/goals';
import { GoalLifecycleCheckIn } from '@/components/goals/GoalLifecycleCheckIn';
import type { OperationResult } from '@/domain/types';
import {
  agreeGoalVersion,
  cancelGoal,
  completeGoal,
  linkGoalWork,
  postGoalMilestoneUpdate,
  proposeGoalVersion,
  requestGoalUpdate,
  resolveGoalSupport,
  type GoalMilestoneInput,
} from '@/server/actions/goal-actions';
import type { GoalDetail, GoalMilestone } from '@/server/goal-queries';
import { resolveBarrier } from '@/server/actions/task-actions';

import styles from './GoalDetailDrawer.module.css';

interface WorkOption {
  id: string;
  title: string;
}

function idempotencyKey() {
  return crypto.randomUUID();
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(
    new Date(value.length === 10 ? `${value}T12:00:00Z` : value),
  );
}

function formatMoment(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function eventLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

/**
 * Progress control shared by the milestone check-in and the overall goal
 * update.
 *
 * Implements the approved v34 pattern (`goal-range-ticks` / `goal-range-caption`
 * in the prototype, and PRODUCTION_LOGIC.md "V34 — Goal weighting and
 * milestone-update rules" item 5):
 *
 *   - 5% increments, matching the prototype's `step="5"`
 *   - direct numeric entry alongside the slider, kept in sync
 *   - the control initialises from the PERSISTED value, and any movement is
 *     shown as an unsaved new value until Save update commits it
 *
 * One component rather than two copies, so the milestone and goal sliders
 * cannot drift apart.
 */
function ProgressRange({
  id,
  label,
  saved,
  value,
  onChange,
  name,
}: {
  id: string;
  label: string;
  saved: number;
  value: number;
  onChange: (next: number) => void;
  name?: string;
}) {
  const dirty = value !== saved;
  const clamp = (next: number) => Math.min(100, Math.max(0, Math.round(next / 5) * 5));

  return (
    <div className={`${styles.progressCard} field full`}>
      <label htmlFor={id}>
        {label} <output htmlFor={id}>New {value}%</output>
      </label>

      <div className="goal-range">
        <input
          id={id}
          name={name}
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-describedby={`${id}-saved`}
        />

        {/* Direct percentage entry for people who know the number and do not
            want to drag to it. */}
        <input
          className="goal-range-number"
          type="number"
          min={0}
          max={100}
          step={5}
          value={value}
          /* Deliberately not "{label} percentage": that name contains the
             slider's own label, so both controls would answer to a query for
             it. This is the secondary entry beside the slider. */
          aria-label="Progress percentage"
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
        />
      </div>

      <div className="goal-range-ticks" aria-hidden="true">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
      <div className="goal-range-caption" aria-hidden="true">
        <span>Not started</span>
        <span>Complete</span>
      </div>

      {/* The saved value stays visible so an unsaved change is never mistaken
          for committed progress. */}
      <p className="goal-range-saved" id={`${id}-saved`}>
        Saved progress {saved}%
        {dirty && <span className="goal-range-new"> · new value {value}% (not saved yet)</span>}
      </p>
    </div>
  );
}

function MilestoneUpdateForm({
  goalId,
  goalVersion,
  milestone,
  current = false,
  openRequest = 0,
  onGeneralNote,
  pending,
  finish,
}: {
  goalId: string;
  goalVersion: number;
  milestone: GoalMilestone;
  current?: boolean;
  openRequest?: number;
  onGeneralNote?: () => void;
  pending: boolean;
  finish: (result: OperationResult, success: string) => boolean;
}) {
  const [progress, setProgress] = useState(milestone.progressPercent);
  const [open, setOpen] = useState(openRequest > 0);
  const [markComplete, setMarkComplete] = useState(false);
  const [supportRequested, setSupportRequested] = useState(false);
  const [localPending, startTransition] = useTransition();
  const busy = pending || localPending;

  return (
    <article
      className={`goal-milestone${milestone.progressPercent === 100 ? ' completed' : ''}${current ? ` ${styles.currentMilestone}` : ''}`}
    >
      <button
        type="button"
        className="goal-milestone-summary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="goal-milestone-state" aria-hidden="true">
          {milestone.progressPercent === 100 ? '✓' : current ? '→' : '○'}
        </span>
        <span>
          <strong>{milestone.title}</strong>
          <small>{milestone.completionDefinition}</small>
        </span>
        <span className="goal-milestone-progress">
          <strong>{milestone.progressPercent}%</strong>
          <small>{milestone.weightPercent}% weight</small>
        </span>
      </button>
      <button
        type="button"
        className={`${styles.milestoneAction} btn small${current ? ' primary' : ''}`}
        onClick={() => setOpen(true)}
      >
        {milestone.progressPercent === 100 ? 'Add note' : 'Update'}
      </button>

      <Modal
        open={open}
        title={`Update ${milestone.title}`}
        onClose={() => setOpen(false)}
        className={styles.updateDrawer}
      >
        <header className="modalhead">
          <div>
            <p className="eyebrow">Goal check-in</p>
            <h2>{milestone.title}</h2>
            <p className="sub">
              Update progress, record what changed and attach evidence when useful.
            </p>
          </div>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setOpen(false)}
            aria-label="Close milestone update"
          >
            &times;
          </button>
        </header>
        <form
          className={styles.updateForm}
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            data.set('goalId', goalId);
            data.set('milestoneId', milestone.id);
            data.set('expectedVersion', String(goalVersion));
            data.set('progress', String(progress));
            data.set('idempotencyKey', idempotencyKey());
            data.set('markComplete', String(markComplete));
            startTransition(async () => {
              const result = await postGoalMilestoneUpdate(data);
              if (
                finish(result, markComplete ? 'Milestone completed.' : 'Milestone update posted.')
              ) {
                form.reset();
                setOpen(false);
                setMarkComplete(false);
                setSupportRequested(false);
              }
            });
          }}
        >
          <div className={styles.updateBody}>
            <p className={styles.progressSource}>
              <strong>One progress value:</strong> overall goal progress is calculated from the
              agreed milestone weights.
            </p>
            <div className={styles.updateContext}>
              <div>
                <strong>{milestone.title}</strong>
                <span>Saved progress {milestone.progressPercent}%</span>
              </div>
              {onGeneralNote && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setOpen(false);
                    onGeneralNote();
                  }}
                >
                  General goal note
                </button>
              )}
            </div>
            <ProgressRange
              id={`milestone-progress-${milestone.id}`}
              label="Milestone progress"
              saved={milestone.progressPercent}
              value={progress}
              onChange={setProgress}
            />
            <div className="field full">
              <label htmlFor={`milestone-comment-${milestone.id}`}>What changed? *</label>
              <textarea
                id={`milestone-comment-${milestone.id}`}
                name="comment"
                required
                rows={4}
                maxLength={4000}
                placeholder="Describe the result, decision, or progress made."
              />
            </div>
            <AttachmentPicker label="Add evidence" hint="File, photo or screenshot · optional" />
            <details className={styles.moreFields}>
              <summary>Add next step or request support</summary>
              <div className="field full">
                <label htmlFor={`milestone-next-${milestone.id}`}>
                  Next step <span className="sub">Optional</span>
                </label>
                <textarea
                  id={`milestone-next-${milestone.id}`}
                  name="nextStep"
                  rows={2}
                  maxLength={4000}
                />
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  name="supportRequested"
                  checked={supportRequested}
                  disabled={markComplete}
                  onChange={(event) => setSupportRequested(event.target.checked)}
                />{' '}
                I need support
              </label>
              {supportRequested && (
                <div className="field full">
                  <label htmlFor={`milestone-support-${milestone.id}`}>Support needed *</label>
                  <textarea
                    id={`milestone-support-${milestone.id}`}
                    name="supportDetails"
                    required
                    rows={2}
                    maxLength={4000}
                  />
                </div>
              )}
            </details>
            {milestone.progressPercent < 100 && (
              <label className={styles.completeControl}>
                <input
                  type="checkbox"
                  checked={markComplete}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setMarkComplete(checked);
                    if (checked) {
                      setProgress(100);
                      setSupportRequested(false);
                    }
                  }}
                />
                <span>
                  <strong>Mark this milestone complete</strong>
                  <small>Progress will be set to 100% when this update is saved.</small>
                </span>
              </label>
            )}
          </div>
          <footer className={styles.updateFooter}>
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              Save update
            </button>
          </footer>
        </form>
      </Modal>
    </article>
  );
}

function GoalVersionEditor({
  detail,
  pending,
  finish,
  open,
  setOpen,
}: {
  detail: GoalDetail;
  pending: boolean;
  finish: (result: OperationResult, success: string) => boolean;
  open: boolean;
  setOpen: (next: boolean) => void;
}) {
  const editableVersion = detail.pendingVersion ?? detail.activeVersion;
  const [milestones, setMilestones] = useState<GoalMilestoneInput[]>(
    () =>
      editableVersion?.milestones.map((milestone) => ({
        source_milestone_id: milestone.id,
        title: milestone.title,
        completion_definition: milestone.completionDefinition,
        weight_percent: milestone.weightPercent,
        progress_percent: milestone.progressPercent,
      })) ?? [],
  );
  const [successMeasures, setSuccessMeasures] = useState(
    () =>
      editableVersion?.successMeasures.map((measure) => ({
        description: measure.description,
        optionalTargetDate: measure.optionalTargetDate,
      })) ?? [],
  );
  const [, startTransition] = useTransition();
  if (!editableVersion) return null;

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= milestones.length) return;
    setMilestones((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination]!, next[index]!];
      return next;
    });
  }

  return (
    <section className="goal-structure-editor">
      <button type="button" className="btn small" onClick={() => setOpen(!open)}>
        {open ? 'Cancel editing' : detail.goal.status === 'active' ? 'Revise goal' : 'Edit draft'}
      </button>
      {/*
        Section 15.4 — an employee may change their own goal, but the change
        does not take effect until their manager agrees it. Saying so before
        they start writing is fairer than telling them afterwards.
      */}
      {!open && (
        <p className={styles.editorHint}>
          {detail.goal.status === 'active'
            ? 'The current agreement stays active until the manager agrees this audited revision.'
            : 'You and your manager edit the same Goal record before activation.'}
        </p>
      )}
      {open && (
        <form
          className="detail-form card inset"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const submissionMode =
              (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft'
                ? 'draft'
                : 'discussion';
            startTransition(async () => {
              const result = await proposeGoalVersion({
                goalId: detail.goal.id,
                expectedVersion: detail.goal.version,
                expectedResult: String(data.get('expectedResult')),
                successMeasures,
                targetDate: String(data.get('targetDate')),
                employeeApproach: String(data.get('employeeApproach') ?? '') || null,
                supportAgreed: String(data.get('supportAgreed') ?? '') || null,
                dependencies: String(data.get('dependencies') ?? '') || null,
                baseline: String(data.get('baseline') ?? '') || null,
                purpose: String(data.get('purpose') ?? '') || null,
                weightPercent: Number(data.get('weightPercent') || 0),
                milestones,
                submissionMode,
                revisionReason: String(data.get('revisionReason') ?? '') || null,
                idempotencyKey: idempotencyKey(),
              });
              if (finish(result, 'Changes saved as a new version for discussion.')) setOpen(false);
            });
          }}
        >
          <div className="notice">
            <strong>
              {detail.goal.status === 'active'
                ? 'Current agreement stays active'
                : 'One shared Goal'}
            </strong>
            <p>
              {detail.goal.status === 'active'
                ? 'This revision is recorded as a new version and takes effect only after manager agreement.'
                : 'Both people work on this same Draft or For Discussion record. No duplicate Goal is created.'}
            </p>
          </div>
          {detail.goal.status === 'active' && (
            <div className="field">
              <label htmlFor={`goal-revision-reason-${detail.goal.id}`}>
                Why is the agreement changing?
              </label>
              <textarea
                id={`goal-revision-reason-${detail.goal.id}`}
                name="revisionReason"
                rows={2}
                maxLength={2000}
                required
                placeholder="Record the reason for this audited revision."
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="edit-goal-result">Expected result</label>
            <input
              id="edit-goal-result"
              name="expectedResult"
              defaultValue={editableVersion.expectedResult}
              required
              maxLength={500}
            />
          </div>
          <section className={styles.leanMeasureEditor} aria-labelledby="edit-goal-measures">
            <div className="sectionhead">
              <div>
                <h3 id="edit-goal-measures">How will success be measured?</h3>
                <p>Use the natural result statements you would discuss together.</p>
              </div>
              <button
                type="button"
                className="btn small"
                disabled={successMeasures.length >= 10}
                onClick={() =>
                  setSuccessMeasures((current) => [
                    ...current,
                    { description: '', optionalTargetDate: null },
                  ])
                }
              >
                + Add measure
              </button>
            </div>
            {successMeasures.map((measure, index) => (
              <div className={styles.leanMeasureInput} key={index}>
                <span>{index + 1}</span>
                <div className="field">
                  <label className="sr-only" htmlFor={`edit-goal-measure-${index}`}>
                    Success measure {index + 1}
                  </label>
                  <input
                    id={`edit-goal-measure-${index}`}
                    value={measure.description}
                    required
                    maxLength={1000}
                    onChange={(event) =>
                      setSuccessMeasures((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, description: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`edit-goal-measure-date-${index}`}>
                    Different due date <span className="sub">Optional</span>
                  </label>
                  <input
                    id={`edit-goal-measure-date-${index}`}
                    type="date"
                    value={measure.optionalTargetDate ?? ''}
                    onChange={(event) =>
                      setSuccessMeasures((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, optionalTargetDate: event.target.value || null }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
                {successMeasures.length > 1 && (
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() =>
                      setSuccessMeasures((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </section>
          <div className="field">
            <label htmlFor="edit-goal-date">Target date</label>
            <input
              id="edit-goal-date"
              name="targetDate"
              type="date"
              defaultValue={editableVersion.targetDate}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="edit-goal-weight">Goal weight (%)</label>
            <input
              id="edit-goal-weight"
              name="weightPercent"
              type="number"
              min={0}
              max={100}
              defaultValue={editableVersion.weightPercent}
              readOnly={detail.goal.status === 'active' && !detail.capabilities.canAgree}
            />
          </div>
          <details>
            <summary>Supporting context</summary>
            <div className="detail-form">
              <div className="field">
                <label htmlFor="edit-goal-approach">Agreed approach</label>
                <textarea
                  id="edit-goal-approach"
                  name="employeeApproach"
                  defaultValue={editableVersion.employeeApproach ?? ''}
                  rows={2}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-goal-support">Support needed · Optional</label>
                <textarea
                  id="edit-goal-support"
                  name="supportAgreed"
                  defaultValue={editableVersion.supportAgreed ?? ''}
                  rows={2}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-goal-dependencies">Dependencies / risks · Optional</label>
                <textarea
                  id="edit-goal-dependencies"
                  name="dependencies"
                  defaultValue={editableVersion.dependencies ?? ''}
                  rows={2}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-goal-baseline">Baseline</label>
                <textarea
                  id="edit-goal-baseline"
                  name="baseline"
                  defaultValue={editableVersion.baseline ?? ''}
                  rows={2}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-goal-purpose">Purpose</label>
                <textarea
                  id="edit-goal-purpose"
                  name="purpose"
                  defaultValue={editableVersion.purpose ?? ''}
                  rows={2}
                />
              </div>
            </div>
          </details>
          <div className="sectionhead">
            <div>
              <h3>Milestones · Optional</h3>
              <p>Add checkpoints only when they make the Goal easier to manage.</p>
            </div>
            <button
              type="button"
              className="btn small"
              disabled={milestones.length >= 5}
              onClick={() =>
                setMilestones((current) => [
                  ...current,
                  {
                    title: '',
                    completion_definition: '',
                    weight_percent: null,
                    progress_percent: 0,
                  },
                ])
              }
            >
              Add
            </button>
          </div>
          {milestones.map((milestone, index) => (
            <div
              className="goal-milestone-edit compact"
              key={milestone.source_milestone_id ?? index}
            >
              <span className="goal-milestone-number">{index + 1}</span>
              <div className="field">
                <label htmlFor={`edit-ms-title-${index}`}>Result</label>
                <input
                  id={`edit-ms-title-${index}`}
                  value={milestone.title}
                  required
                  onChange={(event) =>
                    setMilestones((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, title: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`edit-ms-done-${index}`}>Definition of done</label>
                <textarea
                  id={`edit-ms-done-${index}`}
                  value={milestone.completion_definition}
                  required
                  rows={2}
                  onChange={(event) =>
                    setMilestones((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, completion_definition: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </div>
              <div className="milestone-reorder">
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${milestone.title || `milestone ${index + 1}`} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => move(index, 1)}
                  disabled={index === milestones.length - 1}
                  aria-label={`Move ${milestone.title || `milestone ${index + 1}`} down`}
                >
                  ↓
                </button>
                {
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() =>
                      setMilestones((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                }
              </div>
            </div>
          ))}
          <div className="modal-actions">
            {detail.goal.status !== 'active' && (
              <button type="submit" className="btn" value="draft" disabled={pending}>
                Save draft
              </button>
            )}
            <button
              type="submit"
              className="btn primary"
              value="discussion"
              disabled={pending}
              aria-busy={pending}
            >
              {detail.goal.status === 'active' ? 'Save revision' : 'Save for discussion'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function GoalWorkLinkControl({
  detail,
  options,
  pending,
  onSubmit,
}: {
  detail: GoalDetail;
  options: WorkOption[];
  pending: boolean;
  onSubmit: (data: FormData) => void;
}) {
  return (
    <details className={styles.linkWorkDisclosure}>
      <summary className="btn small">+ Link work</summary>
      <form
        className="goal-link-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <div className="field">
          <label htmlFor={`goal-work-${detail.goal.id}`}>Work item</label>
          <select id={`goal-work-${detail.goal.id}`} name="taskId" required defaultValue="">
            <option value="" disabled>
              Select visible work
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`goal-work-milestone-${detail.goal.id}`}>
            Milestone <span className="sub">Optional</span>
          </label>
          <select id={`goal-work-milestone-${detail.goal.id}`} name="milestoneId" defaultValue="">
            <option value="">Overall Goal</option>
            {detail.activeVersion?.milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" disabled={pending} aria-busy={pending}>
          Link work
        </button>
      </form>
    </details>
  );
}

export function GoalDetailDrawer({
  detail,
  closeHref,
  timeZone,
  initialAction,
  workOptions,
}: {
  detail: GoalDetail;
  closeHref: string;
  timeZone: string;
  initialAction?: string;
  workOptions: WorkOption[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'success' | 'checkin' | 'milestones' | 'history'>(
    initialAction === 'edit' ? 'milestones' : initialAction === 'update' ? 'checkin' : 'success',
  );
  const [milestoneOpenRequest, setMilestoneOpenRequest] = useState(0);
  // Editing the goal itself lives on the milestones tab, because the milestones
  // are the part people actually change. Arriving with `action=edit` opens it
  // directly rather than making someone hunt for it.
  const [structureOpen, setStructureOpen] = useState(initialAction === 'edit');

  /*
   * `?action=update` is a one-shot instruction: open this when I arrive. It is
   * not state, and leaving it in the URL made it behave like state.
   *
   * Completing a milestone moves it into the collapsed "done" group, which
   * re-orders the list and remounts the check-in form. On remount the form
   * re-read `action=update` and reopened itself — so saving appeared to do
   * nothing, even though the milestone had been saved. Consuming the parameter
   * once, as soon as it has been acted on, means a later re-render cannot
   * replay it.
   */
  useEffect(() => {
    if (!initialAction) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('action')) return;
    url.searchParams.delete('action');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [initialAction]);

  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  function finish(result: OperationResult, success: string) {
    if (result.ok) {
      setMessage({ tone: 'success', text: success });
      router.refresh();
      return true;
    }
    setMessage({ tone: 'error', text: result.message });
    return false;
  }

  /*
   * v34 splits the milestone list: completed ones collapse behind a summary so
   * the current milestone stays prominent. Derived rather than stored, because
   * "completed" is simply 100% progress.
   */
  const allMilestones = useMemo(
    () => (detail.activeVersion ?? detail.pendingVersion)?.milestones ?? [],
    [detail.activeVersion, detail.pendingVersion],
  );
  const completedMilestones = useMemo(
    () => allMilestones.filter((milestone) => milestone.progressPercent === 100),
    [allMilestones],
  );
  const openMilestones = useMemo(
    () => allMilestones.filter((milestone) => milestone.progressPercent < 100),
    [allMilestones],
  );
  const currentMilestone = openMilestones[0] ?? allMilestones.at(-1) ?? null;
  const displayVersion = detail.activeVersion ?? detail.pendingVersion;
  const latestMonthly = detail.checkIns.find((checkIn) => checkIn.checkinType === 'monthly');

  /*
   * Which milestone the `?action=update` request was actually for, captured
   * once at mount.
   *
   * It used to be delivered by position — "whichever is first" — and position
   * is not stable. Completing a milestone moves it into the collapsed "done"
   * group, so the next one shifts into first place, remounts holding a request
   * meant for its predecessor, and reopens the dialog the person just closed.
   * Saving therefore looked like it had failed, when it had in fact succeeded.
   *
   * Binding the request to an id means re-ordering cannot misdeliver it.
   */
  const [requestedMilestoneId] = useState<string | null>(() => currentMilestone?.id ?? null);

  const timeline = useMemo(
    () =>
      [
        ...detail.updates.map((update) => ({
          id: update.id,
          title: goalDisplayHealth(detail.goal),
          body: update.whatChanged,
          secondary: update.nextStep,
          actor: update.authorName,
          occurredAt: update.createdAt,
          attachments: detail.attachments.filter((item) => item.goalUpdateId === update.id),
        })),
        ...detail.milestoneUpdates.map((update) => ({
          id: update.id,
          title: `${update.milestoneTitle} · ${goalDisplayHealth(detail.goal)}`,
          body:
            update.comment ??
            (update.markedComplete ? 'Milestone completed.' : 'Milestone progress updated.'),
          secondary: null,
          actor: update.authorName,
          occurredAt: update.createdAt,
          attachments: detail.attachments.filter((item) => item.milestoneUpdateId === update.id),
        })),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [detail.attachments, detail.goal, detail.milestoneUpdates, detail.updates],
  );

  const linkedIds = new Set(detail.workLinks.map((link) => link.taskId));
  const availableWorkOptions = workOptions.filter((option) => !linkedIds.has(option.id));

  function openPrimaryUpdate() {
    setActiveTab('checkin');
  }

  return (
    <SideDrawer
      closeHref={closeHref}
      closeLabel="Close Goal detail"
      returnFocusTo={`goal-${detail.goal.id}`}
      eyebrow={`${detail.goal.category[0]!.toUpperCase()}${detail.goal.category.slice(1)} goal`}
      title={detail.goal.title}
      titleId="goal-detail-title"
      className="goal-detail-drawer"
      meta={
        <>
          <span>{detail.goal.ownerName}</span>
          <span>{GOAL_STATUS_LABELS[detail.goal.status]}</span>
          <span>
            {detail.goal.agreedAt
              ? `Agreed ${formatDate(detail.goal.agreedAt, timeZone)}`
              : `Target ${formatDate(detail.goal.targetDate, timeZone)}`}
          </span>
        </>
      }
      actions={
        <>
          {/*
            A pending version is already awaiting agreement, so a second edit
            would race it. The state is named rather than the button silently
            missing.
          */}
          {detail.capabilities.canEditStructure &&
            (detail.goal.status === 'active' && detail.goal.pendingVersionId ? (
              <span className="flag amber">Change awaiting agreement</span>
            ) : (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setActiveTab('milestones');
                  setStructureOpen(true);
                }}
              >
                {detail.goal.status === 'active' ? 'Revise goal' : 'Edit draft'}
              </button>
            ))}
          {/*
            No aria-label on the control below. It read "Open employee-level
            Goal session history", which does not contain the visible word — so
            the accessible name and the label disagreed (WCAG 2.5.3), and
            anybody driving this by voice could not say "Sessions" and have it
            work.
          */}
          {detail.capabilities.canUpdate && detail.goal.status === 'active' && (
            <button type="button" className="btn small primary" onClick={openPrimaryUpdate}>
              Sessions
            </button>
          )}
        </>
      }
    >
      <div className="task-detail-scroll goal-detail-scroll">
        <nav className="drawer-tabs" aria-label="Goal details" role="tablist">
          {(
            [
              ['success', 'Success'],
              ['checkin', 'Sessions'],
              ['milestones', 'Milestones'],
              ['history', 'History'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              className={activeTab === key ? 'active' : undefined}
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        {message && (
          <div className={`notice ${message.tone}`} role="status">
            <strong>{message.tone === 'success' ? 'Saved' : 'Action needed'}</strong>
            <p>{message.text}</p>
          </div>
        )}

        {activeTab === 'success' && (
          <>
            {detail.goal.pendingVersionId && detail.pendingVersion && (
              <section className="goal-pending-version">
                <div>
                  <StatusBadge tone="purple">Changes awaiting agreement</StatusBadge>
                  <h3>Version {detail.pendingVersion.versionNumber} is ready for discussion</h3>
                  <p>
                    {detail.goal.activeVersionNumber
                      ? `The active agreement remains version ${detail.goal.activeVersionNumber}. Review the revised result, target and optional milestones before agreeing.`
                      : 'Review the result, success measures, target and formal weight before activation.'}
                  </p>
                </div>
                {detail.capabilities.canAgree && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() =>
                      startTransition(async () => {
                        finish(
                          await agreeGoalVersion({
                            goalId: detail.goal.id,
                            pendingVersionId: detail.pendingVersion!.id,
                            expectedVersion: detail.goal.version,
                            idempotencyKey: idempotencyKey(),
                          }),
                          detail.goal.activeVersionId
                            ? 'The revised Goal is now active.'
                            : 'The Goal is agreed and active.',
                        );
                      })
                    }
                  >
                    {detail.goal.activeVersionId ? 'Agree revision' : 'Agree & activate'}
                  </button>
                )}
              </section>
            )}

            <p className={styles.progressSource}>
              <strong>Success comes first.</strong> These agreed result statements define what
              achievement means; milestones are optional checkpoints.
            </p>

            <section className={styles.measureList} aria-labelledby="goal-success-measures">
              <div className={styles.milestoneHeader}>
                <div>
                  <h3 id="goal-success-measures">Success measures</h3>
                  <p>Actual results stay against agreed targets without inventing a percentage.</p>
                </div>
                <span className="flag blue">
                  {displayVersion?.successMeasures.length ?? 0} agreed
                </span>
              </div>
              {displayVersion?.successMeasures.map((measure) => (
                <article className={styles.measureRow} key={measure.id}>
                  <div>
                    <strong>{measure.description}</strong>
                    <span>
                      {measure.measureType === 'qualitative'
                        ? `${measure.currentState?.replaceAll('_', ' ') ?? 'not started'} → ${measure.targetText}`
                        : `${measure.currentNumeric ?? 0}${measure.unit ? ` ${measure.unit}` : ''} of ${measure.targetNumeric}${measure.unit ? ` ${measure.unit}` : ''}`}
                      {measure.period ? ` · ${measure.period}` : ''}
                    </span>
                  </div>
                  <small className={styles.measureDue}>
                    {measure.optionalTargetDate
                      ? `Due ${formatDate(measure.optionalTargetDate, timeZone)}`
                      : `Uses Goal target date · ${formatDate(detail.goal.targetDate, timeZone)}`}
                  </small>
                  <span className={styles.measureActual}>
                    {measure.actualResult
                      ? `Actual result: ${measure.actualResult}`
                      : 'Actual result will be recorded at completion.'}
                  </span>
                </article>
              ))}
            </section>

            <section className={`goal-progress-hero ${styles.progressHero}`}>
              <div className={styles.goalHeroCard}>
                <div className={styles.goalHeroTop}>
                  <div>
                    <strong>{goalDisplayHealth(detail.goal)}</strong>
                    <span>Current health · reported through employee-level sessions</span>
                  </div>
                  <StatusBadge
                    tone={
                      detail.goal.health === 'support_requested' ||
                      detail.goal.health === 'off_track'
                        ? 'red'
                        : detail.goal.health === 'need_attention' ||
                            detail.goal.health === 'at_risk'
                          ? 'amber'
                          : 'green'
                    }
                  >
                    {goalDisplayHealth(detail.goal)}
                  </StatusBadge>
                </div>
                <div className={styles.goalHeroMeta}>
                  <span>
                    <b>Target</b> {formatDate(detail.goal.targetDate, timeZone)}
                  </span>
                  <span>
                    <b>Weight</b> {detail.goal.weightPercent}%
                  </span>
                  <span>
                    <b>Updated</b> {formatDate(detail.goal.lastMeaningfulUpdateAt, timeZone)}
                  </span>
                </div>
              </div>
            </section>

            {detail.goal.status === 'active' && (
              <section className={styles.cadencePreview} aria-label="Goal check-in summary">
                <div>
                  <span>Monthly check-in</span>
                  <strong>
                    {detail.goal.isMonthlyCheckinDue
                      ? `Due ${formatDate(detail.goal.nextMonthlyCheckinDate, timeZone)}`
                      : 'Recorded for this month'}
                  </strong>
                  {latestMonthly && (
                    <small>
                      {latestMonthly.noMaterialChange
                        ? 'No material change'
                        : (latestMonthly.employeeSummary ?? 'Check-in recorded')}
                    </small>
                  )}
                </div>
                <div>
                  <span>Next quarterly discussion</span>
                  <strong>{formatDate(detail.goal.nextQuarterlyCheckinDate, timeZone)}</strong>
                  <small>Review progress, blockers and support together.</small>
                </div>
                {detail.capabilities.canUpdate && (
                  /* Named apart from the header control: two buttons reading
                     "Sessions" in one dialog is ambiguous out of context. */
                  <button type="button" className="btn small" onClick={openPrimaryUpdate}>
                    View sessions
                  </button>
                )}
              </section>
            )}

            {detail.supportRequests
              .filter((support) => support.status !== 'resolved' && support.sourceActive)
              .map((support) => (
                <section className="goal-support-callout" key={support.id}>
                  <div>
                    <StatusBadge tone="red">Support requested</StatusBadge>
                    <p>{support.details}</p>
                    <span className="sub">
                      {support.requestedByName} · {formatMoment(support.createdAt, timeZone)}
                    </span>
                  </div>
                  {detail.capabilities.canAgree && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const note = String(
                          new FormData(event.currentTarget).get('resolutionNote'),
                        );
                        startTransition(async () => {
                          finish(
                            support.sourceKind === 'action_request'
                              ? await resolveBarrier({
                                  barrierId: support.id,
                                  resolutionNote: note,
                                })
                              : await resolveGoalSupport({
                                  supportRequestId: support.id,
                                  resolutionNote: note,
                                  idempotencyKey: idempotencyKey(),
                                }),
                            'Support request resolved.',
                          );
                        });
                      }}
                    >
                      <div className="field">
                        <label htmlFor={`resolve-${support.id}`}>Resolution</label>
                        <textarea
                          id={`resolve-${support.id}`}
                          name="resolutionNote"
                          required
                          rows={2}
                        />
                      </div>
                      <button className="btn small primary" disabled={pending} aria-busy={pending}>
                        Resolve support
                      </button>
                    </form>
                  )}
                </section>
              ))}

            <section className={styles.outcome}>
              <span>Agreed outcome</span>
              <strong>{detail.goal.expectedResult ?? 'Ready for discussion'}</strong>
            </section>

            {currentMilestone && (
              <section className={styles.currentFocus}>
                <div className={styles.currentFocusHead}>
                  <div>
                    <strong>Current milestone &middot; {currentMilestone.title}</strong>
                    <span>{currentMilestone.completionDefinition}</span>
                  </div>
                  {detail.capabilities.canUpdate && (
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => {
                        setActiveTab('milestones');
                        setMilestoneOpenRequest((current) => current + 1);
                      }}
                    >
                      Update milestone
                    </button>
                  )}
                </div>
                <ProgressIndicator value={currentMilestone.progressPercent} />
              </section>
            )}

            <div className={styles.agreementDetails}>
              <details open>
                <summary>Success measures</summary>
                <p>{detail.goal.successMeasure ?? 'Not recorded'}</p>
              </details>
              <details>
                <summary>Agreed approach</summary>
                <p>{detail.goal.employeeApproach ?? 'Not recorded'}</p>
              </details>
              <details>
                <summary>Support needed</summary>
                <p>{detail.goal.supportAgreed ?? 'Not recorded'}</p>
              </details>
              <details>
                <summary>Baseline and purpose</summary>
                <p>
                  <b>Current position:</b> {detail.goal.baseline ?? 'Not recorded'}
                  <br />
                  <br />
                  <b>Why it matters:</b> {detail.goal.purpose ?? 'Not recorded'}
                </p>
              </details>
            </div>

            {detail.capabilities.canAgree && detail.goal.status === 'active' && (
              <div className={styles.managerActions}>
                <button
                  type="button"
                  className="btn small"
                  disabled={pending}
                  aria-busy={pending}
                  onClick={() =>
                    startTransition(async () => {
                      finish(
                        await requestGoalUpdate({
                          goalId: detail.goal.id,
                          expectedVersion: detail.goal.version,
                          idempotencyKey: idempotencyKey(),
                        }),
                        'Update request sent.',
                      );
                    })
                  }
                >
                  Request update
                </button>
              </div>
            )}
          </>
        )}

        {activeTab === 'checkin' && (
          <GoalLifecycleCheckIn detail={detail} timeZone={timeZone} finish={finish} />
        )}

        {activeTab === 'milestones' && (
          <section className="goal-milestone-list">
            <div className={styles.milestoneHeader}>
              <div>
                <h3>Agreed milestones</h3>
                <p>Update the result, comment and evidence through one short check-in.</p>
              </div>
              {detail.capabilities.canEditStructure && (
                <GoalVersionEditor
                  key={detail.pendingVersion?.id ?? detail.activeVersion?.id}
                  detail={detail}
                  pending={pending}
                  finish={finish}
                  open={structureOpen}
                  setOpen={setStructureOpen}
                />
              )}
            </div>
            {/*
              v34: completed milestones are collapsed by default so the current
              one stays prominent ("Collapsed completed milestones and kept the
              current milestone visually prominent"). They remain one keystroke
              away rather than hidden — a native <details> is keyboard operable
              and announced by assistive technology without extra ARIA.
            */}
            {completedMilestones.length > 0 && (
              <details className="goal-milestones-done">
                <summary>
                  <span>
                    / {completedMilestones.length} completed milestone
                    {completedMilestones.length === 1 ? '' : 's'}
                  </span>
                  <span>View</span>
                </summary>
                {completedMilestones.map((milestone) => (
                  <MilestoneUpdateForm
                    key={milestone.id}
                    goalId={detail.goal.id}
                    goalVersion={detail.goal.version}
                    milestone={milestone}
                    onGeneralNote={() => setActiveTab('checkin')}
                    pending={pending}
                    finish={finish}
                  />
                ))}
              </details>
            )}

            {openMilestones.map((milestone, index) => (
              <MilestoneUpdateForm
                key={index === 0 ? `${milestone.id}:${milestoneOpenRequest}` : milestone.id}
                goalId={detail.goal.id}
                goalVersion={detail.goal.version}
                milestone={milestone}
                current={index === 0}
                openRequest={milestone.id === requestedMilestoneId ? milestoneOpenRequest : 0}
                onGeneralNote={() => setActiveTab('checkin')}
                pending={pending}
                finish={finish}
              />
            ))}

            {allMilestones.length === 0 && (
              <div className="empty-state">
                <h3>No agreed milestones</h3>
                <p>No staged checkpoints were needed for this Goal.</p>
              </div>
            )}
          </section>
        )}

        {activeTab === 'history' && (
          <section className="goal-update-list">
            <div className="sectionhead">
              <div>
                <h3>Goal history</h3>
                <p>Check-ins, decisions, evidence, measure changes and milestones in time order.</p>
              </div>
              {detail.capabilities.canUpdate && (
                <button type="button" className="btn small primary" onClick={openPrimaryUpdate}>
                  Check in
                </button>
              )}
            </div>
            {timeline.length ? (
              timeline.map((item) => (
                <article className="goal-update" key={item.id}>
                  <time>{formatDate(item.occurredAt, timeZone)}</time>
                  <div>
                    <div className="goal-update-head">
                      <strong>{item.title}</strong>
                      <span className="sub">{item.actor}</span>
                    </div>
                    <p>{item.body}</p>
                    {item.secondary && (
                      <p className="sub">
                        <b>Next:</b> {item.secondary}
                      </p>
                    )}
                    {item.attachments.length > 0 && (
                      <div className={styles.updateAttachments}>
                        {item.attachments.map((attachment) => (
                          <Link
                            key={attachment.id}
                            href={`/api/goal-attachments/${attachment.id}`}
                            className={styles.fileChip}
                          >
                            <span aria-hidden="true">&#128206;</span> {attachment.fileName}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <h3>No updates yet</h3>
                <p>The first meaningful progress update will appear here.</p>
              </div>
            )}
            {detail.activity.length > 0 && (
              <details className="goal-activity">
                <summary>Full Goal activity</summary>
                {detail.activity.map((item) => (
                  <ActivityRow
                    key={item.id}
                    title={String(item.detail.title ?? eventLabel(item.eventType))}
                    actor={item.actorName}
                    timestamp={formatMoment(item.occurredAt, timeZone)}
                  />
                ))}
              </details>
            )}
          </section>
        )}

        {activeTab === 'history' && (
          <section className="goal-evidence-work">
            <div className="sectionhead">
              <div>
                <h3>Files</h3>
              </div>
            </div>
            {detail.attachments.length ? (
              <div className="goal-file-list">
                {detail.attachments.map((attachment) => (
                  <Link
                    className="goal-file-row interactive-row"
                    href={`/api/goal-attachments/${attachment.id}`}
                    key={attachment.id}
                  >
                    <span>
                      <strong>{attachment.fileName}</strong>
                      <small>
                        Uploaded by {attachment.uploadedByName} &middot; linked to goal evidence
                      </small>
                    </span>
                    <span className="btn small" aria-hidden="true">
                      Preview
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className={styles.compactEmpty}>No file attached.</p>
            )}

            <div className="sectionhead">
              <div>
                <h3>Linked work</h3>
                <p>Supporting work does not automatically increase goal progress.</p>
              </div>
              {detail.capabilities.canEditStructure && availableWorkOptions.length > 0 && (
                <GoalWorkLinkControl
                  detail={detail}
                  options={availableWorkOptions}
                  pending={pending}
                  onSubmit={(data) => {
                    startTransition(async () => {
                      finish(
                        await linkGoalWork({
                          goalId: detail.goal.id,
                          taskId: String(data.get('taskId')),
                          milestoneId: String(data.get('milestoneId') || '') || null,
                          expectedVersion: detail.goal.version,
                          idempotencyKey: idempotencyKey(),
                        }),
                        'Work linked to the Goal.',
                      );
                    });
                  }}
                />
              )}
            </div>
            {detail.workLinks.length ? (
              <div className="goal-work-list">
                {detail.workLinks.map((link) => (
                  <Link
                    key={link.id}
                    className="goal-work-row interactive-row"
                    href={`/work?task=${link.taskId}`}
                  >
                    <span>
                      <strong>{link.taskTitle}</strong>
                      <small>{link.milestoneTitle ?? 'Supports the overall Goal'}</small>
                    </span>
                    <span className="btn small" aria-hidden="true">
                      Open
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className={styles.compactEmpty}>No linked work.</p>
            )}
          </section>
        )}

        {/*
          v52 — closing a Goal, which nothing could do.

          `close_goal` has existed since v33 and is still the only procedure
          that writes a terminal Goal status; the v50/v51 lean-goal work added
          authoring and check-ins but no ending. So a Goal, once agreed, stayed
          active for ever — including through the year it was written for.

          It is the agreeing manager's act, matching `focus.can_agree_goal`,
          and it requires a reason: a Goal that stopped mattering and one that
          was delivered are different outcomes, and the record should say which.
        */}
        {detail.capabilities.canCompleteGoal && detail.activeVersion && (
          <section className="detail-section">
            <details className={styles.terminalDisclosure}>
              <summary>Complete this Goal</summary>
              <form
                className="detail-lifecycle-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  startTransition(async () => {
                    if (
                      finish(
                        await completeGoal({
                          goalId: detail.goal.id,
                          expectedVersion: detail.goal.version,
                          finalResultSummary: String(data.get('finalResultSummary') ?? ''),
                          measureResults: detail.activeVersion!.successMeasures.map((measure) => ({
                            measureId: measure.id,
                            actualResult: String(data.get(`measure-${measure.id}`) ?? ''),
                          })),
                          idempotencyKey: idempotencyKey(),
                        }),
                        'Goal completed with the actual results preserved.',
                      )
                    ) {
                      form.reset();
                    }
                  });
                }}
              >
                <p className="sub">
                  Record what was achieved against every agreed success measure. Completion is
                  separate from cancellation.
                </p>
                {detail.activeVersion.successMeasures.map((measure) => (
                  <div className="field" key={measure.id}>
                    <label htmlFor={`goal-result-${measure.id}`}>{measure.description}</label>
                    <textarea
                      id={`goal-result-${measure.id}`}
                      name={`measure-${measure.id}`}
                      rows={2}
                      required
                      defaultValue={measure.actualResult ?? ''}
                      placeholder="What was actually achieved?"
                    />
                  </div>
                ))}
                <div className="field">
                  <label htmlFor={`goal-final-summary-${detail.goal.id}`}>
                    Final result summary
                  </label>
                  <textarea
                    id={`goal-final-summary-${detail.goal.id}`}
                    name="finalResultSummary"
                    rows={3}
                    required
                  />
                </div>
                <button className="btn small primary" disabled={pending} aria-busy={pending}>
                  Complete Goal
                </button>
              </form>
            </details>
          </section>
        )}

        {detail.capabilities.canCancelGoal && (
          <section className="detail-section">
            <details className={styles.terminalDisclosure}>
              <summary>Cancel this Goal</summary>
              <form
                className="detail-lifecycle-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const reason = String(new FormData(form).get('cancelReason') ?? '');
                  startTransition(async () => {
                    if (
                      finish(
                        await cancelGoal({
                          goalId: detail.goal.id,
                          expectedVersion: detail.goal.version,
                          reason,
                          idempotencyKey: idempotencyKey(),
                        }),
                        'Goal cancelled. Its reason and allocation gap remain visible.',
                      )
                    ) {
                      form.reset();
                    }
                  });
                }}
              >
                <label htmlFor={`cancel-goal-${detail.goal.id}`}>
                  Why does this Goal no longer apply?
                </label>
                <textarea
                  id={`cancel-goal-${detail.goal.id}`}
                  name="cancelReason"
                  rows={2}
                  required
                />
                <button className="btn small" disabled={pending} aria-busy={pending}>
                  Cancel Goal
                </button>
              </form>
            </details>
          </section>
        )}
      </div>
    </SideDrawer>
  );
}

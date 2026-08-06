'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { AttachmentPicker } from '@/components/ui/AttachmentPicker';
import { Modal } from '@/components/ui/Modal';
import { SideDrawer } from '@/components/ui/SideDrawer';
import { ActivityRow, ProgressIndicator, StatusBadge } from '@/components/ui/ParityPrimitives';
import { GOAL_STATUS_LABELS, goalDisplayHealth } from '@/domain/goals';
import type { OperationResult } from '@/domain/types';
import {
  agreeGoalVersion,
  linkGoalWork,
  postGoalMilestoneUpdate,
  postGoalUpdate,
  proposeGoalVersion,
  requestGoalUpdate,
  resolveGoalSupport,
  type GoalMilestoneInput,
} from '@/server/actions/goal-actions';
import type { GoalDetail, GoalMilestone } from '@/server/goal-queries';

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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
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
    <div className="field full">
      <label htmlFor={id}>
        {label} <output htmlFor={id}>{value}%</output>
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
  pending,
  finish,
}: {
  goalId: string;
  goalVersion: number;
  milestone: GoalMilestone;
  current?: boolean;
  openRequest?: number;
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
          {milestone.progressPercent === 100 ? '✓' : milestone.position}
        </span>
        <span>
          <strong>{milestone.title}</strong>
          <small>{milestone.completionDefinition}</small>
          {current && <small className={styles.currentLabel}>Current milestone</small>}
        </span>
        <span className="goal-milestone-progress">
          <strong>{milestone.progressPercent}%</strong>
          <small>{milestone.weightPercent}% weight</small>
        </span>
      </button>

      <Modal
        open={open}
        title={`Update ${milestone.title}`}
        onClose={() => setOpen(false)}
        className={styles.updateDrawer}
      >
        <header className="modalhead">
          <div>
            <p className="eyebrow">Milestone check-in</p>
            <h2>{milestone.title}</h2>
            <p className="sub">Record one meaningful change and its evidence.</p>
          </div>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setOpen(false)}
            aria-label="Close milestone update"
          >
            Close
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
              <strong>One progress value:</strong> overall Goal progress is calculated from the
              agreed milestone weights.
            </p>
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
            <AttachmentPicker
              label="Add evidence"
              hint="Optional · attached to this milestone update"
            />
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
            <button type="submit" className="btn primary" disabled={busy}>
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
}: {
  detail: GoalDetail;
  pending: boolean;
  finish: (result: OperationResult, success: string) => boolean;
}) {
  const active = detail.activeVersion;
  const [open, setOpen] = useState(false);
  const [milestones, setMilestones] = useState<GoalMilestoneInput[]>(
    () =>
      active?.milestones.map((milestone) => ({
        source_milestone_id: milestone.id,
        title: milestone.title,
        completion_definition: milestone.completionDefinition,
        weight_percent: milestone.weightPercent,
        progress_percent: milestone.progressPercent,
      })) ?? [],
  );
  const [, startTransition] = useTransition();
  if (!active || detail.goal.pendingVersionId) return null;

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
      <button type="button" className="btn small" onClick={() => setOpen((value) => !value)}>
        {open ? 'Cancel editing' : 'Edit Goal and milestones'}
      </button>
      {open && (
        <form
          className="detail-form card inset"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            startTransition(async () => {
              const result = await proposeGoalVersion({
                goalId: detail.goal.id,
                expectedVersion: detail.goal.version,
                expectedResult: String(data.get('expectedResult')),
                successMeasure: String(data.get('successMeasure')),
                targetDate: String(data.get('targetDate')),
                employeeApproach: String(data.get('employeeApproach') ?? '') || null,
                supportAgreed: String(data.get('supportAgreed') ?? '') || null,
                dependencies: String(data.get('dependencies') ?? '') || null,
                baseline: String(data.get('baseline') ?? '') || null,
                purpose: String(data.get('purpose') ?? '') || null,
                weightPercent: Number(data.get('weightPercent') || 0),
                milestones,
                idempotencyKey: idempotencyKey(),
              });
              if (finish(result, 'Changes saved as a new version for discussion.')) setOpen(false);
            });
          }}
        >
          <div className="notice">
            <strong>Current agreement stays active</strong>
            <p>
              These structural changes create a new version. Normal progress continues against the
              agreed version until a manager agrees the changes.
            </p>
          </div>
          <div className="field">
            <label htmlFor="edit-goal-result">Expected result</label>
            <input
              id="edit-goal-result"
              name="expectedResult"
              defaultValue={active.expectedResult}
              required
              maxLength={500}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-goal-measure">Success measure</label>
            <textarea
              id="edit-goal-measure"
              name="successMeasure"
              defaultValue={active.successMeasure}
              required
              rows={3}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-goal-date">Target date</label>
            <input
              id="edit-goal-date"
              name="targetDate"
              type="date"
              defaultValue={active.targetDate}
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
              defaultValue={active.weightPercent}
            />
          </div>
          <details>
            <summary>Supporting context</summary>
            <div className="detail-form">
              <div className="field">
                <label htmlFor="edit-goal-approach">Employee approach</label>
                <textarea
                  id="edit-goal-approach"
                  name="employeeApproach"
                  defaultValue={active.employeeApproach ?? ''}
                  rows={2}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-goal-support">Support agreed</label>
                <textarea
                  id="edit-goal-support"
                  name="supportAgreed"
                  defaultValue={active.supportAgreed ?? ''}
                  rows={2}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-goal-dependencies">Dependencies</label>
                <textarea
                  id="edit-goal-dependencies"
                  name="dependencies"
                  defaultValue={active.dependencies ?? ''}
                  rows={2}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-goal-baseline">Baseline</label>
                <textarea
                  id="edit-goal-baseline"
                  name="baseline"
                  defaultValue={active.baseline ?? ''}
                  rows={2}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-goal-purpose">Purpose</label>
                <textarea
                  id="edit-goal-purpose"
                  name="purpose"
                  defaultValue={active.purpose ?? ''}
                  rows={2}
                />
              </div>
            </div>
          </details>
          <div className="sectionhead">
            <div>
              <h3>Milestones</h3>
              <p>Changing structure creates a versioned alignment record.</p>
            </div>
            <button
              type="button"
              className="btn small"
              disabled={milestones.length >= 10}
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
              <div className="field compact-field">
                <label htmlFor={`edit-ms-weight-${index}`}>Weight</label>
                <input
                  id={`edit-ms-weight-${index}`}
                  type="number"
                  min={1}
                  max={100}
                  value={milestone.weight_percent ?? ''}
                  onChange={(event) =>
                    setMilestones((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              weight_percent: event.target.value
                                ? Number(event.target.value)
                                : null,
                            }
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
                {milestones.length > 1 && (
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
                )}
              </div>
            </div>
          ))}
          <button type="submit" className="btn primary" disabled={pending}>
            Save for discussion
          </button>
        </form>
      )}
    </section>
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
  const hasOpenMilestone = Boolean(
    detail.activeVersion?.milestones.some((milestone) => milestone.progressPercent < 100),
  );
  const [activeTab, setActiveTab] = useState<'overview' | 'milestones' | 'updates' | 'evidence'>(
    initialAction === 'update' && hasOpenMilestone ? 'milestones' : 'overview',
  );
  const [updateOpen, setUpdateOpen] = useState(initialAction === 'update' && !hasOpenMilestone);
  const [milestoneOpenRequest, setMilestoneOpenRequest] = useState(
    initialAction === 'update' && hasOpenMilestone ? 1 : 0,
  );
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
    () => detail.activeVersion?.milestones ?? [],
    [detail.activeVersion],
  );
  const completedMilestones = useMemo(
    () => allMilestones.filter((milestone) => milestone.progressPercent === 100),
    [allMilestones],
  );
  const openMilestones = useMemo(
    () => allMilestones.filter((milestone) => milestone.progressPercent < 100),
    [allMilestones],
  );

  const timeline = useMemo(
    () =>
      [
        ...detail.updates.map((update) => ({
          id: update.id,
          title: `Overall progress ${update.previousProgress}% → ${update.newProgress}%`,
          body: update.whatChanged,
          secondary: update.nextStep,
          actor: update.authorName,
          occurredAt: update.createdAt,
        })),
        ...detail.milestoneUpdates.map((update) => ({
          id: update.id,
          title: `${update.milestoneTitle}: ${update.previousProgress}% → ${update.newProgress}%`,
          body:
            update.comment ??
            (update.markedComplete ? 'Milestone completed.' : 'Milestone progress updated.'),
          secondary: null,
          actor: update.authorName,
          occurredAt: update.createdAt,
        })),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [detail.milestoneUpdates, detail.updates],
  );

  const linkedIds = new Set(detail.workLinks.map((link) => link.taskId));
  const availableWorkOptions = workOptions.filter((option) => !linkedIds.has(option.id));

  function openPrimaryUpdate() {
    if (!hasOpenMilestone) {
      setActiveTab('overview');
      setUpdateOpen(true);
      return;
    }
    setActiveTab('milestones');
    setMilestoneOpenRequest((current) => current + 1);
  }

  return (
    <SideDrawer
      closeHref={closeHref}
      closeLabel="Close Goal detail"
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
        detail.capabilities.canUpdate && detail.goal.status === 'active' ? (
          <button type="button" className="btn small primary" onClick={openPrimaryUpdate}>
            Update
          </button>
        ) : null
      }
    >
      <div className="task-detail-scroll goal-detail-scroll">
        <div className="task-detail-meta">
          <StatusBadge
            tone={
              detail.goal.health === 'support_requested'
                ? 'red'
                : detail.goal.health === 'need_attention'
                  ? 'amber'
                  : 'blue'
            }
          >
            {goalDisplayHealth(detail.goal)}
          </StatusBadge>
        </div>

        <nav className="drawer-tabs" aria-label="Goal details" role="tablist">
          {(
            [
              ['overview', 'Overview'],
              ['milestones', 'Milestones'],
              ['updates', 'Updates'],
              ['evidence', 'Evidence & work'],
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
              {key === 'milestones' && <span>{detail.activeVersion?.milestones.length ?? 0}</span>}
              {key === 'updates' && timeline.length > 0 && <span>{timeline.length}</span>}
            </button>
          ))}
        </nav>

        {message && (
          <div className={`notice ${message.tone}`} role="status">
            <strong>{message.tone === 'success' ? 'Saved' : 'Action needed'}</strong>
            <p>{message.text}</p>
          </div>
        )}

        {activeTab === 'overview' && (
          <>
            {detail.goal.pendingVersionId && detail.pendingVersion && (
              <section className="goal-pending-version">
                <div>
                  <StatusBadge tone="purple">Changes awaiting agreement</StatusBadge>
                  <h3>Version {detail.pendingVersion.versionNumber} is ready for discussion</h3>
                  <p>
                    The active agreement remains version {detail.goal.activeVersionNumber}. Review
                    the revised result, target, and milestones before agreeing.
                  </p>
                </div>
                {detail.capabilities.canAgree && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        finish(
                          await agreeGoalVersion({
                            goalId: detail.goal.id,
                            pendingVersionId: detail.pendingVersion!.id,
                            expectedVersion: detail.goal.version,
                            idempotencyKey: idempotencyKey(),
                          }),
                          'The revised Goal is now active.',
                        );
                      })
                    }
                  >
                    Agree changes
                  </button>
                )}
              </section>
            )}

            <section className={`goal-progress-hero ${styles.progressHero}`}>
              <div>
                <span className="sub">Goal progress</span>
                <strong>{detail.goal.derivedProgress}%</strong>
                <ProgressIndicator value={detail.goal.derivedProgress} />
                <p>Calculated from the agreed milestone weights.</p>
              </div>
            </section>

            <div className="goal-action-strip">
              {detail.capabilities.canUpdate && (
                <button type="button" className="btn" onClick={() => setUpdateOpen(true)}>
                  General goal note
                </button>
              )}
              {detail.capabilities.canAgree && detail.goal.status === 'active' && (
                <button
                  type="button"
                  className="btn"
                  disabled={pending}
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
              )}
            </div>

            {detail.capabilities.canUpdate && (
              <Modal
                open={updateOpen}
                title={`Update ${detail.goal.title}`}
                onClose={() => setUpdateOpen(false)}
              >
                <header className="modalhead">
                  <div>
                    <p className="eyebrow">Goal check-in</p>
                    <h2>General goal note</h2>
                    <p>{detail.goal.title}</p>
                  </div>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => setUpdateOpen(false)}
                    aria-label="Close Goal update"
                  >
                    ×
                  </button>
                </header>
                <form
                  className="goal-quick-update modalbody"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    data.set('goalId', detail.goal.id);
                    data.set('expectedVersion', String(detail.goal.version));
                    data.set('progress', String(detail.goal.derivedProgress));
                    data.set('idempotencyKey', idempotencyKey());
                    startTransition(async () => {
                      const result = await postGoalUpdate(data);
                      if (finish(result, 'Goal note saved.')) {
                        form.reset();
                        setUpdateOpen(false);
                      }
                    });
                  }}
                >
                  <input type="hidden" name="progress" value={detail.goal.derivedProgress} />
                  <div className="field">
                    <label htmlFor={`goal-changed-${detail.goal.id}`}>What changed?</label>
                    <textarea
                      id={`goal-changed-${detail.goal.id}`}
                      name="whatChanged"
                      required
                      rows={3}
                      maxLength={4000}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`goal-next-${detail.goal.id}`}>
                      Next step <span className="sub">Optional</span>
                    </label>
                    <textarea
                      id={`goal-next-${detail.goal.id}`}
                      name="nextStep"
                      rows={2}
                      maxLength={4000}
                    />
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      name="supportRequested"
                      onChange={(event) => {
                        const details = event.currentTarget.form?.elements.namedItem(
                          'supportDetails',
                        ) as HTMLTextAreaElement | null;
                        if (details) details.required = event.currentTarget.checked;
                      }}
                    />{' '}
                    I need support
                  </label>
                  <div className="field">
                    <label htmlFor={`goal-support-${detail.goal.id}`}>Support needed</label>
                    <textarea
                      id={`goal-support-${detail.goal.id}`}
                      name="supportDetails"
                      rows={2}
                      maxLength={4000}
                    />
                  </div>
                  <AttachmentPicker label="Add evidence" hint="Optional · files remain private" />
                  <button className="btn primary" disabled={pending}>
                    Save note
                  </button>
                </form>
              </Modal>
            )}

            {detail.supportRequests
              .filter((support) => support.status !== 'resolved')
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
                            await resolveGoalSupport({
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
                      <button className="btn small primary" disabled={pending}>
                        Resolve support
                      </button>
                    </form>
                  )}
                </section>
              ))}

            <section className="detail-section">
              <h3>Agreed outcome</h3>
              <dl className="goal-metadata-grid">
                <div>
                  <dt>Expected result</dt>
                  <dd>{detail.goal.expectedResult ?? 'Ready for discussion'}</dd>
                </div>
                <div>
                  <dt>Success measure</dt>
                  <dd>{detail.goal.successMeasure ?? 'Ready for discussion'}</dd>
                </div>
                <div>
                  <dt>Manager / reviewer</dt>
                  <dd>{detail.goal.managerName ?? 'Not assigned'}</dd>
                </div>
                <div>
                  <dt>Date agreed</dt>
                  <dd>
                    {detail.goal.agreedAt
                      ? formatDate(detail.goal.agreedAt, timeZone)
                      : 'Not agreed yet'}
                  </dd>
                </div>
                <div>
                  <dt>Current milestone</dt>
                  <dd>
                    {detail.goal.currentMilestoneTitle ??
                      detail.goal.nextMilestoneTitle ??
                      'No current milestone'}
                  </dd>
                </div>
                <div>
                  <dt>Goal weight</dt>
                  <dd>{detail.goal.weightPercent}%</dd>
                </div>
              </dl>
            </section>

            <details className="goal-context">
              <summary>Supporting context</summary>
              <dl className="goal-context-list">
                <div>
                  <dt>Employee approach</dt>
                  <dd>{detail.goal.employeeApproach ?? 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Support agreed</dt>
                  <dd>{detail.goal.supportAgreed ?? 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Dependencies</dt>
                  <dd>{detail.goal.dependencies ?? 'None recorded'}</dd>
                </div>
                <div>
                  <dt>Baseline</dt>
                  <dd>{detail.goal.baseline ?? 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Why it matters</dt>
                  <dd>{detail.goal.purpose ?? 'Not recorded'}</dd>
                </div>
              </dl>
            </details>
            {detail.capabilities.canEditStructure && (
              <GoalVersionEditor detail={detail} pending={pending} finish={finish} />
            )}
          </>
        )}

        {activeTab === 'milestones' && (
          <section className="goal-milestone-list">
            <div className="sectionhead">
              <div>
                <h3>Agreed milestones</h3>
                <p>Progress, comments, completion, and evidence are independent for each result.</p>
              </div>
              <strong>{detail.goal.derivedProgress}% derived</strong>
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
                  {completedMilestones.length} completed milestone
                  {completedMilestones.length === 1 ? '' : 's'}
                </summary>
                {completedMilestones.map((milestone) => (
                  <MilestoneUpdateForm
                    key={milestone.id}
                    goalId={detail.goal.id}
                    goalVersion={detail.goal.version}
                    milestone={milestone}
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
                openRequest={index === 0 ? milestoneOpenRequest : 0}
                pending={pending}
                finish={finish}
              />
            ))}

            {allMilestones.length === 0 && (
              <div className="empty-state">
                <h3>No agreed milestones</h3>
                <p>This Goal is still waiting for alignment.</p>
              </div>
            )}
          </section>
        )}

        {activeTab === 'updates' && (
          <section className="goal-update-list">
            <div className="sectionhead">
              <div>
                <h3>Updates</h3>
                <p>Overall and milestone progress in one chronological record.</p>
              </div>
            </div>
            {timeline.length ? (
              timeline.map((item) => (
                <article className="goal-update" key={item.id}>
                  <div className="goal-update-head">
                    <strong>{item.title}</strong>
                    <time>{formatMoment(item.occurredAt, timeZone)}</time>
                  </div>
                  <p>{item.body}</p>
                  {item.secondary && <p className="sub">Next: {item.secondary}</p>}
                  <span className="sub">{item.actor}</span>
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
                    title={eventLabel(item.eventType)}
                    actor={item.actorName}
                    timestamp={formatMoment(item.occurredAt, timeZone)}
                  />
                ))}
              </details>
            )}
          </section>
        )}

        {activeTab === 'evidence' && (
          <section className="goal-evidence-work">
            <div className="sectionhead">
              <div>
                <h3>Evidence</h3>
                <p>Files keep their uploader, time, and related update.</p>
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
                    <span aria-hidden="true">↥</span>
                    <span>
                      <strong>{attachment.fileName}</strong>
                      <small>
                        {attachment.relatedLabel} · {attachment.uploadedByName}
                      </small>
                    </span>
                    <span className="sub">
                      {formatBytes(attachment.byteSize)} ·{' '}
                      {formatDate(attachment.createdAt, timeZone)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <h3>No evidence attached</h3>
                <p>Evidence added to Goal or milestone updates appears here.</p>
              </div>
            )}

            <div className="sectionhead">
              <div>
                <h3>Linked work</h3>
                <p>Completing linked work never changes Goal progress automatically.</p>
              </div>
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
                    <StatusBadge>{eventLabel(link.taskStatus)}</StatusBadge>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <h3>No linked work</h3>
                <p>Relevant tasks and routines can be connected without coupling their progress.</p>
              </div>
            )}
            {detail.capabilities.canEditStructure && availableWorkOptions.length > 0 && (
              <form
                className="goal-link-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
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
              >
                <div className="field">
                  <label htmlFor={`goal-work-${detail.goal.id}`}>Work item</label>
                  <select id={`goal-work-${detail.goal.id}`} name="taskId" required defaultValue="">
                    <option value="" disabled>
                      Select visible work
                    </option>
                    {availableWorkOptions.map((option) => (
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
                  <select
                    id={`goal-work-milestone-${detail.goal.id}`}
                    name="milestoneId"
                    defaultValue=""
                  >
                    <option value="">Overall Goal</option>
                    {detail.activeVersion?.milestones.map((milestone) => (
                      <option key={milestone.id} value={milestone.id}>
                        {milestone.title}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn" disabled={pending}>
                  Link work
                </button>
              </form>
            )}
          </section>
        )}
      </div>
    </SideDrawer>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState, useTransition } from 'react';

import { latestPlausibleDate } from '@/domain/delivery';
import { COMPLETION_EVIDENCE_LABELS, type CompletionEvidenceRule } from '@/domain/types';
import { classifyCapture, type CaptureWorkType } from '@/domain/classification';
import type { CaptureDestination } from '@/domain/types';
import { assignWork } from '@/server/actions/assignment-actions';
import {
  answerCaptureQuestion,
  confirmCapture,
  createCaptureDraft,
  discardCaptureDraft,
} from '@/server/actions/capture-actions';
import { useFileDropZone } from '@/components/ui/useFileDropZone';
import { addChecklistStep } from '@/server/actions/task-actions';
import { Modal } from '@/components/ui/Modal';

/**
 * New Work.
 *
 * One screen. Fill it in, press Create work, done.
 *
 * What this replaced, and why. Creating ordinary work used to take two pages:
 * the form, and then a "Recommended destination" screen listing the capacity
 * effect, the manager visibility effect, and the classification rule — printed
 * as `multi_day_default`. That is the system explaining its own architecture
 * to somebody who wanted to add a task. Worse, the rule it explained was
 * inferred: the due date decided whether work was "multi-day", so a job due in
 * a fortnight was told "you said this needs more than a day" when they had
 * said nothing of the kind.
 *
 * Now the type is chosen, not guessed; the only genuine ambiguity is one
 * question inside Add details; and the whole outcome is a single line above the
 * button. The governance record is unchanged — `work_captures` still stores the
 * rule code, the reason, the creator and the timestamps — it simply stopped
 * being read aloud.
 *
 * The one place a second step survives is the urgent safety route, where a
 * person must answer a question before mandatory work can exist. An exception
 * deserving attention is exactly what an interstitial is for.
 */
export interface AssignablePerson {
  id: string;
  fullName: string;
  employeeId: string;
}

const WORK_TYPE_LABELS: Record<CaptureWorkType, string> = {
  normal: 'Normal work',
  routine: 'Routine',
  self_development: 'Self-Development',
  major_project: 'Major Project proposal',
};

export function CaptureWork({
  modal = false,
  assignablePeople = [],
  teamDirectory = [],
  viewerName = 'Me',
}: {
  modal?: boolean;
  /** Non-empty only for a manager or administrator. */
  assignablePeople?: AssignablePerson[];
  /**
   * Everybody, for checklist assignment only — the `team_directory`
   * projection: names without work, so an employee can hand a step to a
   * colleague without being able to read their tasks (v45 sections 1-2).
   */
  teamDirectory?: Array<{ id: string; name: string }>;
  viewerName?: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState('');
  const [chosenDate, setChosenDate] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [workType, setWorkType] = useState<CaptureWorkType>('normal');
  const [followUp, setFollowUp] = useState<'unset' | 'yes' | 'no'>('unset');

  /*
   * A Major Project is the one capture that leaves the person making it and
   * goes to somebody else to decide. That decision is made from these three
   * answers and nothing else, so they are asked here rather than chased later.
   * They stay hidden for every other work type, which is the whole point of
   * putting them behind the choice instead of on the front of the form.
   */
  const [rationale, setRationale] = useState('');
  const [successMeasure, setSuccessMeasure] = useState('');
  const [expectedMonths, setExpectedMonths] = useState('');
  const isProposal = workType === 'major_project';
  const [evidenceRule, setEvidenceRule] = useState<CompletionEvidenceRule>('optional');
  const [evidenceInstruction, setEvidenceInstruction] = useState('');

  /*
   * v41 section 4 — ownership is decided here, once. An employee capturing
   * work owns it, so there is no picker; a manager is often capturing on
   * somebody else's behalf, so they get one.
   */
  const canAssign = assignablePeople.length > 0;
  const [primaryOwnerId, setPrimaryOwnerId] = useState('');
  const CAPTURE_URGENCY = 'normal' as const;

  const [steps, setSteps] = useState<Array<{ action: string; assignedTo: string }>>([]);
  const ownerLabel =
    (primaryOwnerId && assignablePeople.find((person) => person.id === primaryOwnerId)?.fullName) ||
    viewerName;

  // The urgent route is a different workflow, not a checkbox on this one.
  const [urgentCaptureId, setUrgentCaptureId] = useState<string | null>(null);

  /*
   * The preview line. Computed with the same function the server uses, so what
   * somebody reads before pressing Create is what actually happens.
   */
  const preview = classifyCapture({
    workType,
    requiresFollowUp: followUp === 'unset' ? null : followUp === 'yes',
  });

  function updateStep(index: number, patch: Partial<{ action: string; assignedTo: string }>) {
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...patch } : step)),
    );
  }

  function addFiles(incoming: FileList | File[]) {
    setFiles((current) => [...current, ...Array.from(incoming)].slice(0, 8));
  }

  const dropZoneRef = useRef<HTMLDivElement>(null);
  // Capture already had its own bordered zone, so that is the box: marked
  // explicitly rather than left to the form, which is the whole page here.
  const { dragging } = useFileDropZone({ onFiles: addFiles, anchorRef: dropZoneRef });

  /**
   * Adds drafted steps to the task that was just created. Sequential because
   * each derives its position from the current last row.
   */
  async function applyChecklist(taskId: string): Promise<string | null> {
    for (const step of steps) {
      const action = step.action.trim();
      if (!action) continue;
      const result = await addChecklistStep({
        taskId,
        action,
        assignedTo: step.assignedTo || null,
      });
      if (!result.ok) return result.message;
    }
    return null;
  }

  function routeFor(destination: CaptureDestination, proposalId?: string): string {
    if (destination === 'major_project_request' && proposalId)
      return `/work?proposal=${proposalId}`;
    switch (destination) {
      case 'operational_available_work':
      case 'self_development_plan':
        return '/work?tab=available';
      case 'collaborative_contribution':
        return '/work?tab=shared';
      default:
        return '/today';
    }
  }

  /** Everything after the work exists, whichever route created it. */
  async function finishWith(
    taskId: string | undefined,
    destination: CaptureDestination,
    proposalId?: string,
  ) {
    if (taskId) {
      const failure = await applyChecklist(taskId);
      if (failure) {
        setError(`The work was created, but a step was not added: ${failure}`);
        return;
      }
    }
    router.push(routeFor(destination, proposalId));
    router.refresh();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    form.set('workType', workType);
    form.set('completionEvidenceRule', evidenceRule);
    form.set('completionEvidenceInstruction', evidenceInstruction.trim());
    if (followUp !== 'unset') form.set('requiresFollowUp', followUp);
    files.forEach((file) => form.append('files', file));

    if (isProposal) {
      // The server rejects this too. Checking here as well means the person
      // is told inside the section they are already looking at, rather than
      // after a round trip that closes the disclosure they typed into.
      if (!rationale.trim()) {
        setError('Explain why this needs to be a project. Your manager decides from this.');
        return;
      }
      form.set('description', rationale.trim());
      if (successMeasure.trim()) form.set('successMeasure', successMeasure.trim());
      if (expectedMonths.trim()) form.set('expectedMonths', expectedMonths.trim());
    }

    /*
     * Routine leaves this flow entirely.
     *
     * It used to go through `confirm_work_capture`, which wrote a
     * `work_proposals` row of kind `routine_template` — and nothing in the
     * system could act on that row. No decision procedure, no screen. Choosing
     * Routine therefore did exactly nothing visible, which is what was
     * reported. A schedule needs a cadence anyway, and asking for one here
     * would put recurrence setup in the middle of the quick path, so Routine
     * sends people to the screen built for it.
     */
    if (workType === 'routine') {
      router.push(`/work/routine?new=${encodeURIComponent(title.trim())}`);
      return;
    }

    startTransition(async () => {
      const draft = await createCaptureDraft(form);
      if (!draft.ok || !draft.captureId || !draft.recommendation) {
        setError(draft.message ?? 'The work was not saved.');
        return;
      }

      // A manager naming somebody else is assigning: assigned work waits in
      // that person's Available list rather than starting on their behalf
      // (v41 section 13). The draft is discarded because `assign_work` is what
      // creates the task.
      if (primaryOwnerId && canAssign) {
        const workClass =
          draft.recommendation.destination === 'major_project_request'
            ? ('major_project' as const)
            : draft.recommendation.destination === 'self_development_plan'
              ? ('self_development' as const)
              : ('operational_action' as const);

        const assigned = await assignWork({
          title: title.trim(),
          workClass,
          ownerIds: [primaryOwnerId],
          urgency: CAPTURE_URGENCY,
          dueDate: chosenDate || undefined,
          idempotencyKey: crypto.randomUUID(),
        });
        if (!assigned.ok) {
          setError(assigned.message);
          return;
        }
        await discardCaptureDraft({ captureId: draft.captureId });
        await finishWith(assigned.task_ids?.[0], 'operational_available_work');
        return;
      }

      const created = await confirmCapture({
        captureId: draft.captureId,
        destination: draft.recommendation.destination,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!created.ok) {
        setError(created.message);
        return;
      }
      await finishWith(created.task_id, draft.recommendation.destination, created.proposal_id);
    });
  }

  /** The urgent route: capture first, then ask the one question that matters. */
  function startUrgent() {
    if (!title.trim()) {
      setError('Describe the issue before reporting it as urgent.');
      return;
    }
    setError(null);

    const form = new FormData();
    form.set('title', title.trim());
    form.set('workType', 'normal');
    if (chosenDate) form.set('chosenDate', chosenDate);
    files.forEach((file) => form.append('files', file));

    startTransition(async () => {
      const draft = await createCaptureDraft(form);
      if (!draft.ok || !draft.captureId) {
        setError(draft.message ?? 'The work was not saved.');
        return;
      }
      setUrgentCaptureId(draft.captureId);
    });
  }

  function answerUrgency(answer: boolean) {
    const captureId = urgentCaptureId;
    if (!captureId) return;
    setError(null);

    startTransition(async () => {
      const answered = await answerCaptureQuestion({ captureId, question: 'urgency', answer });
      if (!answered.ok || !answered.recommendation) {
        setError(answered.message ?? 'Your answer was not saved.');
        return;
      }
      const created = await confirmCapture({
        captureId,
        destination: answered.recommendation.destination,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!created.ok) {
        setError(created.message);
        return;
      }
      setUrgentCaptureId(null);
      await finishWith(created.task_id, answered.recommendation.destination, created.proposal_id);
    });
  }

  const content = (
    <section className="capture-shell card" aria-live="polite">
      {error && (
        <div className="notice error" role="alert">
          <strong>Nothing changed</strong>
          <p>{error}</p>
        </div>
      )}

      {urgentCaptureId ? (
        <div className="capture-question">
          <p className="eyebrow">One question</p>
          <h2>
            Does this need immediate controlled action because of an active safety risk, legal
            requirement, or compliance deadline?
          </h2>
          <p>
            Answering yes creates mandatory work that starts immediately and notifies your manager.
            Answering no returns it to ordinary work.
          </p>
          <div className="capture-answer-grid">
            <button
              type="button"
              className="capture-answer"
              disabled={pending}
              onClick={() => answerUrgency(true)}
            >
              <strong>Yes</strong>
              <span>Immediate controlled action is needed.</span>
            </button>
            <button
              type="button"
              className="capture-answer"
              disabled={pending}
              onClick={() => answerUrgency(false)}
            >
              <strong>No</strong>
              <span>Treat this as ordinary work.</span>
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="capture-form">
          <div className="field">
            <label htmlFor="capture-title">What needs to be done?</label>
            <input
              id="capture-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="capture-date">Due date</label>
            <input
              id="capture-date"
              name="chosenDate"
              type="date"
              /* A slipped digit in the year is the one date error nobody
                 notices: 2926 is never overdue, never due today, and sits in
                 Available looking valid forever. The server refuses it too. */
              max={latestPlausibleDate()}
              value={chosenDate}
              onChange={(event) => setChosenDate(event.target.value)}
            />
            <small>Leave this blank if there is no date yet.</small>
          </div>

          {/*
            Decided once, here, rather than asked of the employee at every
            completion.

            Most work asks for nothing in particular. Where proof matters it is
            the person setting the work up who knows what would count — an
            inspection needs a photograph, an assessment needs the report — and
            the employee should simply be told. Asking them to choose would make
            the requirement theirs to weaken.
          */}
          <div className="field">
            <label htmlFor="capture-evidence-rule">Completion evidence</label>
            <select
              id="capture-evidence-rule"
              name="completionEvidenceRule"
              value={evidenceRule}
              onChange={(event) => setEvidenceRule(event.target.value as CompletionEvidenceRule)}
            >
              {(Object.keys(COMPLETION_EVIDENCE_LABELS) as CompletionEvidenceRule[]).map((rule) => (
                <option key={rule} value={rule}>
                  {COMPLETION_EVIDENCE_LABELS[rule]}
                </option>
              ))}
            </select>
            <small>
              {evidenceRule === 'optional'
                ? 'Nothing has to be attached to complete this.'
                : evidenceRule === 'file'
                  ? 'A file or photograph must be attached before this can be completed.'
                  : 'Proof is required. A written result counts where no file exists.'}
            </small>
          </div>

          {/* Only worth asking once something is actually required: an
              instruction for "optional" is a sentence nobody needs. */}
          {evidenceRule !== 'optional' && (
            <div className="field">
              <label htmlFor="capture-evidence-instruction">
                What should be attached? <span className="field-optional">Optional</span>
              </label>
              <input
                id="capture-evidence-instruction"
                name="completionEvidenceInstruction"
                maxLength={500}
                value={evidenceInstruction}
                onChange={(event) => setEvidenceInstruction(event.target.value)}
                placeholder="Attach the completed assessment report."
              />
            </div>
          )}

          {canAssign && (
            <div className="field">
              <label htmlFor="capture-primary-owner">Primary owner</label>
              <select
                id="capture-primary-owner"
                value={primaryOwnerId}
                onChange={(event) => setPrimaryOwnerId(event.target.value)}
              >
                <option value="">Me — {viewerName.split(' ')[0]}</option>
                {assignablePeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <details className="capture-details">
            <summary>Add details</summary>

            <p className="capture-detail-heading">Steps — Optional</p>
            {steps.length > 0 && (
              <ol className="capture-steps">
                {steps.map((step, index) => (
                  <li key={index} className="capture-step">
                    <div className="field">
                      <label htmlFor={`capture-step-${index}`}>What needs to be done?</label>
                      <input
                        id={`capture-step-${index}`}
                        value={step.action}
                        maxLength={300}
                        onChange={(event) => updateStep(index, { action: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`capture-step-assignee-${index}`}>Assigned to</label>
                      <select
                        id={`capture-step-assignee-${index}`}
                        value={step.assignedTo}
                        onChange={(event) => updateStep(index, { assignedTo: event.target.value })}
                      >
                        <option value="">{ownerLabel}</option>
                        {teamDirectory.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() =>
                        setSteps((current) => current.filter((_, position) => position !== index))
                      }
                    >
                      Remove step {index + 1}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <button
              type="button"
              className="btn small"
              onClick={() => setSteps((current) => [...current, { action: '', assignedTo: '' }])}
            >
              + Add step
            </button>

            <p className="capture-detail-heading">Attachments — Optional</p>
            {/* The zone handled `drop` but showed nothing while a file was
                over it, and cleared no state on `dragleave` - so there was no
                way to tell it was a target until after letting go. */}
            <div ref={dropZoneRef} className="capture-dropzone" data-drop-zone="true">
              <strong>Attach evidence or context</strong>
              <span>
                {dragging
                  ? 'Drop to attach.'
                  : 'Drop files, paste a screenshot, or choose from this device.'}
              </span>
              <button
                type="button"
                className="btn small"
                onClick={() => fileInput.current?.click()}
              >
                Choose files
              </button>
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                aria-label="Attach files"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,.xlsx,.docx"
                onChange={(event) => event.target.files && addFiles(event.target.files)}
              />
            </div>
            {files.length > 0 && (
              <ul className="capture-files" aria-label="Selected attachments">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    <span>{file.name}</span>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() =>
                        setFiles((current) => current.filter((_, position) => position !== index))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="capture-detail-heading">Work type</p>
            <div className="field">
              <label className="visually-hidden" htmlFor="capture-work-type">
                Work type
              </label>
              <select
                id="capture-work-type"
                value={workType}
                onChange={(event) => setWorkType(event.target.value as CaptureWorkType)}
              >
                {(Object.keys(WORK_TYPE_LABELS) as CaptureWorkType[]).map((key) => (
                  <option key={key} value={key}>
                    {WORK_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            {isProposal && (
              <div className="capture-proposal">
                <p className="capture-proposal-note">
                  This goes to your manager to approve, so it needs a case they can decide on.
                </p>
                <div className="field">
                  <label htmlFor="capture-rationale">Why does this need to be a project?</label>
                  <textarea
                    id="capture-rationale"
                    rows={4}
                    value={rationale}
                    onChange={(event) => setRationale(event.target.value)}
                    placeholder="What problem it solves, and why ordinary work will not cover it."
                  />
                </div>
                <div className="field">
                  <label htmlFor="capture-success">
                    What does finished look like? <span className="optional-label">Optional</span>
                  </label>
                  <textarea
                    id="capture-success"
                    rows={3}
                    value={successMeasure}
                    onChange={(event) => setSuccessMeasure(event.target.value)}
                    placeholder="How you will know it worked."
                  />
                </div>
                <div className="field capture-months">
                  <label htmlFor="capture-months">
                    Roughly how many months? <span className="optional-label">Optional</span>
                  </label>
                  <input
                    id="capture-months"
                    type="number"
                    min={1}
                    max={60}
                    inputMode="numeric"
                    value={expectedMonths}
                    onChange={(event) => setExpectedMonths(event.target.value)}
                  />
                </div>
              </div>
            )}

            {/*
              The only question the rules genuinely cannot answer, asked in
              words rather than guessed from the date.
            */}
            {workType === 'normal' && (
              <fieldset className="capture-followup">
                <legend>Will this need follow-up after the day you start?</legend>
                <label>
                  <input
                    type="radio"
                    name="followUpChoice"
                    checked={followUp === 'no'}
                    onChange={() => setFollowUp('no')}
                  />
                  <span>No — it finishes in one go</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="followUpChoice"
                    checked={followUp === 'yes'}
                    onChange={() => setFollowUp('yes')}
                  />
                  <span>Yes — it continues afterwards</span>
                </label>
              </fieldset>
            )}
          </details>

          {/*
            v40 section 13 — the ONLY route to mandatory classification. A whole
            clickable row, because as a line of red helper text it read as a
            caption rather than an alternative way to file the work.
          */}
          <button type="button" className="capture-urgent-row" onClick={startUrgent}>
            <span aria-hidden="true">⚠</span>
            <span>
              <strong>Urgent safety or compliance issue?</strong>
              <small>Use when immediate controlled action is required.</small>
            </span>
            <span className="capture-urgent-go" aria-hidden="true">
              Report urgent issue →
            </span>
          </button>

          <p className="capture-preview" role="status">
            {preview.summary}
          </p>

          <div className="capture-actions">
            <button className="btn primary" disabled={pending} aria-busy={pending}>
              {pending ? 'Creating…' : 'Create work'}
            </button>
          </div>
        </form>
      )}
    </section>
  );

  if (!modal) return content;

  return (
    <Modal open title="New Work" onClose={() => router.push('/today')}>
      <header className="modalhead capture-modal-head">
        <div>
          <p className="eyebrow">New Work</p>
          <h2>What needs to be done?</h2>
        </div>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => router.push('/today')}
          aria-label="Close New Work"
        >
          ×
        </button>
      </header>
      <div className="modalbody capture-modal-body">{content}</div>
    </Modal>
  );
}

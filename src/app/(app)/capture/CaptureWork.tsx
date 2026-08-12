'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState, useTransition } from 'react';

import {
  DESTINATION_LABELS,
  SELECTABLE_DESTINATIONS,
  type CaptureRecommendation,
} from '@/domain/classification';
import type { CaptureDestination, CaptureTiming } from '@/domain/types';
import { assignWork } from '@/server/actions/assignment-actions';
import {
  answerCaptureQuestion,
  confirmCapture,
  createCaptureDraft,
  discardCaptureDraft,
} from '@/server/actions/capture-actions';
import { Modal } from '@/components/ui/Modal';

/**
 * Capture Work (section 8; revised for v40 sections 8, 12, 13).
 *
 * Two v40 changes are visible here:
 *
 *   Collaborative Contribution is gone. A contribution is not something a
 *   person captures — it arises when somebody assigns them a checklist item on
 *   a task that already exists, and it shows up in their Shared view. Offering
 *   it at capture time asked employees to understand an implementation concept
 *   and invited a second parent task for a result somebody else already owns.
 *
 *   The urgent safety route is now genuinely explicit. It used to be decorative:
 *   pressing it only prefilled the description, while the real trigger was a
 *   keyword list scanning the title. Now pressing it is what raises the
 *   controlled-action question, and nothing in the wording can raise it.
 */
export interface AssignablePerson {
  id: string;
  fullName: string;
  employeeId: string;
}

/**
 * Turns the single date field back into the timing the rest of the system
 * already speaks.
 *
 * `timing` was never only a due date: `classifyCapture` reads it, and
 * `timing === 'today'` is the sole route to a Quick Action (section 6.3). Four
 * buttons were how that value got set, so removing them without deriving it
 * would have quietly made Quick Action unreachable from Capture.
 *
 * Only `today` and `choose_date` are produced. `this_week` is deliberately not,
 * because `dueAtFor` computes the end of the week for it and would overwrite
 * the date the person actually picked.
 */
export function timingForDate(date: string, today = new Date()): CaptureTiming {
  if (!date) return 'no_date';
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  return date === key ? 'today' : 'choose_date';
}

export function CaptureWork({
  modal = false,
  assignablePeople = [],
  viewerName = 'Me',
}: {
  modal?: boolean;
  /** Non-empty only for a manager or administrator. */
  assignablePeople?: AssignablePerson[];
  viewerName?: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<'entry' | 'question' | 'recommendation'>('entry');
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<CaptureRecommendation | null>(null);
  const [destination, setDestination] = useState<CaptureDestination | null>(null);
  const [title, setTitle] = useState('');
  const [chosenDate, setChosenDate] = useState('');
  // Derived, not chosen. See timingForDate.
  const timing = timingForDate(chosenDate);
  const [files, setFiles] = useState<File[]>([]);
  const [showTypes, setShowTypes] = useState(false);
  const [urgentCapture, setUrgentCapture] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * v41 section 4 — ownership is decided HERE, once.
   *
   * An employee capturing work owns it; asking them to pick themselves from a
   * list is a question with one answer, so there is no picker. A manager is
   * often capturing on somebody else's behalf, so they get a Primary owner
   * selector defaulting to themselves.
   *
   * This replaces v40's separate "assign this to someone else" flow. Deciding
   * who owns a result and describing the result are the same moment of
   * thought, and splitting them into two workflows made the manager state the
   * same intention twice.
   */
  const canAssign = assignablePeople.length > 0;
  const [primaryOwnerId, setPrimaryOwnerId] = useState('');
  /*
   * Capture no longer sets urgency or a review date. Both belonged to the
   * removed multi-assign card, and neither is something the person capturing
   * the work is being asked. `assignWork` still wants an urgency, so it gets
   * the same default the card opened with; the review date is left unset and
   * remains editable from Task Detail.
   */
  const CAPTURE_URGENCY = 'normal' as const;

  function addFiles(incoming: FileList | File[]) {
    setFiles((current) => [...current, ...Array.from(incoming)].slice(0, 8));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    form.set('timing', timing);
    files.forEach((file) => form.append('files', file));

    startTransition(async () => {
      const result = await createCaptureDraft(form);
      if (!result.ok || !result.captureId || !result.recommendation) {
        setError(result.message ?? 'The work was not saved.');
        return;
      }
      setCaptureId(result.captureId);
      setRecommendation(result.recommendation);
      setDestination(result.recommendation.destination);
      // The urgent route is the only thing that can raise the controlled-action
      // question, and the person chose it before submitting.
      setStage(
        urgentCapture || result.recommendation.followUpQuestion ? 'question' : 'recommendation',
      );
    });
  }

  function answer(question: 'urgency' | 'followup', value: boolean) {
    if (!captureId) return;
    setError(null);
    startTransition(async () => {
      const result = await answerCaptureQuestion({ captureId, question, answer: value });
      if (!result.ok || !result.recommendation) {
        setError(result.message ?? 'Your answer was not saved.');
        return;
      }
      setRecommendation(result.recommendation);
      setDestination(result.recommendation.destination);
      setStage(result.recommendation.followUpQuestion ? 'question' : 'recommendation');
    });
  }

  function createWork() {
    if (!captureId || !destination) return;
    setError(null);

    // A manager who named somebody else as Primary Owner is assigning, and
    // assigned work waits in that person's Available list rather than starting
    // (v41 section 13). The capture draft is discarded because the assignment
    // procedure is the one that creates the task.
    if (primaryOwnerId && canAssign) {
      const workClass =
        destination === 'major_project_request'
          ? ('major_project' as const)
          : destination === 'self_development_plan'
            ? ('self_development' as const)
            : ('operational_action' as const);

      startTransition(async () => {
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
        await discardCaptureDraft({ captureId });
        router.push('/work?scope=team');
        router.refresh();
      });
      return;
    }
    startTransition(async () => {
      const result = await confirmCapture({
        captureId,
        destination,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }

      const destinationRoute: Record<CaptureDestination, string> = {
        quick_action: '/today',
        operational_available_work: '/work?tab=available',
        routine_template_request: '/today',
        self_development_plan: '/work?tab=available',
        // Retained for records captured before v40 removed this destination.
        collaborative_contribution: '/work?tab=shared',
        major_project_request: '/today',
        // Mandatory work is Active immediately, so it belongs on My Day.
        mandatory_operational_action: '/today',
      };
      router.push(
        destination === 'major_project_request' && result.proposal_id
          ? `/work?proposal=${result.proposal_id}`
          : destinationRoute[destination],
      );
      router.refresh();
    });
  }

  function editDetails() {
    if (!captureId) return;
    setError(null);
    startTransition(async () => {
      const result = await discardCaptureDraft({ captureId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCaptureId(null);
      setRecommendation(null);
      setDestination(null);
      setStage('entry');
    });
  }

  const question = urgentCapture
    ? 'Does this need immediate controlled action because of an active safety risk, legal requirement, or compliance deadline?'
    : recommendation?.followUpQuestion;
  const questionKind: 'urgency' | 'followup' = urgentCapture ? 'urgency' : 'followup';

  const content = (
    <section className="capture-shell card" aria-live="polite">
      {error && (
        <div className="notice error" role="alert">
          <strong>Nothing changed</strong>
          <p>{error}</p>
        </div>
      )}

      {stage === 'entry' && (
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
              value={chosenDate}
              onChange={(event) => setChosenDate(event.target.value)}
            />
            <small>Leave this blank if there is no date yet.</small>
          </div>

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
              <small>
                One task has one Primary Owner. Collaboration is assigned later through checklist
                steps.
              </small>
            </div>
          )}

          <details className="capture-details">
            <summary>Add more details</summary>
            <p className="capture-detail-heading">Attachments — Optional</p>
            <div
              className="capture-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addFiles(event.dataTransfer.files);
              }}
              onPaste={(event) => {
                const pasted = Array.from(event.clipboardData.files);
                if (pasted.length) addFiles(pasted);
              }}
            >
              <strong>Attach evidence or context</strong>
              <span>Drop files, paste a screenshot, or choose from this device.</span>
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
                        setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>

          {/*
            v40 section 13 — the ONLY route to mandatory classification. No word
            in the title reaches it: "replace PPE signage" is ordinary work
            unless the person says otherwise here.
          */}
          <div className="capture-secondary-row">
            {/* v42 section L — "controlled response" is governance vocabulary.
                People reading it have to stop and work out what it means, which
                is the last thing to ask of somebody reporting a hazard. */}
            <span>Urgent safety or compliance issue?</span>
            <button
              type="button"
              className="capture-urgent-link"
              aria-pressed={urgentCapture}
              onClick={() => setUrgentCapture((current) => !current)}
            >
              ! Report urgent issue
            </button>
          </div>
          {urgentCapture && (
            <div className="notice warning" role="status">
              <strong>Urgent route selected</strong>
              <p>
                Use this when immediate action or management awareness is needed because of an
                active safety risk, legal requirement or urgent compliance deadline. You will be
                asked one question before this is classified; answering no returns it to the
                ordinary flow.
              </p>
            </div>
          )}

          <div className="capture-actions">
            <button className="btn primary" disabled={pending} aria-busy={pending}>
              {pending ? 'Saving…' : 'Create work'}
            </button>
          </div>
        </form>
      )}

      {stage === 'question' && question && (
        <div className="capture-question">
          <p className="eyebrow">One quick question</p>
          <h2>{question}</h2>
          <p>One answer is enough for the system to make the recommendation.</p>
          <div className="capture-answer-grid">
            <button
              className="capture-answer"
              disabled={pending}
              aria-busy={pending}
              onClick={() => answer(questionKind, false)}
            >
              <strong>No</strong>
              <span>Manage this through the ordinary work flow.</span>
            </button>
            <button
              className="capture-answer"
              disabled={pending}
              aria-busy={pending}
              onClick={() => answer(questionKind, true)}
            >
              <strong>Yes</strong>
              <span>
                {questionKind === 'urgency'
                  ? 'Immediate controlled action is required.'
                  : 'Continued follow-up will be needed.'}
              </span>
            </button>
          </div>
        </div>
      )}

      {stage === 'recommendation' && recommendation && destination && (
        <div className="capture-recommendation">
          <p className="eyebrow">Recommended destination</p>
          <h2>{DESTINATION_LABELS[destination]}</h2>
          <p>{recommendation.reason}</p>
          <dl className="capture-facts">
            <div>
              <dt>Capacity</dt>
              <dd>{recommendation.capacityEffect}</dd>
            </div>
            <div>
              <dt>Manager</dt>
              <dd>{recommendation.managerVisibility}</dd>
            </div>
            <div>
              <dt>Record</dt>
              <dd>Creator, origin, final type, and timestamp are audited.</dd>
            </div>
            {/* v40 section 12 — the rule is named, so the audit trail can later
                answer "why was this Operational?" without implying that
                anything read meaning into the sentence. */}
            <div>
              <dt>Rule</dt>
              <dd>
                {recommendation.ruleText} <span className="muted">({recommendation.ruleCode})</span>
              </dd>
            </div>
          </dl>

          <button
            type="button"
            className="btn small ghost"
            onClick={() => setShowTypes((value) => !value)}
          >
            Change type
          </button>
          {showTypes && (
            <div className="capture-type-grid">
              {SELECTABLE_DESTINATIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`capture-type${destination === option ? ' active' : ''}`}
                  onClick={() => setDestination(option)}
                >
                  {DESTINATION_LABELS[option]}
                </button>
              ))}
            </div>
          )}

          <div className="capture-actions">
            <button className="btn" disabled={pending} aria-busy={pending} onClick={editDetails}>
              Edit details
            </button>
            <button
              className="btn primary"
              disabled={pending}
              aria-busy={pending}
              onClick={createWork}
            >
              {pending ? 'Creating…' : 'Confirm & Create'}
            </button>
          </div>
        </div>
      )}
    </section>
  );

  if (!modal) return content;

  return (
    <Modal open title="Capture work" onClose={() => router.push('/today')}>
      <header className="modalhead capture-modal-head">
        <div>
          <p className="eyebrow">Capture work</p>
          <h2>What needs to be done?</h2>
          <p>Start with the work and timing. Focus will recommend where it belongs.</p>
        </div>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => router.push('/today')}
          aria-label="Close Capture work"
        >
          ×
        </button>
      </header>
      <div className="modalbody capture-modal-body">{content}</div>
    </Modal>
  );
}

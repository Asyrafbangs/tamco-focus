'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState, useTransition } from 'react';

import {
  DESTINATION_LABELS,
  SELECTABLE_DESTINATIONS,
  type CaptureRecommendation,
} from '@/domain/classification';
import type { CaptureDestination, CaptureTiming } from '@/domain/types';
import {
  answerCaptureQuestion,
  confirmCapture,
  createCaptureDraft,
  discardCaptureDraft,
} from '@/server/actions/capture-actions';
import { Modal } from '@/components/ui/Modal';

interface ParentOption {
  id: string;
  title: string;
  ownerName: string;
}

export function CaptureWork({
  parentOptions,
  modal = false,
}: {
  parentOptions: ParentOption[];
  modal?: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<'entry' | 'question' | 'recommendation'>('entry');
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<CaptureRecommendation | null>(null);
  const [destination, setDestination] = useState<CaptureDestination | null>(null);
  const [parentTaskId, setParentTaskId] = useState('');
  const [timing, setTiming] = useState<CaptureTiming>('today');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chosenDate, setChosenDate] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [showTypes, setShowTypes] = useState(false);
  const [urgentCapture, setUrgentCapture] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setStage(
        result.recommendation.urgencyQuestion || result.recommendation.followUpQuestion
          ? 'question'
          : 'recommendation',
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
      setStage(
        result.recommendation.urgencyQuestion || result.recommendation.followUpQuestion
          ? 'question'
          : 'recommendation',
      );
    });
  }

  function createWork() {
    if (!captureId || !destination) return;
    if (destination === 'collaborative_contribution' && !parentTaskId) {
      setError('Choose the existing task this contribution supports.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await confirmCapture({
        captureId,
        destination,
        parentTaskId: parentTaskId || null,
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
        collaborative_contribution: '/work?tab=shared',
        major_project_request: '/today',
        mandatory_operational_action: '/today',
      };
      router.push(destinationRoute[destination]);
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

  const question = recommendation?.urgencyQuestion ?? recommendation?.followUpQuestion;
  const questionKind = recommendation?.urgencyQuestion ? 'urgency' : 'followup';

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

          <fieldset className="capture-when">
            <legend>When is it needed?</legend>
            {(
              [
                ['today', 'Today'],
                ['this_week', 'This week'],
                ['choose_date', 'Choose date'],
                ['no_date', 'No date yet'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`capture-choice${timing === value ? ' active' : ''}`}
                aria-pressed={timing === value}
                onClick={() => setTiming(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>

          {timing === 'choose_date' && (
            <div className="field">
              <label htmlFor="capture-date">Target date</label>
              <input
                id="capture-date"
                name="chosenDate"
                type="date"
                value={chosenDate}
                onChange={(event) => setChosenDate(event.target.value)}
                required
              />
            </div>
          )}

          <details className="capture-details">
            <summary>Add more details</summary>
            <div className="field">
              <label htmlFor="capture-description">Useful context</label>
              <textarea
                id="capture-description"
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                maxLength={4000}
              />
            </div>
          </details>

          <div className="capture-secondary-row">
            <span>Need a controlled response?</span>
            <button
              type="button"
              className="capture-urgent-link"
              aria-pressed={urgentCapture}
              onClick={() => {
                setUrgentCapture(true);
                setDescription((current) => current || 'Urgent safety or compliance work.');
              }}
            >
              ! Report urgent safety or compliance work
            </button>
          </div>
          {urgentCapture && (
            <div className="notice warning" role="status">
              <strong>Urgent route selected</strong>
              <p>One controlled-action question will be asked before the work is classified.</p>
            </div>
          )}

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
            <button type="button" className="btn small" onClick={() => fileInput.current?.click()}>
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

          <div className="capture-actions">
            <button className="btn primary" disabled={pending}>
              {pending ? 'Saving…' : 'Add Work'}
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
              onClick={() => answer(questionKind, false)}
            >
              <strong>No</strong>
              <span>Manage this through the ordinary work flow.</span>
            </button>
            <button
              className="capture-answer"
              disabled={pending}
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
          </dl>

          {destination === 'collaborative_contribution' && (
            <div className="field">
              <label htmlFor="parent-task">Link to existing task</label>
              <select
                id="parent-task"
                value={parentTaskId}
                onChange={(event) => setParentTaskId(event.target.value)}
                required
              >
                <option value="">Choose work owned by someone else</option>
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title} — {option.ownerName}
                  </option>
                ))}
              </select>
            </div>
          )}

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
            <button className="btn" disabled={pending} onClick={editDetails}>
              Edit details
            </button>
            <button className="btn primary" disabled={pending} onClick={createWork}>
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

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  cadenceIdFor,
  describeCadence,
  ROUTINE_CADENCES,
  WEEKDAY_LABELS,
  type RecurrenceFrequency,
} from '@/domain/routines';
import {
  createRoutineTemplate,
  setRoutineActive,
  updateRoutineTemplate,
} from '@/server/actions/routine-actions';
import type { RoutineTemplateRow } from '@/server/queries';
import { Modal } from '@/components/ui/Modal';

/**
 * Setting up and controlling routines.
 *
 * The screen that did not exist. Occurrences were listed, and the templates
 * generating them could only be created by seeding the database — so a routine
 * created through New Work produced a proposal nothing could act on, and the
 * person saw nothing happen.
 *
 * Cadence is chosen as a phrase and translated once, in `@/domain/routines`.
 * "Quarterly" is monthly with an interval of three, which the recurrence engine
 * always supported and nothing ever offered.
 */
export function RoutineManager({
  templates,
  failed,
  canManageOthers,
  people,
  openWith = null,
}: {
  templates: readonly RoutineTemplateRow[];
  failed: boolean;
  /** Managers may set a routine up for somebody else. */
  canManageOthers: boolean;
  people: readonly { id: string; name: string }[];
  /** A title arriving from New Work, which opens the form ready to fill in. */
  openWith?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<RoutineTemplateRow | null>(null);
  const [creating, setCreating] = useState(Boolean(openWith));

  if (failed) {
    return (
      <div className="notice error" role="alert">
        <strong>Routines could not be loaded</strong>
        <p>Nothing has changed. Refresh the page, and tell an administrator if it persists.</p>
      </div>
    );
  }

  function toggle(template: RoutineTemplateRow) {
    setMessage(null);
    startTransition(async () => {
      const result = await setRoutineActive({
        templateId: template.id,
        active: !template.isActive,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.message ?? 'Nothing changed.' });
        return;
      }
      setMessage({
        tone: 'success',
        text: template.isActive
          ? `${template.title} is paused. No further occurrences will be created.`
          : `${template.title} is active. Occurrences will be created from now on.`,
      });
      router.refresh();
    });
  }

  return (
    <>
      {message && (
        <div
          className={`notice ${message.tone === 'success' ? 'success' : 'error'}`}
          role={message.tone === 'success' ? 'status' : 'alert'}
        >
          <p>{message.text}</p>
        </div>
      )}

      <div className="routine-manager-head">
        <div>
          <strong>Routines</strong>
          <span className="muted">
            The schedules that create the occurrences below. Pausing one stops future occurrences
            without touching those already created.
          </span>
        </div>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          Set up a routine
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state">
          <strong>No routines yet</strong>
          <p>Set one up to have work created automatically on a schedule.</p>
        </div>
      ) : (
        <ul className="routine-template-list">
          {templates.map((template) => (
            <li
              key={template.id}
              className={`routine-template-row${template.isActive ? '' : ' paused'}`}
            >
              <div className="routine-template-main">
                <strong>{template.title}</strong>
                <span className="muted">
                  {describeCadence(template)} · {template.ownerName}
                  {template.nextOccurrenceDate
                    ? ` · next ${new Date(template.nextOccurrenceDate).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}`
                    : template.isActive
                      ? ' · nothing scheduled yet'
                      : ''}
                </span>
              </div>
              <span className={`routine-state ${template.isActive ? 'active' : 'paused'}`}>
                {template.isActive ? 'Active' : 'Paused'}
              </span>
              <div className="routine-template-actions">
                <button type="button" className="btn small" onClick={() => setEditing(template)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn small"
                  disabled={pending}
                  onClick={() => toggle(template)}
                >
                  {template.isActive ? 'Pause' : 'Activate'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <RoutineForm
          initialTitle={editing ? null : openWith}
          template={editing}
          canManageOthers={canManageOthers}
          people={people}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={(text) => {
            setCreating(false);
            setEditing(null);
            setMessage({ tone: 'success', text });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function RoutineForm({
  initialTitle = null,
  template,
  canManageOthers,
  people,
  onClose,
  onDone,
}: {
  initialTitle?: string | null;
  template: RoutineTemplateRow | null;
  canManageOthers: boolean;
  people: readonly { id: string; name: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(template?.title ?? initialTitle ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [cadenceId, setCadenceId] = useState(template ? cadenceIdFor(template) : 'weekly');
  const [customFrequency, setCustomFrequency] = useState<RecurrenceFrequency>(
    template?.frequency ?? 'monthly',
  );
  const [customInterval, setCustomInterval] = useState(String(template?.intervalCount ?? 1));
  const [weekday, setWeekday] = useState(String(template?.weekday ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String(template?.dayOfMonth ?? 1));
  const [dueTime, setDueTime] = useState((template?.dueTime ?? '17:00').slice(0, 5));
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [ownerId, setOwnerId] = useState(template?.ownerId ?? '');
  const [evidenceRequired, setEvidenceRequired] = useState(template?.evidenceRequired ?? false);
  const [requiresReview, setRequiresReview] = useState(template?.requiresCompletionReview ?? false);

  const cadence = ROUTINE_CADENCES.find((entry) => entry.id === cadenceId) ?? ROUTINE_CADENCES[1]!;
  const isCustom = cadenceId === 'custom';
  const frequency: RecurrenceFrequency = isCustom ? customFrequency : cadence.frequency;
  const intervalCount = isCustom ? Number(customInterval) || 1 : cadence.intervalCount;
  const needs = isCustom
    ? frequency === 'weekly'
      ? 'weekday'
      : frequency === 'monthly'
        ? 'day_of_month'
        : 'nothing'
    : cadence.needs;

  // The same sentence the list will show once this is saved.
  const preview = describeCadence({
    frequency,
    intervalCount,
    weekday: needs === 'weekday' ? Number(weekday) : null,
    dayOfMonth: needs === 'day_of_month' ? Number(dayOfMonth) : null,
  });

  function submit() {
    setError(null);
    const shape = {
      title: title.trim(),
      description: description.trim() || null,
      frequency,
      intervalCount,
      weekday: needs === 'weekday' ? Number(weekday) : null,
      dayOfMonth: needs === 'day_of_month' ? Number(dayOfMonth) : null,
      dueTime,
      evidenceRequired,
      requiresCompletionReview: requiresReview,
      idempotencyKey: crypto.randomUUID(),
    };

    startTransition(async () => {
      const result = template
        ? await updateRoutineTemplate({ ...shape, templateId: template.id })
        : await createRoutineTemplate({
            ...shape,
            ownerId: ownerId || null,
            startDate,
          });

      if (!result.ok) {
        setError(result.message ?? 'Nothing changed.');
        return;
      }
      onDone(
        result.code === 'routine_awaiting_review'
          ? `${shape.title} is set up and waiting for your manager to activate it.`
          : template
            ? `${shape.title} updated. Future occurrences use the new schedule.`
            : `${shape.title} is active. ${preview}.`,
      );
    });
  }

  return (
    <Modal open title={template ? 'Edit routine' : 'Set up a routine'} onClose={onClose}>
      <div className="modal-head">
        <div>
          <strong>{template ? 'Edit routine' : 'Set up a routine'}</strong>
          <span>Work is created automatically on this schedule.</span>
        </div>
        <button type="button" className="btn small" aria-label="Close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="modal-body">
        {error && (
          <div className="notice error" role="alert">
            <p>{error}</p>
          </div>
        )}

        <div className="field">
          <label htmlFor="routine-title">What repeats?</label>
          <input
            id="routine-title"
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="routine-description">Details — optional</label>
          <textarea
            id="routine-description"
            value={description}
            rows={2}
            maxLength={4000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="routine-cadence">How often?</label>
          <select
            id="routine-cadence"
            value={cadenceId}
            onChange={(event) => setCadenceId(event.target.value)}
          >
            {ROUTINE_CADENCES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        {isCustom && (
          <div className="routine-custom">
            <div className="field">
              <label htmlFor="routine-interval">Repeat every</label>
              <input
                id="routine-interval"
                type="number"
                min={1}
                max={52}
                value={customInterval}
                onChange={(event) => setCustomInterval(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="routine-unit">Unit</label>
              <select
                id="routine-unit"
                value={customFrequency}
                onChange={(event) => setCustomFrequency(event.target.value as RecurrenceFrequency)}
              >
                <option value="daily">days</option>
                <option value="weekly">weeks</option>
                <option value="monthly">months</option>
              </select>
            </div>
          </div>
        )}

        {needs === 'weekday' && (
          <div className="field">
            <label htmlFor="routine-weekday">On which day?</label>
            <select
              id="routine-weekday"
              value={weekday}
              onChange={(event) => setWeekday(event.target.value)}
            >
              {WEEKDAY_LABELS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {needs === 'day_of_month' && (
          <div className="field">
            <label htmlFor="routine-dom">On which date?</label>
            <select
              id="routine-dom"
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(event.target.value)}
            >
              {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
            <small className="muted">
              A date later than a short month has runs on that month&rsquo;s last day.
            </small>
          </div>
        )}

        <div className="field">
          <label htmlFor="routine-time">Due by</label>
          <input
            id="routine-time"
            type="time"
            value={dueTime}
            onChange={(event) => setDueTime(event.target.value)}
          />
        </div>

        {!template && (
          <div className="field">
            <label htmlFor="routine-start">Start from</label>
            <input
              id="routine-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
        )}

        {!template && canManageOthers && (
          <div className="field">
            <label htmlFor="routine-owner">Who does it?</label>
            <select
              id="routine-owner"
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
            >
              <option value="">Me</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <fieldset className="routine-flags">
          <legend>Each occurrence</legend>
          <label>
            <input
              type="checkbox"
              checked={evidenceRequired}
              onChange={(event) => setEvidenceRequired(event.target.checked)}
            />
            <span>Requires evidence before it can be completed</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={requiresReview}
              onChange={(event) => setRequiresReview(event.target.checked)}
            />
            <span>Needs a completion review</span>
          </label>
        </fieldset>

        <p className="routine-preview" role="status">
          {preview}
          {dueTime ? `, due by ${dueTime}` : ''}
        </p>
      </div>

      <div className="modal-foot">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={pending || title.trim().length === 0}
          aria-busy={pending}
          onClick={submit}
        >
          {pending ? 'Saving…' : template ? 'Save changes' : 'Create routine'}
        </button>
      </div>
    </Modal>
  );
}

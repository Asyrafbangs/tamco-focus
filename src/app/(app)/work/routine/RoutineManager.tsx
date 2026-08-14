'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  defaultPattern,
  describeRecurrence,
  FREQUENCY_LABELS,
  MONTH_LABELS,
  NTH_OPTIONS,
  patternFromRow,
  patternToColumns,
  todayIso,
  validatePattern,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  type RecurrenceFrequency,
  type RecurrencePattern,
} from '@/domain/routines';
import {
  createRoutineTemplate,
  deleteRoutineTemplate,
  setRoutineActive,
  updateRoutineTemplate,
} from '@/server/actions/routine-actions';
import type { RoutineTemplateRow } from '@/server/queries';
import { Modal } from '@/components/ui/Modal';

/**
 * Setting up and controlling routines.
 *
 * The recurrence editor is modelled on the one people already use in a
 * calendar client, because a routine is the same idea and inventing a second
 * vocabulary for it earns nothing. A frequency down the left, its options to
 * the right, and a range underneath.
 *
 * It replaced a list of eight fixed cadences. That list read well and could not
 * say "the first Wednesday of every month", had no start date, and offered
 * "Yearly" that was really monthly with an interval of twelve — which is how a
 * Safety Walk ended up described as "Yearly on the 5th" and first scheduled for
 * August 2027.
 */
function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function RoutineManager({
  templates,
  failed,
  canManageOthers,
  people,
  viewerId,
  openWith = null,
}: {
  templates: readonly RoutineTemplateRow[];
  failed: boolean;
  /** Managers may set a routine up for somebody else. */
  canManageOthers: boolean;
  people: readonly { id: string; name: string }[];
  /** Deleting is the creator's to do, so the row needs to know who is looking. */
  viewerId: string;
  /** A title arriving from New Work, which opens the form ready to fill in. */
  openWith?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<RoutineTemplateRow | null>(null);
  const [creating, setCreating] = useState(Boolean(openWith));
  const [confirmDelete, setConfirmDelete] = useState<RoutineTemplateRow | null>(null);

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

  function remove(template: RoutineTemplateRow) {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteRoutineTemplate({
        templateId: template.id,
        idempotencyKey: crypto.randomUUID(),
      });
      setConfirmDelete(null);
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.message ?? 'Nothing changed.' });
        return;
      }
      const cleared = result.future_occurrences_cleared ?? 0;
      setMessage({
        tone: 'success',
        text: cleared
          ? `${template.title} is in the Bin, with ${cleared} occurrence${cleared === 1 ? '' : 's'} that had not started yet.`
          : `${template.title} is in the Bin. Restore it from there if this was a mistake.`,
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
          {templates.map((template) => {
            const pattern = patternFromRow(template);
            /*
             * The generated occurrence if there is one, otherwise what the
             * schedule says. Only showing the generated one is why a routine
             * due next month read "nothing scheduled yet" — generation runs a
             * fortnight ahead, so a working schedule and a broken one looked
             * identical.
             */
            const nextDate = template.nextOccurrenceDate ?? template.scheduledNextDate;
            return (
              <li
                key={template.id}
                className={`routine-template-row${template.isActive ? '' : ' paused'}`}
              >
                <div className="routine-template-main">
                  <strong>{template.title}</strong>
                  <span className="muted">
                    {describeRecurrence(pattern)} · {template.ownerName}
                  </span>
                  <span className="routine-template-next">
                    {nextDate
                      ? `Next: ${formatDate(nextDate)}`
                      : template.isActive
                        ? 'This series has finished'
                        : 'Paused — nothing will be created'}
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
                  {/*
                    Deleting is for a routine that should not exist, which is
                    the person who set it up saying so. Anybody else who wants
                    it to stop wants Pause, and the procedure refuses either way.
                  */}
                  {template.createdBy === viewerId && (
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={pending}
                      onClick={() => setConfirmDelete(template)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmDelete && (
        <Modal open title="Delete this routine?" onClose={() => setConfirmDelete(null)}>
          <header className="modalhead">
            <div>
              <p className="eyebrow">Delete routine</p>
              <h2>{confirmDelete.title}</h2>
            </div>
          </header>
          <div className="modalbody">
            <p>
              It moves to the Bin and stops creating work. Occurrences that have already been
              started or completed stay exactly as they are — only ones nobody has begun are
              withdrawn.
            </p>
            <p className="muted">If you only want it to stop for now, use Pause instead.</p>
          </div>
          <footer className="modalfoot">
            <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={pending}
              onClick={() => remove(confirmDelete)}
            >
              {pending ? 'Deleting…' : 'Delete to Bin'}
            </button>
          </footer>
        </Modal>
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

const FREQUENCIES: readonly RecurrenceFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

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
  const [dueTime, setDueTime] = useState((template?.dueTime ?? '17:00').slice(0, 5));
  const [ownerId, setOwnerId] = useState(template?.ownerId ?? '');
  const [evidenceRequired, setEvidenceRequired] = useState(template?.evidenceRequired ?? false);
  const [requiresReview, setRequiresReview] = useState(template?.requiresCompletionReview ?? false);

  const [pattern, setPattern] = useState<RecurrencePattern>(() =>
    template ? patternFromRow(template) : defaultPattern(todayIso()),
  );

  function set(patch: Partial<RecurrencePattern>) {
    setPattern((current) => ({ ...current, ...patch }));
  }

  function toggleWeekday(day: number) {
    setPattern((current) => {
      const has = current.weekdays.includes(day);
      // Never empty: an empty weekly pattern has no meaning, and silently
      // accepting one would fail at the server with a message about a field
      // the person cannot see.
      if (has && current.weekdays.length === 1) return current;
      return {
        ...current,
        weekdays: has
          ? current.weekdays.filter((entry) => entry !== day)
          : [...current.weekdays, day].sort((a, b) => a - b),
      };
    });
  }

  const monthly = pattern.frequency === 'monthly' || pattern.frequency === 'yearly';
  const unitLabel =
    pattern.frequency === 'daily'
      ? 'day'
      : pattern.frequency === 'weekly'
        ? 'week'
        : pattern.frequency === 'monthly'
          ? 'month'
          : 'year';

  function submit() {
    setError(null);
    const shapeError = validatePattern(pattern);
    if (shapeError) {
      setError(shapeError);
      return;
    }
    if (!title.trim()) {
      setError('Give the routine a name.');
      return;
    }

    const columns = patternToColumns(pattern);
    const shape = {
      title: title.trim(),
      description: description.trim() || null,
      frequency: columns.frequency,
      intervalCount: columns.intervalCount,
      weekdays: columns.weekdays,
      monthlyMode: columns.monthlyMode,
      dayOfMonth: columns.dayOfMonth,
      nthWeekday: columns.nthWeekday as 1 | 2 | 3 | 4 | -1 | null,
      nthWeekdayDow: columns.nthWeekdayDow,
      monthOfYear: columns.monthOfYear,
      dueTime,
      startDate: columns.startDate,
      endsMode: columns.endsMode,
      endsAfterCount: columns.endsAfterCount,
      endsOnDate: columns.endsOnDate,
      evidenceRequired,
      requiresCompletionReview: requiresReview,
      idempotencyKey: crypto.randomUUID(),
    };

    startTransition(async () => {
      const result = template
        ? await updateRoutineTemplate({ ...shape, templateId: template.id })
        : await createRoutineTemplate({ ...shape, ownerId: ownerId || null });

      if (!result.ok) {
        setError(result.message ?? 'Nothing changed.');
        return;
      }
      const cleared = result.future_occurrences_cleared ?? 0;
      onDone(
        template
          ? cleared
            ? `${shape.title} updated. ${cleared} occurrence${cleared === 1 ? '' : 's'} that had not started were rescheduled.`
            : `${shape.title} updated.`
          : result.code === 'routine_awaiting_review'
            ? `${shape.title} is set up and waiting for your manager to activate it.`
            : `${shape.title} is active. ${describeRecurrence(pattern)}.`,
      );
    });
  }

  return (
    <Modal
      open
      size="wide"
      title={template ? 'Edit routine' : 'Set up a routine'}
      onClose={onClose}
    >
      <header className="modalhead">
        <div>
          <p className="eyebrow">Routine</p>
          <h2>{template ? 'Edit routine' : 'Set up a routine'}</h2>
        </div>
      </header>

      <div className="modalbody routine-form">
        {error && (
          <div className="notice error" role="alert">
            <p>{error}</p>
          </div>
        )}

        <div className="field">
          <label htmlFor="routine-title">What is the routine?</label>
          <input
            id="routine-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Monthly Gemba walk"
          />
        </div>

        <div className="field">
          <label htmlFor="routine-description">
            Notes <span className="optional-label">Optional</span>
          </label>
          <textarea
            id="routine-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What the person doing it needs to know."
          />
        </div>

        {canManageOthers && !template && (
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

        {/* ---------------------------------------------------------------- */}
        <fieldset className="recurrence-block">
          <legend>Recurrence pattern</legend>
          <div className="recurrence-grid">
            <div className="recurrence-frequencies" role="radiogroup" aria-label="How often">
              {FREQUENCIES.map((option) => (
                <label key={option} className="recurrence-frequency">
                  <input
                    type="radio"
                    name="routine-frequency"
                    checked={pattern.frequency === option}
                    onChange={() => set({ frequency: option })}
                  />
                  <span>{FREQUENCY_LABELS[option]}</span>
                </label>
              ))}
            </div>

            <div className="recurrence-options">
              <div className="recurrence-line">
                <span>Repeat every</span>
                <input
                  className="recurrence-number"
                  type="number"
                  min={1}
                  max={99}
                  aria-label={`Number of ${unitLabel}s between occurrences`}
                  value={pattern.intervalCount}
                  onChange={(event) =>
                    set({ intervalCount: Math.max(1, Number(event.target.value) || 1) })
                  }
                />
                <span>{pattern.intervalCount === 1 ? unitLabel : `${unitLabel}s`}</span>
              </div>

              {pattern.frequency === 'weekly' && (
                <div className="recurrence-line recurrence-weekdays">
                  <span>on</span>
                  <div className="weekday-toggles">
                    {WEEKDAY_SHORT.map((label, index) => {
                      const day = index + 1;
                      const on = pattern.weekdays.includes(day);
                      return (
                        <button
                          key={label}
                          type="button"
                          className={`weekday-toggle${on ? ' on' : ''}`}
                          aria-pressed={on}
                          aria-label={WEEKDAY_LABELS[index]}
                          onClick={() => toggleWeekday(day)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {monthly && (
                <div className="recurrence-monthly" role="radiogroup" aria-label="Which day">
                  <label className="recurrence-line">
                    <input
                      type="radio"
                      name="routine-monthly-mode"
                      checked={pattern.monthlyMode === 'day_of_month'}
                      onChange={() => set({ monthlyMode: 'day_of_month' })}
                    />
                    <span>Day</span>
                    <input
                      className="recurrence-number"
                      type="number"
                      min={1}
                      max={31}
                      aria-label="Day of the month"
                      value={pattern.dayOfMonth}
                      onChange={(event) =>
                        set({
                          monthlyMode: 'day_of_month',
                          dayOfMonth: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                        })
                      }
                    />
                    {pattern.frequency === 'yearly' && (
                      <select
                        aria-label="Month of the year"
                        value={pattern.monthOfYear}
                        onChange={(event) => set({ monthOfYear: Number(event.target.value) })}
                      >
                        {MONTH_LABELS.map((label, index) => (
                          <option key={label} value={index + 1}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>

                  <label className="recurrence-line">
                    <input
                      type="radio"
                      name="routine-monthly-mode"
                      checked={pattern.monthlyMode === 'nth_weekday'}
                      onChange={() => set({ monthlyMode: 'nth_weekday' })}
                    />
                    <span>The</span>
                    <select
                      aria-label="Which occurrence in the month"
                      value={pattern.nthWeekday}
                      onChange={(event) =>
                        set({ monthlyMode: 'nth_weekday', nthWeekday: Number(event.target.value) })
                      }
                    >
                      {NTH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Which weekday"
                      value={pattern.nthWeekdayDow}
                      onChange={(event) =>
                        set({
                          monthlyMode: 'nth_weekday',
                          nthWeekdayDow: Number(event.target.value),
                        })
                      }
                    >
                      {WEEKDAY_LABELS.map((label, index) => (
                        <option key={label} value={index + 1}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {pattern.frequency === 'yearly' && (
                      <>
                        <span>of</span>
                        <select
                          aria-label="Month of the year"
                          value={pattern.monthOfYear}
                          onChange={(event) => set({ monthOfYear: Number(event.target.value) })}
                        >
                          {MONTH_LABELS.map((label, index) => (
                            <option key={label} value={index + 1}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </label>
                </div>
              )}

              <div className="recurrence-line">
                <label htmlFor="routine-time">Due at</label>
                <input
                  id="routine-time"
                  type="time"
                  value={dueTime}
                  onChange={(event) => setDueTime(event.target.value)}
                />
              </div>
            </div>
          </div>
        </fieldset>

        {/* ---------------------------------------------------------------- */}
        <fieldset className="recurrence-block">
          <legend>Range of recurrence</legend>

          <div className="recurrence-line">
            <label htmlFor="routine-start">Start</label>
            <input
              id="routine-start"
              type="date"
              value={pattern.startDate}
              onChange={(event) => set({ startDate: event.target.value || todayIso() })}
            />
          </div>

          <div className="recurrence-ends" role="radiogroup" aria-label="When it ends">
            <label className="recurrence-line">
              <input
                type="radio"
                name="routine-ends"
                checked={pattern.endsMode === 'never'}
                onChange={() => set({ endsMode: 'never' })}
              />
              <span>No end date</span>
            </label>

            <label className="recurrence-line">
              <input
                type="radio"
                name="routine-ends"
                checked={pattern.endsMode === 'after'}
                onChange={() =>
                  set({ endsMode: 'after', endsAfterCount: pattern.endsAfterCount ?? 10 })
                }
              />
              <span>End after</span>
              <input
                className="recurrence-number"
                type="number"
                min={1}
                max={999}
                aria-label="Number of occurrences"
                value={pattern.endsAfterCount ?? ''}
                onChange={(event) =>
                  set({ endsMode: 'after', endsAfterCount: Number(event.target.value) || null })
                }
              />
              <span>occurrences</span>
            </label>

            <label className="recurrence-line">
              <input
                type="radio"
                name="routine-ends"
                checked={pattern.endsMode === 'on_date'}
                onChange={() => set({ endsMode: 'on_date' })}
              />
              <span>End by</span>
              <input
                type="date"
                aria-label="Last date"
                value={pattern.endsOnDate ?? ''}
                onChange={(event) =>
                  set({ endsMode: 'on_date', endsOnDate: event.target.value || null })
                }
              />
            </label>
          </div>
        </fieldset>

        {/*
          The same sentence the list will show. Computed from the same fields
          the server stores, so what is read here is what will happen.
        */}
        <p className="recurrence-preview">
          <strong>{describeRecurrence(pattern)}</strong>
          {/*
            "Runs from", not "Starting". The start date bounds the series; it
            is not the first occurrence, and for "the first Wednesday of every
            month" set up mid-month the two are weeks apart. The list row shows
            the real next date, which the database computes.
          */}
          <span>Runs from {formatDate(pattern.startDate)}</span>
        </p>

        <div className="routine-form-flags">
          <label>
            <input
              type="checkbox"
              checked={evidenceRequired}
              onChange={(event) => setEvidenceRequired(event.target.checked)}
            />
            <span>Evidence is required to complete each one</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={requiresReview}
              onChange={(event) => setRequiresReview(event.target.checked)}
            />
            <span>A manager reviews each completion</span>
          </label>
        </div>
      </div>

      <footer className="modalfoot">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={pending} onClick={submit}>
          {pending ? 'Saving…' : template ? 'Save changes' : 'Create routine'}
        </button>
      </footer>
    </Modal>
  );
}

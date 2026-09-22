'use client';

import { useActionState, useState } from 'react';

import { calendarLines } from '@/domain/esh-followup';
import {
  saveFollowupPolicy,
  saveWorkingCalendar,
  type FollowupFormState,
} from '@/server/esh/followup-actions';
import type { FollowupSettings } from '@/server/esh/queries';

const INITIAL: FollowupFormState = { ok: false, message: '' };
const WEEKDAYS = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [7, 'Sunday'],
] as const;

function Result({ state }: { state: FollowupFormState }) {
  if (!state.message) return null;
  return (
    <div className={`notice ${state.ok ? 'success' : 'error'} compact`} role="status">
      <strong>{state.message}</strong>
      {state.problems && state.problems.length > 0 && (
        <ul>
          {state.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FollowupSettingsForm({ settings }: { settings: FollowupSettings }) {
  const [policyState, policyAction, policyPending] = useActionState(saveFollowupPolicy, INITIAL);
  const [calendarState, calendarAction, calendarPending] = useActionState(
    saveWorkingCalendar,
    INITIAL,
  );
  const [levels, setLevels] = useState(settings.levelDays);

  return (
    <section className="esh-policy-stack" aria-labelledby="followup-settings-title">
      {/* v204 put weekly reports on this page too, so follow-up is a named
          section of it rather than the whole of it. */}
      <div className="esh-section-heading">
        <div>
          <h2 id="followup-settings-title">Follow-up settings</h2>
          <p>Reminders, escalation timing and the working-day calendar behind them.</p>
        </div>
      </div>
      <form action={policyAction} className="esh-policy-form">
        <Result state={policyState} />
        <section className="esh-form-card" aria-labelledby="owner-followup-title">
          <h3 id="owner-followup-title" className="esh-form-card-title">
            Owner reminders
          </h3>
          <div className="form-grid two">
            <label className="esh-field">
              <span>Before due date</span>
              <input
                name="pre_due_days"
                type="number"
                min="0"
                max="30"
                defaultValue={settings.preDueDays}
              />
              <small>Calendar days. Use 0 to turn this reminder off.</small>
            </label>
            <label className="esh-field">
              <span>While overdue</span>
              <input
                name="overdue_every_days"
                type="number"
                min="1"
                max="30"
                defaultValue={settings.overdueEveryDays}
              />
              <small>Repeat every this many calendar days.</small>
            </label>
          </div>
          <label className="check-row">
            <input name="remind_on_due" type="checkbox" defaultChecked={settings.remindOnDue} />
            <span>Send a due-day reminder</span>
          </label>
        </section>

        <section className="esh-form-card" aria-labelledby="escalation-timing-title">
          <h3 id="escalation-timing-title" className="esh-form-card-title">
            Escalation timing
          </h3>
          <div className="esh-policy-levels">
            {levels.map((days, index) => (
              <label className="esh-policy-level" key={index}>
                <span>Level {index + 1}</span>
                <input
                  name="level_days"
                  type="number"
                  min="0"
                  max="365"
                  value={days}
                  onChange={(event) =>
                    setLevels((current) =>
                      current.map((value, position) =>
                        position === index ? Number(event.target.value) : value,
                      ),
                    )
                  }
                />
                <small>calendar days overdue</small>
                {levels.length > 1 && index === levels.length - 1 && (
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => setLevels((current) => current.slice(0, -1))}
                  >
                    Remove
                  </button>
                )}
              </label>
            ))}
          </div>
          {levels.length < 9 && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setLevels((current) => [...current, (current.at(-1) ?? 0) + 2])}
            >
              + Add Level {levels.length + 1}
            </button>
          )}
        </section>

        <section className="esh-form-card" aria-labelledby="review-followup-title">
          <h3 id="review-followup-title" className="esh-form-card-title">
            ESH review follow-up
          </h3>
          <label className="esh-field">
            <span>Remind ESH reviewer after</span>
            <input
              name="review_reminder_days"
              type="number"
              min="1"
              max="30"
              defaultValue={settings.reviewReminderDays}
            />
            <small>Working days from the maintained calendar below.</small>
          </label>
        </section>

        <div className="notice neutral">
          <p>
            Owner completion reminders and escalation stop while ESH is reviewing. A policy save
            applies to future assignments; assigned work keeps its original policy snapshot.
          </p>
        </div>
        <div className="esh-form-actions">
          <span className="form-hint">
            Version {settings.version} · {settings.timeZone} · date-only work is due at 17:00
          </span>
          <button className="btn primary" type="submit" disabled={policyPending}>
            {policyPending ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </form>

      <form action={calendarAction} className="esh-policy-form">
        <Result state={calendarState} />
        <section className="esh-form-card" aria-labelledby="working-calendar-title">
          <h3 id="working-calendar-title" className="esh-form-card-title">
            Working-day calendar
          </h3>
          <p className="esh-form-card-hint">
            The weekday pattern is not a Malaysian holiday calendar. Add and label every exception
            used for review follow-up.
          </p>
          <fieldset className="esh-weekdays">
            <legend>Usual working days</legend>
            {WEEKDAYS.map(([day, label]) => (
              <label className="check-row" key={day}>
                <input
                  type="checkbox"
                  name="working_weekdays"
                  value={day}
                  defaultChecked={settings.workingWeekdays.includes(day)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <div className="form-grid two">
            <label className="esh-field">
              <span>Non-working dates</span>
              <textarea
                name="non_working_dates"
                rows={5}
                defaultValue={calendarLines(settings.calendarExceptions, false)}
                placeholder="2026-12-25 | Christmas Day"
              />
              <small>One per line: YYYY-MM-DD | label</small>
            </label>
            <label className="esh-field">
              <span>Additional working dates</span>
              <textarea
                name="additional_working_dates"
                rows={5}
                defaultValue={calendarLines(settings.calendarExceptions, true)}
                placeholder="2026-12-19 | Replacement workday"
              />
              <small>Overrides the usual weekday pattern.</small>
            </label>
          </div>
          <label className="esh-field esh-calendar-confirmed">
            <span>Holiday calendar confirmed through</span>
            <input
              name="confirmed_through"
              type="date"
              defaultValue={settings.calendarConfirmedThrough ?? ''}
            />
            <small>
              Leave blank until ESH has reviewed the dates. The system does not imply public-holiday
              coverage.
            </small>
          </label>
        </section>
        <div className="esh-form-actions">
          <span className="form-hint">
            {settings.calendarConfirmedThrough
              ? `Confirmed through ${settings.calendarConfirmedThrough}`
              : 'Holiday coverage is not yet confirmed'}
          </span>
          <button className="btn primary" type="submit" disabled={calendarPending}>
            {calendarPending ? 'Saving…' : 'Save calendar'}
          </button>
        </div>
      </form>
    </section>
  );
}

'use client';

import { useActionState, useState } from 'react';

import { saveFollowupRule, saveQuietHours } from '@/server/esh/followup-actions';
import type { FollowupSettings } from '@/server/esh/queries';

/**
 * Where the schedule may differ, and when it stays quiet (v209, §16).
 *
 * The organisation's policy above answers for most work. A rule here answers
 * for one risk level or one priority instead — a critical finding chased
 * harder than a housekeeping observation, which is the whole point of §16's
 * insistence that one hardcoded rule must not stand in for safety policy.
 * The rule that applies to an action is settled when it is assigned, so
 * changing this never rewrites what an owner was already promised.
 */

const RISKS = [
  { value: 'critical', label: 'Critical risk' },
  { value: 'high', label: 'High risk' },
  { value: 'medium', label: 'Medium risk' },
  { value: 'low', label: 'Low risk' },
  { value: 'not_assessed', label: 'Not assessed' },
];

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent priority' },
  { value: 'high', label: 'High priority' },
  { value: 'normal', label: 'Normal priority' },
];

const INITIAL = { ok: false, message: '' };

function Result({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <p className={state.ok ? 'notice success' : 'esh-field-error'} role="status">
      {state.message}
    </p>
  );
}

function RuleEditor({
  rule,
  settings,
}: {
  rule: FollowupSettings['rules'][number] | null;
  settings: FollowupSettings;
}) {
  const [state, action, pending] = useActionState(saveFollowupRule, INITIAL);
  const [appliesTo, setAppliesTo] = useState<'risk' | 'priority'>(rule?.appliesTo ?? 'risk');
  const existing = rule !== null;
  const levels = rule?.levelDays ?? settings.levelDays;
  const id = existing ? `${rule.appliesTo}-${rule.appliesValue}` : 'new';

  return (
    <form action={action} className="esh-form-card esh-followup-rule">
      <h3 className="esh-form-card-title">
        {existing
          ? `${[...RISKS, ...PRIORITIES].find((option) => option.value === rule.appliesValue)?.label ?? rule.appliesValue}`
          : 'A different schedule for some work'}
      </h3>
      <Result state={state} />
      <div className="form-grid two">
        <div className="esh-field">
          <label htmlFor={`applies-to-${id}`}>Applies to</label>
          <select
            id={`applies-to-${id}`}
            name="applies_to"
            value={appliesTo}
            disabled={existing}
            onChange={(event) => setAppliesTo(event.target.value as 'risk' | 'priority')}
          >
            <option value="risk">A risk level</option>
            <option value="priority">An action priority</option>
          </select>
          {existing && <input type="hidden" name="applies_to" value={rule.appliesTo} />}
        </div>
        <div className="esh-field">
          <label htmlFor={`applies-value-${id}`}>Which</label>
          <select
            id={`applies-value-${id}`}
            name="applies_value"
            defaultValue={rule?.appliesValue ?? ''}
            disabled={existing}
          >
            {(appliesTo === 'risk' ? RISKS : PRIORITIES).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {existing && <input type="hidden" name="applies_value" value={rule.appliesValue} />}
          <small>Priority is checked first, then risk, then the policy above.</small>
        </div>
        <label className="esh-field">
          <span>Before due date</span>
          <input
            name="pre_due_days"
            type="number"
            min={0}
            max={30}
            defaultValue={rule?.preDueDays ?? settings.preDueDays}
          />
        </label>
        <label className="esh-field">
          <span>Overdue reminder, every</span>
          <input
            name="overdue_every_days"
            type="number"
            min={1}
            max={30}
            defaultValue={rule?.overdueEveryDays ?? settings.overdueEveryDays}
          />
        </label>
        <label className="esh-field">
          <span>ESH review reminder after</span>
          <input
            name="review_reminder_days"
            type="number"
            min={1}
            max={30}
            defaultValue={rule?.reviewReminderDays ?? settings.reviewReminderDays}
          />
        </label>
        <label className="esh-field esh-followup-rule-ondue">
          <input
            name="remind_on_due"
            type="checkbox"
            defaultChecked={rule?.remindOnDue ?? settings.remindOnDue}
          />
          <span>Remind on the day it is due</span>
        </label>
      </div>
      <fieldset className="esh-followup-rule-levels">
        <legend>Escalate at, in days overdue</legend>
        {levels.map((day, index) => (
          <label key={`${id}-level-${index}`} className="esh-field">
            <span>Level {index + 1}</span>
            <input name="level_days" type="number" min={1} max={365} defaultValue={day} />
          </label>
        ))}
      </fieldset>
      <div className="esh-import-actions">
        <button type="submit" className="btn" disabled={pending}>
          {existing ? 'Save this rule' : 'Add this rule'}
        </button>
        {existing && (
          <button type="submit" name="remove" value="true" className="btn ghost small">
            Remove it
          </button>
        )}
      </div>
    </form>
  );
}

export function FollowupRulesForm({ settings }: { settings: FollowupSettings }) {
  const [quietState, quietAction, quietPending] = useActionState(saveQuietHours, INITIAL);

  return (
    <section className="esh-policy-stack" aria-labelledby="followup-rules-title">
      <div className="esh-section-heading">
        <div>
          <h2 id="followup-rules-title">When the schedule differs</h2>
          <p>
            Rules for particular work, and the hours when routine mail waits. Escalation is never
            held: quiet hours are about not pestering people at night, not about holding up news.
          </p>
        </div>
      </div>

      <form action={quietAction} className="esh-form-card">
        <h3 className="esh-form-card-title">Quiet hours and catching up</h3>
        <Result state={quietState} />
        <div className="form-grid two">
          <label className="esh-field">
            <span>Quiet from</span>
            <input name="quiet_from" type="time" defaultValue={settings.quietFrom ?? ''} />
          </label>
          <label className="esh-field">
            <span>Quiet until</span>
            <input name="quiet_to" type="time" defaultValue={settings.quietTo ?? ''} />
            <small>Leave both empty to send routine reminders whenever they are raised.</small>
          </label>
          <div className="esh-field">
            <label htmlFor="catch-up">After an outage</label>
            <select id="catch-up" name="catch_up" defaultValue={settings.catchUp}>
              <option value="coalesce">Send the highest stage now due, and record the rest</option>
              <option value="every_missed">Send every stage that was missed</option>
            </select>
            <small>
              Coalescing is the safer default: it says what was skipped instead of posting a week of
              letters at once.
            </small>
          </div>
        </div>
        <button type="submit" className="btn" disabled={quietPending}>
          Save these
        </button>
      </form>

      {settings.rules.map((rule) => (
        <RuleEditor
          key={`${rule.appliesTo}-${rule.appliesValue}`}
          rule={rule}
          settings={settings}
        />
      ))}
      <RuleEditor rule={null} settings={settings} />
    </section>
  );
}

'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { ESH_PRESET_DESCRIPTIONS, ESH_PRESET_LABELS, type EshPreset } from '@/domain/esh-findings';
import { setStaffEshAccess, type StaffAccessState } from '@/server/esh/actions';
import type { StaffEshAccess } from '@/server/esh/queries';

/**
 * Identity & Access → selected person → Finding Management access (§43.2).
 *
 * Off by default for everybody. Enabling somebody is a deliberate act with a
 * role and an explicit scope; it is audited, and it grants the administrator
 * doing it nothing (FM59). Submitted by hand so a refused save keeps what was
 * chosen instead of resetting the form.
 *
 * Switching access off keeps the role and scope below as they were, so
 * switching it back on restores them: the fields are dimmed, not disabled,
 * because a disabled field would not be sent and the save would erase them.
 */
export function EshAccessForm({
  userId,
  firstName,
  access,
  rolloutConfigured,
  departments,
}: {
  userId: string;
  firstName: string;
  access: StaffEshAccess | null;
  rolloutConfigured: boolean;
  departments: Array<{ id: string; name: string }>;
}) {
  const [enabled, setEnabled] = useState(access?.enabled ?? false);
  const [preset, setPreset] = useState<EshPreset>(access?.preset ?? 'viewer');
  const [scope, setScope] = useState<'all' | 'departments'>(
    access?.scopeAll ? 'all' : 'departments',
  );
  const [state, setState] = useState<StaffAccessState | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await setStaffEshAccess(null, data));
    });
  }

  if (!rolloutConfigured) {
    return (
      <p className="form-hint">
        Finding Management is not set up on this database, so no access can be granted.
      </p>
    );
  }

  const enabledBy = access?.enabled
    ? access.bootstrap
      ? 'Enabled at the rollout’s first setup.'
      : `Enabled by ${access.enabledByName ?? 'an administrator'}${
          access.enabledAt
            ? ` on ${new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(new Date(access.enabledAt))}`
            : ''
        }.`
    : 'Off. Finding Management is hidden from this person.';

  return (
    <form className="settings-form esh-access-form" onSubmit={onSubmit}>
      <input type="hidden" name="user_id" value={userId} />
      <p className="form-hint">{enabledBy}</p>

      <label className="check-row">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>
          Enable Finding Management for {firstName}
          <small>
            Nobody has access until it is enabled here, including managers and administrators.
          </small>
        </span>
      </label>

      <fieldset className={enabled ? undefined : 'esh-dimmed'}>
        <legend>Role</legend>
        {(Object.keys(ESH_PRESET_LABELS) as EshPreset[]).map((option) => (
          <label key={option} className="radio-row">
            <input
              type="radio"
              name="preset"
              value={option}
              checked={preset === option}
              onChange={() => setPreset(option)}
            />
            <span>
              {ESH_PRESET_LABELS[option]}
              <small>{ESH_PRESET_DESCRIPTIONS[option]}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={enabled ? undefined : 'esh-dimmed'}>
        <legend>Scope</legend>
        <label className="radio-row">
          <input
            type="radio"
            name="scope"
            value="departments"
            checked={scope === 'departments'}
            onChange={() => setScope('departments')}
          />
          <span>Selected departments</span>
        </label>
        {scope === 'departments' && (
          <div className="esh-access-departments">
            {departments.map((department) => (
              <label key={department.id} className="check-row">
                <input
                  type="checkbox"
                  name="department_ids"
                  value={department.id}
                  defaultChecked={access?.departmentIds.includes(department.id)}
                />
                <span>{department.name}</span>
              </label>
            ))}
            <label className="check-row">
              <input
                type="checkbox"
                name="include_descendants"
                defaultChecked={access?.includeDescendants}
              />
              <span>
                Include their sub-departments
                <small>
                  Choosing a department does not include the ones below it unless this is ticked.
                </small>
              </span>
            </label>
          </div>
        )}
        <label className="radio-row">
          <input
            type="radio"
            name="scope"
            value="all"
            checked={scope === 'all'}
            onChange={() => setScope('all')}
          />
          <span>
            The whole organisation
            <small>Every department, including restricted findings.</small>
          </span>
        </label>
      </fieldset>

      <label className="check-row">
        <input
          type="checkbox"
          name="can_manage_reports"
          defaultChecked={access?.canManageReports}
        />
        <span>
          Can manage weekly reports
          <small>Sets up leadership reports. Grants no finding content by itself.</small>
        </span>
      </label>

      <label>
        <span>Reason (recorded in the audit)</span>
        <input name="reason" maxLength={300} placeholder="Pilot user, ESH coordinator for BR2" />
      </label>

      {state && (
        <p
          className={state.ok ? 'notice success' : 'notice error'}
          role={state.ok ? 'status' : 'alert'}
        >
          {state.message}
        </p>
      )}

      <div className="esh-form-actions">
        <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save Finding Management access'}
        </button>
      </div>
    </form>
  );
}

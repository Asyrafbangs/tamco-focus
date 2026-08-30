'use client';

import { useActionState, useMemo, useState } from 'react';

import type { CurrentProfile } from '@/lib/supabase/server';
import {
  changeUserStatusAction,
  provisionUserAction,
  setVisibilityAction,
  updateMyPreferencesAction,
  updateOrgSettingAction,
  updateUserAction,
  type SettingsActionState,
} from '@/server/actions/settings-actions';
import type { DirectoryData, DirectoryUser, PersonalSettingsData } from '@/server/queries';

const INITIAL_STATE: SettingsActionState = { ok: false, code: 'idle', message: '' };

function ActionStatus({ state }: { state: SettingsActionState }) {
  if (!state.message) return null;
  return (
    <div
      className={`notice ${state.ok ? 'success' : 'error'}`}
      role={state.ok ? 'status' : 'alert'}
    >
      <strong>{state.ok ? 'Saved' : 'Could not save'}</strong>
      <p>{state.message}</p>
    </div>
  );
}

export function PersonalSettingsForm({
  profile,
  data,
  section = 'all',
}: {
  profile: CurrentProfile;
  data: PersonalSettingsData;
  section?: 'all' | 'workspace' | 'alerts' | 'accessibility';
}) {
  const [state, action, pending] = useActionState(updateMyPreferencesAction, INITIAL_STATE);
  const quietEnabled = profile.quiet_hours_start !== null && profile.quiet_hours_end !== null;
  return (
    <form action={action} className="settings-form">
      {section !== 'all' && section !== 'workspace' && (
        <>
          <input type="hidden" name="defaultLandingPage" value={profile.default_landing_page} />
          <input type="hidden" name="dailyBriefMode" value={profile.daily_brief_mode} />
          <input type="hidden" name="dailyBriefHour" value={profile.daily_brief_hour} />
          <input type="hidden" name="firstDayOfWeek" value={profile.first_day_of_week} />
          <input type="hidden" name="quietHoursStart" value={profile.quiet_hours_start ?? 18} />
          <input type="hidden" name="quietHoursEnd" value={profile.quiet_hours_end ?? 8} />
          {quietEnabled && <input type="hidden" name="quietHoursEnabled" value="on" />}
        </>
      )}
      {section !== 'all' && section !== 'alerts' && (
        <>
          {data.alerts.barrierInvolvingMe && (
            <input type="hidden" name="barrierInvolvingMe" value="on" />
          )}
          {data.alerts.assignmentChanges && (
            <input type="hidden" name="assignmentChanges" value="on" />
          )}
          {data.alerts.collaborationHandoff && (
            <input type="hidden" name="collaborationHandoff" value="on" />
          )}
          {data.alerts.dueTodayAndDeadlines && (
            <input type="hidden" name="dueTodayAndDeadlines" value="on" />
          )}
          {data.alerts.routineUpcoming && <input type="hidden" name="routineUpcoming" value="on" />}
          <input type="hidden" name="personalSummaryMode" value={profile.personal_summary_mode} />
        </>
      )}
      {section !== 'all' && section !== 'accessibility' && (
        <>
          <input type="hidden" name="themePreference" value={profile.theme_preference} />
          <input type="hidden" name="textSize" value={profile.text_size} />
          {profile.reduced_motion && <input type="hidden" name="reducedMotion" value="on" />}
          {profile.status_labels_always_visible && (
            <input type="hidden" name="statusLabelsAlwaysVisible" value="on" />
          )}
          {profile.shortcut_hints && <input type="hidden" name="shortcutHints" value="on" />}
        </>
      )}
      {(section === 'all' || section === 'workspace') && (
        <fieldset>
          <legend>My workspace</legend>
          <div className="form-grid">
            <label>
              <span>Default opening page</span>
              <select name="defaultLandingPage" defaultValue={profile.default_landing_page}>
                <option value="today">Today</option>
                <option value="work">Work</option>
                <option value="plan">Plan</option>
                <option value="team">Team</option>
                <option value="more">More</option>
              </select>
            </label>
            <label>
              <span>Daily brief</span>
              <select name="dailyBriefMode" defaultValue={profile.daily_brief_mode}>
                <option value="off">Off</option>
                <option value="workdays">Workdays</option>
                <option value="daily">Every day</option>
              </select>
            </label>
            <label>
              <span>Daily brief hour</span>
              <input
                name="dailyBriefHour"
                type="number"
                min="0"
                max="23"
                defaultValue={profile.daily_brief_hour}
              />
            </label>
            <label>
              <span>First day of week</span>
              <select name="firstDayOfWeek" defaultValue={profile.first_day_of_week}>
                <option value="1">Monday</option>
                <option value="0">Sunday</option>
                <option value="6">Saturday</option>
              </select>
            </label>
          </div>
          <label className="check-row">
            <input name="quietHoursEnabled" type="checkbox" defaultChecked={quietEnabled} />
            <span>Use quiet hours for non-critical reminders</span>
          </label>
          <div className="form-grid two">
            <label>
              <span>Quiet hours start</span>
              <input
                name="quietHoursStart"
                type="number"
                min="0"
                max="23"
                defaultValue={profile.quiet_hours_start ?? 18}
              />
            </label>
            <label>
              <span>Quiet hours end</span>
              <input
                name="quietHoursEnd"
                type="number"
                min="0"
                max="23"
                defaultValue={profile.quiet_hours_end ?? 8}
              />
            </label>
          </div>
          <p className="form-hint">
            Identity and timezone are controlled by your administrator: {profile.email} ·{' '}
            {profile.timezone}
          </p>
        </fieldset>
      )}

      {(section === 'all' || section === 'alerts') && (
        <fieldset>
          <legend>My alerts</legend>
          <p className="form-hint">
            Each notification recorded for these alerts also arrives by email, with a secure link to
            the exact task, contribution, Goal, or request.
          </p>
          <label className="check-row">
            <input
              name="barrierInvolvingMe"
              type="checkbox"
              defaultChecked={data.alerts.barrierInvolvingMe}
            />
            <span>Barrier or support involving me</span>
          </label>
          <label className="check-row">
            <input
              name="assignmentChanges"
              type="checkbox"
              defaultChecked={data.alerts.assignmentChanges}
            />
            <span>Assignment and reassignment</span>
          </label>
          <label className="check-row">
            <input
              name="collaborationHandoff"
              type="checkbox"
              defaultChecked={data.alerts.collaborationHandoff}
            />
            <span>Collaborative handoff</span>
          </label>
          <label className="check-row">
            <input
              name="dueTodayAndDeadlines"
              type="checkbox"
              defaultChecked={data.alerts.dueTodayAndDeadlines}
            />
            <span>Due-today and selection deadlines</span>
          </label>
          <label className="check-row">
            <input
              name="routineUpcoming"
              type="checkbox"
              defaultChecked={data.alerts.routineUpcoming}
            />
            <span>Routine work coming up</span>
          </label>
          <label>
            <span>Weekly email summary</span>
            <select name="personalSummaryMode" defaultValue={profile.personal_summary_mode}>
              <option value="off">Off</option>
              <option value="focused">Focused</option>
              <option value="standard">Standard</option>
            </select>
          </label>
        </fieldset>
      )}

      {(section === 'all' || section === 'accessibility') && (
        <fieldset>
          <legend>Accessibility</legend>
          <div className="form-grid two">
            <label>
              <span>Theme</span>
              <select name="themePreference" defaultValue={profile.theme_preference}>
                <option value="system">Follow device</option>
                <option value="light">Day</option>
                <option value="dark">Night</option>
              </select>
            </label>
            <label>
              <span>Text size</span>
              <select name="textSize" defaultValue={profile.text_size}>
                <option value="default">Default</option>
                <option value="large">Large</option>
                <option value="larger">Larger</option>
              </select>
            </label>
          </div>
          <label className="check-row">
            <input name="reducedMotion" type="checkbox" defaultChecked={profile.reduced_motion} />
            <span>Reduce motion</span>
          </label>
          <label className="check-row">
            <input
              name="statusLabelsAlwaysVisible"
              type="checkbox"
              defaultChecked={profile.status_labels_always_visible}
            />
            <span>Keep written status labels visible</span>
          </label>
          <label className="check-row">
            <input name="shortcutHints" type="checkbox" defaultChecked={profile.shortcut_hints} />
            <span>Show keyboard shortcut hints</span>
          </label>
        </fieldset>
      )}
      <ActionStatus state={state} />
      <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save my settings'}
      </button>
    </form>
  );
}

function settingInput(key: string, value: unknown) {
  if (typeof value === 'boolean')
    return (
      <select name="value" defaultValue={String(value)}>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    );
  if (key === 'review.request_changes_outcome')
    return (
      <select name="value" defaultValue={String(value)}>
        <option value="return_to_available">Return to Available Work</option>
        <option value="reopen_active">Reopen as Active</option>
      </select>
    );
  return <input name="value" type="number" defaultValue={Number(value)} min="1" />;
}

export function SettingsPolicyRow({
  setting,
}: {
  setting: PersonalSettingsData['organisation'][number];
}) {
  const [state, action, pending] = useActionState(updateOrgSettingAction, INITIAL_STATE);
  return (
    <form action={action} className="setting-row">
      <input type="hidden" name="key" value={setting.key} />
      <div>
        <strong>{setting.key.replaceAll('.', ' · ').replaceAll('_', ' ')}</strong>
        <p>{setting.description}</p>
      </div>
      <div className="setting-control">
        {settingInput(setting.key, setting.value)}
        <button className="btn small" type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <ActionStatus state={state} />
    </form>
  );
}

const ROLE_WORDS: Record<DirectoryUser['role'], string> = {
  team_member: 'team member',
  manager: 'manager',
  administrator: 'administrator',
};

const peopleOptions = (users: DirectoryUser[], excludeId?: string) =>
  users.filter((user) => user.status === 'active' && user.id !== excludeId);

export function UserCreateForm({ directory }: { directory: DirectoryData }) {
  const [state, action, pending] = useActionState(provisionUserAction, INITIAL_STATE);
  return (
    <form action={action} className="settings-form">
      <div className="form-grid">
        <label>
          <span>Full name</span>
          <input name="fullName" required maxLength={120} />
        </label>
        <label>
          <span>Employee ID</span>
          {/*
            The dash is escaped. Unescaped it made the whole pattern fail to
            compile — browsers compile `pattern` with the `v` flag, where a
            bare `-` inside a class is reserved — so Chrome logged a SyntaxError
            on every render and silently dropped the constraint. The field
            looked validated and accepted anything.
          */}
          <input
            name="employeeId"
            required
            pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,31}"
            title="3 to 32 letters, digits or dashes, starting with a letter or digit."
          />
        </label>
        <label>
          <span>Email address</span>
          <input name="email" type="email" required />
        </label>
        <label>
          <span>Temporary password</span>
          <input
            name="password"
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
          />
        </label>
        <label>
          <span>Department</span>
          <select name="departmentId" required>
            <option value="">Choose department</option>
            {directory.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Role</span>
          <select name="role" defaultValue="team_member">
            <option value="team_member">Team member</option>
            <option value="manager">Manager</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
        <label>
          <span>Reporting manager</span>
          <select name="reportingManagerId">
            <option value="">None</option>
            {peopleOptions(directory.users).map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName} · {user.employeeId}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Personal weekly summary</span>
          <select name="personalSummaryMode" defaultValue="standard">
            <option value="off">Off</option>
            <option value="focused">Focused</option>
            <option value="standard">Standard</option>
          </select>
        </label>
        <label>
          <span>Manager team summary</span>
          <select name="teamSummaryMode" defaultValue="off">
            <option value="off">Off</option>
            <option value="leadership">Leadership</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
      </div>
      <ActionStatus state={state} />
      <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Creating…' : 'Create user'}
      </button>
    </form>
  );
}

export function UserEditForm({
  user,
  directory,
}: {
  user: DirectoryUser;
  directory: DirectoryData;
}) {
  const [state, action, pending] = useActionState(updateUserAction, INITIAL_STATE);
  return (
    <form action={action} className="settings-form">
      <input type="hidden" name="userId" value={user.id} />
      <div className="form-grid">
        <label>
          <span>Full name</span>
          <input name="fullName" required defaultValue={user.fullName} />
        </label>
        <label>
          <span>Employee ID</span>
          <input value={user.employeeId} readOnly aria-readonly="true" />
        </label>
        <label>
          <span>Email address</span>
          <input name="email" type="email" required defaultValue={user.email} />
        </label>
        <label>
          <span>Department</span>
          <select name="departmentId" defaultValue={user.departmentId ?? ''} required>
            {directory.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Role</span>
          <select name="role" defaultValue={user.role}>
            <option value="team_member">Team member</option>
            <option value="manager">Manager</option>
            <option value="administrator">Administrator</option>
          </select>
          {/*
            Said out loud because the absence of an effect reads as a failed
            save. Promoting somebody to Manager on its own changes very little:
            the powers that matter are attached to the reporting line, and what
            they can see is decided by the panel below. The one thing the role
            does decide is the default when no visibility rule has been stored.
          */}
          <small className="form-hint">
            Manager powers follow the reporting line, not the title — they apply to whoever reports
            to this person. What they can see is set below.
          </small>
        </label>
        <label>
          <span>Reporting manager</span>
          <select name="reportingManagerId" defaultValue={user.reportingManagerId ?? ''}>
            <option value="">None</option>
            {peopleOptions(directory.users, user.id).map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName} · {person.employeeId}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Personal weekly summary</span>
          <select name="personalSummaryMode" defaultValue={user.personalSummaryMode}>
            <option value="off">Off</option>
            <option value="focused">Focused</option>
            <option value="standard">Standard</option>
          </select>
        </label>
        <label>
          <span>Manager team summary</span>
          <select name="teamSummaryMode" defaultValue={user.teamSummaryMode}>
            <option value="off">Off</option>
            <option value="leadership">Leadership</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
      </div>
      <ActionStatus state={state} />
      <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save user'}
      </button>
    </form>
  );
}

export function UserStatusForm({ user }: { user: DirectoryUser }) {
  const [state, action, pending] = useActionState(changeUserStatusAction, INITIAL_STATE);
  return (
    <div className="settings-form danger-zone">
      <h3>Account status</h3>
      <p>Deactivation is the normal removal path and preserves every historical reference.</p>
      <form action={action}>
        <input type="hidden" name="userId" value={user.id} />
        <input
          type="hidden"
          name="intent"
          value={user.status === 'active' ? 'deactivate' : 'reactivate'}
        />
        <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
          {user.status === 'active' ? 'Deactivate account' : 'Reactivate account'}
        </button>
      </form>
      {state.code === 'open_work_requires_reassignment' && (
        <form action={action} className="controlled-exception">
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="intent" value="deactivate_with_open_work" />
          <p>{state.message}</p>
          <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
            Confirm controlled exception
          </button>
        </form>
      )}
      <ActionStatus
        state={state.code === 'open_work_requires_reassignment' ? INITIAL_STATE : state}
      />
      <hr />
      <form action={action}>
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="intent" value="delete" />
        <label>
          <span>Permanent deletion confirmation</span>
          <input name="employeeIdConfirmation" placeholder={`Type ${user.employeeId}`} />
        </label>
        <p className="form-hint">The database rejects deletion whenever retained history exists.</p>
        <button className="btn danger" type="submit" disabled={pending} aria-busy={pending}>
          Permanently delete history-free account
        </button>
      </form>
    </div>
  );
}

/**
 * Who one person may see.
 *
 * Two questions are shown separately on purpose, because conflating them is
 * what made this screen untrustworthy. "In force now" is the database's own
 * answer, read back through `preview_effective_visibility` — it is what the
 * row-level policies will actually do this second. "After you save" is a
 * projection of the unsaved form, and only appears once something has been
 * changed. Previously there was one panel, computed in the browser, presented
 * as though it were the live rule.
 */
export function VisibilityForm({
  viewer,
  users,
  initialMode,
  initialSubjectIds,
  configured,
  effectiveNow,
}: {
  viewer: DirectoryUser;
  users: DirectoryUser[];
  initialMode: 'specific_only' | 'direct_reports_plus' | 'none';
  initialSubjectIds: string[];
  /** False when no policy has been stored and the mode is the role default. */
  configured: boolean;
  effectiveNow: Array<{ userId: string; fullName: string; employeeId: string; source: string }>;
}) {
  const [state, action, pending] = useActionState(setVisibilityAction, INITIAL_STATE);
  const [mode, setMode] = useState(initialMode);
  const [selected, setSelected] = useState(() => new Set(initialSubjectIds));
  const activePeople = users.filter((user) => user.status === 'active' && user.id !== viewer.id);
  const dirty =
    mode !== initialMode ||
    selected.size !== initialSubjectIds.length ||
    initialSubjectIds.some((id) => !selected.has(id));
  const effective = useMemo(() => {
    if (viewer.role === 'administrator')
      return activePeople.map((user) => ({ user, source: 'administrator scope' }));
    if (mode === 'none') return [];
    const resolved = new Map<string, { user: DirectoryUser; source: string }>();
    if (mode === 'direct_reports_plus') {
      const queue = activePeople.filter((user) => user.reportingManagerId === viewer.id);
      for (let index = 0; index < queue.length; index += 1) {
        const person = queue[index];
        if (!person || resolved.has(person.id)) continue;
        resolved.set(person.id, { user: person, source: 'direct report' });
        queue.push(
          ...activePeople.filter((candidate) => candidate.reportingManagerId === person.id),
        );
      }
    }
    for (const id of selected) {
      const user = activePeople.find((candidate) => candidate.id === id);
      if (user) resolved.set(id, { user, source: resolved.get(id)?.source ?? 'explicit grant' });
    }
    return [...resolved.values()].sort((a, b) => a.user.fullName.localeCompare(b.user.fullName));
  }, [activePeople, mode, selected, viewer.id, viewer.role]);

  return (
    <form action={action} className="settings-form visibility-form">
      <input type="hidden" name="viewerId" value={viewer.id} />
      <p className={configured ? 'form-hint' : 'form-hint form-hint-default'}>
        {configured
          ? 'This rule was set here. It overrides whatever the role would give.'
          : `Nobody has set a rule for ${viewer.fullName.split(' ')[0]}. The mode below is the default for a ${ROLE_WORDS[viewer.role]} — saving this form turns it into a fixed rule that the role no longer changes.`}
      </p>
      <fieldset>
        <legend>Visibility mode</legend>
        <label className="radio-row">
          <input
            type="radio"
            name="mode"
            value="specific_only"
            checked={mode === 'specific_only'}
            onChange={() => setMode('specific_only')}
          />
          <span>
            <strong>Specific people only</strong>
            <small>Own work plus selected people.</small>
          </span>
        </label>
        <label className="radio-row">
          <input
            type="radio"
            name="mode"
            value="direct_reports_plus"
            checked={mode === 'direct_reports_plus'}
            onChange={() => setMode('direct_reports_plus')}
          />
          <span>
            <strong>Direct reports + selected people</strong>
            <small>Reporting tree plus explicit additions.</small>
          </span>
        </label>
        <label className="radio-row">
          <input
            type="radio"
            name="mode"
            value="none"
            checked={mode === 'none'}
            onChange={() => setMode('none')}
          />
          <span>
            <strong>No team visibility</strong>
            <small>Own work remains visible.</small>
          </span>
        </label>
      </fieldset>
      <fieldset disabled={mode === 'none'}>
        <legend>Selected people</legend>
        <div className="people-check-grid">
          {activePeople.map((person) => (
            <label className="check-row" key={person.id}>
              <input
                name="subjectIds"
                type="checkbox"
                value={person.id}
                checked={selected.has(person.id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(person.id);
                    else next.delete(person.id);
                    return next;
                  })
                }
              />
              <span>
                {person.fullName}
                <small>
                  {person.employeeId} · {person.departmentName}
                </small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        <span>Reason for change</span>
        <textarea
          name="reason"
          rows={2}
          maxLength={1000}
          placeholder="Explain the operational need"
        />
      </label>
      <section className="effective-preview">
        <h3>In force now</h3>
        <p>
          {viewer.fullName} can see their own work
          {effectiveNow.length > 1
            ? ` and ${effectiveNow.length - 1} other people`
            : ' and nobody else'}
          . This is the database answering, not a preview.
        </p>
        {effectiveNow.length > 0 && (
          <ul>
            {effectiveNow.map((person) => (
              <li key={person.userId}>
                <span>
                  {person.fullName} · {person.employeeId}
                </span>
                <small>{person.source}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      {dirty && (
        <section className="effective-preview pending" aria-live="polite">
          <h3>After you save</h3>
          <p>
            {effective.length
              ? `${viewer.fullName} would see their own work and ${effective.length} other people.`
              : `${viewer.fullName} would see only their own work.`}
          </p>
          {effective.length > 0 && (
            <ul>
              {effective.map(({ user, source }) => (
                <li key={user.id}>
                  <span>
                    {user.fullName} · {user.employeeId}
                  </span>
                  <small>{source}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ActionStatus state={state} />
      <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save visibility rules'}
      </button>
    </form>
  );
}

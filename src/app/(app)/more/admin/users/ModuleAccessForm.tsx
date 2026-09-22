'use client';

import { useActionState } from 'react';

import type { DirectoryUser } from '@/server/queries';
import {
  setPersonModuleAccessAction,
  type SettingsActionState,
} from '@/server/actions/settings-actions';

const INITIAL_STATE: SettingsActionState = { ok: true, code: 'idle', message: '' };

/**
 * v203 — job title, Focus responsibility and platform administration are
 * separate facts. The database keeps the legacy role only as a compatibility
 * projection for established Focus authorization.
 */
export function ModuleAccessForm({ user }: { user: DirectoryUser }) {
  const [state, action, pending] = useActionState(setPersonModuleAccessAction, INITIAL_STATE);

  return (
    <form action={action} className="settings-form module-access-form">
      <input type="hidden" name="userId" value={user.id} />
      <label>
        <span>TAMCO Focus preset</span>
        <select name="focusPreset" defaultValue={user.focusAccessPreset}>
          <option value="no_access">No access</option>
          <option value="team_member">Team member</option>
          <option value="manager">Manager</option>
        </select>
        <small className="form-hint">
          Reporting lines and explicit visibility continue to decide which people and work are
          visible.
        </small>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          name="platformAdministrator"
          defaultChecked={user.platformAdministrator}
        />
        <span>
          Platform administrator
          <small>
            Maintains identities, policy and delivery. This grants no Finding Management business
            access.
          </small>
        </span>
      </label>
      <label>
        <span>Reason</span>
        <input name="reason" required maxLength={300} placeholder="Role change or access review" />
      </label>
      {state.code !== 'idle' ? (
        <p
          className={`notice ${state.ok ? 'success' : 'error'}`}
          role={state.ok ? 'status' : 'alert'}
        >
          {state.message}
        </p>
      ) : null}
      <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save module access'}
      </button>
    </form>
  );
}

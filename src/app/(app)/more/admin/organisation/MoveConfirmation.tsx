'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { changeReportingManagerAction } from '@/server/actions/settings-actions';

/**
 * The confirmation every move goes through (v169).
 *
 * Dropping somebody onto a manager and changing who they answer to are not the
 * same act, however similar they look on screen. Both routes — the drag and the
 * "Change manager" control — arrive here, where the change is stated in full
 * before anybody agrees to it: who is moving, who they report to now, and who
 * they would report to instead.
 *
 * A reason and an effective date are offered because a transfer agreed on the
 * 1st and entered on the 9th belongs to the 1st, and six months later the only
 * answer anybody has is what was written down here.
 */

export interface MovePerson {
  id: string;
  fullName: string;
  jobTitle: string | null;
  employeeId: string;
}

const INITIAL = { ok: false, code: '', message: '' };

export function MoveConfirmation({
  subject,
  currentManager,
  proposedManagerId,
  options,
  cancelHref,
}: {
  subject: MovePerson;
  currentManager: MovePerson | null;
  proposedManagerId: string;
  options: MovePerson[];
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState(changeReportingManagerAction, INITIAL);

  return (
    <section className="org-move-panel" aria-labelledby="org-move-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Confirm</p>
          <h2 id="org-move-heading">Change reporting line?</h2>
        </div>
      </div>

      <div className="org-move-lines">
        <strong>{subject.fullName}</strong>
        <span className="sub">
          {[subject.jobTitle, subject.employeeId].filter(Boolean).join(' · ')}
        </span>
        <span className="sub">
          Current manager: {currentManager ? currentManager.fullName : 'None — top of the line'}
        </span>
      </div>

      <form action={action} className="settings-form">
        <input type="hidden" name="userId" value={subject.id} />
        <div className="form-grid">
          <label>
            <span>New manager</span>
            {/*
              Defaults to who they report to now, not to "None".
              A panel opened from the row starts with no proposal, and a select
              that begins at "None — top of the line" turns an unconsidered Save
              into a move to the top of the organisation. Unchanged is the only
              safe starting point; the procedure answers `unchanged` for it.
            */}
            <select name="managerId" defaultValue={proposedManagerId || (currentManager?.id ?? '')}>
              <option value="">None — top of the line</option>
              {options.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName} · {person.employeeId}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Effective date</span>
            {/* Left blank means today, in the organisation's calendar. */}
            <input type="date" name="effectiveDate" />
          </label>
          <label>
            <span>Reason (optional)</span>
            <input name="reason" maxLength={400} placeholder="Transfer, cover, reorganisation…" />
          </label>
        </div>

        {state.message && (
          <p className={state.ok ? 'notice success' : 'notice error'} role="status">
            {state.message}
          </p>
        )}

        <div className="org-move-actions">
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <Link className="btn small ghost" href={cancelHref}>
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import {
  changeFunctionalManagerAction,
  changeReportingManagerAction,
} from '@/server/actions/settings-actions';

/**
 * The confirmation every change to a line goes through (v169, v173).
 *
 * Dropping somebody onto a manager and changing who they answer to are not the
 * same act, however similar they look on screen. Both routes — the drag and the
 * "Change manager" control — arrive here, where the change is stated in full
 * before anybody agrees to it: who is moving, who they report to now, and who
 * they would report to instead.
 *
 * The dotted line (v173) comes through the same door with its own words, and
 * with the one sentence it must never be drawn without: it gives nobody sight
 * of the person's work. An organisation chart that quietly granted access every
 * time somebody drew a line would have become the security model.
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

const COPY = {
  primary: {
    heading: 'Change reporting line?',
    current: 'Current manager',
    none: 'None — top of the line',
    select: 'New manager',
  },
  functional: {
    heading: 'Change dotted line?',
    current: 'Current dotted line',
    none: 'None — no dotted line',
    select: 'Dotted-line manager',
  },
} as const;

export function MoveConfirmation({
  relationship = 'primary',
  subject,
  currentManager,
  proposedManagerId,
  options,
  cancelHref,
}: {
  relationship?: 'primary' | 'functional';
  subject: MovePerson;
  /** Whoever holds this relationship now. */
  currentManager: MovePerson | null;
  proposedManagerId: string;
  options: MovePerson[];
  cancelHref: string;
}) {
  // The panel is keyed by what is open, so a mounted instance never changes
  // relationship and the hook always receives the same action.
  const [state, action, pending] = useActionState(
    relationship === 'functional' ? changeFunctionalManagerAction : changeReportingManagerAction,
    INITIAL,
  );
  const copy = COPY[relationship];
  const firstName = subject.fullName.split(' ')[0];

  return (
    <section className="org-move-panel" aria-labelledby="org-move-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Confirm</p>
          <h2 id="org-move-heading">{copy.heading}</h2>
        </div>
      </div>

      <div className="org-move-lines">
        <strong>{subject.fullName}</strong>
        <span className="sub">
          {[subject.jobTitle, subject.employeeId].filter(Boolean).join(' · ')}
        </span>
        <span className="sub">
          {copy.current}: {currentManager ? currentManager.fullName : copy.none}
        </span>
      </div>

      {relationship === 'functional' && (
        <p className="sub org-move-note">
          A dotted line gives nobody sight of {firstName}&apos;s work. If this manager needs to see
          it, grant that on {firstName}&apos;s Directory page.
        </p>
      )}

      <form action={action} className="settings-form">
        <input type="hidden" name="userId" value={subject.id} />
        <div className="form-grid">
          <label>
            <span>{copy.select}</span>
            {/*
              Defaults to whoever holds the line now, not to "None".
              A panel opened from the row starts with no proposal, and a select
              that begins at "None" turns an unconsidered Save into removing the
              line. Unchanged is the only safe starting point; the procedures
              answer `unchanged` for it.
            */}
            <select name="managerId" defaultValue={proposedManagerId || (currentManager?.id ?? '')}>
              <option value="">{copy.none}</option>
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

'use client';

import { useState } from 'react';

import styles from './SetPasswordForm.module.css';

const MINIMUM = 12;
const COMFORTABLE = 16;

/**
 * The password fields, with live feedback.
 *
 * Three deliberate departures from a conventional password form:
 *
 * The checklist shows only what the server actually enforces — twelve
 * characters, and the two entries matching. Listing a digit or a symbol would
 * be inventing a rule `setPassword` does not apply, and a checklist that
 * disagrees with the validator teaches people to distrust it.
 *
 * The meter measures length alone, for the reason given on the page itself: a
 * composition rule reliably produces `Password1!`. Rewarding punctuation here
 * would undercut the advice the page is giving two lines above.
 *
 * The submit button is never disabled. `required` and `minLength` on the inputs
 * already refuse a short password without any JavaScript, and the server checks
 * again regardless — so the form keeps working when this component does not
 * load, which a disabled-until-valid button would prevent.
 */
export function SetPasswordForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [revealed, setRevealed] = useState(false);

  const longEnough = password.length >= MINIMUM;
  const matches = confirmation.length > 0 && password === confirmation;

  const tier = password.length === 0 ? 0 : !longEnough ? 1 : password.length < COMFORTABLE ? 2 : 3;
  const tone = tier === 1 ? 'short' : 'met';
  const strengthLabel = tier === 1 ? 'Too short' : tier === 2 ? 'Good' : 'Strong';

  return (
    <form action={action}>
      <div className="field">
        <label htmlFor="password">New password</label>
        <div className={styles.inputWrap}>
          <input
            id="password"
            name="password"
            type={revealed ? 'text' : 'password'}
            required
            minLength={MINIMUM}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setRevealed((value) => !value)}
            aria-pressed={revealed}
            aria-controls="password confirmation"
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        </div>

        {tier > 0 && (
          <>
            <div className={styles.meter} aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className={`${styles.segment} ${index < tier ? styles[tone] : ''}`}
                />
              ))}
            </div>
            <p className={`${styles.strength} ${styles[tone]}`} role="status">
              {strengthLabel}
            </p>
          </>
        )}
      </div>

      <div className="field">
        <label htmlFor="confirmation">Confirm password</label>
        <div className={styles.inputWrap}>
          <input
            id="confirmation"
            name="confirmation"
            type={revealed ? 'text' : 'password'}
            required
            minLength={MINIMUM}
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
      </div>

      {/* Below both fields, so neither rule is asked before it can be answered. */}
      <ul className={styles.rules}>
        <Rule met={longEnough}>At least twelve characters</Rule>
        <Rule met={matches}>Both entries match</Rule>
      </ul>

      <p className={styles.hint}>
        Length beats complexity. A short phrase you can recall beats a scramble you cannot.
      </p>

      <button type="submit" className="btn primary" style={{ width: '100%' }}>
        Save password
      </button>
    </form>
  );
}

function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={`${styles.rule} ${met ? styles.done : ''}`}>
      <span className={styles.tick} aria-hidden="true">
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M1.5 6.5 4.5 9.5 10.5 2.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {children}
      <span className="visually-hidden">{met ? ' — met' : ' — not yet met'}</span>
    </li>
  );
}

'use client';

import { useActionState, useId, useState } from 'react';

import styles from './SetPasswordForm.module.css';

export type SetPasswordState = { ok: boolean; message: string };

export const INITIAL_SET_PASSWORD_STATE: SetPasswordState = { ok: false, message: '' };

const MINIMUM = 12;

/**
 * What the form requires, checked live.
 *
 * The server enforces the twelve-character minimum and nothing else. These
 * additional two are a client-side policy: the submit button will not enable
 * until all three pass, so the checklist stays truthful about what it takes to
 * submit this form. A stricter client over a laxer server is safe — the server
 * remains authoritative and rejects anything it considers invalid regardless.
 */
const RULES = [
  {
    id: 'length',
    label: `At least ${MINIMUM} characters`,
    test: (value: string) => value.length >= MINIMUM,
  },
  { id: 'number', label: 'At least one number', test: (value: string) => /\d/.test(value) },
  {
    id: 'special',
    label: 'At least one special character',
    test: (value: string) => /[^A-Za-z0-9]/.test(value),
  },
] as const;

export function SetPasswordForm({
  action,
}: {
  action: (state: SetPasswordState, formData: FormData) => Promise<SetPasswordState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_SET_PASSWORD_STATE);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const results = RULES.map((rule) => ({ ...rule, met: rule.test(password) }));
  const score = results.filter((rule) => rule.met).length;
  const allMet = score === RULES.length;

  const mismatch = confirmation.length > 0 && password !== confirmation;
  const matches = confirmation.length > 0 && password === confirmation;
  const submittable = allMet && matches && !pending;

  const tone = score <= 1 ? 'weak' : score === 2 ? 'fair' : 'strong';
  const strengthLabel = score <= 1 ? 'Weak' : score === 2 ? 'Fair' : 'Strong';

  const mismatchId = useId();

  return (
    <form action={formAction} noValidate>
      {state.message && !state.ok && (
        <div className="notice error" role="alert">
          <p>{state.message}</p>
        </div>
      )}

      <PasswordField
        id="password"
        name="password"
        label="New Password"
        value={password}
        onChange={setPassword}
        autoFocus
      />

      {password.length > 0 && (
        <>
          <div className={styles.meter}>
            <div
              className={`${styles.fill} ${styles[tone]}`}
              style={{ width: `${(score / RULES.length) * 100}%` }}
            />
          </div>
          <p className={`${styles.strength} ${styles[tone]}`} role="status">
            {strengthLabel}
          </p>
        </>
      )}

      <ul className={styles.rules}>
        {results.map((rule) => (
          <li key={rule.id} className={`${styles.rule} ${rule.met ? styles.met : ''}`}>
            <span className={styles.icon} aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M1.5 6.5 4.5 9.5 10.5 2.5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            {rule.label}
            <span className="visually-hidden">{rule.met ? ' — met' : ' — not yet met'}</span>
          </li>
        ))}
      </ul>

      <div style={{ height: 22 }} />

      <PasswordField
        id="confirmation"
        name="confirmation"
        label="Confirm New Password"
        value={confirmation}
        onChange={setConfirmation}
        invalid={mismatch}
        describedBy={mismatch ? mismatchId : undefined}
      />

      {mismatch && (
        <p className={styles.mismatch} id={mismatchId} role="alert">
          Passwords do not match.
        </p>
      )}

      <button type="submit" className={styles.submit} disabled={!submittable}>
        {pending ? 'Updating password…' : 'Update Password'}
      </button>
    </form>
  );
}

function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  autoFocus,
  invalid,
  describedBy,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inputRow}>
        <input
          id={id}
          name={name}
          className={styles.input}
          type={revealed ? 'text' : 'password'}
          required
          minLength={MINIMUM}
          autoComplete="new-password"
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setRevealed((current) => !current)}
          aria-pressed={revealed}
          aria-controls={id}
          aria-label={`${revealed ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

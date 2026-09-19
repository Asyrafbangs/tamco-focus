'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';

import { EmailChips } from '@/components/esh/EmailChips';
import {
  PRIORITY_LABELS,
  RISK_LABELS,
  SOURCE_LABELS,
  canonicalEmail,
  looksLikeEmail,
  type ActionPriority,
  type FindingSource,
  type RiskLevel,
} from '@/domain/esh-findings';
import { saveFinding, type SaveFindingState } from '@/server/esh/actions';

export interface FindingFormInitial {
  findingId: string | null;
  reference: string | null;
  title: string;
  description: string;
  source: FindingSource;
  sourceReference: string;
  reportedOn: string;
  location: string;
  departmentId: string;
  riskLevel: RiskLevel;
  isRestricted: boolean;
  requiredOutcome: string;
  evidenceInstruction: string;
  priority: ActionPriority | '';
  ownerEmail: string;
  dueDate: string;
  dueTime: string;
  reviewerUserId: string;
  escalation: Record<number, string[]>;
  noFurtherEscalationReason: string;
}

/**
 * New finding, and the same form for a draft (§7).
 *
 * The common case stays compact: what was found, who puts it right by when,
 * and who hears about it if they do not. Risk, the restricted flag and levels
 * beyond three sit behind "More settings".
 *
 * Submitted by hand rather than through `<form action>`: React resets a form
 * after an action finishes, which would wipe everything typed whenever the
 * database answers with something to correct.
 */
export function FindingForm({
  initial,
  departments,
  verifiers,
}: {
  initial: FindingFormInitial;
  departments: Array<{ id: string; name: string }>;
  verifiers: Array<{ userId: string; fullName: string; email: string }>;
}) {
  const [state, setState] = useState<SaveFindingState | null>(null);
  const [pending, startTransition] = useTransition();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [ownerEmail, setOwnerEmail] = useState(initial.ownerEmail);
  const [noFurtherEscalation, setNoFurtherEscalation] = useState(
    Boolean(initial.noFurtherEscalationReason),
  );
  const extraLevels = Object.keys(initial.escalation)
    .map(Number)
    .filter((level) => level > 3);
  const [levelCount, setLevelCount] = useState(Math.max(3, ...extraLevels));
  const summaryId = useId();

  const problemsFor = (field: string) =>
    (state?.problems ?? []).filter((problem) => problem.field === field);

  /*
   * A problem stops being shown the moment its field is edited, so the form
   * never argues with what is now typed. The escalation editor's inputs are
   * unnamed; anything inside it answers for "escalation".
   */
  function clearProblemFor(target: EventTarget) {
    if (!state || state.problems.length === 0 || !(target instanceof HTMLElement)) return;
    const field = target.closest('.esh-escalation-levels')
      ? 'escalation'
      : (target.getAttribute('name') ?? '');
    if (!field || !state.problems.some((problem) => problem.field === field)) return;
    setState({ ...state, problems: state.problems.filter((problem) => problem.field !== field) });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(async () => {
      const result = await saveFinding(null, data);
      // A successful save redirects to the finding, so only a problem returns.
      setState(result);
      if (!result.ok) {
        requestAnimationFrame(() => document.getElementById(summaryId)?.focus());
      }
    });
  }

  const ownerCanonical = looksLikeEmail(ownerEmail) ? canonicalEmail(ownerEmail) : null;

  return (
    <form
      className="settings-form esh-finding-form"
      onSubmit={onSubmit}
      onChange={(event) => clearProblemFor(event.target)}
      noValidate
    >
      <input type="hidden" name="finding_id" value={initial.findingId ?? ''} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />

      {state && !state.ok && state.problems.length > 0 && (
        <div id={summaryId} className="notice error" role="alert" tabIndex={-1}>
          <strong>
            {state.problems.length === 1
              ? 'One thing needs correcting'
              : `${state.problems.length} things need correcting`}
          </strong>
          <ul>
            {state.problems.map((problem) => (
              <li key={`${problem.field}-${problem.message}`}>{problem.message}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="esh-form-card" aria-labelledby="esh-form-finding">
        <h2 id="esh-form-finding" className="esh-form-card-title">
          The finding
        </h2>
        <Field label="Finding title" problems={problemsFor('title')}>
          {(props) => (
            <input name="title" required maxLength={200} defaultValue={initial.title} {...props} />
          )}
        </Field>
        <Field label="What was found" problems={problemsFor('description')}>
          {(props) => (
            <textarea
              name="description"
              rows={3}
              maxLength={4000}
              defaultValue={initial.description}
              {...props}
            />
          )}
        </Field>
        <div className="form-grid two">
          <Field label="Location" problems={problemsFor('location')}>
            {(props) => (
              <input
                name="location"
                maxLength={200}
                placeholder="BR2 Warehouse"
                defaultValue={initial.location}
                {...props}
              />
            )}
          </Field>
          <Field label="Accountable department" problems={problemsFor('accountable_department_id')}>
            {(props) => (
              <select
                name="accountable_department_id"
                defaultValue={initial.departmentId}
                {...props}
              >
                <option value="">Choose a department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Reported on" problems={problemsFor('reported_on')}>
            {(props) => (
              <input name="reported_on" type="date" defaultValue={initial.reportedOn} {...props} />
            )}
          </Field>
          <Field label="Source" problems={problemsFor('source')}>
            {(props) => (
              <select name="source" defaultValue={initial.source} {...props}>
                {(Object.keys(SOURCE_LABELS) as FindingSource[]).map((source) => (
                  <option key={source} value={source}>
                    {SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </section>

      <section className="esh-form-card" aria-labelledby="esh-form-action">
        <h2 id="esh-form-action" className="esh-form-card-title">
          Corrective action
        </h2>
        <Field label="Required outcome" problems={problemsFor('required_outcome')}>
          {(props) => (
            <textarea
              name="required_outcome"
              rows={2}
              maxLength={2000}
              placeholder="Clear the walkway and keep materials inside the designated storage area."
              defaultValue={initial.requiredOutcome}
              {...props}
            />
          )}
        </Field>
        <Field
          label="Completion evidence"
          problems={problemsFor('evidence_instruction')}
          hint="What the owner must send before ESH can verify it. A photo or file is required."
        >
          {(props) => (
            <input
              name="evidence_instruction"
              maxLength={400}
              defaultValue={initial.evidenceInstruction}
              {...props}
            />
          )}
        </Field>
        <div className="form-grid two">
          <Field
            label="Action Owner email"
            problems={problemsFor('owner_email')}
            hint="No employee account or registration is required."
          >
            {(props) => (
              <input
                name="owner_email"
                type="email"
                inputMode="email"
                autoComplete="off"
                maxLength={254}
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                {...props}
              />
            )}
          </Field>
          <Field label="Action priority" problems={problemsFor('priority')}>
            {(props) => (
              <select name="priority" defaultValue={initial.priority} {...props}>
                <option value="">Choose a priority</option>
                {(Object.keys(PRIORITY_LABELS) as ActionPriority[]).map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Due date"
            problems={problemsFor('due_date')}
            hint="Without a time, due at 17:00 Kuala Lumpur time."
          >
            {(props) => (
              <input name="due_date" type="date" defaultValue={initial.dueDate} {...props} />
            )}
          </Field>
          <Field label="Due time (optional)" problems={problemsFor('due_time')}>
            {(props) => (
              <input name="due_time" type="time" defaultValue={initial.dueTime} {...props} />
            )}
          </Field>
        </div>
        {ownerCanonical && (
          // The whole address, spelled out, before anything is sent (§7).
          <p className="esh-recipient-confirm" aria-live="polite">
            The assignment will go to <strong>{ownerEmail.trim()}</strong>
          </p>
        )}
        <Field
          label="ESH reviewer"
          problems={problemsFor('reviewer_user_id')}
          hint="Who verifies the correction. The owner can never verify their own."
        >
          {(props) => (
            <select name="reviewer_user_id" defaultValue={initial.reviewerUserId} {...props}>
              <option value="">Verification queue — any ESH Verifier</option>
              {verifiers.map((verifier) => (
                <option key={verifier.userId} value={verifier.userId}>
                  {verifier.fullName}
                </option>
              ))}
            </select>
          )}
        </Field>
      </section>

      <section className="esh-form-card" aria-labelledby="esh-form-escalation">
        <h2 id="esh-form-escalation" className="esh-form-card-title">
          Escalation recipients
        </h2>
        <p className="form-hint esh-form-card-hint">
          Email addresses only. Each level is told only if the action becomes overdue enough to
          reach it; nobody here gets access before then.
        </p>
        {problemsFor('escalation').map((problem) => (
          <p key={problem.message} className="esh-field-error" role="alert">
            {problem.message}
          </p>
        ))}
        <div className="esh-escalation-levels">
          {Array.from({ length: levelCount }, (_, index) => index + 1).map((level) => (
            <EmailChips
              key={level}
              name={`escalation_level_${level}`}
              label={`Level ${level}`}
              initial={initial.escalation[level] ?? []}
            />
          ))}
        </div>
        {levelCount < 9 && (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setLevelCount((count) => Math.min(9, count + 1))}
          >
            + Add Level {levelCount + 1}
          </button>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            name="no_further_escalation"
            checked={noFurtherEscalation}
            onChange={(event) => setNoFurtherEscalation(event.target.checked)}
          />
          <span>
            No further escalation
            <small>Record why, instead of inventing addresses nobody agreed.</small>
          </span>
        </label>
        {noFurtherEscalation && (
          <Field label="Why there is no further escalation" problems={[]}>
            {(props) => (
              <input
                name="no_further_escalation_reason"
                maxLength={400}
                defaultValue={initial.noFurtherEscalationReason}
                {...props}
              />
            )}
          </Field>
        )}
      </section>

      <details className="esh-form-more">
        <summary>More settings</summary>
        <div className="form-grid two">
          <Field
            label="Finding risk"
            problems={problemsFor('risk_level')}
            hint="Assessed with TAMCO's method. Unassessed findings say Not assessed."
          >
            {(props) => (
              <select name="risk_level" defaultValue={initial.riskLevel} {...props}>
                {(Object.keys(RISK_LABELS) as RiskLevel[]).map((risk) => (
                  <option key={risk} value={risk}>
                    {RISK_LABELS[risk]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Source reference (optional)" problems={[]}>
            {(props) => (
              <input
                name="source_reference"
                maxLength={120}
                placeholder="Audit report or inspection number"
                defaultValue={initial.sourceReference}
                {...props}
              />
            )}
          </Field>
        </div>
        <label className="check-row">
          <input type="checkbox" name="is_restricted" defaultChecked={initial.isRestricted} />
          <span>
            Restricted finding
            <small>Kept out of leadership reports and their counts.</small>
          </span>
        </label>
      </details>

      <div className="esh-form-actions">
        <button className="btn" type="submit" name="intent" value="draft" disabled={pending}>
          Save draft
        </button>
        <button
          className="btn primary"
          type="submit"
          name="intent"
          value="assign"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? 'Saving…' : 'Assign finding'}
        </button>
      </div>
    </form>
  );
}

/** A labelled field with its hint and any problem the save reported. */
function Field({
  label,
  hint,
  problems,
  children,
}: {
  label: string;
  hint?: string;
  problems: Array<{ message: string }>;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: 'true';
  }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, problems.length ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="esh-field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': problems.length ? 'true' : undefined,
      })}
      {hint && (
        <p id={hintId} className="form-hint">
          {hint}
        </p>
      )}
      {problems.length > 0 && (
        <p id={errorId} className="esh-field-error">
          {problems.map((problem) => problem.message).join(' ')}
        </p>
      )}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent } from 'react';

import { createClient } from '@supabase/supabase-js';

import { AttachButtons } from '@/components/esh/EvidenceUploader';
import { evidenceLabel, evidenceProblem, uploadContentType } from '@/domain/esh-evidence';
import { publicEnv } from '@/lib/env';
import { finishStaffUpload, startStaffUpload } from '@/server/esh/evidence-actions';

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
 * Eight fields answer three questions: what was found, who puts it right by
 * when, and who hears about it if they do not. Everything with a sound default
 * — the date it was reported, where it came from, what evidence to send, who
 * verifies it, the time of day it is due, risk, restriction — sits under More
 * settings, still submitted, just not asked for. A finding recorded in ninety
 * seconds is a finding that gets recorded.
 *
 * Submitted by hand rather than through `<form action>`: React resets a form
 * after an action finishes, which would wipe everything typed whenever the
 * database answers with something to correct.
 */
/** "after 1 day overdue", so a level means something before it fires. */
function overdueWords(days: number | undefined): string {
  if (days === undefined) return 'timing follows your policy';
  if (days <= 0) return 'as soon as it is overdue';
  return `after ${days} day${days === 1 ? '' : 's'} overdue`;
}

export function FindingForm({
  initial,
  departments,
  verifiers,
  levelDays = [],
}: {
  initial: FindingFormInitial;
  departments: Array<{ id: string; name: string }>;
  verifiers: Array<{ userId: string; fullName: string; email: string }>;
  /** v215 - the organisation's escalation timing, so a level says when. */
  levelDays?: number[];
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
  // One level to begin with. Three empty boxes only ever read as three
  // things left undone.
  const [levelCount, setLevelCount] = useState(
    Math.max(1, ...Object.keys(initial.escalation).map(Number), ...extraLevels),
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const router = useRouter();
  /*
   * v215 - the photographs are taken at the scene, so they are chosen here.
   * They cannot be uploaded yet: an evidence record belongs to a finding, and
   * the finding does not exist until this form is saved. They wait in the
   * browser and go up the moment it does, before the screen moves on.
   */
  const [staged, setStaged] = useState<File[]>([]);
  const [attaching, setAttaching] = useState<string | null>(null);
  const stagedProblem = staged
    .map((file) => evidenceProblem(file.name, file.size))
    .find((problem) => problem);
  const summaryId = useId();
  // A field that fails validation cannot be left folded away, so the
  // disclosure opens itself when the answer it holds is the one to correct.
  /*
   * v215 - two steps, not three. Escalation is configuration around the
   * action, not a third thing to record, so it sits inside the second step
   * with the rest of the follow-up.
   */
  const STEP_FIELDS: Record<number, string[]> = {
    1: ['title', 'description', 'location', 'accountable_department_id'],
    2: [
      'required_outcome',
      'owner_email',
      'priority',
      'due_date',
      'due_time',
      'escalation',
      'no_further_escalation_reason',
    ],
  };
  const STEPS = ['Finding', 'Action & follow-up'];
  const [step, setStep] = useState(1);
  const ADVANCED = [
    'priority',
    'reported_on',
    'source',
    'source_reference',
    'due_time',
    'evidence_instruction',
    'reviewer_user_id',
    'risk_level',
  ];
  const advancedProblem = (state?.problems ?? []).some((problem) =>
    ADVANCED.includes(problem.field),
  );
  /**
   * The earliest step holding something to correct.
   *
   * Applied once, when the answer comes back — never derived while rendering.
   * Derived, it would move the form out from under whoever is typing: clearing
   * the last problem on step one would leave step two the earliest, and the
   * screen would change mid-sentence.
   */
  function stepOfProblems(problems: Array<{ field: string }>): number | null {
    return problems.reduce<number | null>((earliest, problem) => {
      const found = [1, 2, 3].find((index) => STEP_FIELDS[index]?.includes(problem.field));
      if (!found) return earliest;
      return earliest === null ? found : Math.min(earliest, found);
    }, null);
  }
  const shown = step;

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

  /** Attach what was chosen at the scene, now that there is a finding. */
  async function attachStaged(findingId: string) {
    const storage = createClient(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ).storage.from('finding-evidence');
    for (const [index, file] of staged.entries()) {
      setAttaching(`Attaching ${index + 1} of ${staged.length}…`);
      const started = await startStaffUpload({
        findingId,
        actionId: null,
        purpose: 'original',
        name: file.name,
        size: file.size,
      });
      if (!started.ok) continue;
      const sent = await storage.uploadToSignedUrl(started.path, started.token, file, {
        contentType: uploadContentType(file.name),
      });
      if (sent.error) continue;
      await finishStaffUpload({ assetId: started.assetId, findingId });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(async () => {
      const result = await saveFinding(null, data);
      setState(result);
      if (result.ok && result.findingId && result.redirectTo) {
        // The finding exists now, so its evidence can belong to something.
        if (staged.length > 0) await attachStaged(result.findingId);
        setAttaching(null);
        router.push(result.redirectTo);
        return;
      }
      if (!result.ok) {
        // Take the form to the first step that has something to correct, so
        // the summary is never about a screen nobody is looking at.
        const target = stepOfProblems(result.problems ?? []);
        if (target) setStep(target);
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

      <ol className="esh-steps" aria-label="Recording a finding">
        {STEPS.map((name, index) => {
          const number = index + 1;
          return (
            <li
              key={name}
              className="esh-step"
              data-state={number === shown ? 'current' : number < shown ? 'done' : 'ahead'}
              aria-current={number === shown ? 'step' : undefined}
            >
              <button
                type="button"
                onClick={() => setStep(number)}
                // Steps are a route through the form, not a lock on it: an
                // ESH coordinator who knows what they are recording can go
                // straight to the part they want to change.
                aria-label={`Step ${number} of ${STEPS.length}: ${name}`}
              >
                <span className="esh-step-mark" aria-hidden="true">
                  {number < shown ? '✓' : number}
                </span>
                <span className="esh-step-name">{name}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <section className="esh-form-card" aria-labelledby="esh-form-finding" hidden={shown !== 1}>
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
        </div>
        <div className="esh-field">
          <span className="esh-field-label">Evidence</span>
          <p className="form-hint">
            What was seen, attached now rather than remembered later. The Action Owner sees it under
            “Original finding &amp; evidence”.
          </p>
          <AttachButtons
            onFiles={(files) => setStaged((current) => [...current, ...Array.from(files)])}
            disabled={pending}
          />
          {staged.length > 0 && (
            <ul className="esh-file-list esh-staged-list" aria-label="Evidence to attach">
              {staged.map((file, index) => (
                <li key={`${file.name}-${index}`} className="esh-file">
                  <span>
                    <strong>{file.name}</strong>
                    <small>{evidenceLabel(file.name, file.size)}</small>
                  </span>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => setStaged((current) => current.filter((_, at) => at !== index))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {stagedProblem && (
            <p className="esh-field-error" role="alert">
              {stagedProblem}
            </p>
          )}
        </div>
      </section>

      <section className="esh-form-card" aria-labelledby="esh-form-action" hidden={shown !== 2}>
        <h2 id="esh-form-action" className="esh-form-card-title">
          Who puts it right, by when
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
        <div className="form-grid two">
          <Field
            label="Risk"
            problems={problemsFor('risk_level')}
            hint="Assessed with TAMCO's method. It decides how follow-up behaves."
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
          <Field
            label="Due date"
            problems={problemsFor('due_date')}
            hint="Due at 17:00 Kuala Lumpur time unless More settings says otherwise."
          >
            {(props) => (
              <input name="due_date" type="date" defaultValue={initial.dueDate} {...props} />
            )}
          </Field>
        </div>
        {ownerCanonical && (
          // The whole address, spelled out, before anything is sent (§7).
          <p className="esh-recipient-confirm" aria-live="polite">
            The assignment will go to <strong>{ownerEmail.trim()}</strong>
          </p>
        )}
      </section>

      <section className="esh-form-card" aria-labelledby="esh-form-escalation" hidden={shown !== 2}>
        <h2 id="esh-form-escalation" className="esh-form-card-title">
          Follow-up if overdue
        </h2>
        <p className="form-hint esh-form-card-hint">
          Nobody here is written to, or given any access, until the action is actually overdue by
          the days shown. The timing comes from your follow-up policy.
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
              hint={overdueWords(levelDays[level - 1])}
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
            + Add level {levelCount + 1}
          </button>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            name="no_further_escalation"
            checked={noFurtherEscalation}
            onChange={(event) => setNoFurtherEscalation(event.target.checked)}
          />
          <span>Stop escalation after this level</span>
        </label>
        {noFurtherEscalation && (
          <Field label="Reason" problems={[]}>
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

      <details
        hidden={shown !== 2}
        className="esh-form-more"
        open={advancedProblem || moreOpen}
        onToggle={(event) => setMoreOpen(event.currentTarget.open)}
      >
        <summary>More settings</summary>
        <p className="form-hint esh-form-card-hint">
          Each of these already has an answer. Change them when this finding is an exception.
        </p>
        <div className="form-grid two">
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
          <Field label="Source reference" problems={[]}>
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
          <Field
            label="Due time"
            problems={problemsFor('due_time')}
            hint="Left empty, the action is due at 17:00."
          >
            {(props) => (
              <input name="due_time" type="time" defaultValue={initial.dueTime} {...props} />
            )}
          </Field>
        </div>
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
            label="ESH reviewer"
            problems={problemsFor('reviewer_user_id')}
            hint="The owner can never verify their own."
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
          <Field
            label="Action priority"
            problems={problemsFor('priority')}
            hint="What the owner should do first. Risk is the assessment; this is the queue."
          >
            {(props) => (
              <select name="priority" defaultValue={initial.priority || 'normal'} {...props}>
                {(Object.keys(PRIORITY_LABELS) as ActionPriority[]).map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
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
        {shown > 1 && (
          <button className="btn ghost" type="button" onClick={() => setStep(shown - 1)}>
            Back
          </button>
        )}
        <button className="btn" type="submit" name="intent" value="draft" disabled={pending}>
          Save draft
        </button>
        {/*
         * Distinct keys, and a prevented default, on purpose. Rendered as one
         * conditional without them, React reconciles Next and Assign into the
         * same DOM node and only flips `type` from button to submit — which
         * the browser then honours for the click already in flight, saving the
         * finding the moment somebody pressed Next.
         */}
        {shown < STEPS.length ? (
          <button
            key="step-next"
            className="btn primary"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              setStep(shown + 1);
            }}
          >
            Next
          </button>
        ) : (
          <button
            key="step-assign"
            className="btn primary"
            type="submit"
            name="intent"
            value="assign"
            disabled={pending}
            aria-busy={pending}
          >
            {attaching ?? (pending ? 'Saving…' : 'Assign finding')}
          </button>
        )}
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

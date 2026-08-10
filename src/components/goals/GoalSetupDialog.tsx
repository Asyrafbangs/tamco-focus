'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Modal } from '@/components/ui/Modal';
import { createGoal, type GoalMilestoneInput } from '@/server/actions/goal-actions';

import styles from './GoalSetupDialog.module.css';

export interface GoalOwnerOption {
  id: string;
  fullName: string;
  employeeId: string;
  activeWeight: number;
}

interface SuccessMeasureInput {
  description: string;
  optionalTargetDate: string | null;
  useDifferentDate: boolean;
}

function blankMilestone(): GoalMilestoneInput {
  return { title: '', completion_definition: '', progress_percent: 0, weight_percent: null };
}

function blankMeasure(): SuccessMeasureInput {
  return { description: '', optionalTargetDate: null, useDifferentDate: false };
}

export function GoalSetupDialog({
  owner,
  employees = [],
  canActivate = false,
  triggerLabel = '+ New goal',
  returnView = 'my',
}: {
  owner?: GoalOwnerOption;
  employees?: GoalOwnerOption[];
  canActivate?: boolean;
  triggerLabel?: string;
  returnView?: 'my' | 'team';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<GoalMilestoneInput[]>([]);
  const [successMeasures, setSuccessMeasures] = useState<SuccessMeasureInput[]>([blankMeasure()]);
  const [ownerId, setOwnerId] = useState(owner?.id ?? '');
  const [weightPercent, setWeightPercent] = useState(20);

  const ownerOptions = owner ? [owner] : employees;
  const selectedOwner = ownerOptions.find((employee) => employee.id === ownerId);
  const currentActiveWeight = selectedOwner?.activeWeight ?? 0;
  const proposedActiveWeight = currentActiveWeight + weightPercent;
  const activationBlocked = proposedActiveWeight > 100;

  function reset() {
    setOwnerId(owner?.id ?? '');
    setWeightPercent(20);
    setMilestones([]);
    setSuccessMeasures([blankMeasure()]);
    setMessage(null);
    setStep(1);
  }

  function openDialog() {
    reset();
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function setMilestone(index: number, patch: Partial<GoalMilestoneInput>) {
    setMilestones((current) =>
      current.map((milestone, milestoneIndex) =>
        milestoneIndex === index ? { ...milestone, ...patch } : milestone,
      ),
    );
  }

  function setSuccessMeasure(index: number, patch: Partial<SuccessMeasureInput>) {
    setSuccessMeasures((current) =>
      current.map((measure, measureIndex) =>
        measureIndex === index ? { ...measure, ...patch } : measure,
      ),
    );
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={openDialog}>
        {triggerLabel}
      </button>
      <Modal open={open} title="Set a Goal" onClose={close} size="wide" className={styles.modal}>
        <form
          className={`goal-setup ${styles.form}`}
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            if (step === 1) {
              if (!form.reportValidity()) return;
              setStep(2);
              return;
            }

            const data = new FormData(form);
            const submissionMode =
              ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') as
                'draft' | 'discussion' | 'active') ?? 'discussion';
            setMessage(null);
            startTransition(async () => {
              const result = await createGoal({
                ownerId: String(data.get('ownerId')),
                expectedResult: String(data.get('expectedResult')),
                successMeasures: successMeasures.map((measure) => ({
                  description: measure.description,
                  optionalTargetDate: measure.useDifferentDate ? measure.optionalTargetDate : null,
                })),
                targetDate: String(data.get('targetDate')),
                baseline: String(data.get('baseline') ?? '') || null,
                purpose: String(data.get('purpose') ?? '') || null,
                weightPercent: Number(data.get('weightPercent') || 0),
                category: String(data.get('category')) as
                  'performance' | 'improvement' | 'development',
                employeeApproach: String(data.get('employeeApproach') ?? '') || null,
                supportAgreed: String(data.get('supportAgreed') ?? '') || null,
                dependencies: String(data.get('dependencies') ?? '') || null,
                milestones,
                submissionMode,
                idempotencyKey: crypto.randomUUID(),
              });
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              const goalId = (result as typeof result & { goal_id?: string }).goal_id;
              setOpen(false);
              reset();
              if (!goalId) {
                router.refresh();
                return;
              }
              const query = new URLSearchParams({
                lifecycle: submissionMode === 'active' ? 'active' : 'draft',
                goal: goalId,
              });
              if (returnView === 'team') {
                query.set('view', 'team');
                query.set('person', String(data.get('ownerId')));
              }
              router.push(`/goals?${query.toString()}`);
            });
          }}
        >
          <header className="modal-head">
            <div>
              <p className="eyebrow">Step {step} of 2</p>
              <h2>{step === 1 ? 'Set the expectation' : 'Discuss and agree'}</h2>
              <p>{step === 1 ? 'What are we trying to achieve?' : 'How will we achieve it?'}</p>
            </div>
            <button type="button" className="btn small ghost" onClick={close}>
              Close
            </button>
          </header>

          <div className="goal-stepper" aria-label="Goal setup progress">
            <span className="active">
              1 <small>Expectation</small>
            </span>
            <span className={step === 2 ? 'active' : ''}>
              2 <small>Alignment</small>
            </span>
          </div>

          {message && (
            <div className="notice error" role="alert">
              <strong>Goal not saved</strong>
              <p>{message}</p>
            </div>
          )}

          <div hidden={step !== 1} className={`goal-setup-fields ${styles.fields}`}>
            {owner ? (
              <input type="hidden" name="ownerId" value={owner.id} />
            ) : (
              <div className="field full">
                <label htmlFor="goal-owner">Employee</label>
                <select
                  id="goal-owner"
                  name="ownerId"
                  required
                  value={ownerId}
                  onChange={(event) => setOwnerId(event.target.value)}
                >
                  <option value="" disabled>
                    Select an employee
                  </option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName} · {employee.employeeId}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field full">
              <label htmlFor="goal-result">What result should be achieved?</label>
              <input
                id="goal-result"
                name="expectedResult"
                required
                maxLength={500}
                placeholder="Strengthen shop-floor safety monitoring and corrective-action closure."
              />
            </div>

            <section className={`${styles.builder} full`} aria-labelledby="setup-measures">
              <div className="sectionhead">
                <div>
                  <h3 id="setup-measures">How will success be measured?</h3>
                  <p>Add the few results that would prove this Goal was achieved.</p>
                </div>
              </div>
              <div className={styles.measureList}>
                {successMeasures.map((measure, index) => (
                  <article className={styles.measure} key={index}>
                    <span className={styles.number} aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="field">
                      <label className="sr-only" htmlFor={`setup-measure-${index}`}>
                        Success measure {index + 1}
                      </label>
                      <input
                        id={`setup-measure-${index}`}
                        value={measure.description}
                        required={step === 1}
                        maxLength={1000}
                        placeholder="Complete at least 4 ESH inspections each month."
                        onChange={(event) =>
                          setSuccessMeasure(index, { description: event.target.value })
                        }
                      />
                    </div>
                    <div className={styles.measureActions}>
                      <button
                        type="button"
                        className="btn small ghost"
                        aria-expanded={measure.useDifferentDate}
                        onClick={() =>
                          setSuccessMeasure(index, {
                            useDifferentDate: !measure.useDifferentDate,
                            optionalTargetDate: measure.useDifferentDate
                              ? null
                              : measure.optionalTargetDate,
                          })
                        }
                      >
                        {measure.useDifferentDate ? 'Use Goal date' : 'Set different due date'}
                      </button>
                      {successMeasures.length > 1 && (
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() =>
                            setSuccessMeasures((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {measure.useDifferentDate && (
                      <div className={`field ${styles.optionalDate}`}>
                        <label htmlFor={`setup-measure-date-${index}`}>Different due date</label>
                        <input
                          id={`setup-measure-date-${index}`}
                          type="date"
                          required={step === 1}
                          value={measure.optionalTargetDate ?? ''}
                          onChange={(event) =>
                            setSuccessMeasure(index, {
                              optionalTargetDate: event.target.value || null,
                            })
                          }
                        />
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <button
                type="button"
                className="btn small"
                disabled={successMeasures.length >= 10}
                onClick={() => setSuccessMeasures((current) => [...current, blankMeasure()])}
              >
                + Add success measure
              </button>
            </section>

            <div className="field">
              <label htmlFor="goal-date">Target date</label>
              <input
                id="goal-date"
                name="targetDate"
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="field">
              <label htmlFor="goal-weight">Formal weight</label>
              <div className={styles.weightInput}>
                <input
                  id="goal-weight"
                  name="weightPercent"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  required
                  value={weightPercent || ''}
                  onChange={(event) => setWeightPercent(Number(event.target.value))}
                  aria-describedby="goal-formal-weight-summary"
                />
                <span aria-hidden="true">%</span>
              </div>
            </div>

            {ownerId && weightPercent > 0 && (
              <div
                id="goal-formal-weight-summary"
                className={`full ${styles.formalWeight}${activationBlocked ? ` ${styles.error}` : ''}`}
                role="status"
              >
                <div>
                  <span>Current allocation</span>
                  <strong>{currentActiveWeight}%</strong>
                </div>
                <div>
                  <span>After activation</span>
                  <strong>{proposedActiveWeight}%</strong>
                </div>
                <div>
                  <span>{activationBlocked ? 'Over allocation' : 'Remaining'}</span>
                  <strong>
                    {activationBlocked
                      ? `${proposedActiveWeight - 100}%`
                      : `${100 - proposedActiveWeight}%`}
                  </strong>
                </div>
                {activationBlocked && (
                  <p>
                    This Goal would bring the allocation to {proposedActiveWeight}%. Adjust the
                    weight before activation.
                  </p>
                )}
              </div>
            )}

            <details className={`full ${styles.disclosure}`}>
              <summary>+ More context</summary>
              <div className={`goal-setup-fields ${styles.disclosureFields}`}>
                <div className="field full">
                  <label htmlFor="goal-category">Category</label>
                  <select id="goal-category" name="category" defaultValue="performance">
                    <option value="performance">Performance</option>
                    <option value="improvement">Improvement</option>
                    <option value="development">Development</option>
                  </select>
                </div>
                <div className="field full">
                  <label htmlFor="goal-baseline">Current baseline</label>
                  <textarea
                    id="goal-baseline"
                    name="baseline"
                    rows={2}
                    maxLength={4000}
                    placeholder="Where are we starting from?"
                  />
                </div>
                <div className="field full">
                  <label htmlFor="goal-purpose">Why it matters</label>
                  <textarea
                    id="goal-purpose"
                    name="purpose"
                    rows={2}
                    maxLength={4000}
                    placeholder="Add context only if useful."
                  />
                </div>
              </div>
            </details>
          </div>

          <div hidden={step !== 2} className={`goal-setup-fields ${styles.fields}`}>
            <div className="field full">
              <label htmlFor="goal-approach">Agreed approach</label>
              <textarea
                id="goal-approach"
                name="employeeApproach"
                rows={3}
                maxLength={4000}
                placeholder="What approach have you agreed to take?"
              />
            </div>
            <div className="field full">
              <label htmlFor="goal-support">
                Support needed <span className="sub">· Optional</span>
              </label>
              <textarea id="goal-support" name="supportAgreed" rows={2} maxLength={4000} />
            </div>
            <details className={`full ${styles.disclosure}`}>
              <summary>+ More details</summary>
              <div className={`goal-setup-fields ${styles.disclosureFields}`}>
                <div className="field full">
                  <label htmlFor="goal-dependencies">
                    Dependencies / risks <span className="sub">· Optional</span>
                  </label>
                  <textarea id="goal-dependencies" name="dependencies" rows={2} maxLength={4000} />
                </div>
              </div>
            </details>

            <section className={`${styles.builder} full`} aria-labelledby="setup-milestones">
              <div className="sectionhead">
                <div>
                  <h3 id="setup-milestones">Milestones · Optional</h3>
                  <p>Add a few checkpoints if this Goal will be easier to manage in stages.</p>
                </div>
              </div>
              {milestones.map((milestone, index) => (
                <article className={styles.milestone} key={index}>
                  <span className={styles.number} aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="field">
                    <label htmlFor={`setup-milestone-title-${index}`}>Milestone result</label>
                    <input
                      id={`setup-milestone-title-${index}`}
                      value={milestone.title}
                      required={step === 2}
                      maxLength={500}
                      onChange={(event) => setMilestone(index, { title: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`setup-milestone-done-${index}`}>Done when</label>
                    <textarea
                      id={`setup-milestone-done-${index}`}
                      value={milestone.completion_definition}
                      required={step === 2}
                      rows={2}
                      maxLength={2000}
                      onChange={(event) =>
                        setMilestone(index, { completion_definition: event.target.value })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() =>
                      setMilestones((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </article>
              ))}
              <button
                type="button"
                className="btn small"
                disabled={milestones.length >= 5}
                onClick={() => setMilestones((current) => [...current, blankMilestone()])}
              >
                + Add milestone
              </button>
            </section>

            <div className={`full ${styles.alignmentWeight}`}>
              <span>Goal weight: {weightPercent}%</span>
              <span>Allocation after activation: {proposedActiveWeight}%</span>
              <strong>
                {activationBlocked
                  ? `${proposedActiveWeight - 100}% over allocation`
                  : `${100 - proposedActiveWeight}% remaining`}
              </strong>
            </div>
          </div>

          <footer className="modal-actions">
            {step === 2 && (
              <button type="button" className="btn" onClick={() => setStep(1)} disabled={pending}>
                Back
              </button>
            )}
            {step === 1 ? (
              <button type="submit" className="btn primary">
                Continue to discussion
              </button>
            ) : (
              <>
                <button type="submit" className="btn ghost" value="draft" disabled={pending}>
                  Save draft
                </button>
                <button type="submit" className="btn" value="discussion" disabled={pending}>
                  Save for discussion
                </button>
                {canActivate && (
                  <button
                    type="submit"
                    className="btn primary"
                    value="active"
                    disabled={pending || activationBlocked}
                    aria-busy={pending}
                    aria-describedby="goal-formal-weight-summary"
                  >
                    Agree &amp; activate
                  </button>
                )}
              </>
            )}
          </footer>
        </form>
      </Modal>
    </>
  );
}

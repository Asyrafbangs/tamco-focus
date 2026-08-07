'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Modal } from '@/components/ui/Modal';
import { createGoal, type GoalMilestoneInput } from '@/server/actions/goal-actions';

import styles from './GoalSetupDialog.module.css';

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeId: string;
  activeWeight: number;
}

function blankMilestone(): GoalMilestoneInput {
  return { title: '', completion_definition: '', progress_percent: 0, weight_percent: null };
}

export function GoalSetupDialog({ employees }: { employees: EmployeeOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<GoalMilestoneInput[]>([blankMilestone()]);
  const [ownerId, setOwnerId] = useState('');
  const [weightPercent, setWeightPercent] = useState(0);

  const currentActiveWeight =
    employees.find((employee) => employee.id === ownerId)?.activeWeight ?? 0;
  const proposedActiveWeight = currentActiveWeight + weightPercent;
  const activationBlocked = proposedActiveWeight > 100;

  function openDialog() {
    setOwnerId('');
    setWeightPercent(0);
    setMilestones([blankMilestone()]);
    setMessage(null);
    setStep(1);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setStep(1);
    setMessage(null);
  }

  function setMilestone(index: number, patch: Partial<GoalMilestoneInput>) {
    setMilestones((current) =>
      current.map((milestone, milestoneIndex) =>
        milestoneIndex === index ? { ...milestone, ...patch } : milestone,
      ),
    );
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={openDialog}>
        ＋ Set up goal
      </button>
      <Modal open={open} title="Set a Goal" onClose={close} size="wide">
        <form
          className="goal-setup"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            if (step === 1) {
              if (!form.reportValidity()) return;
              setStep(2);
              return;
            }
            const data = new FormData(form);
            const activate =
              (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'activate';
            setMessage(null);
            startTransition(async () => {
              const result = await createGoal({
                ownerId: String(data.get('ownerId')),
                expectedResult: String(data.get('expectedResult')),
                successMeasure: String(data.get('successMeasure')),
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
                activate,
                idempotencyKey: crypto.randomUUID(),
              });
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              const goalId = (result as typeof result & { goal_id?: string }).goal_id;
              close();
              if (goalId) {
                router.push(
                  `/goals?view=team&person=${encodeURIComponent(String(data.get('ownerId')))}&lifecycle=${activate ? 'active' : 'discussion'}&goal=${goalId}`,
                );
              } else router.refresh();
            });
          }}
        >
          <header className="modal-head">
            <div>
              <p className="eyebrow">Step {step} of 2</p>
              <h2>{step === 1 ? 'Set the expectation' : 'Discuss and agree'}</h2>
              <p>
                {step === 1
                  ? 'Define the result before discussing how it will be achieved.'
                  : 'Agree the approach, support, and a small set of measurable milestones.'}
              </p>
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

          <div hidden={step !== 1} className="goal-setup-fields">
            <div className="field">
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
            <div className="field full">
              <label htmlFor="goal-result">Expected result</label>
              <input id="goal-result" name="expectedResult" required maxLength={500} />
            </div>
            <div className="field full">
              <label htmlFor="goal-measure">How will success be measured?</label>
              <textarea
                id="goal-measure"
                name="successMeasure"
                required
                rows={3}
                maxLength={2000}
              />
            </div>
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
              <label htmlFor="goal-category">Category</label>
              <select id="goal-category" name="category" defaultValue="performance">
                <option value="performance">Performance</option>
                <option value="improvement">Improvement</option>
                <option value="development">Development</option>
              </select>
            </div>
            <details className="full goal-context">
              <summary>＋ More context</summary>
              <div className="goal-setup-fields">
                <div className="field full">
                  <label htmlFor="goal-baseline">Current baseline</label>
                  <textarea id="goal-baseline" name="baseline" rows={2} maxLength={4000} />
                </div>
                <div className="field">
                  <label htmlFor="goal-weight">Goal weight (%)</label>
                  <input
                    id="goal-weight"
                    name="weightPercent"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={weightPercent}
                    onChange={(event) => setWeightPercent(Number(event.target.value))}
                    aria-describedby="goal-formal-weight-summary"
                  />
                </div>
                <div className="field full">
                  <label htmlFor="goal-purpose">Why it matters</label>
                  <textarea id="goal-purpose" name="purpose" rows={2} maxLength={4000} />
                </div>
              </div>
            </details>
          </div>

          <div hidden={step !== 2} className="goal-setup-fields">
            <div
              id="goal-formal-weight-summary"
              className={`full ${styles.formalWeight}${activationBlocked ? ` ${styles.error}` : ''}`}
              role="status"
            >
              <strong>
                Active allocation: {currentActiveWeight}% → {proposedActiveWeight}%
              </strong>
              <span>
                {activationBlocked
                  ? 'Agree & activate is blocked above 100%. Save for discussion remains available.'
                  : `${100 - proposedActiveWeight}% remains after activation.`}
              </span>
            </div>
            <div className="field full">
              <label htmlFor="goal-approach">Employee&apos;s proposed approach</label>
              <textarea id="goal-approach" name="employeeApproach" rows={3} maxLength={4000} />
            </div>
            <div className="field full">
              <label htmlFor="goal-support">Support agreed</label>
              <textarea id="goal-support" name="supportAgreed" rows={2} maxLength={4000} />
            </div>
            <div className="field full">
              <label htmlFor="goal-dependencies">Dependencies</label>
              <textarea id="goal-dependencies" name="dependencies" rows={2} maxLength={4000} />
            </div>

            <section className="goal-milestone-builder full" aria-labelledby="setup-milestones">
              <div className="sectionhead">
                <div>
                  <h3 id="setup-milestones">Agree the milestones together</h3>
                  <p>Keep each milestone as a clear result that can be updated and completed.</p>
                </div>
                <button
                  type="button"
                  className="btn small"
                  disabled={milestones.length >= 10}
                  onClick={() => setMilestones((current) => [...current, blankMilestone()])}
                >
                  ＋ Milestone
                </button>
              </div>
              {milestones.map((milestone, index) => (
                <article className="goal-milestone-edit" key={index}>
                  <span className="goal-milestone-number">{index + 1}</span>
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
                    <label htmlFor={`setup-milestone-done-${index}`}>Definition of done</label>
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
                  {milestones.length > 1 && (
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
                  )}
                </article>
              ))}
              <p className="sub">
                Each milestone counts equally towards the goal. Weighting is set on the goal itself,
                not on individual milestones.
              </p>
            </section>
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
                <button type="submit" className="btn" value="discussion" disabled={pending}>
                  Save for discussion
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  value="activate"
                  disabled={pending || activationBlocked}
                  aria-describedby="goal-formal-weight-summary"
                >
                  Agree &amp; activate
                </button>
              </>
            )}
          </footer>
        </form>
      </Modal>
    </>
  );
}

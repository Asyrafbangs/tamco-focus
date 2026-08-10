'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Modal } from '@/components/ui/Modal';
import type { GoalOverview } from '@/domain/goals';
import type { OperationResult } from '@/domain/types';
import {
  completeGoalQuarterlySession,
  finalizeGoalPlan,
  submitGoalMonthlySession,
} from '@/server/actions/goal-actions';
import type { GoalPlanOverview, GoalSessionOverview } from '@/server/goal-queries';

import styles from './GoalSessionPanel.module.css';

type SessionHealth = 'on_track' | 'at_risk' | 'off_track' | 'no_material_change';

const HEALTH_OPTIONS: Array<{ value: SessionHealth; label: string }> = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
  { value: 'no_material_change', label: 'No material change' },
];

function quarterForMonth(month: number) {
  return Math.floor((month - 1) / 3) + 1;
}

function currentSessionHealth(goal: GoalOverview): SessionHealth {
  if (goal.health === 'on_track' || goal.health === 'at_risk' || goal.health === 'off_track') {
    return goal.health;
  }
  if (goal.health === 'support_requested' || goal.health === 'need_attention') return 'at_risk';
  return 'no_material_change';
}

export function GoalSessionPanel({
  ownerId,
  activeGoals,
  plan,
  sessions,
  supportPeople,
  canSubmitMonthly,
  canReviewQuarterly,
  canFinalizePlan,
  now,
}: {
  ownerId: string;
  activeGoals: GoalOverview[];
  plan: GoalPlanOverview | null;
  sessions: GoalSessionOverview[];
  supportPeople: Array<{ id: string; name: string }>;
  canSubmitMonthly: boolean;
  canReviewQuarterly: boolean;
  canFinalizePlan: boolean;
  now: string;
}) {
  const router = useRouter();
  const current = new Date(now);
  const year = current.getFullYear();
  const month = current.getMonth() + 1;
  const quarter = quarterForMonth(month);
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [quarterlyOpen, setQuarterlyOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const monthlyDone = sessions.find(
    (session) =>
      session.sessionKind === 'monthly' &&
      session.periodYear === year &&
      session.periodMonth === month,
  );
  const quarterlyDone = sessions.find(
    (session) =>
      session.sessionKind === 'quarterly' &&
      session.periodYear === year &&
      session.periodQuarter === quarter,
  );

  function finish(result: OperationResult, success: string, close: () => void) {
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message });
      return;
    }
    setMessage({ tone: 'success', text: success });
    close();
    router.refresh();
  }

  if (!plan && activeGoals.length === 0) return null;

  return (
    <section className={styles.panel} aria-labelledby="goal-session-heading">
      <div className={styles.planSummary}>
        <div>
          <p className="eyebrow" id="goal-session-heading">
            {plan?.performancePeriodName ?? 'Goal plan'}
          </p>
          <strong>{plan?.formalWeight ?? 0}% formal Active allocation</strong>
          <span>
            {plan?.status === 'finalized'
              ? 'Plan finalized'
              : plan?.reallocationRequired
                ? `${plan.reallocationRequired}% still requires allocation`
                : 'Ready for finalisation'}
          </span>
        </div>
        {canFinalizePlan && plan && plan.status !== 'finalized' && (
          <button
            type="button"
            className="btn small"
            disabled={pending || !plan.canFinalize}
            title={plan.canFinalize ? undefined : 'Formal Active Goal weight must equal 100%.'}
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                finish(
                  await finalizeGoalPlan({
                    employeeId: ownerId,
                    performancePeriodId: plan.performancePeriodId,
                    expectedVersion: plan.version,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                  'Goal plan finalized at exactly 100%.',
                  () => undefined,
                );
              });
            }}
          >
            Finalize plan
          </button>
        )}
      </div>

      <div className={styles.sessionGrid}>
        {canSubmitMonthly && (
          <article className={styles.sessionCard}>
            <div>
              <strong>Monthly Goal session</strong>
              <span>
                {monthlyDone
                  ? `${monthlyDone.goalCount} Goals recorded for ${month}/${year}`
                  : `Complete one employee session for all ${activeGoals.length} Active Goals.`}
              </span>
            </div>
            <button
              type="button"
              className="btn small primary"
              disabled={Boolean(monthlyDone) || activeGoals.length === 0}
              onClick={() => {
                setMessage(null);
                setMonthlyOpen(true);
              }}
            >
              {monthlyDone ? 'Month complete' : 'Start monthly session'}
            </button>
          </article>
        )}

        {canReviewQuarterly && (
          <article className={styles.sessionCard}>
            <div>
              <strong>Quarterly Goal session</strong>
              <span>
                {quarterlyDone
                  ? `${quarterlyDone.goalCount} Goals reviewed for Q${quarter} ${year}`
                  : `Review current health across all ${activeGoals.length} Active Goals once.`}
              </span>
            </div>
            <button
              type="button"
              className="btn small"
              disabled={Boolean(quarterlyDone) || activeGoals.length === 0}
              onClick={() => {
                setMessage(null);
                setQuarterlyOpen(true);
              }}
            >
              {quarterlyDone ? 'Quarter complete' : 'Start quarterly review'}
            </button>
          </article>
        )}
      </div>

      {message && (
        <p className={`${styles.message} ${styles[message.tone]}`} role="status">
          {message.text}
        </p>
      )}

      <Modal
        open={monthlyOpen}
        title={`Monthly Goal session · ${month}/${year}`}
        onClose={() => !pending && setMonthlyOpen(false)}
        size="wide"
      >
        <form
          className={styles.sessionForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!plan) return;
            const data = new FormData(event.currentTarget);
            startTransition(async () => {
              finish(
                await submitGoalMonthlySession({
                  employeeId: ownerId,
                  performancePeriodId: plan.performancePeriodId,
                  periodYear: year,
                  periodMonth: month,
                  items: activeGoals.map((goal) => ({
                    goalId: goal.id,
                    health: String(data.get(`health-${goal.id}`)) as SessionHealth,
                    updateText: String(data.get(`update-${goal.id}`) ?? '') || null,
                    supportRequested: data.get(`support-${goal.id}`) === 'on',
                    supportDetails: String(data.get(`support-details-${goal.id}`) ?? '') || null,
                    actionRequiredFrom: String(data.get(`support-person-${goal.id}`) ?? '') || null,
                  })),
                  idempotencyKey: crypto.randomUUID(),
                }),
                'Monthly Goal session completed.',
                () => setMonthlyOpen(false),
              );
            });
          }}
        >
          <header className="modal-head">
            <div>
              <p className="eyebrow">Monthly Goal session</p>
              <h2>
                {month}/{year} · All Active Goals
              </h2>
            </div>
            <button
              type="button"
              className="btn small ghost"
              disabled={pending}
              aria-label="Close monthly Goal session"
              onClick={() => setMonthlyOpen(false)}
            >
              ×
            </button>
          </header>
          <div className={`modal-body ${styles.sessionBody}`}>
            <p className="sub">
              Record current health for every Active Goal. A normal update needs no approval;
              explicit support creates an actionable request.
            </p>
            <div className={styles.goalItems}>
              {activeGoals.map((goal) => (
                <fieldset className={styles.goalItem} key={goal.id}>
                  <legend>{goal.title}</legend>
                  <div className="field">
                    <label htmlFor={`monthly-health-${goal.id}`}>Current health</label>
                    <select
                      id={`monthly-health-${goal.id}`}
                      name={`health-${goal.id}`}
                      defaultValue={currentSessionHealth(goal)}
                      required
                    >
                      {HEALTH_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`monthly-update-${goal.id}`}>What changed? · Optional</label>
                    <textarea
                      id={`monthly-update-${goal.id}`}
                      name={`update-${goal.id}`}
                      rows={2}
                      placeholder="Required when At risk or Off track."
                    />
                  </div>
                  <label className={styles.supportToggle}>
                    <input type="checkbox" name={`support-${goal.id}`} />
                    <span>Request support, a decision or escalation</span>
                  </label>
                  <div className={styles.supportFields}>
                    <div className="field">
                      <label htmlFor={`support-details-${goal.id}`}>Support needed</label>
                      <textarea
                        id={`support-details-${goal.id}`}
                        name={`support-details-${goal.id}`}
                        rows={2}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`support-person-${goal.id}`}>Action required from</label>
                      <select id={`support-person-${goal.id}`} name={`support-person-${goal.id}`}>
                        <option value="">Select person</option>
                        {supportPeople.map((person) => (
                          <option value={person.id} key={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </fieldset>
              ))}
            </div>
          </div>
          <footer className="modal-actions">
            <button type="button" className="btn" onClick={() => setMonthlyOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={pending} aria-busy={pending}>
              Complete month
            </button>
          </footer>
        </form>
      </Modal>

      <Modal
        open={quarterlyOpen}
        title={`Quarterly Goal review · Q${quarter} ${year}`}
        onClose={() => !pending && setQuarterlyOpen(false)}
        size="wide"
      >
        <form
          className={styles.sessionForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!plan) return;
            const data = new FormData(event.currentTarget);
            startTransition(async () => {
              finish(
                await completeGoalQuarterlySession({
                  employeeId: ownerId,
                  performancePeriodId: plan.performancePeriodId,
                  periodYear: year,
                  periodQuarter: quarter,
                  summary: String(data.get('quarterSummary') ?? '') || null,
                  items: activeGoals.map((goal) => ({
                    goalId: goal.id,
                    health: String(data.get(`quarter-health-${goal.id}`)) as SessionHealth,
                    attentionText: String(data.get(`quarter-attention-${goal.id}`) ?? '') || null,
                    supportAdjustment: String(data.get(`quarter-support-${goal.id}`) ?? '') || null,
                  })),
                  idempotencyKey: crypto.randomUUID(),
                }),
                'Quarterly Goal session completed.',
                () => setQuarterlyOpen(false),
              );
            });
          }}
        >
          <header className="modal-head">
            <div>
              <p className="eyebrow">Quarterly Goal session</p>
              <h2>
                Q{quarter} {year} · All Active Goals
              </h2>
            </div>
            <button
              type="button"
              className="btn small ghost"
              disabled={pending}
              aria-label="Close quarterly Goal session"
              onClick={() => setQuarterlyOpen(false)}
            >
              ×
            </button>
          </header>
          <div className={`modal-body ${styles.sessionBody}`}>
            <p className="sub">
              One review covers the employee&apos;s full Active Goal set. Normal health does not
              create a manager exception.
            </p>
            <div className={styles.goalItems}>
              {activeGoals.map((goal) => (
                <fieldset className={styles.goalItem} key={goal.id}>
                  <legend>{goal.title}</legend>
                  <div className="field">
                    <label htmlFor={`quarter-health-${goal.id}`}>Current health</label>
                    <select
                      id={`quarter-health-${goal.id}`}
                      name={`quarter-health-${goal.id}`}
                      defaultValue={currentSessionHealth(goal)}
                      required
                    >
                      {HEALTH_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`quarter-attention-${goal.id}`}>
                      Attention or discussion · Optional
                    </label>
                    <textarea
                      id={`quarter-attention-${goal.id}`}
                      name={`quarter-attention-${goal.id}`}
                      rows={2}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`quarter-support-${goal.id}`}>
                      Agreed support adjustment · Optional
                    </label>
                    <textarea
                      id={`quarter-support-${goal.id}`}
                      name={`quarter-support-${goal.id}`}
                      rows={2}
                    />
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="field">
              <label htmlFor="quarter-summary">Employee-level review summary · Optional</label>
              <textarea id="quarter-summary" name="quarterSummary" rows={3} />
            </div>
          </div>
          <footer className="modal-actions">
            <button type="button" className="btn" onClick={() => setQuarterlyOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={pending} aria-busy={pending}>
              Complete quarter
            </button>
          </footer>
        </form>
      </Modal>
    </section>
  );
}

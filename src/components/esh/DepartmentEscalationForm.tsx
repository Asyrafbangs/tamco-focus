'use client';

import { useState, useTransition } from 'react';

import { looksLikeEmail } from '@/domain/esh-findings';
import {
  setDepartmentEscalation,
  type DepartmentEscalationState,
} from '@/server/esh/department-actions';
import type { DepartmentEscalationDefault } from '@/server/esh/queries';

/**
 * The escalation route a department normally uses (§7).
 *
 * ESH was typing the same two addresses for every finding in the same
 * warehouse. Recorded here once, they are offered when a finding is assigned
 * to that department — and offered is all: the route on the action is still
 * what ESH confirms, and nobody listed here is written to or given access by
 * being listed.
 */
export function DepartmentEscalationForm({
  departments,
  levelDays,
}: {
  departments: DepartmentEscalationDefault[];
  levelDays: number[];
}) {
  return (
    <section className="esh-policy-stack" aria-labelledby="esh-department-routes-title">
      <div className="esh-section-heading">
        <div>
          <h2 id="esh-department-routes-title">Escalation routes by department</h2>
          <p>
            Offered when a finding is assigned to that department, so the same addresses are not
            typed again for every finding. ESH still confirms the route on each finding.
          </p>
        </div>
      </div>
      {departments.map((department) => (
        <DepartmentRoute
          key={department.departmentId}
          department={department}
          levelDays={levelDays}
        />
      ))}
    </section>
  );
}

function DepartmentRoute({
  department,
  levelDays,
}: {
  department: DepartmentEscalationDefault;
  levelDays: number[];
}) {
  const [levels, setLevels] = useState<string[]>(() => {
    const highest = Math.max(1, ...department.levels.map((one) => one.level));
    return Array.from({ length: highest }, (_, index) => {
      const found = department.levels.find((one) => one.level === index + 1);
      return found?.email ?? '';
    });
  });
  const [state, setState] = useState<DepartmentEscalationState | null>(null);
  const [pending, startTransition] = useTransition();
  const bad = levels.some((email) => email.trim() && !looksLikeEmail(email));

  return (
    <section className="esh-form-card" aria-labelledby={`route-${department.departmentId}`}>
      <h3 id={`route-${department.departmentId}`} className="esh-form-card-title">
        {department.departmentName}
      </h3>
      {state && (
        <div className={`notice ${state.ok ? 'success' : 'error'} compact`} role="status">
          <strong>{state.message}</strong>
        </div>
      )}
      <div className="esh-escalation-levels">
        {levels.map((email, index) => (
          <div className="esh-field" key={index}>
            <label htmlFor={`route-${department.departmentId}-${index}`}>
              <span>Level {index + 1}</span>
            </label>
            <small className="esh-chips-hint">
              {levelDays[index] === undefined
                ? 'timing follows your policy'
                : `after ${levelDays[index]} day${levelDays[index] === 1 ? '' : 's'} overdue`}
            </small>
            <input
              id={`route-${department.departmentId}-${index}`}
              type="email"
              inputMode="email"
              autoComplete="off"
              maxLength={254}
              value={email}
              placeholder="name@company.com"
              onChange={(event) => {
                setState(null);
                setLevels((current) =>
                  current.map((one, at) => (at === index ? event.target.value : one)),
                );
              }}
            />
          </div>
        ))}
      </div>
      {bad && (
        <p className="esh-field-error" role="alert">
          One of those is not a valid email address.
        </p>
      )}
      <div className="esh-form-actions">
        {levels.length < 9 && (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setLevels((current) => [...current, ''])}
          >
            + Add level {levels.length + 1}
          </button>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={pending || bad}
          onClick={() =>
            startTransition(async () => {
              setState(
                await setDepartmentEscalation({
                  departmentId: department.departmentId,
                  // An empty level is a level removed, not an empty address.
                  levels: levels
                    .map((email, index) => ({ level: index + 1, email: email.trim() }))
                    .filter((entry) => entry.email),
                }),
              );
            })
          }
        >
          {pending ? 'Saving…' : 'Save route'}
        </button>
      </div>
    </section>
  );
}

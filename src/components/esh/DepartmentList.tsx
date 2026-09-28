'use client';

import { useState, useTransition } from 'react';

import {
  departmentCodeProblem,
  similarDepartments,
  suggestDepartmentCode,
} from '@/domain/department-names';
import { addDepartment } from '@/server/esh/department-actions';

/**
 * The department list, where repeated configuration belongs (v228, §31.2).
 *
 * Adding one from the finding form (v225) is for the moment somebody discovers
 * the gap mid-finding; this is for the afternoon somebody sets the register up
 * properly. Both call the same administrator-only `create_department`, so this
 * is no new authority and no organisation-chart editor — the reporting line,
 * the parent and the head still belong to shared administration.
 *
 * Read-only for anybody who is not an administrator: an ESH Verifier maintains
 * escalation routes, not the company's departments.
 */
export function DepartmentList({
  departments,
  canAdd,
}: {
  departments: Array<{ id: string; name: string }>;
  canAdd: boolean;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [touchedCode, setTouchedCode] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [added, setAdded] = useState<Array<{ id: string; name: string }>>([]);
  const [pending, startTransition] = useTransition();

  const known = [
    ...departments,
    ...added.filter((one) => !departments.some((d) => d.id === one.id)),
  ];
  const typed = name.trim();
  const near = typed.length >= 3 ? similarDepartments(typed, known) : [];
  const suggested = touchedCode ? code : suggestDepartmentCode(typed);
  const codeProblem = typed && suggested ? departmentCodeProblem(suggested) : null;

  return (
    <section className="esh-form-card" aria-labelledby="esh-department-list">
      <h2 id="esh-department-list" className="esh-form-card-title">
        Department list
      </h2>
      <p className="form-hint esh-form-card-hint">
        Every finding is recorded against one of these. Adding a department gives nobody access and
        tells nobody anything.
      </p>

      <ul className="esh-department-chips">
        {known.map((department) => (
          <li key={department.id}>{department.name}</li>
        ))}
      </ul>

      {said && (
        <div className={`notice ${said.ok ? 'success' : 'error'} compact`} role="status">
          <strong>{said.message}</strong>
        </div>
      )}

      {canAdd ? (
        <>
          <div className="esh-field">
            <label htmlFor="esh-new-department">
              <span>New department name</span>
            </label>
            <input
              id="esh-new-department"
              value={name}
              maxLength={120}
              placeholder="e.g. Maintenance"
              onChange={(event) => {
                setName(event.target.value);
                setSaid(null);
                if (!touchedCode) setCode(suggestDepartmentCode(event.target.value));
              }}
            />
          </div>

          {/*
            The near-match warning is the point of putting this here rather than
            leaving it to the form: a register split across Maintenance,
            Maintainance and Maintenance Dept ruins every report built on it.
          */}
          {near.length > 0 && (
            <div className="notice compact" role="status">
              <strong>
                {near.length === 1 ? 'This already exists' : 'These already exist'}, or nearly:
              </strong>{' '}
              {near.map((department) => department.name).join(', ')}
            </div>
          )}

          <div className="esh-field">
            <label htmlFor="esh-new-department-code">
              <span>Short code</span>
            </label>
            <input
              id="esh-new-department-code"
              value={suggested}
              maxLength={32}
              onChange={(event) => {
                setTouchedCode(true);
                setCode(event.target.value.toUpperCase());
                setSaid(null);
              }}
            />
            {codeProblem && (
              <p className="esh-field-error" role="alert">
                {codeProblem}
              </p>
            )}
          </div>

          <div className="esh-form-actions">
            <button
              type="button"
              className="btn primary"
              disabled={pending || !typed || Boolean(codeProblem)}
              onClick={() =>
                startTransition(async () => {
                  const answer = await addDepartment({ name: typed, code: suggested });
                  setSaid(answer);
                  if (answer.ok && answer.department) {
                    setAdded((current) => [...current, answer.department!]);
                    setName('');
                    setCode('');
                    setTouchedCode(false);
                  }
                })
              }
            >
              {pending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </>
      ) : (
        <p className="form-hint">
          An administrator adds a department, under Identity and access. It can also be added while
          recording a finding.
        </p>
      )}
    </section>
  );
}

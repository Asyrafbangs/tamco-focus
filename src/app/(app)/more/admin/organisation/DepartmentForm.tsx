'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { createDepartmentAction, updateDepartmentAction } from '@/server/actions/settings-actions';

/**
 * Creating or changing a department, in one small form (v170).
 *
 * Four questions and nothing else: what it is called, its code, what it sits
 * under, and who heads it. A department is maintained often enough to deserve
 * a short form, and rarely enough that a configuration wizard would be a way of
 * making people guess.
 *
 * Editing adds one more: whether it is still in use. Archiving is refused by
 * the procedure while the department still holds people or live sub-units, and
 * the sentence it answers with is shown here rather than translated.
 */

export interface DepartmentChoice {
  id: string;
  name: string;
  code: string;
}

export interface HeadChoice {
  id: string;
  fullName: string;
  employeeId: string;
}

export interface EditableDepartment extends DepartmentChoice {
  parentId: string | null;
  headId: string | null;
  status: 'active' | 'archived';
}

const INITIAL = { ok: false, code: '', message: '' };

export function DepartmentForm({
  department,
  departments,
  people,
  cancelHref,
}: {
  /** Absent when creating. */
  department: EditableDepartment | null;
  departments: DepartmentChoice[];
  people: HeadChoice[];
  cancelHref: string;
}) {
  const creating = department === null;
  const [state, action, pending] = useActionState(
    creating ? createDepartmentAction : updateDepartmentAction,
    INITIAL,
  );

  // A department cannot sit under itself; the procedure refuses the deeper
  // loops, and its sentence says so.
  const parents = departments.filter((candidate) => candidate.id !== department?.id);

  return (
    <section className="org-move-panel" aria-labelledby="org-department-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Department</p>
          <h2 id="org-department-heading">{creating ? 'New department' : 'Edit department'}</h2>
        </div>
      </div>

      <form action={action} className="settings-form">
        {department && <input type="hidden" name="departmentId" value={department.id} />}
        <div className="form-grid">
          <label>
            <span>Department name</span>
            <input name="name" required maxLength={120} defaultValue={department?.name ?? ''} />
          </label>
          <label>
            <span>Code</span>
            <input
              name="code"
              required
              maxLength={32}
              defaultValue={department?.code ?? ''}
              placeholder="GIS"
              // Codes are stored upper-case; typing lower-case is not a mistake.
              style={{ textTransform: 'uppercase' }}
            />
          </label>
          <label>
            <span>Reports under</span>
            <select name="parentId" defaultValue={department?.parentId ?? ''}>
              <option value="">Nothing — top of the organisation</option>
              {parents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Department head</span>
            <select name="headId" defaultValue={department?.headId ?? ''}>
              <option value="">No head yet</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName} · {person.employeeId}
                </option>
              ))}
            </select>
          </label>
          {department && (
            <label>
              <span>Status</span>
              <select name="status" defaultValue={department.status}>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          )}
        </div>

        {state.message && (
          <p className={state.ok ? 'notice success' : 'notice error'} role="status">
            {state.message}
          </p>
        )}

        <div className="org-move-actions">
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : creating ? 'Create department' : 'Save'}
          </button>
          <Link className="btn small ghost" href={cancelHref}>
            {state.ok ? 'Done' : 'Cancel'}
          </Link>
        </div>
      </form>
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { EmailChips } from '@/components/esh/EmailChips';
import { departmentProposal } from '@/domain/esh-departments';
import { createDepartment, setDepartmentRoute } from '@/server/esh/owner-email-actions';

/**
 * Departments and their usual escalation route (v223).
 *
 * Set once here, a department's route is what every new finding for it
 * starts from — folded to one line on the form — and what an imported
 * backlog row is assigned with. Changing it never rewrites an action already
 * assigned: those keep the route they were given.
 */
export function DepartmentRoutesForm({
  departments,
  routes,
  levelDays,
  canAdd,
  canEditRoutes,
}: {
  departments: Array<{ id: string; name: string }>;
  routes: Record<string, Array<{ level: number; email: string }>>;
  levelDays: number[];
  canAdd: boolean;
  canEditRoutes: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [levels, setLevels] = useState(1);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [pending, start] = useTransition();
  const proposal = newName.trim() ? departmentProposal(newName, departments) : null;

  const summary = (departmentId: string) => {
    const route = routes[departmentId] ?? [];
    if (route.length === 0) return 'No usual route — set on each finding';
    return Array.from(new Set(route.map((entry) => entry.level)))
      .sort((a, b) => a - b)
      .map((level) => {
        const days = levelDays[level - 1];
        const when = days === undefined ? '' : ` · ${days} day${days === 1 ? '' : 's'} overdue`;
        return `Level ${level}${when} → ${route
          .filter((entry) => entry.level === level)
          .map((entry) => entry.email)
          .join(', ')}`;
      })
      .join('   ');
  };

  function save(departmentId: string, form: HTMLFormElement) {
    const data = new FormData(form);
    const route: Array<{ level: number; email: string }> = [];
    for (let level = 1; level <= levels; level += 1) {
      const raw = data.get(`route_level_${level}`);
      const emails = typeof raw === 'string' && raw ? (JSON.parse(raw) as string[]) : [];
      for (const email of emails) route.push({ level, email });
    }
    start(async () => {
      const result = await setDepartmentRoute({ departmentId, route });
      setMessage(
        result.ok ? { ok: true, text: 'Route saved.' } : { ok: false, text: result.message },
      );
      if (result.ok) {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="esh-form-card" aria-labelledby="department-routes-title">
      <h2 id="department-routes-title" className="esh-form-card-title">
        Departments and follow-up
      </h2>
      <p className="form-hint esh-form-card-hint">
        Who hears about an overdue action, by department. A new finding starts from this route; it
        is changed on the finding only when that finding is the exception.
      </p>
      {message && (
        <p className={message.ok ? 'notice success' : 'esh-field-error'} role="status">
          {message.text}
        </p>
      )}
      <ul className="esh-department-routes">
        {departments.map((department) => (
          <li key={department.id}>
            <div className="esh-department-route-head">
              <strong>{department.name}</strong>
              <small>{summary(department.id)}</small>
              {canEditRoutes && editing !== department.id && (
                <button
                  type="button"
                  className="btn small ghost"
                  aria-label={`Change the route for ${department.name}`}
                  onClick={() => {
                    const existing = routes[department.id] ?? [];
                    setLevels(Math.max(1, ...existing.map((entry) => entry.level)));
                    setEditing(department.id);
                    setMessage(null);
                  }}
                >
                  Change
                </button>
              )}
            </div>
            {editing === department.id && (
              <form
                className="esh-department-route-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  save(department.id, event.currentTarget);
                }}
              >
                {Array.from({ length: levels }, (_, index) => index + 1).map((level) => (
                  <EmailChips
                    key={level}
                    name={`route_level_${level}`}
                    label={`Level ${level}`}
                    hint={
                      levelDays[level - 1] === undefined
                        ? undefined
                        : `after ${levelDays[level - 1]} day${levelDays[level - 1] === 1 ? '' : 's'} overdue`
                    }
                    initial={(routes[department.id] ?? [])
                      .filter((entry) => entry.level === level)
                      .map((entry) => entry.email)}
                  />
                ))}
                <div className="esh-form-actions">
                  {levels < 9 && (
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => setLevels((count) => count + 1)}
                    >
                      + Add level {levels + 1}
                    </button>
                  )}
                  <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary" disabled={pending}>
                    {pending ? 'Saving…' : 'Save route'}
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      {canAdd && (
        <form
          className="esh-department-add"
          onSubmit={(event) => {
            event.preventDefault();
            start(async () => {
              const result = await createDepartment({ name: newName });
              if (!result.ok) {
                setMessage({ ok: false, text: result.message });
                return;
              }
              setMessage({
                ok: true,
                text: result.existed
                  ? `${result.name} already exists.`
                  : `${result.name} added to the department list.`,
              });
              setNewName('');
              router.refresh();
            });
          }}
        >
          <label className="esh-field">
            <span>Add a department</span>
            <input
              value={newName}
              maxLength={80}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <button type="submit" className="btn" disabled={pending || !newName.trim()}>
            Add
          </button>
          {proposal && proposal.kind !== 'new' && (
            <p className="form-hint" role="status">
              {proposal.kind === 'exists' ? 'Already in the list' : 'Similar department exists'}:{' '}
              <strong>{proposal.department.name}</strong>
            </p>
          )}
        </form>
      )}
    </section>
  );
}

'use client';

import { useId, useRef, useState, useTransition, type KeyboardEvent } from 'react';

import {
  departmentProposal,
  matchDepartments,
  type DepartmentChoice,
} from '@/domain/esh-departments';
import { createDepartment } from '@/server/esh/owner-email-actions';

/**
 * The accountable department as a combobox (v223).
 *
 * Search first, choose what exists, add only what is genuinely missing. When
 * nothing matches and the person may add one, the list offers
 * + Add "Warehouse Project Team"; a name close to an existing department says
 * so first, because a register split between "Warehouse" and "Ware House"
 * cannot be reported on. Adding creates the department in the master list and
 * selects it, without a trip to Settings.
 *
 * The chosen id travels in a hidden field named as the old select was, so the
 * save does not know the difference.
 */
export function DepartmentPicker({
  id,
  name,
  departments,
  value,
  canAdd,
  describedBy,
  invalid,
  onChange,
}: {
  id: string;
  name: string;
  departments: DepartmentChoice[];
  value: string;
  canAdd: boolean;
  describedBy?: string;
  invalid?: boolean;
  onChange: (departmentId: string, created?: DepartmentChoice) => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const chosen = departments.find((department) => department.id === value) ?? null;
  const [query, setQuery] = useState(chosen?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();

  const typed = query.trim();
  const showingChosen = chosen !== null && typed === chosen.name;
  const matches = showingChosen ? departments : matchDepartments(typed, departments);
  const proposal =
    canAdd && typed && !showingChosen ? departmentProposal(typed, departments) : null;
  const offerAdd = proposal?.kind === 'new' || proposal?.kind === 'similar';
  const options = matches.length + (offerAdd ? 1 : 0);

  function choose(department: DepartmentChoice) {
    setQuery(department.name);
    setOpen(false);
    setProblem(null);
    onChange(department.id);
  }

  function add() {
    startAdding(async () => {
      const result = await createDepartment({ name: typed });
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      const department = { id: result.id, name: result.name || typed };
      setQuery(department.name);
      setOpen(false);
      setProblem(null);
      onChange(department.id, result.existed ? undefined : department);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(options - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && open) {
      // Enter chooses; it never submits the whole finding from here.
      event.preventDefault();
      const highlighted = matches[active];
      if (highlighted) choose(highlighted);
      else if (offerAdd) add();
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="esh-combobox">
      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options > 0 ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid ? 'true' : undefined}
        placeholder="Search departments"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
          setProblem(null);
          // Typing over a choice un-chooses it: what is in the box is the answer.
          if (value) onChange('');
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // A name typed exactly as an existing department is that department.
          if (proposal?.kind === 'exists') choose(proposal.department);
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
      />
      <input type="hidden" name={name} value={value} />
      {open && options > 0 && (
        <ul id={listId} role="listbox" className="esh-combobox-list">
          {matches.map((department, index) => (
            <li
              key={department.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={department.id === value}
              data-active={index === active || undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(department);
              }}
            >
              {department.name}
            </li>
          ))}
          {offerAdd && (
            <li
              id={`${listId}-${matches.length}`}
              role="option"
              aria-selected={false}
              className="esh-combobox-add"
              data-active={active === matches.length || undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                add();
              }}
            >
              {proposal?.kind === 'similar' && (
                <small>Similar department exists: {proposal.department.name}</small>
              )}
              <span>{adding ? 'Adding…' : `+ Add “${typed}”`}</span>
            </li>
          )}
        </ul>
      )}
      {proposal?.kind === 'exists' && !showingChosen && (
        <p className="form-hint" role="status">
          {proposal.department.name} already exists —{' '}
          <button
            type="button"
            className="esh-inline-link"
            onClick={() => choose(proposal.department)}
          >
            choose it
          </button>
        </p>
      )}
      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

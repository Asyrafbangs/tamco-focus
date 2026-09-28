'use client';

import { useId, useMemo, useRef, useState, useTransition } from 'react';

import {
  matchingDepartments,
  similarDepartments,
  suggestDepartmentCode,
} from '@/domain/department-names';
import { addDepartment } from '@/server/esh/department-actions';

export interface DepartmentOption {
  id: string;
  name: string;
}

/**
 * Choosing the accountable department by typing, and adding one that is not
 * there (v225, §7).
 *
 * A select with thirty departments in it is read by scrolling, and a select
 * with the right department missing is a dead end: the only way on was to
 * abandon a half-written finding, find Organisation under administration,
 * create it, and start again. Both were reported.
 *
 * Adding is administrator-only, because it is the same `create_department` that
 * shared administration calls and it carries the same authority. For everybody
 * else the list is the list, and it says who to ask. Before anything is
 * created, near-matches are shown: a register split between Maintenance and
 * Maintainance is far harder to undo than to avoid.
 */
export function DepartmentChooser({
  departments,
  value,
  onChange,
  canAdd,
  inputProps,
}: {
  departments: DepartmentOption[];
  value: string;
  onChange: (id: string) => void;
  canAdd: boolean;
  inputProps: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: 'true' };
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState<DepartmentOption[]>([]);
  const listId = useId();
  const addingRef = useRef<HTMLInputElement | null>(null);

  /*
   * The server's list, plus anything added here that it has not caught up with.
   *
   * Held this way round rather than as a copy of the prop: a department created
   * from this form has to be selectable and named on screen at once, and the
   * page it was created from revalidates a moment later. A copy would either
   * lose the new one or go stale against the server's.
   */
  const known = useMemo(() => {
    const byId = new Map(departments.map((department) => [department.id, department]));
    for (const one of added) if (!byId.has(one.id)) byId.set(one.id, one);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [departments, added]);
  const chosen = known.find((department) => department.id === value) ?? null;

  const matches = matchingDepartments(query, known);
  const typed = query.trim();
  const near = adding ? similarDepartments(typed, known) : [];
  const exact = known.some(
    (department) => department.name.trim().toLowerCase() === typed.toLowerCase(),
  );

  function choose(department: DepartmentOption) {
    onChange(department.id);
    setQuery('');
    setOpen(false);
    setAdding(false);
    setProblem(null);
  }

  function startAdding() {
    setAdding(true);
    setCode(suggestDepartmentCode(typed));
    setProblem(null);
    // The panel replaces the list, so the caret has to follow it.
    window.setTimeout(() => addingRef.current?.focus(), 0);
  }

  return (
    <div className="esh-combobox">
      {/*
        The hidden field is what the form submits. The visible input holds a
        search, never an id, so a half-typed department cannot be submitted as
        though it had been chosen.
      */}
      <input type="hidden" name="accountable_department_id" value={value} />
      <input
        {...inputProps}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        /*
         * Only while the list exists. Pointed at an id that is not on the page,
         * `aria-controls` is an invalid attribute value, which axe reports as a
         * serious violation on every render where the box is shut — which is
         * nearly all of them.
         */
        aria-controls={open && !adding ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        placeholder={chosen ? chosen.name : 'Type to find a department'}
        value={open ? query : (chosen?.name ?? '')}
        onFocus={() => {
          setQuery('');
          setOpen(true);
          setActive(0);
        }}
        onBlur={(event) => {
          // Not while the caret is somewhere inside this control: the add panel
          // and the options are both in here, and closing on the way to them
          // would take them with it.
          if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) return;
          setOpen(false);
          setAdding(false);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
          setAdding(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActive((current) => {
              const step = event.key === 'ArrowDown' ? 1 : -1;
              const next = current + step;
              if (matches.length === 0) return 0;
              return (next + matches.length) % matches.length;
            });
            return;
          }
          if (event.key === 'Enter' && open) {
            const pick = matches[active];
            if (pick) {
              event.preventDefault();
              choose(pick);
            }
            return;
          }
          if (event.key === 'Escape') {
            setOpen(false);
            setAdding(false);
          }
        }}
      />

      {/*
        The listbox holds options and nothing else. A note and a button put
        inside it as presentational rows break the listbox's required children,
        so they sit beside it and the popup is the box around both.
      */}
      {open && !adding && (
        <div className="esh-combobox-pop">
          <ul className="esh-combobox-list" id={listId} role="listbox">
            {matches.map((department, index) => (
              <li
                key={department.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={department.id === value}
                data-active={index === active ? 'true' : undefined}
                // Not onClick: the input's blur would fire first and close the
                // list out from under the press.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(department);
                }}
              >
                {department.name}
              </li>
            ))}
          </ul>
          {matches.length === 0 && (
            <p className="esh-combobox-empty">
              No department matches “{typed}”.
              {!canAdd && ' An administrator can add it under Identity and access.'}
            </p>
          )}
          {canAdd && typed.length >= 2 && !exact && (
            <button
              type="button"
              className="esh-combobox-add"
              /*
               * preventDefault, or focus moves to this button — and opening the
               * panel unmounts the button in the same tick, so focus lands on
               * the body instead, the input's blur sees no related target
               * inside this control, and the panel closes the instant it opens.
               * Keeping focus on the input avoids the race rather than racing.
               */
              onMouseDown={(event) => {
                event.preventDefault();
                startAdding();
              }}
            >
              + Add “{typed}”
            </button>
          )}
        </div>
      )}

      {adding && (
        <div className="esh-combobox-panel">
          {near.length > 0 && (
            <div className="notice compact" role="status">
              <strong>
                {near.length === 1 ? 'This already exists' : 'These already exist'}, or nearly:
              </strong>
              <ul>
                {near.map((department) => (
                  <li key={department.id}>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => choose(department)}
                    >
                      Use {department.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="esh-field" htmlFor={`${listId}-code`}>
            <span>Short code for “{typed}”</span>
          </label>
          <input
            ref={addingRef}
            id={`${listId}-code`}
            value={code}
            maxLength={32}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setProblem(null);
            }}
          />
          {problem && (
            <p className="esh-field-error" role="alert">
              {problem}
            </p>
          )}
          <div className="esh-form-actions">
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                setAdding(false);
                setProblem(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn small primary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const answer = await addDepartment({ name: typed, code });
                  if (!answer.ok || !answer.department) {
                    setProblem(answer.message);
                    return;
                  }
                  setAdded((current) => [...current, answer.department!]);
                  choose(answer.department);
                })
              }
            >
              {pending ? 'Adding…' : 'Add department'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

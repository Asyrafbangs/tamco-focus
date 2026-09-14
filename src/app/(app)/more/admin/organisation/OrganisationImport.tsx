'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import {
  emptyOrganisationImport,
  summariseProblems,
  type OrganisationImportField,
  type OrganisationImportState,
} from '@/domain/organisation-import';
import { organisationImportAction } from '@/server/actions/organisation-import-actions';

/**
 * Import organisation (v174): a file checked before anything is written.
 *
 * Three states, one panel. Choosing a file writes nothing. Checking it shows
 * what each row would do — how many would change somebody, how many already
 * match, and what is wrong with the rest, counted in words and then listed by
 * row so the spreadsheet can be fixed. Applying writes only the rows that
 * passed, and says how many it wrote.
 *
 * There is no progress bar and no partial success. The apply is one
 * transaction: every change the check promised, or none.
 */

const FIELD_LABELS: Record<OrganisationImportField, string> = {
  department: 'Department',
  job_title: 'Job title',
  manager: 'Manager',
  dotted_line: 'Dotted line',
};

function plural(count: number, singular: string, many: string) {
  return `${count} ${count === 1 ? singular : many}`;
}

export function OrganisationImport({
  cancelHref,
  exportHref,
}: {
  cancelHref: string;
  exportHref: string;
}) {
  const [state, action, pending] = useActionState(
    organisationImportAction,
    emptyOrganisationImport(),
  );

  return (
    <section className="org-move-panel org-import" aria-labelledby="org-import-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Import</p>
          <h2 id="org-import-heading">Import organisation</h2>
        </div>
      </div>

      {state.stage === 'applied' ? (
        <>
          <p className="notice success" role="status">
            {state.message}
          </p>
          <div className="org-move-actions">
            <Link className="btn small ghost" href={cancelHref}>
              Done
            </Link>
          </div>
        </>
      ) : state.stage === 'checked' ? (
        <CheckedFile state={state} action={action} pending={pending} cancelHref={cancelHref} />
      ) : (
        <form action={action} className="settings-form">
          <p className="sub org-move-note">
            An Excel workbook (.xlsx) or CSV file with one row per person, found by{' '}
            <code>employee_id</code>. Only the first sheet is read. It can set{' '}
            <code>department_code</code>, <code>job_title</code>, <code>manager_employee_id</code>{' '}
            and <code>functional_manager_employee_id</code>. <code>name</code> and{' '}
            <code>email</code> are checked against the Directory and never changed. A column the
            file leaves out is left alone; an empty cell means none.
          </p>
          <p className="sub org-move-note">
            To start from what is recorded now, download it, change it in a spreadsheet, and bring
            it back. Nothing is written until you have seen what the file would do.
          </p>
          <div className="org-move-actions">
            <a className="btn small" href={exportHref}>
              Download current organisation (CSV)
            </a>
          </div>
          <div className="form-grid">
            <label>
              <span>Excel or CSV file</span>
              <input
                type="file"
                name="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
              />
            </label>
          </div>

          {state.message && (
            <p className="notice error" role="status">
              {state.message}
            </p>
          )}

          <div className="org-move-actions">
            <button
              className="btn primary"
              type="submit"
              name="intent"
              value="check"
              disabled={pending}
            >
              {pending ? 'Checking…' : 'Check file'}
            </button>
            <Link className="btn small ghost" href={cancelHref}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}

function CheckedFile({
  state,
  action,
  pending,
  cancelHref,
}: {
  state: OrganisationImportState;
  action: (formData: FormData) => void;
  pending: boolean;
  cancelHref: string;
}) {
  const { counts, verdicts } = state;
  const problems = verdicts.filter((verdict) => verdict.status === 'problem');
  const changes = verdicts.filter((verdict) => verdict.status === 'change');
  const summary = summariseProblems(problems);

  return (
    <>
      <p className="sub org-move-note">Checked {state.fileName}. Nothing has been written yet.</p>

      <ul className="org-import-counts" aria-label="What the file would do">
        <li>
          <strong>{counts.change}</strong> ready to change
        </li>
        <li>
          <strong>{counts.unchanged}</strong> already {counts.unchanged === 1 ? 'matches' : 'match'}
        </li>
        <li data-tone={counts.problem > 0 ? 'warning' : undefined}>
          <strong>{counts.problem}</strong> cannot be applied
        </li>
      </ul>

      {state.ignoredColumns.length > 0 && (
        <p className="sub org-move-note">
          Not read, because this import does not use them: {state.ignoredColumns.join(', ')}.
        </p>
      )}

      {problems.length > 0 && (
        <div className="org-import-problems">
          <h3>What to fix in the file</h3>
          <ul className="org-import-kinds">
            {summary.map((kind) => (
              <li key={kind.code}>{kind.label}</li>
            ))}
          </ul>
          {/*
            A list rather than a table. As a table it was wider than a phone, so
            the sentence saying what was wrong — the one column that matters —
            sat off the edge behind a sideways scroll. Each row now says where it
            is and then what is wrong with it, side by side where there is room
            and one above the other where there is not.
          */}
          <ul className="org-import-problem-list" aria-label="Rows that cannot be applied">
            {problems.map((verdict) => (
              <li key={verdict.line}>
                <span className="org-import-where">
                  <strong>Row {verdict.line}</strong>
                  <span className="sub">
                    {[verdict.employeeId, verdict.name].filter(Boolean).join(' · ') ||
                      'No employee ID'}
                  </span>
                </span>
                <span>{verdict.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {changes.length > 0 && (
        <details className="org-import-changes">
          <summary>Show the {plural(changes.length, 'change', 'changes')}</summary>
          <ul>
            {changes.map((verdict) => (
              <li key={verdict.line}>
                <strong>{verdict.name}</strong> <span className="sub">{verdict.employeeId}</span>
                {verdict.changes.map((change) => (
                  <span key={change.field} className="sub">
                    {FIELD_LABELS[change.field]}: {change.from ?? 'None'} → {change.to ?? 'None'}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}

      <form action={action} className="settings-form">
        <input type="hidden" name="rows" value={state.rows} />
        <input type="hidden" name="fileName" value={state.fileName} />
        <input type="hidden" name="ignoredColumns" value={state.ignoredColumns.join('\n')} />
        <input type="hidden" name="expected" value={counts.change} />

        {counts.change > 0 ? (
          <>
            <div className="form-grid">
              <label>
                <span>Effective date</span>
                {/* Left blank means today, in the organisation's calendar. */}
                <input type="date" name="effectiveDate" />
              </label>
              <label>
                <span>Reason (optional)</span>
                <input name="reason" maxLength={400} placeholder="Reorganisation, initial setup…" />
              </label>
            </div>
            {problems.length > 0 && (
              <p className="sub org-move-note">
                The {plural(problems.length, 'row', 'rows')} that cannot be applied will be left
                out. Fix them in the file and import it again.
              </p>
            )}
          </>
        ) : (
          <p className="notice" role="status">
            Nothing in this file would change anybody.
          </p>
        )}

        {state.message && (
          <p className={state.ok ? 'notice success' : 'notice error'} role="status">
            {state.message}
          </p>
        )}

        <div className="org-move-actions">
          {counts.change > 0 && (
            <button
              className="btn primary"
              type="submit"
              name="intent"
              value="apply"
              disabled={pending}
            >
              {pending ? 'Applying…' : `Apply ${plural(counts.change, 'change', 'changes')}`}
            </button>
          )}
          <button
            className="btn small"
            type="submit"
            name="intent"
            value="reset"
            formNoValidate
            disabled={pending}
          >
            Choose another file
          </button>
          <Link className="btn small ghost" href={cancelHref}>
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}

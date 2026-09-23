'use client';

import { useActionState, useState, useTransition } from 'react';

import type { ReportDefinitionSummary } from '@/domain/esh-reports';
import {
  previewReport,
  saveReportDefinition,
  type ReportFormState,
  type ReportPreview,
} from '@/server/esh/report-actions';
import type { DepartmentOption } from '@/server/esh/queries';

const INITIAL: ReportFormState = { ok: false, message: '' };
const WEEK = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DAYS = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
] as const;

function ReportEditor({
  report,
  departments,
}: {
  report: ReportDefinitionSummary | null;
  departments: DepartmentOption[];
}) {
  const [state, action, pending] = useActionState(saveReportDefinition, INITIAL);
  const [wide, setWide] = useState(report?.organizationWide ?? false);
  // §34.1 asks for a preview and a recipient/scope confirmation before a report
  // is activated. This sends nothing and captures nothing: it is a look at what
  // the letter would say, so nobody turns on a weekly email to real leadership
  // without having seen its audience and its numbers first.
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [previewing, startPreview] = useTransition();
  return (
    <form action={action} className="esh-policy-form">
      {report && <input type="hidden" name="id" value={report.id} />}
      {state.message && (
        <div className={`notice ${state.ok ? 'success' : 'error'} compact`} role="status">
          <strong>{state.message}</strong>
        </div>
      )}
      <section className="esh-form-card" aria-labelledby={`report-${report?.id ?? 'new'}`}>
        <h3 id={`report-${report?.id ?? 'new'}`} className="esh-form-card-title">
          {report?.name ?? 'New weekly report'}
        </h3>
        <div className="form-grid two">
          <label className="esh-field">
            <span>Report name</span>
            <input name="name" required maxLength={120} defaultValue={report?.name ?? ''} />
          </label>
          <label className="esh-field">
            <span>Status</span>
            <select name="state" defaultValue={report?.state ?? 'draft'}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <label className="esh-field">
            <span>Send day</span>
            <select name="schedule_isodow" defaultValue={report?.scheduleIsoDay ?? 1}>
              {DAYS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="esh-field">
            <span>Send time</span>
            <input
              name="schedule_local_time"
              type="time"
              required
              defaultValue={report?.scheduleLocalTime ?? '08:30'}
            />
          </label>
          <label className="esh-field">
            <span>Timezone</span>
            <input
              name="timezone"
              required
              defaultValue={report?.timezone ?? 'Asia/Kuala_Lumpur'}
            />
          </label>
          <label className="esh-field">
            <span>Recipients</span>
            <textarea
              name="recipient_emails"
              rows={4}
              defaultValue={(report?.recipients ?? [])
                .filter((recipient) => recipient.enabled)
                .map((recipient) => recipient.email)
                .join('\n')}
              placeholder="one.address@tamco.com.my"
            />
            <small>One address per line. Every recipient receives an individual secure link.</small>
          </label>
        </div>
        <fieldset className="esh-report-scope">
          <legend>Department scope</legend>
          <label className="check-row">
            <input
              name="organization_wide"
              type="checkbox"
              checked={wide}
              onChange={(event) => setWide(event.target.checked)}
            />
            <span>Whole organisation</span>
          </label>
          <label className="check-row">
            <input
              name="include_descendants"
              type="checkbox"
              defaultChecked={report?.includeDescendants ?? true}
            />
            <span>Include child departments</span>
          </label>
          <div className="esh-report-departments" aria-disabled={wide}>
            {departments.map((department) => (
              <label className="check-row" key={department.id}>
                <input
                  name="department_ids"
                  type="checkbox"
                  value={department.id}
                  disabled={wide}
                  defaultChecked={report?.departmentIds.includes(department.id)}
                />
                <span>{department.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {report?.latestRun && (
          <div className="notice neutral compact">
            <strong>Latest snapshot</strong>
            <p>
              {report.latestRun.open} open · {report.latestRun.overdue} overdue ·{' '}
              {report.latestRun.awaiting} awaiting review · {report.latestRun.closed} closed
            </p>
          </div>
        )}
        <div className="esh-form-actions">
          <span className="form-hint">
            {report
              ? `Version ${report.version} · scope ${report.scopeVersion}`
              : 'Starts as Draft'}
          </span>
          {report && (
            <button
              className="btn"
              type="button"
              disabled={previewing}
              onClick={() =>
                startPreview(async () => {
                  setPreview(await previewReport({ definitionId: report.id }));
                })
              }
            >
              {previewing ? 'Reading…' : 'Preview'}
            </button>
          )}
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save report'}
          </button>
        </div>
        {preview && (
          <div className="esh-report-preview" role="status">
            {preview.ok && preview.data ? (
              <>
                <p>
                  <strong>Nothing was sent.</strong> Captured now, {preview.data.name} would say{' '}
                  {preview.data.counts.open} open, {preview.data.counts.overdue} overdue,{' '}
                  {preview.data.counts.awaiting} awaiting review, and {preview.data.counts.closed}{' '}
                  closed between {WEEK.format(new Date(preview.data.closedFrom))} and{' '}
                  {WEEK.format(new Date(preview.data.closedTo))}.
                </p>
                <p>
                  Departments in scope:{' '}
                  {preview.data.departments.length > 0
                    ? preview.data.departments.join(', ')
                    : 'none — nothing would be reported'}
                  .
                </p>
                <ul>
                  {preview.data.recipients.length === 0 && <li>No recipients yet.</li>}
                  {preview.data.recipients.map((recipient) => (
                    <li key={recipient.email}>
                      {recipient.email}
                      {!recipient.enabled && ' · switched off for this report'}
                      {recipient.enabled &&
                        !recipient.accessEnabled &&
                        ' · contact access is off, so their letter would be held'}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{preview.message ?? 'The preview could not be read.'}</p>
            )}
          </div>
        )}
      </section>
    </form>
  );
}

export function ReportSettingsForm({
  definitions,
  departments,
}: {
  definitions: ReportDefinitionSummary[];
  departments: DepartmentOption[];
}) {
  return (
    <section className="esh-policy-stack" aria-labelledby="weekly-reports-title">
      <div className="esh-section-heading">
        <div>
          <h2 id="weekly-reports-title">Weekly reports</h2>
          <p>Immutable weekly snapshots with individually authorised leadership links.</p>
        </div>
      </div>
      {definitions.map((report) => (
        <ReportEditor report={report} departments={departments} key={report.id} />
      ))}
      <ReportEditor report={null} departments={departments} />
    </section>
  );
}

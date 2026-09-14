import Link from 'next/link';

import { RecordRow, StatusBadge, WorkspaceTabs } from '@/components/ui/ParityPrimitives';
import { PeriodPicker } from '@/components/ui/PeriodPicker';
import { SubmitOnSelect } from '@/components/ui/SubmitOnSelect';
import { periodParams, RECORD_PERIODS, resolvePeriod } from '@/domain/period';
import { requireProfile } from '@/lib/supabase/server';
import { getCompletionRecords, type RecordFilters } from '@/server/queries';
import { taskDrawerHref } from '@/domain/navigation';

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Not recorded';

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    state?: string;
    review?: string;
    owner?: string;
    type?: string;
    attachment?: string;
    period?: string;
    period_from?: string;
    period_to?: string;
  }>;
}) {
  const params = await searchParams;
  const state = ['all', 'completed', 'cancelled'].includes(params.state ?? '')
    ? (params.state as RecordFilters['state'])
    : 'all';
  const review = ['all', 'pending', 'accepted', 'changes_requested', 'not_required'].includes(
    params.review ?? '',
  )
    ? (params.review as RecordFilters['review'])
    : 'all';
  const workClass = [
    'all',
    'major_project',
    'operational_action',
    'quick_action',
    'self_development',
    'routine_occurrence',
  ].includes(params.type ?? '')
    ? (params.type as RecordFilters['workClass'])
    : 'all';
  const attachment = ['all', 'with', 'without'].includes(params.attachment ?? '')
    ? (params.attachment as RecordFilters['attachment'])
    : 'all';
  /*
   * The profile first, because the period is read in the viewer's zone and the
   * query is bounded by the period. One request in front of the other rather
   * than a range that is eight hours out for everybody east of UTC.
   */
  const profile = await requireProfile();
  const period = resolvePeriod(
    params.period,
    params.period_from,
    params.period_to,
    new Date(),
    'all',
    profile.timezone,
  );
  const records = await getCompletionRecords({
    query: params.q,
    state,
    review,
    ownerId: params.owner,
    workClass,
    attachment,
    // Records is the archive, so its period defaults to all time rather than
    // to a recent window: finding one old record is why it exists.
    dateFrom: period.key === 'all' ? undefined : period.since.slice(0, 10),
    dateTo: period.until ? period.until.slice(0, 10) : undefined,
  });
  /* Everything except the period, so choosing one keeps the rest of the
     filter the reader already set. */
  const recordFilterParams = Object.fromEntries(
    Object.entries({
      q: params.q,
      owner: params.owner,
      type: params.type,
      attachment: params.attachment,
      state: params.state,
      review: params.review,
    }).filter(([, value]) => typeof value === 'string' && value.length > 0),
  ) as Record<string, string>;

  const ownerOptions = [
    ...new Map(
      records.map((record) => [record.task.primaryOwnerId, record.task.ownerName]),
    ).entries(),
  ];

  return (
    <>
      <div className="pagehead">
        <div>
          <Link href="/more" className="btn ghost small">
            ← More
          </Link>
          <p className="eyebrow">Records</p>
          <h1>Records and completion review</h1>
          <p>
            Search retained records and review completion evidence without changing normal task
            states.
          </p>
        </div>
      </div>
      <WorkspaceTabs
        label="Record workspace"
        items={
          profile.role === 'team_member'
            ? [
                { href: '/more/records', label: 'My Records', active: true, count: records.length },
                { href: '/more/attachments', label: 'My Attachments' },
                { href: '/more/audit', label: 'My Activity' },
              ]
            : [
                {
                  href: '/more/records?review=pending',
                  label: 'Completion Reviews',
                  active: review === 'pending',
                  count: records.filter((record) => record.task.reviewStatus === 'pending').length,
                },
                {
                  href: '/more/records',
                  label: 'All Records',
                  active: review !== 'pending',
                  count: records.length,
                },
                { href: '/more/attachments', label: 'Attachments' },
                { href: '/more/audit', label: 'Audit History' },
                { href: '/more/archive', label: 'Archive' },
              ]
        }
      />
      {/* Beside the filters rather than inside them: the period is the filter
          people change most, and burying it behind a disclosure meant Records
          was the one screen where you could not see what window you were
          looking at. */}
      <div className="record-period">
        <span className="muted">Closed</span>
        <PeriodPicker
          action="/more/records"
          hidden={recordFilterParams}
          presets={RECORD_PERIODS}
          period={period}
          ariaLabel="Change the period records are read over"
        />
      </div>

      <details className="record-filters">
        <summary>Filter records</summary>
        <form className="filterbar" role="search">
          {/* The period lives outside this form, in the control every other
              screen uses. Carried here so applying a filter does not silently
              reset it. */}
          {Object.entries(periodParams(period)).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <label>
            <span>Title or reference</span>
            <input name="q" defaultValue={params.q} placeholder="Search records" />
          </label>
          <label>
            <span>Owner</span>
            <select name="owner" defaultValue={params.owner ?? ''}>
              <option value="">All visible owners</option>
              {ownerOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Record type</span>
            <select name="type" defaultValue={workClass}>
              <option value="all">All types</option>
              <option value="major_project">Major Project</option>
              <option value="operational_action">Operational Action</option>
              <option value="quick_action">Quick Action</option>
              <option value="self_development">Self-Development</option>
              <option value="routine_occurrence">Routine occurrence</option>
            </select>
          </label>
          <label>
            <span>Attachment status</span>
            <select name="attachment" defaultValue={attachment}>
              <option value="all">Any attachment status</option>
              <option value="with">Has attachments</option>
              <option value="without">No attachments</option>
            </select>
          </label>
          <label>
            <span>State</span>
            <select name="state" defaultValue={state}>
              <option value="all">All states</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            <span>Review</span>
            <select name="review" defaultValue={review}>
              <option value="all">All outcomes</option>
              <option value="pending">Pending</option>
              <option value="accepted">Accepted</option>
              <option value="changes_requested">Changes requested</option>
              <option value="not_required">Not required</option>
            </select>
          </label>
          <button className="btn primary" type="submit">
            Apply
          </button>
          {/* A chosen option applies at once (v179); Apply stays for the text box. */}
          <SubmitOnSelect />
        </form>
      </details>

      <div className="record-list" aria-live="polite">
        {records.length === 0 ? (
          <div className="empty-state">
            <h2>No matching records</h2>
            <p>Adjust the search or filters.</p>
          </div>
        ) : (
          records.map(({ task, submittedAt, decidedAt, decision, decisionNote }) => (
            <RecordRow
              key={task.id}
              href={taskDrawerHref(task.id, '/more/records')}
              title={task.title}
              reference={`${task.ownerEmployeeId} · ${task.workClass.replaceAll('_', ' ')}`}
              owner={task.ownerName}
              timestamp={formatDate(task.completedAt ?? task.cancelledAt)}
              status={
                <>
                  <StatusBadge tone={task.status === 'cancelled' ? 'amber' : 'green'}>
                    {task.status}
                  </StatusBadge>
                  <StatusBadge>{task.reviewStatus.replaceAll('_', ' ')}</StatusBadge>
                </>
              }
              details={
                <>
                  <span>Submitted {formatDate(submittedAt)}</span>
                  <span>
                    {decision?.replaceAll('_', ' ') ?? task.reviewStatus.replaceAll('_', ' ')}
                  </span>
                  <span>{decidedAt ? `Decided ${formatDate(decidedAt)}` : 'Decision pending'}</span>
                  <span>
                    {task.attachmentCount} attachment{task.attachmentCount === 1 ? '' : 's'}
                  </span>
                  {decisionNote && (
                    <span>
                      <strong>Decision:</strong> {decisionNote}
                    </span>
                  )}
                </>
              }
            />
          ))
        )}
      </div>
    </>
  );
}

import Link from 'next/link';

import { HeldNoticesRelease } from '@/components/esh/HeldNoticesRelease';
import { OperationalHealth } from '@/components/esh/OperationalHealth';
import { PRIORITY_LABELS, type EshAccess } from '@/domain/esh-findings';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  getDashboard,
  getDepartmentsInScope,
  getOperationalHealth,
  getRolloutStatus,
  listRegister,
  listReportIntake,
  listVerificationQueue,
  ROLLOUT_NOT_ASKED,
  type RegisterListRow,
  type ReportIntakeRow,
  type VerificationQueueRow,
} from '@/server/esh/queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many submissions Today shows before sending the reader to the queue. */
const TODAY_PREVIEW = 6;

type Query = { queue?: string; department?: string };

/** Daily decisions belong here; historical measures remain in Patterns. */
export default async function FindingsTodayPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const query = await searchParams;
  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  /*
   * The verification queue is a view of Today rather than a page of its own
   * (v4.1 S1), so `/findings/verification` redirects here. It is the only
   * view that takes a department, because it is the only one with a control
   * for choosing one: a department in the address with no control to change
   * it would scope the rows while leaving the counters above them counting
   * the whole organisation, and a number that disagrees with its own list is
   * the failure this screen exists to prevent.
   */
  return query.queue === 'verification'
    ? await verificationQueue(access, query, timeZone)
    : await today(access, timeZone);
}

async function today(access: EshAccess, timeZone: string) {
  const now = new Date();
  const [dashboard, attention, verification, health, rollout, intake] = await Promise.all([
    getDashboard(),
    listRegister({
      filter: 'attention',
      search: '',
      departmentId: null,
      closedSince: now.toISOString(),
      closedUntil: null,
      page: 0,
    }),
    listVerificationQueue(),
    getOperationalHealth(),
    access.canCoordinate ? getRolloutStatus() : Promise.resolve(ROLLOUT_NOT_ASKED),
    /*
     * Only a coordinator may triage, and `/findings/intake` refuses anyone
     * else, so a reader without that authority is not given a counter and a
     * card leading somewhere they cannot go.
     */
    access.canCoordinate ? listReportIntake() : Promise.resolve(null),
  ]);

  /*
   * `null` where the dashboard could not be read, not nought.
   *
   * These two figures used to fall back to `?? 0`, so a failed read had Today
   * announce no unprotected significant risks and no overdue actions — the
   * most reassuring thing this screen can say, said on no evidence, directly
   * above a queue panel that does admit when it could not be read.
   *
   * The third is different and keeps its fallback: the verification queue is
   * its own read, and it now throws rather than coming back empty, so its
   * length is a figure somebody counted either way.
   */
  const protection = dashboard.failed ? null : (dashboard.data?.protection.unprotected ?? 0);
  const overdue = dashboard.failed ? null : (dashboard.data?.overdueActions ?? 0);
  const awaiting = dashboard.data?.awaitingVerification ?? verification.length;
  const incoming = intake?.rows ?? [];

  return (
    <>
      <div className="pagehead esh-today-head">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Today</h1>
          <p>What needs a decision now, and who owes the next move.</p>
        </div>
        {access.canCoordinate && (
          <Link className="btn primary" href="/findings/new">
            + New finding
          </Link>
        )}
      </div>

      {/*
       * Four obligations, each counted once, each with a list holding exactly
       * what the number says. Every destination is a named register view
       * rather than a search that merely looks close: the protection figure
       * used to link to every open finding, so a reader who clicked three
       * arrived at forty rows with no way to tell which three were meant.
       */}
      <section className="esh-signals esh-today-signals" aria-label="Today’s queues">
        {intake && !intake.failed ? (
          <Signal
            label="New reports"
            value={incoming.length}
            detail="Private reports waiting for triage"
            href="/findings/intake"
            exception={incoming.length > 0}
          />
        ) : (
          <Signal
            label="New reports"
            value={null}
            detail={
              intake ? 'The intake queue could not be read' : 'Triage needs coordinator access'
            }
            disabled
          />
        )}
        <Signal
          label="Significant risks without verified protection"
          value={protection}
          detail={
            protection === null
              ? 'The figures could not be read'
              : 'Open, high or critical, nothing verified in place'
          }
          href={protection === null ? undefined : '/findings/register?filter=unprotected'}
          exception={protection !== null && protection > 0}
          disabled={protection === null}
        />
        <Signal
          label="Overdue owner actions"
          value={overdue}
          detail={
            overdue === null ? 'The figures could not be read' : 'Owner action past its due date'
          }
          href={overdue === null ? undefined : '/findings/register?filter=overdue'}
          exception={overdue !== null && overdue > 0}
          disabled={overdue === null}
        />
        <Signal
          label="Waiting for ESH verification"
          value={awaiting}
          detail="Submitted proof needs a decision"
          href="/findings?queue=verification"
          exception={awaiting > 0}
        />
      </section>

      <OperationalHealth health={health.data} failed={health.failed} />
      {rollout.data && <HeldNoticesRelease releasable={rollout.data.heldReleasable} />}

      <section className="esh-today-queue" aria-labelledby="today-queue-title">
        <div className="esh-section-head">
          <div>
            <h2 id="today-queue-title">Needs attention</h2>
            <p>One row per finding. The reason labels identify the current work.</p>
          </div>
          <Link href="/findings/register?filter=attention">Open all</Link>
        </div>
        {attention.failed ? (
          <div className="notice error" role="alert">
            <strong>The queue could not be read</strong>
            <p>No rows are shown rather than a list that might be incomplete.</p>
          </div>
        ) : attention.rows.length === 0 ? (
          <QueueEmpty
            title="No items need attention"
            detail="No open finding currently needs an ESH decision."
          />
        ) : (
          <ul className="esh-today-list" aria-label="Needs attention">
            {attention.rows.map((row) => (
              <AttentionRow key={row.actionId ?? row.findingId} row={row} />
            ))}
          </ul>
        )}
      </section>

      <div className="esh-today-columns">
        <section className="esh-form-card" aria-labelledby="today-verification-title">
          <div className="esh-section-head">
            <div>
              <h2 id="today-verification-title">To verify</h2>
              <p>Owner submissions, oldest first.</p>
            </div>
            <Link href="/findings?queue=verification">Open queue</Link>
          </div>
          {verification.length === 0 ? (
            <QueueEmpty
              title="No actions waiting for verification"
              detail="Submitted work will appear here when ESH has the next move."
            />
          ) : (
            <>
              <ul className="esh-today-list">
                {verification.slice(0, TODAY_PREVIEW).map((row) => (
                  <VerificationRow key={row.submissionId} row={row} timeZone={timeZone} />
                ))}
              </ul>
              {/*
               * Six rows is a preview, so the card says how many there are.
               * Showing six of eleven and saying nothing about it read as a
               * complete queue.
               */}
              {verification.length > TODAY_PREVIEW && (
                <p className="esh-register-foot">
                  <Link href="/findings?queue=verification">
                    {verification.length} waiting · see them all
                  </Link>
                </p>
              )}
            </>
          )}
        </section>
        <section className="esh-form-card" aria-labelledby="today-incoming-title">
          <div className="esh-section-head">
            <div>
              <h2 id="today-incoming-title">Incoming reports</h2>
              <p>Reports recorded by ESH. Public QR reporting is not enabled.</p>
            </div>
            {intake && !intake.failed && <Link href="/findings/intake">Open queue</Link>}
          </div>
          {!intake ? (
            <QueueEmpty
              title="Triage needs coordinator access"
              detail="A report is triaged by a coordinator for the department it came from."
            />
          ) : intake.failed ? (
            <div className="notice error" role="alert">
              <strong>The intake queue could not be read</strong>
              <p>No rows are shown rather than a list that might be incomplete.</p>
            </div>
          ) : incoming.length === 0 ? (
            <QueueEmpty
              title="No reports need triage"
              detail="A report recorded here is not a Finding until a coordinator reviews it."
            />
          ) : (
            <>
              <ul className="esh-today-list">
                {incoming.slice(0, TODAY_PREVIEW).map((row) => (
                  <IntakeRow key={row.id} row={row} timeZone={timeZone} />
                ))}
              </ul>
              {incoming.length > TODAY_PREVIEW && (
                <p className="esh-register-foot">
                  <Link href="/findings/intake">{incoming.length} waiting · see them all</Link>
                </p>
              )}
            </>
          )}
        </section>
        <section className="esh-form-card" aria-labelledby="today-escalations-title">
          <div className="esh-section-head">
            <div>
              <h2 id="today-escalations-title">Escalations</h2>
              <p>Delivery failures and overdue work remain with the affected finding.</p>
            </div>
            <Link href="/findings/register?filter=attention">Review</Link>
          </div>
          <QueueEmpty
            title="No separate escalation queue"
            detail="Keeping escalation with the finding preserves the owner, protection and due-date context."
          />
        </section>
      </div>
    </>
  );
}

/**
 * Everything waiting for ESH, oldest submission first (§13, §24).
 *
 * The whole queue, not a page of it. Nothing here is reachable another way,
 * so a row left off the screen is a correction nobody ever looks at.
 */
async function verificationQueue(access: EshAccess, query: Query, timeZone: string) {
  const departmentUnassigned = query.department === 'unassigned';
  const departmentId = query.department && UUID.test(query.department) ? query.department : null;
  const [rows, departments] = await Promise.all([
    listVerificationQueue(departmentId, departmentUnassigned),
    getDepartmentsInScope(access),
  ]);
  const when = (instant: string) =>
    new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
      new Date(instant),
    );

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>To verify</h1>
          <p>Corrections submitted for ESH to check, oldest first.</p>
        </div>
      </div>

      <form className="filterbar esh-register-search" action="/findings">
        <input type="hidden" name="queue" value="verification" />
        <label>
          <span>Department</span>
          <select
            name="department"
            defaultValue={departmentUnassigned ? 'unassigned' : (departmentId ?? '')}
          >
            <option value="">All departments in your scope</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <button className="btn small" type="submit">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="guest-empty">Nothing is waiting for verification.</p>
      ) : (
        <ul className="esh-register" aria-label="Waiting for verification">
          {rows.map((row) => (
            <li key={row.submissionId}>
              <Link
                href={`/findings/${row.findingId}?action=${row.actionId}`}
                className="esh-register-row"
              >
                <span className="esh-register-finding">
                  <small>
                    {[row.reference, row.location ?? row.departmentName]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  <strong>{row.title}</strong>
                  <small>
                    Submitted by {row.ownerEmail} · {when(row.submittedAt)}
                  </small>
                </span>
                <span className="esh-register-owner">
                  <small>Version {row.version}</small>
                  <span>
                    {row.files} file{row.files === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="esh-register-status">
                  <span className="flag neutral">Awaiting ESH review</span>
                  {row.priority && row.priority !== 'normal' && (
                    <small className="esh-priority" data-priority={row.priority}>
                      {PRIORITY_LABELS[row.priority]} priority
                    </small>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="esh-register-foot">
        {rows.length} waiting · A Verifier who submitted the work cannot verify it themselves.
      </p>
    </>
  );
}

function Signal({
  label,
  value,
  detail,
  href,
  exception = false,
  disabled = false,
}: {
  label: string;
  value: number | null;
  detail: string;
  href?: string;
  exception?: boolean;
  disabled?: boolean;
}) {
  const content = (
    <>
      <span>{label}</span>
      {/*
       * A figure nobody could count is shown as a dash, not as nought. The
       * detail line beneath says why; a zero would read as the answer.
       */}
      <strong>{value === null ? '—' : value}</strong>
      <small>{detail}</small>
    </>
  );
  return href ? (
    <Link className="esh-signal" data-exception={exception || undefined} href={href}>
      {content}
    </Link>
  ) : (
    <div className="esh-signal" data-disabled={disabled || undefined}>
      {content}
    </div>
  );
}

function AttentionRow({ row }: { row: RegisterListRow }) {
  const reasons = [
    row.isOverdue && 'Overdue owner action',
    row.actionState === 'awaiting_verification' && 'Waiting for ESH verification',
    row.notificationFailed && 'Notification needs attention',
    row.changesRequested && 'Owner needs to improve proof',
  ].filter((value): value is string => Boolean(value));
  const href = row.actionId
    ? `/findings/${row.findingId}?action=${row.actionId}`
    : `/findings/${row.findingId}`;
  return (
    <li>
      <Link href={href}>
        <span className="esh-today-row-main">
          <strong>{row.reference}</strong>
          <b>{row.title}</b>
          <small>{[row.location, row.departmentName].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="esh-today-row-reasons">
          {reasons.map((reason) => (
            <small key={reason}>{reason}</small>
          ))}
        </span>
      </Link>
    </li>
  );
}

function VerificationRow({ row, timeZone }: { row: VerificationQueueRow; timeZone: string }) {
  const submitted = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(row.submittedAt));
  return (
    <li className="esh-register-row">
      <Link href={`/findings/${row.findingId}?action=${row.actionId}`}>
        <span className="esh-today-row-main">
          <strong>{row.reference}</strong>
          <b>{row.title}</b>
          <small>
            {[row.location, `Submitted ${submitted}`, `Version ${row.version}`, row.ownerEmail]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </span>
      </Link>
    </li>
  );
}

/**
 * A private report has no reference and no title yet — it is somebody's
 * sentence about what they saw — so the row shows the beginning of it and
 * leaves the rest to the queue.
 */
function IntakeRow({ row, timeZone }: { row: ReportIntakeRow; timeZone: string }) {
  const received = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(row.receivedAt));
  const flat = row.reportText.replace(/\s+/g, ' ').trim();
  return (
    <li className="esh-register-row">
      <Link href="/findings/intake">
        <span className="esh-today-row-main">
          <b>{flat.length <= 90 ? flat : `${flat.slice(0, 89).trimEnd()}…`}</b>
          <small>
            {[
              row.reportedLocation,
              `Received ${received}`,
              row.status === 'new' ? 'Needs triage' : 'Being triaged',
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </span>
      </Link>
    </li>
  );
}

function QueueEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state compact">
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

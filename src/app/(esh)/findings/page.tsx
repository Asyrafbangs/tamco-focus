import Link from 'next/link';

import { HeldNoticesRelease } from '@/components/esh/HeldNoticesRelease';
import { OperationalHealth } from '@/components/esh/OperationalHealth';
import { daysOverdue, PRIORITY_LABELS, type EshAccess } from '@/domain/esh-findings';
import { reportingWords } from '@/domain/esh-intake';
import {
  exposureWords,
  rankExposure,
  todayStages,
  type Exposure,
  type Stage,
} from '@/domain/esh-today';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  getDashboard,
  getDepartmentsInScope,
  getOperationalHealth,
  getQrIntakeStatus,
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
  /*
   * v303 - the register read twice more, for the two things the board could
   * only state as bare numbers.
   *
   * Both are ordered by `due_at` ascending with nulls last, so the first page
   * holds the longest overdue: the age this board prints is the real maximum
   * and not the maximum of a page. They go in the same `Promise.all` as the
   * rest, because a board that reads nine things in sequence is a board
   * somebody waits for.
   */
  const page0 = { search: '', departmentId: null, closedUntil: null, page: 0 } as const;
  const [dashboard, attention, verification, health, rollout, intake, qrIntake, exposed, pastDue] =
    await Promise.all([
      getDashboard(),
      listRegister({ filter: 'attention', closedSince: now.toISOString(), ...page0 }),
      listVerificationQueue(),
      getOperationalHealth(),
      access.canCoordinate ? getRolloutStatus() : Promise.resolve(ROLLOUT_NOT_ASKED),
      /*
       * Only a coordinator may triage, and `/findings/intake` refuses anyone
       * else, so a reader without that authority is not given a counter and a
       * card leading somewhere they cannot go.
       */
      access.canCoordinate ? listReportIntake() : Promise.resolve(null),
      getQrIntakeStatus(),
      listRegister({ filter: 'unprotected', closedSince: now.toISOString(), ...page0 }),
      listRegister({ filter: 'overdue', closedSince: now.toISOString(), ...page0 }),
    ]);

  /*
   * v291 - null, not nought, when the figures could not be read.
   *
   * These two are the module's front page: significant risks with nothing
   * verified protecting people, and owner actions past their date. A failed
   * dashboard read used to render both as 0 - the safest-looking screen in the
   * module, produced by knowing nothing at all. It is the shape v282, v283 and
   * v290 closed on the access read, the finding detail and the review queue,
   * left on the two numbers somebody glances at to decide the day is quiet.
   *
   * `awaiting` keeps its fallback, because that one is a real read: the
   * verification queue refuses a failed read rather than answering empty.
   */
  const protection = dashboard.failed ? null : (dashboard.data?.protection.unprotected ?? 0);
  /*
   * v301 - a hazard nobody has rated is in none of the figures above it.
   *
   * `protection` counts High and Critical, so a finding recorded as Not
   * assessed is absent from the one number on this page that answers whether
   * anybody is exposed. The risk level is optional when a finding is written -
   * `risk_invalid` offers "Choose a risk level, or Not assessed" - so the gap
   * is reachable from the ordinary path, not only from an import.
   *
   * It is not a second count of exposure. It is how much of the first count is
   * unknown, which is why it reads as a note on that figure rather than as a
   * fifth number competing with it.
   */
  const unassessed = dashboard.failed ? null : (dashboard.data?.protection.unassessed ?? 0);
  const overdue = dashboard.failed ? null : (dashboard.data?.overdueActions ?? 0);
  const awaiting = dashboard.data?.awaitingVerification ?? verification.length;
  const incoming = intake?.rows ?? [];

  /*
   * v303 - what the board leads with, and the ages under each queue.
   *
   * The counters this replaces answered "how many". Nobody opens this screen
   * to find that out: they open it to learn whether anybody is working
   * unprotected, and whose desk the rest is sitting on. A failed read stays
   * `null` all the way through `todayStages`, so a stage that could not be
   * read says so instead of claiming to be empty.
   */
  const exposures = exposed.failed
    ? []
    : rankExposure(
        exposed.rows.map((row) => ({
          findingId: row.findingId,
          actionId: row.actionId,
          reference: row.reference,
          title: row.title,
          riskLevel: row.riskLevel,
          departmentName: row.departmentName,
          location: row.location,
          dueAt: row.dueAt,
          isOverdue: row.isOverdue,
        })),
        timeZone,
        now,
      );
  const stages = todayStages({
    /*
     * A reader who may not triage gets no tile at all, rather than a nought
     * for work they are not allowed to see (§43.3). A reader who may, but
     * whose read failed, gets the tile with no figure in it.
     */
    triage: intake
      ? {
          total: intake.failed ? null : intake.total,
          oldest: intake.failed ? null : earliest(incoming.map((row) => row.receivedAt)),
        }
      : null,
    pastDue: { total: overdue, oldest: earliest(pastDue.rows.map((row) => row.dueAt)) },
    checking: { total: awaiting, oldest: earliest(verification.map((row) => row.submittedAt)) },
    openTotal: dashboard.failed ? null : (dashboard.data?.openFindings ?? 0),
    oldestOpenDays: dashboard.failed ? null : (dashboard.data?.oldestOpenDays ?? null),
    timeZone,
    now,
  });

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
      {/*
       * v303 - the board leads with who is unprotected, by name.
       *
       * "Significant risks without verified protection: 1" is a count of
       * something nobody can act on without clicking, and because the same
       * finding is usually the overdue one as well, a single problem read as
       * two numbers out of four. The figure keeps its own link, so the rule
       * that every counter lands on a list holding exactly it still holds -
       * but it now sits with the findings it counts instead of beside them.
       */}
      <ExposureBand
        value={protection}
        exposures={exposures}
        total={exposed.failed ? null : exposed.total}
        unassessed={unassessed}
      />

      {/*
       * How much is waiting, and how long it has been waiting there. A count
       * says there is work; an age says the work is stuck, which is the thing
       * a daily board is actually read for.
       */}
      <section className="esh-signals esh-today-signals" aria-label="Today’s queues">
        {stages.map((stage) => (
          <Signal key={stage.key} stage={stage} />
        ))}
      </section>

      <OperationalHealth reading={health} />
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
          <>
            {/*
             * v303 - a preview, like every other queue on this board.
             *
             * This was the one list that showed everything it had read, which
             * is a page of fifty. On a real register that is four thousand
             * pixels of one list, and the three queue cards beneath it - the
             * ones that say whose desk the work is on - were below all of it.
             * A board nobody can see the bottom of is not a board.
             *
             * Six, the same as the cards, and the footer says how many there
             * are so six of thirty-one never reads as all of them.
             */}
            <ul className="esh-today-list" aria-label="Needs attention">
              {attention.rows.slice(0, TODAY_PREVIEW).map((row) => (
                <AttentionRow key={row.actionId ?? row.findingId} row={row} />
              ))}
            </ul>
            {attention.total > TODAY_PREVIEW && (
              <p className="esh-register-foot">
                <Link href="/findings/register?filter=attention">
                  {attention.total} need attention · see them all
                </Link>
              </p>
            )}
          </>
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
              {/*
               * v290 - the real state, not a sentence written when it was
               * true. This said "Public QR reporting is not enabled" in
               * hard-coded text, and went on saying it after an administrator
               * opened the channel - so the team watching this queue was told
               * nothing could arrive while the form was live.
               */}
              <p>{reportingWords(qrIntake)}</p>
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
        {/*
         * v303 - the column v301 emptied, holding the work nobody could see.
         *
         * Today showed two queues, and both were ESH's own. The corrections
         * sitting with an owner - the ones a coordinator can chase but cannot
         * finish - existed only as the number "Overdue owner actions", so the
         * question this page's own subtitle asks, who owes the next move, had
         * an answer for one side of the work and a digit for the other.
         */}
        <section className="esh-form-card" aria-labelledby="today-waiting-title">
          <div className="esh-section-head">
            <div>
              <h2 id="today-waiting-title">Waiting on someone else</h2>
              <p>You can chase these. You cannot finish them.</p>
            </div>
            <Link href="/findings/register?filter=overdue">Open register</Link>
          </div>
          {pastDue.failed ? (
            <div className="notice error" role="alert">
              <strong>The overdue list could not be read</strong>
              <p>No rows are shown rather than a list that might be incomplete.</p>
            </div>
          ) : pastDue.rows.length === 0 ? (
            <QueueEmpty
              title="Nothing is past its date"
              detail="Every correction with an owner is still inside the date it was given."
            />
          ) : (
            <>
              <ul className="esh-today-list">
                {pastDue.rows.slice(0, TODAY_PREVIEW).map((row) => (
                  <WaitingRow
                    key={row.actionId ?? row.findingId}
                    row={row}
                    now={now}
                    timeZone={timeZone}
                  />
                ))}
              </ul>
              {pastDue.total > TODAY_PREVIEW && (
                <p className="esh-register-foot">
                  <Link href="/findings/register?filter=overdue">
                    {pastDue.total} past due · see them all
                  </Link>
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {/*
       * v301 - a sentence, where a third column used to stand.
       *
       * "Escalations" was a card whose only possible content was an empty
       * state announcing that it would never have content. It took a third of
       * the widest row on the board, permanently, beside two cards holding
       * real work, and on a 768px screen it was one of three columns squeezed
       * to 148px. The explanation is worth keeping; the column was not.
       */}
      <p className="esh-today-note">
        Delivery failures and overdue work stay on the finding itself, next to the owner, the
        protection and the due date, so there is no separate escalation queue to watch.{' '}
        <Link href="/findings/register?filter=attention">Review everything needing attention</Link>.
      </p>
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

/** The earliest instant in a list: the thing that has been waiting longest. */
function earliest(instants: Array<string | null>): string | null {
  let oldest: string | null = null;
  for (const value of instants) {
    if (!value) continue;
    if (oldest === null || Date.parse(value) < Date.parse(oldest)) oldest = value;
  }
  return oldest;
}

function Signal({ stage }: { stage: Stage }) {
  const content = (
    <>
      <span>{stage.label}</span>
      <strong aria-label={stage.value === null ? 'not known' : undefined}>
        {stage.value ?? '—'}
      </strong>
      <small>{stage.detail}</small>
      {stage.dwell && (
        <p className="esh-signal-dwell" data-exception={stage.exception || undefined}>
          {stage.dwell}
        </p>
      )}
    </>
  );
  return stage.href ? (
    <Link
      className="esh-signal"
      data-desk={stage.desk}
      data-exception={stage.exception || undefined}
      href={stage.href}
    >
      {content}
    </Link>
  ) : (
    <div
      className="esh-signal"
      data-desk={stage.desk}
      data-disabled={stage.value === null || undefined}
    >
      {content}
    </div>
  );
}

/**
 * The one question this screen exists to answer, at the top of it.
 *
 * The counter is inside the band rather than beside it, so the figure and the
 * findings it counts are a single statement. It keeps its own link to the
 * register view holding exactly it, which is the invariant
 * `esh-today-counts-v4101` holds and the reason the protection figure stopped
 * linking to every open finding in the first place.
 */
function ExposureBand({
  value,
  exposures,
  total,
  unassessed,
}: {
  value: number | null;
  exposures: Exposure[];
  /** How many there are in all, which may exceed the rows read. */
  total: number | null;
  unassessed: number | null;
}) {
  const shown = exposures.slice(0, 3);
  const figure = (
    <>
      <span>Significant risks without verified protection</span>
      <strong aria-label={value === null ? 'not known' : undefined}>{value ?? '—'}</strong>
      <small>
        {value === null
          ? 'This figure could not be read — it is not a count of none'
          : 'Open, high or critical, nothing verified in place'}
      </small>
      {/*
       * v301 - what the figure above does not cover. A finding nobody has
       * rated is in neither count, and saying so is the difference between a
       * quiet board and a board that is quiet because nobody looked.
       */}
      {unassessed ? (
        <p>
          {unassessed} open finding{unassessed === 1 ? ' has' : 's have'} no risk level yet, so{' '}
          {unassessed === 1 ? 'it is' : 'they are'} in neither figure.
        </p>
      ) : null}
    </>
  );
  return (
    <section
      className="esh-exposure"
      data-state={value === null ? 'unknown' : value > 0 ? 'exposed' : 'clear'}
      aria-labelledby="today-exposure-title"
    >
      <h2 id="today-exposure-title" className="visually-hidden">
        Significant findings with nothing protecting anybody
      </h2>
      {value === null ? (
        <div className="esh-signal" data-disabled>
          {figure}
        </div>
      ) : (
        <Link
          className="esh-signal"
          data-exception={value > 0 || undefined}
          href="/findings/register?filter=unprotected"
        >
          {figure}
        </Link>
      )}
      <div className="esh-exposure-body">
        {value === 0 ? (
          <p className="esh-exposure-words">
            Every open High or Critical finding has an interim control that somebody has checked, or
            a record that none is needed.
          </p>
        ) : shown.length === 0 ? (
          /*
           * The figure read and the list did not. Saying nothing here would
           * leave a number with no findings under it, which reads as a bug in
           * the band rather than as a read that failed.
           */
          <p className="esh-exposure-words">
            The findings behind this figure could not be read, so none are named here.
          </p>
        ) : (
          <>
            <p className="esh-exposure-words">{exposureWords(exposures)}</p>
            <ul className="esh-exposure-list">
              {shown.map((one) => (
                <li key={one.findingId}>
                  <Link href={one.href}>
                    <strong>{one.reference}</strong>
                    <b>{one.title}</b>
                    <small>
                      {[
                        `${one.riskLabel} risk`,
                        one.location ?? one.departmentName,
                        one.overdueDays === null
                          ? null
                          : `${one.overdueDays} day${one.overdueDays === 1 ? '' : 's'} past due`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
            {total !== null && total > shown.length && (
              <p className="esh-exposure-more">
                <Link href="/findings/register?filter=unprotected">
                  {total} in all · open the list
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </section>
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

/**
 * A correction sitting with its owner, past the date it was given.
 *
 * It names the person, because "chase it" is an instruction nobody can follow
 * without one, and it says how far past the date the work is rather than what
 * the date was: by the time a row reaches this card, "due 16 October" is
 * arithmetic the reader has been left to do.
 */
function WaitingRow({ row, now, timeZone }: { row: RegisterListRow; now: Date; timeZone: string }) {
  const over = row.dueAt ? daysOverdue(row.dueAt, now, timeZone) : null;
  const href = row.actionId
    ? `/findings/${row.findingId}?action=${row.actionId}`
    : `/findings/${row.findingId}`;
  return (
    <li>
      <Link href={href}>
        <span className="esh-today-row-main">
          <strong>{row.reference}</strong>
          <b>{row.title}</b>
          <small>
            {[row.ownerEmail, row.location ?? row.departmentName].filter(Boolean).join(' · ')}
          </small>
        </span>
        <span className="esh-today-row-reasons">
          {over !== null && (
            <small>
              {over} day{over === 1 ? '' : 's'} past due
            </small>
          )}
          {row.changesRequested && <small>Owner needs to improve proof</small>}
          {row.notificationFailed && <small>Notification needs attention</small>}
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
    /*
     * v301 - no `esh-register-row` here.
     *
     * That class is the register's four-column grid
     * (`1.6fr 1fr 1.2fr auto`), written for a full-width table of findings.
     * This row has one child, so the child took the 1.6fr track and the other
     * three held nothing: measured at 36% of the card it sits in. The title
     * ellipsised after about ten characters and the meta line wrapped beside
     * two thirds of a card that was empty. Nothing overflowed and nothing was
     * clipped, so no overflow check and no test ever saw it.
     *
     * `esh-today-list a` already lays these rows out, which is what the
     * attention rows directly above have always used.
     */
    <li>
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
    /* The register's grid does not belong here either - see VerificationRow. */
    <li>
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

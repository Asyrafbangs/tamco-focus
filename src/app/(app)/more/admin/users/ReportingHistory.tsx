import { managerOnDate } from '@/domain/reporting-history';
import type { DirectoryUser, ReportingHistoryEntry } from '@/server/queries';

/**
 * Reporting history, on the person's Directory page (v176).
 *
 * Two things. A question with a date — "who did they report to on 3 March?" —
 * answered from the record, with what the answer rests on. And the record
 * itself, newest first: every change to either line, when it took effect, who
 * made it and why.
 *
 * A plain GET form, so the answer is a URL: it survives a reload and can be
 * sent to whoever asked.
 */

const dayFormat = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone: 'UTC' });

/** A calendar date as a date, not as midnight somewhere that moves it a day. */
function formatDay(value: string): string {
  return dayFormat.format(new Date(`${value}T00:00:00Z`));
}

const LINE_WORDS = { primary: 'Reporting manager', functional: 'Dotted line' } as const;

export function ReportingHistory({
  person,
  people,
  history,
  askedDate,
}: {
  person: DirectoryUser;
  /** Everybody in the Directory, deactivated included, to name a manager by. */
  people: DirectoryUser[];
  history: ReportingHistoryEntry[];
  /** YYYY-MM-DD from the URL, or empty when nothing has been asked. */
  askedDate: string;
}) {
  const firstName = person.fullName.split(' ')[0];

  let answer: string | null = null;
  if (askedDate) {
    const found = managerOnDate(history, person.reportingManagerId, askedDate);
    const manager = people.find((candidate) => candidate.id === found.managerId)?.fullName;
    const who = found.managerId ? (manager ?? 'an account that no longer exists') : 'nobody';
    const day = formatDay(askedDate);
    if (found.basis === 'recorded') {
      answer = `On ${day}, ${person.fullName} reported to ${who} — since ${formatDay(found.since)}.`;
    } else if (found.basis === 'before_record') {
      answer = `On ${day}, ${person.fullName} reported to ${who}. That is the line the first recorded change, on ${formatDay(
        found.recordStarts,
      )}, replaced; nothing earlier is recorded.`;
    } else {
      answer = `No change of reporting line has been recorded for ${firstName}, so the record can only say ${who === 'nobody' ? 'they report to nobody' : `they report to ${who}`} now — not that they did on ${day}.`;
    }
  }

  return (
    <section className="admin-history-section" aria-labelledby="reporting-history-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">History</p>
          <h3 id="reporting-history-heading">Reporting history</h3>
          <p>
            Every change to {firstName}&apos;s reporting line and dotted line, by the date it took
            effect.
          </p>
        </div>
      </div>

      <form className="filterbar" action="/more/admin/users">
        <input type="hidden" name="user" value={person.id} />
        <label>
          <span>Who did {firstName} report to on</span>
          <input type="date" name="on" defaultValue={askedDate} required />
        </label>
        <button className="btn small" type="submit">
          Check
        </button>
      </form>
      {answer && (
        <p className="notice" role="status">
          {answer}
        </p>
      )}

      {history.length === 0 ? (
        <p className="sub">No change has been recorded for {firstName} yet.</p>
      ) : (
        <ol className="reporting-history">
          {history.map((entry) => (
            <li key={entry.id}>
              <span className="reporting-history-when">{formatDay(entry.effectiveDate)}</span>
              <span>
                <strong>{LINE_WORDS[entry.relationship]}:</strong>{' '}
                {entry.previousManagerName ?? 'None'} → {entry.newManagerName ?? 'None'}
              </span>
              <span className="sub">
                {[entry.changedByName ? `By ${entry.changedByName}` : 'By the system', entry.reason]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

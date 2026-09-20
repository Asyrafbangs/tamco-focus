import { SubmitSentUpdate } from '@/components/esh/guest/SubmitSentUpdate';
import { evidenceLabel } from '@/domain/esh-evidence';
import {
  conversationDay,
  firstName,
  type ConversationEntry,
  type SubmissionMark,
} from '@/domain/esh-guest';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * One action's conversation (§11, §13), as either side reads it.
 *
 * The owner sees their own messages on the right as "You" and ESH's on the
 * left by first name; ESH sees the reverse, with the owner named by address.
 * Oldest first, with a heading for each day. Files open through the reader's
 * own access route (`fileBase`), never a stored link. A message that was
 * submitted for review says so beneath it, with its version (§12).
 */
export function Conversation({
  entries,
  viewer,
  timeZone,
  now,
  emptyText,
  fileBase,
  submissions = [],
  submitFor = null,
  viewerPrincipalId = null,
}: {
  entries: ConversationEntry[];
  viewer: 'owner' | 'staff' | 'escalation';
  viewerPrincipalId?: string | null;
  timeZone: string;
  now: Date;
  emptyText: string;
  fileBase: string;
  submissions?: SubmissionMark[];
  /** The owner's action, when an update they sent may still be submitted. */
  submitFor?: string | null;
}) {
  if (entries.length === 0) {
    return <p className="esh-conversation-empty">{emptyText}</p>;
  }
  const time = (instant: string) =>
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date(instant));
  const marks = new Map<string, SubmissionMark[]>();
  for (const mark of submissions) {
    marks.set(mark.messageId, [...(marks.get(mark.messageId) ?? []), mark]);
  }

  // Each run of messages gets its day once, above the first of them.
  const days = entries.map((entry) => conversationDay(entry.sentAt, now, timeZone));
  return (
    <ol className="esh-conversation" aria-label="Conversation">
      {entries.map((entry, index) => {
        const heading = index === 0 || days[index] !== days[index - 1] ? days[index] : null;
        const mine =
          viewer === entry.authorKind &&
          (viewer !== 'escalation' || entry.authorPrincipalId === viewerPrincipalId);
        const author =
          entry.authorKind === 'staff'
            ? viewer === 'owner'
              ? `${firstName(entry.authorName)} · ESH`
              : `${entry.authorName ?? 'ESH'} · ESH`
            : entry.authorKind === 'escalation'
              ? mine
                ? 'You · Escalation recipient'
                : `${entry.authorName ?? entry.authorEmail ?? 'Escalation recipient'} · Escalation recipient`
              : viewer === 'owner'
                ? 'You'
                : `${entry.authorEmail ?? 'Action Owner'} · Action Owner`;
        const files = entry.files ?? [];
        return (
          <li key={entry.id} className="esh-message-item">
            {heading && <p className="esh-conversation-day">{heading}</p>}
            <div className={`esh-message${mine ? ' mine' : ''}`}>
              <p className="esh-message-meta">
                {author} · <time dateTime={entry.sentAt}>{time(entry.sentAt)}</time>
              </p>
              <div className="esh-message-body">
                {entry.body && <p>{entry.body}</p>}
                {files.length > 0 && (
                  <ul className="esh-file-list" aria-label="Files">
                    {files.map((file) => (
                      <li key={file.id} className="esh-file">
                        <a
                          href={`${fileBase}/${file.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {IMAGE_TYPES.has(file.type) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="esh-file-thumb"
                              src={`${fileBase}/${file.id}`}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="esh-file-icon" aria-hidden="true">
                              ▧
                            </span>
                          )}
                          <span>
                            <strong>{file.name}</strong>
                            <small>{evidenceLabel(file.name, file.size)}</small>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {submitFor && entry.submittable && !marks.has(entry.id) && (
                <SubmitSentUpdate actionId={submitFor} messageId={entry.id} />
              )}
            </div>
            {(marks.get(entry.id) ?? []).map((mark) => (
              <p key={mark.version} className="esh-submission-mark" data-state={mark.state}>
                {mark.state === 'pending'
                  ? `Submitted for ESH review (version ${mark.version}). This finding is still open.`
                  : mark.state === 'withdrawn'
                    ? `Version ${mark.version} was withdrawn to revise it.`
                    : mark.state === 'accepted'
                      ? `Version ${mark.version} was accepted by ESH.`
                      : `ESH asked for more on version ${mark.version}.`}
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

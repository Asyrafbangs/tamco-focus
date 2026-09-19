import { conversationDay, firstName, type ConversationEntry } from '@/domain/esh-guest';

/**
 * One action's conversation (§11, §13), as either side reads it.
 *
 * The owner sees their own messages on the right as "You" and ESH's on the
 * left by first name; ESH sees the reverse, with the owner named by address.
 * Oldest first, with a heading for each day, so it reads like any chat.
 */
export function Conversation({
  entries,
  viewer,
  timeZone,
  now,
  emptyText,
}: {
  entries: ConversationEntry[];
  viewer: 'owner' | 'staff';
  timeZone: string;
  now: Date;
  emptyText: string;
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

  // Each run of messages gets its day once, above the first of them.
  const days = entries.map((entry) => conversationDay(entry.sentAt, now, timeZone));
  return (
    <ol className="esh-conversation" aria-label="Conversation">
      {entries.map((entry, index) => {
        const heading = index === 0 || days[index] !== days[index - 1] ? days[index] : null;
        const mine = viewer === entry.authorKind;
        const author =
          entry.authorKind === 'staff'
            ? viewer === 'owner'
              ? `${firstName(entry.authorName)} · ESH`
              : `${entry.authorName ?? 'ESH'} · ESH`
            : viewer === 'owner'
              ? 'You'
              : `${entry.authorEmail ?? 'Action Owner'} · Action Owner`;
        return (
          <li key={entry.id} className="esh-message-item">
            {heading && <p className="esh-conversation-day">{heading}</p>}
            <div className={`esh-message${mine ? ' mine' : ''}`}>
              <p className="esh-message-meta">
                {mine && viewer === 'owner' ? 'You' : author} ·{' '}
                <time dateTime={entry.sentAt}>{time(entry.sentAt)}</time>
              </p>
              <p className="esh-message-body">{entry.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

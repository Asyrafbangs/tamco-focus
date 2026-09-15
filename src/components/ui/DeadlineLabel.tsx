import { deadlineGlyph, type Deadline } from '@/domain/deadline';

/**
 * A deadline in words, with its weight (v187).
 *
 * Red with ⚠ once late; amber with ! today, tomorrow and inside the attention
 * window — stronger today and tomorrow; plain further out. The words carry the
 * meaning, so the glyph is decoration and the colour is never the only signal.
 * One component, so a late step and a late task can never be drawn two ways.
 */
export function DeadlineLabel({
  deadline,
  compact = false,
  prefix,
  className = '',
}: {
  deadline: Deadline;
  /** "Overdue 3d" rather than "Overdue 3 days", for tight rows. */
  compact?: boolean;
  /** Words before the label that share its weight: "Delegated step". */
  prefix?: string;
  className?: string;
}) {
  const glyph = deadlineGlyph(deadline.tone);
  const text = compact ? deadline.short : deadline.label;
  const words = prefix ? `${prefix} ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
  return (
    <span className={`deadline deadline-${deadline.tone}${className ? ` ${className}` : ''}`}>
      {glyph ? (
        <span className="deadline-glyph" aria-hidden="true">
          {glyph}{' '}
        </span>
      ) : null}
      {words}
    </span>
  );
}

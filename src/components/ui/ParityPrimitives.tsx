import Link from 'next/link';
import type { CSSProperties, DragEventHandler, ReactNode, Ref } from 'react';

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

export function StatusBadge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return <span className={`status-badge ${tone} ${className}`.trim()}>{children}</span>;
}

export function PriorityFlag({
  children,
  tone = 'red',
}: {
  children: ReactNode;
  tone?: Extract<Tone, 'red' | 'amber' | 'blue'>;
}) {
  return <span className={`priority-flag ${tone}`}>{children}</span>;
}

export function ProgressIndicator({ value, label }: { value: number; label?: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-indicator">
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bounded}
        aria-label={label ?? `${bounded}% complete`}
      >
        <span style={{ '--progress': `${bounded}%` } as CSSProperties} />
      </div>
      {label && <span className="progress-label">{label}</span>}
    </div>
  );
}

export function RowPrimaryLink({
  href,
  children,
  className = '',
  returnFocusId,
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  returnFocusId?: string;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      className={`row-primary-link ${className}`.trim()}
      data-focus-return={returnFocusId}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}

/**
 * A row, optionally openable as a whole (v49 §1-5).
 *
 * When `href` is given the entire row becomes the target, via a link stretched
 * across it rather than a click handler on the article. That matters for three
 * reasons: the keyboard gets Tab and Enter for free, middle-click and "open in
 * new tab" behave like links because it is one, and the buttons already in the
 * row sit above the overlay and keep their own actions — no `stopPropagation`,
 * and no interactive element nested inside another.
 *
 * The alternative, `role="button"` with a keydown handler on the container,
 * requires re-implementing all of that and nests the row's real buttons inside
 * a control, which assistive technology reads as one confused thing.
 */
export function TaskRow({
  children,
  className = '',
  href,
  openLabel,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
  /** What the row opens, for anybody who cannot see the row. */
  openLabel?: string;
}) {
  return (
    <article
      className={`task-row interactive-row ${href ? 'row-openable ' : ''}${className}`.trim()}
    >
      {href && (
        <Link href={href} className="row-cover-link">
          <span className="visually-hidden">{openLabel ?? 'Open'}</span>
        </Link>
      )}
      {children}
    </article>
  );
}

export function RoutineRow({ children }: { children: ReactNode }) {
  return <TaskRow className="routine-row">{children}</TaskRow>;
}

export interface TabItem {
  href: string;
  label: string;
  active?: boolean;
  count?: string | number;
  attention?: boolean;
}

function TabLink({ item, compact = false }: { item: TabItem; compact?: boolean }) {
  return (
    <Link
      href={item.href}
      className={item.active ? 'active' : undefined}
      aria-current={item.active ? 'page' : undefined}
      data-compact={compact || undefined}
    >
      <span>{item.label}</span>
      {item.count !== undefined && (
        <span className={`count${item.attention ? ' over' : ''}`}>{item.count}</span>
      )}
    </Link>
  );
}

/**
 * `tone` separates two questions that are not peers.
 *
 * Scope asks whose work you are looking at; mode asks what kind of work. They
 * were rendered with the same control, one directly under the other, so four
 * options read as one row of four peers and the distinction between them was
 * invisible — a reader had to learn it rather than see it. Mode is the lighter
 * of the two because it sits inside the scope you have already chosen.
 */
export function WorkspaceTabs({
  items,
  label = 'Workspace',
  tone = 'scope',
}: {
  items: TabItem[];
  label?: string;
  tone?: 'scope' | 'mode';
}) {
  return (
    <nav className={tone === 'mode' ? 'workspace-tabs mode' : 'workspace-tabs'} aria-label={label}>
      {items.map((item) => (
        <TabLink key={item.href} item={item} compact />
      ))}
    </nav>
  );
}

/**
 * `variant` tells a set of content tabs from a filter.
 *
 * The dark tabs say "this is the list you are now looking at". A filter over
 * one list is a smaller claim, and giving it the same weight made My Team read
 * as two navigations stacked on each other.
 */
export function FocusTabs({
  items,
  label = 'Focus areas',
  variant = 'panel',
}: {
  items: TabItem[];
  label?: string;
  variant?: 'panel' | 'underline';
}) {
  return (
    <nav
      className={variant === 'underline' ? 'focus-tabs underline' : 'focus-tabs'}
      aria-label={label}
    >
      {items.map((item) => (
        <TabLink key={item.href} item={item} />
      ))}
    </nav>
  );
}

export function EmptyState({
  title,
  children,
  action,
  compact = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`}>
      <h3>{title}</h3>
      <div>{children}</div>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function LoadingSkeleton({
  rows = 3,
  label = 'Loading content',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="loading-skeleton" role="status" aria-label={label} aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton skeleton-row" aria-hidden="true" />
      ))}
    </div>
  );
}

export function ActivityRow({
  title,
  actor,
  timestamp,
  href,
}: {
  title: string;
  actor: string;
  timestamp: string;
  href?: string;
}) {
  return (
    <div className={`activity-row${href ? ' interactive-row' : ''}`}>
      <strong>{href ? <RowPrimaryLink href={href}>{title}</RowPrimaryLink> : title}</strong>
      <span>
        {actor} <span aria-hidden="true">·</span> {timestamp}
      </span>
    </div>
  );
}

export function ChecklistItem({
  state,
  children,
  action,
}: {
  state: 'waiting' | 'ready' | 'completed';
  children: ReactNode;
  action?: ReactNode;
}) {
  if (action === undefined) {
    return <article className={`checklist-item ${state}`}>{children}</article>;
  }
  return (
    <article className={`checklist-item ${state}`}>
      <div className="checklist-state" aria-hidden="true">
        {state === 'completed' ? '✓' : state === 'waiting' ? '…' : '○'}
      </div>
      <div className="checklist-copy">{children}</div>
      {action}
    </article>
  );
}

/** The calendar's kinds of entry, as the Monthly Plan names them. */
export type CalendarItemKind = 'due' | 'overdue' | 'routine' | 'review' | 'discussion' | 'step';

/**
 * v163 — the four types colour distinguishes, and the only thing it does: a
 * task, a routine occurrence, a step, and a booked meeting. Overdue and review
 * dates are states of a task, shown as chips, not types of their own.
 */
export type CalendarItemType = 'task' | 'routine' | 'step' | 'meeting';

const CALENDAR_TYPE_LABEL: Record<CalendarItemType, string> = {
  task: 'Task',
  routine: 'Routine',
  step: 'Step',
  meeting: 'Meeting',
};

export function calendarItemType(kind: CalendarItemKind): CalendarItemType {
  if (kind === 'routine') return 'routine';
  if (kind === 'step') return 'step';
  if (kind === 'discussion') return 'meeting';
  return 'task';
}

/**
 * v163 — a small drawn mark for each type, so the type reads before the word
 * does. Drawn rather than taken from a font: Windows and macOS disagree about
 * most symbols at this size.
 */
export function CalendarTypeGlyph({ type }: { type: CalendarItemType }) {
  return (
    <svg
      className="cal-item-glyph"
      viewBox="0 0 10 10"
      width="9"
      height="9"
      aria-hidden="true"
      focusable="false"
    >
      {type === 'task' && (
        <rect
          x="1.2"
          y="1.2"
          width="7.6"
          height="7.6"
          rx="1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      )}
      {type === 'routine' && (
        <path
          d="M8.4 5a3.4 3.4 0 1 1-1-2.4M7.6 1v1.9H5.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {type === 'step' && (
        <path
          d="M1.6 5.3l2.1 2.1 4.7-4.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {type === 'meeting' && (
        <path
          d="M1.4 1.8h7.2v4.8H4.4L2.2 8.4V6.6h-.8z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function CalendarItem({
  href,
  title,
  kind,
  owner,
  accessibleSuffix,
  draggable,
  onDragStart,
  onDragEnd,
  taskAnchor,
  status,
  relation,
  tooltip,
}: {
  href: string;
  title: string;
  kind: CalendarItemKind;
  /** Shown only when the item belongs to someone other than the viewer. */
  owner?: string;
  accessibleSuffix?: string;
  /**
   * v153 - the Monthly Plan sets these on a due date the viewer may move, and
   * `false` on everything else, so a fixed item cannot be picked up as a bare
   * link. Left undefined everywhere else the item is used.
   */
  draggable?: boolean;
  onDragStart?: DragEventHandler<HTMLAnchorElement>;
  onDragEnd?: DragEventHandler<HTMLAnchorElement>;
  /** Lets focus find a moved item again once it has been redrawn. */
  taskAnchor?: string;
  /** v163 — the one state worth a chip: late, or up for review. */
  status?: 'overdue' | 'review';
  /**
   * v163 — the one fact beside the type: who owes a step, the work a step of
   * yours is part of, or how many steps share the task's date.
   */
  relation?: string;
  /** v163 — the full sentence on hover, since the cell holds only the essentials. */
  tooltip?: string;
}) {
  const type = calendarItemType(kind);
  return (
    <Link
      href={href}
      className={`cal-item ${kind} is-${type}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-plan-task={taskAnchor}
      title={tooltip ?? (owner ? `${title} — ${owner}` : title)}
    >
      <span className="cal-item-title" aria-hidden="true">
        {title}
      </span>
      {/*
        v163 — one line beneath the title: what kind of entry it is, at most one
        state and at most one fact. Colour says the type and nothing else.
      */}
      <span className="cal-item-meta" aria-hidden="true">
        <CalendarTypeGlyph type={type} />
        <span className="cal-item-type">{CALENDAR_TYPE_LABEL[type]}</span>
        {status && (
          <span className={`cal-chip ${status}`}>
            {status === 'overdue' ? 'Overdue' : 'Review by'}
          </span>
        )}
        {relation && <span className="cal-item-relation">{relation}</span>}
        {owner && <span className="cal-item-owner">{owner}</span>}
      </span>
      <span className="visually-hidden">{accessibleSuffix ?? title}</span>
    </Link>
  );
}

export function RecordRow({
  href,
  title,
  reference,
  owner,
  timestamp,
  status,
  details,
}: {
  href: string;
  title: string;
  reference: string;
  owner: string;
  timestamp: string;
  status: ReactNode;
  details?: ReactNode;
}) {
  return (
    <article className="record-row interactive-row">
      <div className="record-row-title">
        <RowPrimaryLink href={href} ariaLabel={`Open record ${title}`}>
          <strong>{title}</strong>
        </RowPrimaryLink>
        <span>{reference}</span>
      </div>
      <span className="record-row-owner">{owner}</span>
      <time>{timestamp}</time>
      <div className="record-row-status row-action">{status}</div>
      {details && <div className="record-row-details">{details}</div>}
    </article>
  );
}

export function AttachmentChip({
  name,
  meta,
  onRemove,
}: {
  name: string;
  meta?: string;
  onRemove?: () => void;
}) {
  return (
    <span className="attachment-chip">
      <span aria-hidden="true">↥</span>
      <span className="attachment-chip-copy">
        <strong>{name}</strong>
        {meta && <small>{meta}</small>}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}>
          ×
        </button>
      )}
    </span>
  );
}

export function Toast({
  children,
  actionLabel,
  onAction,
  actionDisabled = false,
  actionBusy = false,
  actionRef,
}: {
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  actionBusy?: boolean;
  actionRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="toast" role="status">
      <span>{children}</span>
      {actionLabel && onAction && (
        <button
          ref={actionRef}
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          aria-busy={actionBusy || undefined}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

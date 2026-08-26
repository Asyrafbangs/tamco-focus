import Link from 'next/link';
import type { CSSProperties, ReactNode, Ref } from 'react';

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

export function WorkspaceTabs({
  items,
  label = 'Workspace',
}: {
  items: TabItem[];
  label?: string;
}) {
  return (
    <nav className="workspace-tabs" aria-label={label}>
      {items.map((item) => (
        <TabLink key={item.href} item={item} compact />
      ))}
    </nav>
  );
}

export function FocusTabs({ items, label = 'Focus areas' }: { items: TabItem[]; label?: string }) {
  return (
    <nav className="focus-tabs" aria-label={label}>
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

export function CalendarItem({
  href,
  title,
  kind,
  owner,
  accessibleSuffix,
}: {
  href: string;
  title: string;
  kind: 'due' | 'overdue' | 'routine' | 'review' | 'discussion';
  /** Shown only when the item belongs to someone other than the viewer. */
  owner?: string;
  accessibleSuffix?: string;
}) {
  return (
    <Link href={href} className={`cal-item ${kind}`} title={owner ? `${title} — ${owner}` : title}>
      <span aria-hidden="true">{title}</span>
      {owner && (
        <span className="cal-item-owner" aria-hidden="true">
          {owner}
        </span>
      )}
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

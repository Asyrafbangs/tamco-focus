import Link from 'next/link';

import { formatDue } from '@/domain/duration';
import type { TaskDetailActivity, TaskDetailAttachment, TaskDetailUpdate } from '@/server/queries';

function text(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key];
  return typeof value === 'string' && value ? value : null;
}

function bool(detail: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = detail[key];
  return typeof value === 'boolean' ? value : fallback;
}

function number(detail: Record<string, unknown>, key: string): number | null {
  const value = detail[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function eventLabel(eventType: string) {
  return eventType.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatMoment(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function eventPresentation(
  event: TaskDetailActivity,
  timeZone: string,
  updatesById: Map<string, TaskDetailUpdate>,
): { title: string; description: string | null } {
  const detail = event.detail;
  switch (event.eventType) {
    case 'task_due_date_changed': {
      const previous = text(detail, 'previous_due_at');
      const next = text(detail, 'new_due_at');
      const reason = text(detail, 'reason');
      return {
        title: 'Due date changed',
        description:
          previous && next
            ? `${formatDue(previous, bool(detail, 'previous_due_is_date_only', true), timeZone)} → ${formatDue(
                next,
                bool(detail, 'new_due_is_date_only', true),
                timeZone,
              )}${reason ? ` · Reason: ${reason}` : ''}`
            : reason,
      };
    }
    case 'next_action_changed': {
      const previous = text(detail, 'previous_next_action');
      const next = text(detail, 'next_action');
      return {
        title: 'Next Action updated',
        description: next ? `${previous ? `${previous} → ` : ''}${next}` : null,
      };
    }
    case 'next_action_completed':
      return {
        title: 'Next Action completed',
        description: text(detail, 'completed_action'),
      };
    case 'checklist_item_completed': {
      const progress = number(detail, 'progress_percent');
      return {
        title: 'Checklist item completed',
        description: `${text(detail, 'action') ?? 'Checklist item'}${
          progress === null ? '' : ` · Progress ${progress}%`
        }`,
      };
    }
    case 'checklist_item_reopened':
      return {
        title: 'Checklist item reopened',
        description: `${text(detail, 'action') ?? 'Checklist item'}${
          text(detail, 'reason') ? ` · ${text(detail, 'reason')}` : ''
        }`,
      };
    case 'attachment_added': {
      const count = number(detail, 'attachment_count') ?? 1;
      return {
        title: 'Evidence attached',
        description: `${count} file${count === 1 ? '' : 's'} added${
          text(detail, 'action') ? ` for ${text(detail, 'action')}` : ''
        }`,
      };
    }
    case 'update_posted': {
      const updateId = text(detail, 'update_id');
      const update = updateId ? updatesById.get(updateId) : undefined;
      return {
        title: update?.isEvidenceOnly ? 'Evidence recorded' : 'Progress update posted',
        description: update?.body ?? null,
      };
    }
    default:
      return { title: eventLabel(event.eventType), description: null };
  }
}

export function TaskActivityHistory({
  activity,
  updates,
  attachments,
  timeZone,
}: {
  activity: TaskDetailActivity[];
  updates: TaskDetailUpdate[];
  attachments: TaskDetailAttachment[];
  timeZone: string;
}) {
  const updatesById = new Map(updates.map((update) => [update.id, update]));
  const attachmentByUpdate = new Map<string, TaskDetailAttachment[]>();
  for (const attachment of attachments) {
    if (!attachment.updateId) continue;
    const current = attachmentByUpdate.get(attachment.updateId) ?? [];
    current.push(attachment);
    attachmentByUpdate.set(attachment.updateId, current);
  }

  if (activity.length === 0) {
    return (
      <p className="muted" role="status">
        No recorded changes yet.
      </p>
    );
  }

  return (
    <div className="task-activity-list">
      {activity.map((event) => {
        const presentation = eventPresentation(event, timeZone, updatesById);
        const updateId = text(event.detail, 'update_id');
        const eventAttachments = updateId ? (attachmentByUpdate.get(updateId) ?? []) : [];
        return (
          <article key={event.id} className="task-activity-entry">
            <div className="task-activity-main">
              <strong>{presentation.title}</strong>
              {presentation.description ? <p>{presentation.description}</p> : null}
              {eventAttachments.length > 0 ? (
                <div className="task-activity-files">
                  {eventAttachments.map((attachment) => (
                    <Link
                      key={attachment.id}
                      href={`/api/attachments/${attachment.id}`}
                      target="_blank"
                    >
                      {attachment.fileName}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="task-activity-meta">
              <span>{event.actorName}</span>
              <time dateTime={event.occurredAt}>{formatMoment(event.occurredAt, timeZone)}</time>
            </div>
          </article>
        );
      })}
    </div>
  );
}

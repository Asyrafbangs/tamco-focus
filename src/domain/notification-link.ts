import { barrierHref } from '@/domain/barriers';

export interface NotificationLinkSource {
  task_id: string | null;
  goal_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

/**
 * One canonical destination for the bell and the matching email CTA.
 * Record access is still checked by the destination page's RLS-bound query.
 */
export function notificationHref(notification: NotificationLinkSource): string {
  const {
    task_id: taskId,
    goal_id: goalId,
    entity_type: entityType,
    entity_id: entityId,
  } = notification;

  if (entityType === 'checklist_item' && taskId && entityId) {
    return `/work?tab=shared&task=${encodeURIComponent(taskId)}&item=${encodeURIComponent(entityId)}`;
  }
  if (entityType === 'barrier' && taskId && entityId) {
    return barrierHref(taskId, entityId);
  }
  if (entityType === 'barrier' && taskId) {
    return `/work?task=${encodeURIComponent(taskId)}&attention=barrier`;
  }
  if (entityType === 'barrier' && goalId) {
    return `/goals?goal=${encodeURIComponent(goalId)}`;
  }
  if (entityType === 'goal' && entityId) {
    return `/goals?goal=${encodeURIComponent(entityId)}`;
  }
  if (entityType === 'work_proposal' && entityId) {
    return `/work?scope=team&proposal=${encodeURIComponent(entityId)}`;
  }
  if (taskId) return `/work?task=${encodeURIComponent(taskId)}`;
  if (goalId) return `/goals?goal=${encodeURIComponent(goalId)}`;
  return '/today';
}

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
  // v158 - a step on the recipient's own work: the work, at the step. The
  // Shared list is the assignee's view of the same record, not the owner's.
  if (entityType === 'task_step' && taskId && entityId) {
    return `/work?task=${encodeURIComponent(taskId)}&step=${encodeURIComponent(entityId)}`;
  }
  // v184 - asked for an update: the work, with the request and the composer
  // open - at the step, when it was about one. Answered: the work, at the
  // updates, where the reply is.
  if (entityType === 'task_update_request' && taskId) {
    return `/work?task=${encodeURIComponent(taskId)}&respond=update`;
  }
  if (entityType === 'step_update_request' && taskId && entityId) {
    return `/work?task=${encodeURIComponent(taskId)}&step=${encodeURIComponent(entityId)}&respond=update`;
  }
  if (entityType === 'task_update' && taskId) {
    return `/work?task=${encodeURIComponent(taskId)}&section=updates`;
  }
  if (taskId) return `/work?task=${encodeURIComponent(taskId)}`;
  if (goalId) return `/goals?goal=${encodeURIComponent(goalId)}`;
  return '/today';
}

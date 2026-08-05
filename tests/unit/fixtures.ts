import type { TaskOverview } from '@/domain/types';

/**
 * Builds a `TaskOverview` with sensible defaults so each test states only the
 * fields it actually cares about.
 */
export function makeTask(overrides: Partial<TaskOverview> = {}): TaskOverview {
  const now = new Date('2026-08-05T02:00:00.000Z'); // 10:00 in Asia/Kuala_Lumpur

  return {
    id: '00000000-0000-4000-a000-000000000001',
    title: 'Sample work',
    description: null,
    nextAction: null,

    status: 'active',
    workClass: 'operational_action',
    focusBucket: 'operational',
    origin: 'self_initiated',
    urgency: 'normal',
    isMandatory: false,

    progressPercent: 0,
    overFocusTarget: false,
    activationReasonCode: null,
    activationReasonNote: null,

    reviewStatus: 'not_required',
    reviewerId: null,
    version: 1,

    primaryOwnerId: '00000000-0000-4000-b000-000000000001',
    ownerName: 'Izzah Nurul',
    ownerEmployeeId: 'EMP-202',

    routineTemplateId: null,
    occurrenceDate: null,

    createdAt: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
    stateEnteredAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
    lastMeaningfulUpdateAt: new Date(now.getTime() - 1 * 86_400_000).toISOString(),
    dueAt: null,
    dueIsDateOnly: true,
    reviewAt: null,
    completedAt: null,
    cancelledAt: null,

    isOverdue: false,
    isStale: false,

    openBarrierCount: 0,
    checklistTotal: 0,
    checklistCompleted: 0,
    checklistReady: 0,
    missingEvidenceCount: 0,
    attachmentCount: 0,
    collaboratorCount: 0,

    ...overrides,
  };
}

/** A fixed "now" so date-sensitive assertions never depend on the wall clock. */
export const NOW = new Date('2026-08-05T02:00:00.000Z');

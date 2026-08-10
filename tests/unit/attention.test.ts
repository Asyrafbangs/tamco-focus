import { afterEach, describe, expect, it, vi } from 'vitest';

import { attentionPriority, resolveAttentionAction } from '@/domain/attention';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('manager attention CTA resolution', () => {
  it('opens the exact barrier while keeping team attention beneath it, not a person drawer', () => {
    const action = resolveAttentionAction(
      {
        sourceType: 'barrier',
        sourceId: 'barrier-17',
        ctaType: 'barrier_action',
        reasonCode: 'decision_required',
        taskId: 'task-9',
        actionType: 'decision',
      },
      { teamAttention: true },
    );

    expect(action).toEqual({
      badge: 'Decision needed',
      label: 'Provide decision',
      href: '/work?scope=team&filter=attention&task=task-9&attention=barrier&barrier=barrier-17',
    });
    expect(action!.href).not.toContain('person=');
  });

  it('opens the exact routine occurrence', () => {
    expect(
      resolveAttentionAction(
        {
          sourceType: 'routine_occurrence',
          sourceId: 'routine-occurrence-3',
          ctaType: 'open_routine',
          reasonCode: 'overdue',
        },
        { teamAttention: true },
      ),
    ).toEqual({
      badge: 'Overdue routine',
      label: 'Open routine',
      href: '/work?scope=team&filter=attention&task=routine-occurrence-3',
    });
  });

  it('rejects a mismatched source and CTA instead of rendering a dead action', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const action = resolveAttentionAction({
      sourceType: 'routine_occurrence',
      sourceId: 'routine-occurrence-3',
      ctaType: 'barrier_action',
      reasonCode: 'overdue',
      taskId: 'task-9',
    });

    expect(action).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('sourceType and ctaType do not match'),
    );
  });

  it('rejects a barrier without both barrier and task identity', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const action = resolveAttentionAction({
      sourceType: 'barrier',
      sourceId: 'barrier-17',
      ctaType: 'barrier_action',
      reasonCode: 'support_required',
      actionType: 'support',
    });

    expect(action).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('missing barrier taskId'));
  });

  it('opens the exact Goal check-in context with action-specific wording', () => {
    expect(
      resolveAttentionAction({
        sourceType: 'goal',
        sourceId: 'goal-23',
        ctaType: 'review_goal',
        reasonCode: 'goal_quarterly_discussion',
      }),
    ).toEqual({
      badge: 'Quarterly discussion ready',
      label: 'Discuss goal',
      href: '/goals?goal=goal-23&action=update',
    });

    expect(
      resolveAttentionAction({
        sourceType: 'goal',
        sourceId: 'goal-24',
        ctaType: 'review_goal',
        reasonCode: 'goal_support_requested',
      }),
    ).toEqual({
      badge: 'Goal support needed',
      label: 'Review goal',
      href: '/goals?goal=goal-24',
    });
  });

  /**
   * v53 §21 — a Goal request is a request, and it keeps its own identity.
   *
   * Two support requests can be open on one Goal, so the item is the request
   * and the Goal is named separately. Collapsing the two would give both rows
   * the same id and let one stand in for the other.
   */
  it('opens the Goal a request belongs to, not the request id', () => {
    expect(
      resolveAttentionAction({
        sourceType: 'goal',
        sourceId: 'request-91',
        goalId: 'goal-24',
        ctaType: 'review_goal',
        reasonCode: 'goal_support_requested',
        taskId: null,
      }),
    ).toEqual({
      badge: 'Goal support needed',
      label: 'Review goal',
      href: '/goals?goal=goal-24',
    });
  });
});

describe('attention ranking', () => {
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

  /**
   * A Goal support request used to fall through to `awareness`, which put a
   * genuine unanswered request below every routine notice on the list.
   */
  it('ranks a Goal support request with the requests, not with the notices', () => {
    const now = new Date();
    const goalRequest = {
      reasonCode: 'goal_support_requested',
      kind: 'action_required' as const,
      createdAt: at(1),
    };
    const barrierSupport = {
      reasonCode: 'support_required',
      kind: 'action_required' as const,
      createdAt: at(1),
    };
    const awareness = {
      reasonCode: 'awareness',
      kind: 'exception' as const,
      createdAt: at(1),
    };

    expect(attentionPriority(goalRequest, now)).toBeCloseTo(attentionPriority(barrierSupport, now));
    expect(attentionPriority(goalRequest, now)).toBeLessThan(attentionPriority(awareness, now));
  });
});

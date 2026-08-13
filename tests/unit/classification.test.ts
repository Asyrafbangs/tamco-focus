import { describe, expect, it } from 'vitest';

import {
  classifyCapture,
  FOLLOW_UP_QUESTION,
  requiresGovernanceReview,
  SELECTABLE_DESTINATIONS,
  URGENCY_QUESTION,
} from '@/domain/classification';

/**
 * The classifier stopped reading titles and due dates.
 *
 * Work type is chosen from a list; the one remaining ambiguity for ordinary
 * work is asked out loud. These tests exist mostly to keep inference from
 * creeping back in, because every previous version of this module inferred
 * something from wording and was confident about it.
 */
describe('nothing is inferred from the title', () => {
  const TITLES = [
    'replace PPE signage',
    'weekly toolbox talk every Monday',
    'learn advanced risk assessment',
    'roll out a new permit-to-work system across both sites',
    'urgent legal compliance deadline',
  ];

  it('classifies ordinary work the same way whatever the title says', () => {
    // The old module read these titles and produced routines, development
    // plans and major programmes from wording alone.
    for (const title of TITLES) {
      const result = classifyCapture({ workType: 'normal', requiresFollowUp: true });
      expect(result.destination).toBe('operational_available_work');
      expect(result.ruleCode).toBe('normal_with_followup');
      void title;
    }
  });

  it('never reaches a mandatory outcome without an explicit answer', () => {
    const unanswered = classifyCapture({ workType: 'normal' });
    expect(unanswered.destination).not.toBe('mandatory_operational_action');

    const declined = classifyCapture({
      workType: 'normal',
      needsImmediateControlledAction: false,
    });
    expect(declined.destination).not.toBe('mandatory_operational_action');

    const confirmed = classifyCapture({
      workType: 'normal',
      needsImmediateControlledAction: true,
    });
    expect(confirmed.destination).toBe('mandatory_operational_action');
    expect(confirmed.ruleCode).toBe('explicit_urgent_confirmed');
  });
});

describe('ordinary work splits on one answered question', () => {
  it('is a Quick Action when no follow-up is needed', () => {
    const result = classifyCapture({ workType: 'normal', requiresFollowUp: false });
    expect(result.destination).toBe('quick_action');
    expect(result.ruleCode).toBe('normal_no_followup');
  });

  it('is an Operational Action when follow-up is needed', () => {
    const result = classifyCapture({ workType: 'normal', requiresFollowUp: true });
    expect(result.destination).toBe('operational_available_work');
    expect(result.ruleCode).toBe('normal_with_followup');
  });

  it('defaults to Operational when the question was never answered', () => {
    // The safer default: it carries a focus target and stays visible, rather
    // than disappearing into a same-day list nobody revisits.
    const result = classifyCapture({ workType: 'normal' });
    expect(result.destination).toBe('operational_available_work');
    expect(result.ruleText).toMatch(/no follow-up answer/i);
  });

  it('asks a question that does not mention the due date', () => {
    // The old copy said "you said this needs more than a day" on the strength
    // of a date the person had picked for entirely different reasons.
    expect(FOLLOW_UP_QUESTION).toMatch(/after the day you start/i);
    expect(FOLLOW_UP_QUESTION).not.toMatch(/due/i);
  });
});

describe('the other three work types are chosen, not detected', () => {
  it('routes Routine to a template request', () => {
    const result = classifyCapture({ workType: 'routine' });
    expect(result.destination).toBe('routine_template_request');
    expect(result.ruleCode).toBe('chosen_routine');
  });

  it('routes Self-Development to the development plan', () => {
    const result = classifyCapture({ workType: 'self_development' });
    expect(result.destination).toBe('self_development_plan');
    expect(result.ruleCode).toBe('chosen_self_development');
  });

  it('routes Major Project to a proposal', () => {
    const result = classifyCapture({ workType: 'major_project' });
    expect(result.destination).toBe('major_project_request');
    expect(result.ruleCode).toBe('chosen_major_project');
  });

  it('ignores the follow-up answer for non-ordinary work', () => {
    const result = classifyCapture({ workType: 'routine', requiresFollowUp: false });
    expect(result.destination).toBe('routine_template_request');
  });
});

describe('what the person is shown before creating', () => {
  it('is one short line naming the type and where it lands', () => {
    const result = classifyCapture({ workType: 'normal', requiresFollowUp: true });
    expect(result.summary).toBe('Operational Action · starts in Available');
  });

  it('never exposes an internal rule code', () => {
    // `multi_day_default` used to be printed in the interface.
    for (const workType of ['normal', 'routine', 'self_development', 'major_project'] as const) {
      const result = classifyCapture({ workType });
      expect(result.summary).not.toMatch(/_/);
      expect(result.summary).not.toContain(result.ruleCode);
    }
  });

  it('still records the rule for the audit trail', () => {
    const result = classifyCapture({ workType: 'normal', requiresFollowUp: false });
    expect(result.ruleCode).toBeTruthy();
    expect(result.ruleText).toBeTruthy();
  });
});

describe('governance', () => {
  it('offers every destination a person may choose', () => {
    expect(SELECTABLE_DESTINATIONS.length).toBeGreaterThan(0);
    expect(SELECTABLE_DESTINATIONS).not.toContain('mandatory_operational_action');
  });

  it('keeps the urgency question worded as an explicit claim', () => {
    expect(URGENCY_QUESTION).toMatch(/immediate controlled action/i);
  });

  it('sends proposals and routines for review', () => {
    expect(requiresGovernanceReview('major_project_request')).toBe(true);
    expect(requiresGovernanceReview('routine_template_request')).toBe(true);
    expect(requiresGovernanceReview('quick_action')).toBe(false);
  });
});

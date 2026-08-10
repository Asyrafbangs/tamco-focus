import { describe, expect, it } from 'vitest';

import {
  classifyCapture,
  FOLLOW_UP_QUESTION,
  requiresGovernanceReview,
  SELECTABLE_DESTINATIONS,
} from '@/domain/classification';

describe('urgent wording (section 8.6, v40 section 13)', () => {
  it('does not react to safety wording at all', () => {
    // v40 section 13 uses this exact example. "PPE" is a noun about a topic,
    // not a claim about urgency, and reading urgency out of it is the hidden
    // inference the product must not make.
    const result = classifyCapture({
      title: 'replace PPE signage',
      timing: 'today',
      requiresFollowUp: false,
    });

    expect(result.destination).toBe('quick_action');
    expect(result.urgencyQuestion).toBeNull();
    expect(result.ruleCode).toBe('same_day_no_followup');
  });

  it('never raises the urgency question from wording, however alarming', () => {
    for (const title of [
      'Chemical spill near the loading bay',
      'PPE stock is low and there is a safety risk on line 2',
      'Fire extinguisher inspection overdue',
      'Compliance audit finding to close',
    ]) {
      const result = classifyCapture({ title, timing: 'today' });
      expect(result.destination).not.toBe('mandatory_operational_action');
      expect(result.urgencyQuestion).toBeNull();
    }
  });

  it('reaches mandatory only from an explicit yes', () => {
    // The explicit "Report urgent safety or compliance work" path. Note the
    // title says nothing urgent — the ANSWER is what decides.
    const result = classifyCapture({
      title: 'Move the pallet stack away from the panel',
      timing: 'today',
      needsImmediateControlledAction: true,
    });

    expect(result.destination).toBe('mandatory_operational_action');
    expect(result.ruleCode).toBe('explicit_urgent_confirmed');
  });

  it('continues ordinary classification when the answer is no', () => {
    const result = classifyCapture({
      title: 'Update the safety noticeboard',
      timing: 'this_week',
      needsImmediateControlledAction: false,
    });

    expect(result.destination).toBe('operational_available_work');
    expect(result.urgencyQuestion).toBeNull();
  });

  it('produces mandatory work only once the answer is yes', () => {
    const result = classifyCapture({
      title: 'Isolate the faulty conveyor — burning smell reported',
      timing: 'today',
      needsImmediateControlledAction: true,
    });

    expect(result.destination).toBe('mandatory_operational_action');
    expect(result.capacityEffect).toContain('may take you over your focus target');
  });

  it('honours an explicit yes even when the wording contains no safety terms', () => {
    // Reached through the "Report urgent safety or compliance work" action in
    // section 8.2. Gating the mandatory outcome on keyword detection here would
    // silently downgrade genuinely urgent work.
    const result = classifyCapture({
      title: 'Stop the line — something is badly wrong with the press',
      timing: 'today',
      needsImmediateControlledAction: true,
    });

    expect(result.destination).toBe('mandatory_operational_action');
  });
});

describe('ordinary classification (section 8.4)', () => {
  it('recommends a Quick Action for same-day work with no follow-up', () => {
    const result = classifyCapture({
      title: 'Replace the torn label on tank 3',
      timing: 'today',
      requiresFollowUp: false,
    });

    expect(result.destination).toBe('quick_action');
    expect(result.capacityEffect).toBe('Does not use a focus target.');
  });

  it('asks the single follow-up question when same-day intent is ambiguous', () => {
    const result = classifyCapture({ title: 'Sort out the store room', timing: 'today' });

    expect(result.followUpQuestion).toBe(FOLLOW_UP_QUESTION);
  });

  it('upgrades to Operational Available Work when follow-up is needed', () => {
    const result = classifyCapture({
      title: 'Sort out the store room',
      timing: 'today',
      requiresFollowUp: true,
    });

    expect(result.destination).toBe('operational_available_work');
  });

  it('recognises recurring work as a routine template request', () => {
    // "fire" is safety-sensitive wording, so the urgency question is asked
    // first. Answering "no" resumes ordinary classification, which is where the
    // recurring signal is read.
    const result = classifyCapture({
      title: 'Check fire extinguisher tags every month',
      timing: 'no_date',
      needsImmediateControlledAction: false,
    });

    expect(result.destination).toBe('routine_template_request');
    expect(result.capacityEffect).toContain('does not use a focus target');
  });

  it('recognises capability building as a Self-Development Plan', () => {
    const result = classifyCapture({
      title: 'NEBOSH certification study plan',
      timing: 'no_date',
    });

    expect(result.destination).toBe('self_development_plan');
  });

  it('recognises a sustained programme as a Major Project request', () => {
    const result = classifyCapture({
      title: 'Roll out a permit-to-work system across both sites',
      timing: 'no_date',
    });

    expect(result.destination).toBe('major_project_request');
  });

  it('never recommends the removed Collaborative Contribution destination', () => {
    // v40 section 8 — contribution is created by assigning a checklist item on
    // an existing task, not by classifying work at capture time.
    for (const title of [
      'help Amer with the contractor review',
      'assist with the annual PPE forecast',
      'contribute to the BR2 firefighting upgrade',
    ]) {
      const result = classifyCapture({ title, timing: 'this_week' });
      expect(result.destination).not.toBe('collaborative_contribution');
    }
  });

  it('defaults multi-day work to Operational Available Work', () => {
    const result = classifyCapture({ title: 'Tidy the contractor records', timing: 'this_week' });

    expect(result.destination).toBe('operational_available_work');
  });
});

describe('the result screen contract (section 8.4)', () => {
  it('always supplies a reason, a capacity effect, and a visibility effect', () => {
    const titles = [
      'Replace a label',
      'Weekly safety walk',
      'Study for certification',
      'Roll out a new system',
      'Help Izzah with the audit',
    ];

    for (const title of titles) {
      const result = classifyCapture({ title, timing: 'this_week' });

      expect(result.reason.length).toBeGreaterThan(10);
      expect(result.capacityEffect.length).toBeGreaterThan(10);
      expect(result.managerVisibility.length).toBeGreaterThan(10);
    }
  });
});

describe('Change type list (section 8.6)', () => {
  it('omits Mandatory Operational Action from the ordinary list', () => {
    expect(SELECTABLE_DESTINATIONS).not.toContain('mandatory_operational_action');
  });

  it('offers five destinations, with mandatory and collaborative both absent', () => {
    expect(SELECTABLE_DESTINATIONS).toHaveLength(5);
    expect(SELECTABLE_DESTINATIONS).not.toContain('mandatory_operational_action');
    expect(SELECTABLE_DESTINATIONS).not.toContain('collaborative_contribution');
  });

  it('names the rule behind every recommendation', () => {
    // v40 section 12 — the audit trail has to be able to answer "why was this
    // created as Operational?" with a rule rather than an implication that
    // something understood the sentence.
    const cases = [
      {
        input: { title: 'Weekly line walk', timing: 'this_week' as const },
        code: 'recurring_schedule',
      },
      {
        input: { title: 'Finish the NEBOSH revision questions', timing: 'no_date' as const },
        code: 'self_development_topic',
      },
      {
        input: { title: 'Roll out the new permit system company-wide', timing: 'no_date' as const },
        code: 'major_programme_scope',
      },
      {
        input: {
          title: 'Draft the contractor briefing',
          timing: 'today' as const,
          requiresFollowUp: true,
        },
        code: 'continued_followup_yes',
      },
      {
        input: { title: 'Order more gloves', timing: 'this_week' as const },
        code: 'multi_day_default',
      },
    ];

    for (const { input, code } of cases) {
      const result = classifyCapture(input);
      expect(result.ruleCode).toBe(code);
      expect(result.ruleText.length).toBeGreaterThan(0);
      expect(result.ruleText).toBe(result.reason);
    }
  });
});

describe('governance review (section 8.8)', () => {
  it('requires review for Major Project and routine template proposals only', () => {
    expect(requiresGovernanceReview('major_project_request')).toBe(true);
    expect(requiresGovernanceReview('routine_template_request')).toBe(true);

    expect(requiresGovernanceReview('quick_action')).toBe(false);
    expect(requiresGovernanceReview('operational_available_work')).toBe(false);
    expect(requiresGovernanceReview('self_development_plan')).toBe(false);
  });
});

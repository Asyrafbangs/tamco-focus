import { describe, expect, it } from 'vitest';

import { detailFollowUp, openingReads } from '@/domain/ai';

/**
 * v305 — the records a question cannot be answered without, fetched for it.
 *
 * Twelve full evaluation runs said the same thing: the finding register was
 * read in six of the sixteen scenarios that provide it. "What should I
 * prioritise today", "what needs my attention" and "help me prepare for my
 * review" were answered from the task list alone, so a finding the person
 * owned was left out of their own priorities.
 *
 * Three rounds of persuasion had already failed - rule 1a since v295, a
 * narrowed tool description in v303, tool order and task-tool descriptions in
 * v304 - and the three runs before that last change were indistinguishable
 * from the three after. So the read is no longer requested; it is performed.
 *
 * What these tests pin is the judgement, because the risk runs both ways. Too
 * eager and every question pays for records it does not need; too shy and the
 * defect comes straight back.
 */

const names = (question: string) => openingReads(question).map((one) => one.name);

describe('v305 what gets read before the model is asked', () => {
  it('reads the register and the tasks for the management questions that failed', () => {
    /*
     * The four that failed in almost every run. Each needs both halves: a
     * priority list built from tasks alone is wrong in exactly the way
     * nobody notices, because it looks complete.
     */
    for (const question of [
      'What should I prioritise today?',
      'What problems require my attention?',
      'Help me prepare for my performance review.',
      'Am I behind on anything this week?',
    ]) {
      expect(names(question), question).toEqual(['search_findings', 'list_my_tasks']);
    }
  });

  it('reads the register alone for a question about findings', () => {
    for (const question of [
      'How many findings are overdue?',
      'Six actions in Operations are late. Why?',
      'This hazard keeps recurring. Prove it.',
      'What percentage of our findings are closed on time?',
    ]) {
      expect(names(question), question).toEqual(['search_findings']);
    }
  });

  it('looks a named reference up across every state, not just the open ones', () => {
    /*
     * A question about ESH-0500 may well be about a closed record - "has it
     * been fixed" usually is - so the open register would answer "no such
     * finding" about a finding that exists.
     */
    const [read, ...rest] = openingReads('Has ESH-0500 been fixed?');
    expect(read).toMatchObject({
      name: 'search_findings',
      input: { filter: 'all', search: 'ESH-0500' },
    });
    expect(rest, 'a question about one record does not need the asker’s task list').toEqual([]);
  });

  it('fetches nothing for a question that does not need it', () => {
    /*
     * The other half of the judgement, and the reason this is a list of words
     * rather than "read everything first". These are answered from the team
     * tools, and a register read here would be a database call nobody asked
     * for on every question of this shape.
     */
    for (const question of [
      'What did my team achieve last week?',
      'Who completed the most assigned work last week?',
      'What changed compared with the previous week?',
      'How has Mohd Fadli Baharil been doing this month?',
      'Thanks, that is helpful.',
    ]) {
      expect(names(question), question).toEqual([]);
    }
  });

  it('reads the team’s WORK, and the register beside it, for a management question', () => {
    /*
     * v306. Every team tool returned figures per person - four overdue, two
     * stale - and none returned a task. So "what is my team's workload"
     * could only be answered by ranking people by their counts, which is
     * what the assistant did, and why it read as a dashboard rather than a
     * manager. The register comes too: a priority list built from tasks
     * alone puts an overdue expense claim above an unguarded press, because
     * the press is a finding.
     */
    for (const question of [
      "What is my team's workload this week?",
      'Is the workload fairly distributed?',
      'Which tasks should be done first?',
      'What should each employee accomplish this week?',
      'Which work can be postponed without increasing risk?',
      'What needs my decision or intervention?',
      'Who has outstanding tasks?',
    ]) {
      expect(names(question), question).toEqual(['list_team_tasks', 'search_findings']);
    }
  });

  it('leaves a question about the PAST to the history tool', () => {
    /*
     * Today's backlog cannot answer what happened last week, and reading it
     * for that would answer a different question with a straight face.
     */
    for (const question of [
      'What did my team achieve last week?',
      'Who completed the most assigned work last week?',
      'What changed compared with the previous week?',
      'How has Mohd Fadli Baharil been doing this month?',
    ]) {
      expect(names(question), question).toEqual([]);
    }
  });

  it('never asks for more than three reads', () => {
    const most = openingReads(
      'What should I prioritise today given ESH-0101 and my review and the overdue findings?',
    );
    expect(most.length).toBeLessThanOrEqual(2);
  });

  it('says why each read was made, because the model is shown it', () => {
    for (const read of openingReads('What should I prioritise today?')) {
      expect(read.why.length).toBeGreaterThan(20);
    }
  });
});

describe('v305 the detail a summary row cannot stand in for', () => {
  it('opens the one finding a yes-or-no question is about', () => {
    /*
     * `contradictory-evidence`: the register row says `open`, and the
     * rejected verification that actually answers "has it been fixed" is
     * inside the detail. Answered from the row, the reply looks right and
     * rests on nothing - which is how that scenario passed three runs
     * without ever opening the record.
     */
    expect(detailFollowUp('Has the walkway finding been fixed?', ['f-500'])).toMatchObject({
      name: 'get_finding_detail',
      input: { finding_id: 'f-500' },
    });
    expect(detailFollowUp('Tell me about finding ESH-0300.', ['f-300'])).toMatchObject({
      name: 'get_finding_detail',
    });
  });

  it('does not choose between several', () => {
    /*
     * With more than one match, which record matters is a judgement about
     * the question rather than a fetch, and guessing would spend a read on
     * the wrong record while looking authoritative.
     */
    expect(detailFollowUp('Has the walkway finding been fixed?', ['f-500', 'f-501'])).toBeNull();
    expect(detailFollowUp('Has the walkway finding been fixed?', [])).toBeNull();
  });

  it('does not open a record for a question that is not about one', () => {
    expect(detailFollowUp('How many findings are overdue?', ['f-1401'])).toBeNull();
    expect(detailFollowUp('What should I prioritise today?', ['f-1401'])).toBeNull();
  });
});

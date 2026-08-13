import { describe, expect, it } from 'vitest';

import { PEOPLE, serviceClient, signInAs } from './setup';

/**
 * What a manager has to decide from.
 *
 * A Major Project is the only capture that leaves the person making it. The
 * review drawer renders `work_proposals.rationale` and nothing else, and that
 * column is filled from `work_captures.description` — so when the description
 * box was removed from New Work, every proposal reached its manager as a bare
 * title under the heading "Why this should become a Major Project", followed by
 * "No rationale was recorded."
 *
 * Nothing failed. The proposal was created, routed and displayed correctly; it
 * simply had nothing in it. That is exactly the kind of regression a passing
 * suite hides, so these read the proposal back rather than trusting the call.
 */
describe('v61 major project proposal detail', () => {
  async function capture(fields: Record<string, unknown>) {
    const client = await signInAs('izzul');
    const { data, error } = await client
      .from('work_captures')
      .insert({
        captured_by: PEOPLE.izzul.id,
        title: 'Replace the plant scheduling spreadsheet',
        recommended_destination: 'major_project_request',
        classification_rule_code: 'chosen_major_project',
        classification_rule_text: 'You chose Major Project.',
        recommendation_reason: 'You chose Major Project.',
        timing_choice: 'no_date',
        due_is_date_only: true,
        ...fields,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const confirmed = (
      await client.rpc('confirm_work_capture', {
        p_capture_id: data.id,
        p_destination: 'major_project_request',
        p_idempotency_key: crypto.randomUUID(),
      })
    ).data as Record<string, unknown>;
    return { confirmed, client };
  }

  it('carries the reason through to the proposal a manager reads', async () => {
    const { confirmed } = await capture({
      description: 'Six plants keep separate spreadsheets and the numbers disagree every month.',
      success_measure: 'One schedule every plant works from.',
      expected_months: 4,
    });

    expect(confirmed).toMatchObject({ ok: true });
    const proposalId = confirmed.proposal_id;
    expect(proposalId).toBeTruthy();

    const { data: proposal } = await serviceClient()
      .from('work_proposals')
      .select('rationale, payload')
      .eq('id', proposalId as string)
      .single();

    // The exact failure that shipped: a proposal with a title and nothing else.
    expect(proposal?.rationale).not.toBeNull();
    expect(proposal?.rationale).toContain('spreadsheets');

    const payload = proposal?.payload as Record<string, unknown>;
    expect(payload.success_measure).toBe('One schedule every plant works from.');
    expect(payload.expected_months).toBe(4);
  });

  it('leaves the extra fields absent rather than empty when they were not given', async () => {
    const { confirmed } = await capture({
      description: 'The current process cannot be audited.',
    });

    const { data: proposal } = await serviceClient()
      .from('work_proposals')
      .select('rationale, payload')
      .eq('id', confirmed.proposal_id as string)
      .single();

    expect(proposal?.rationale).toBe('The current process cannot be audited.');
    const payload = proposal?.payload as Record<string, unknown>;
    // Null, not missing: the drawer decides what to show from the value, and a
    // proposal made before v61 has to render without these rather than break.
    expect(payload.success_measure).toBeNull();
    expect(payload.expected_months).toBeNull();
  });
});

/**
 * Why a piece of work exists (specification section 11).
 *
 * The product used to lead with what shape work was — Major Project,
 * Operational Action, Self-Development — and those are real distinctions about
 * size and governance. They are not the distinction a manager and an employee
 * actually talk about, which is why the work is happening at all: did
 * something break, is this a responsibility that runs anyway, or are we making
 * something better.
 *
 * Three deliberate choices in this vocabulary:
 *
 *   * "Reactive work", never "Firefighting". At TAMCO firefighting also means
 *     literal emergency response, so the metaphor collides with the job.
 *   * Not Q1/Q2. A quadrant number tells nobody anything without the grid, and
 *     the grid implies a ranking these three do not have — planned operations
 *     can be important and unhurried; improvement work can turn urgent.
 *   * Urgency stays a separate flag on the row. Being overdue never changes a
 *     purpose to Reactive: the reason the work exists does not change because
 *     time passed.
 */

export type WorkPurpose = 'reactive' | 'planned_operations' | 'improvement_development';

export const WORK_PURPOSE_VALUES: readonly WorkPurpose[] = [
  'reactive',
  'planned_operations',
  'improvement_development',
];

export const WORK_PURPOSE_LABELS: Record<WorkPurpose, string> = {
  reactive: 'Reactive work',
  planned_operations: 'Planned operations',
  improvement_development: 'Improvement & development',
};

/** One word, for a row where every entry already carries the same suffix. */
export const WORK_PURPOSE_SHORT_LABELS: Record<WorkPurpose, string> = {
  reactive: 'Reactive',
  planned_operations: 'Planned',
  improvement_development: 'Improvement',
};

/** Section 11's own wording, shown beside the choice so nobody has to guess. */
export const WORK_PURPOSE_MEANINGS: Record<WorkPurpose, string> = {
  reactive: 'Responding to an incident, breakdown or unexpected problem.',
  planned_operations:
    'Keeping existing responsibilities running — planned inspections, reporting or training.',
  improvement_development: 'Improving controls, systems, or individual and team capability.',
};

export const WORK_PURPOSE_OPTIONS: ReadonlyArray<{
  value: WorkPurpose;
  label: string;
  meaning: string;
}> = WORK_PURPOSE_VALUES.map((value) => ({
  value,
  label: WORK_PURPOSE_LABELS[value],
  meaning: WORK_PURPOSE_MEANINGS[value],
}));

/** What an unclassified row says. A true statement, not a guess. */
export const WORK_PURPOSE_UNSET_LABEL = 'Purpose not recorded';

/** Narrows a value that arrived from a form or the database. */
export function toWorkPurpose(value: unknown): WorkPurpose | null {
  return WORK_PURPOSE_VALUES.includes(value as WorkPurpose) ? (value as WorkPurpose) : null;
}

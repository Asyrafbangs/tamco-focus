/**
 * The words the backlog import uses (v205, §38).
 *
 * The workbook belongs to whoever kept the backlog, so nothing here assumes
 * its columns: these are the destinations a column can be pointed at, and the
 * reasons a row is not ready. A row that is not ready is never quietly fixed —
 * it says what is missing, and somebody decides.
 */

export const IMPORT_FIELDS = [
  { key: 'reference', label: 'Finding number', hint: 'The reference in the source register.' },
  { key: 'description', label: 'Description', hint: 'What was found, kept as written.' },
  { key: 'action', label: 'Required corrective action', hint: 'What has to be done.' },
  { key: 'owner_name', label: "Responsible person's name", hint: 'A hint, not an address.' },
  { key: 'owner_email', label: 'Owner email', hint: 'The address the action is assigned to.' },
  { key: 'department', label: 'Department', hint: 'Matched to a department you already have.' },
  { key: 'location', label: 'Area or location', hint: 'Where it was found.' },
  { key: 'reported_on', label: 'Reported date', hint: 'Kept as the original reported date.' },
  { key: 'due_on', label: 'Target date', hint: 'Becomes the due date, however old.' },
  { key: 'risk', label: 'Risk', hint: 'Unrecognised values read Not assessed.' },
  { key: 'priority', label: 'Priority', hint: 'Urgent, High or Normal; reviewed before release.' },
  { key: 'remarks', label: 'Remarks or progress', hint: 'Kept as history, not as a message.' },
  { key: 'status', label: 'Status', hint: 'Preserved; "Done" is not verified.' },
  { key: 'title', label: 'Short title', hint: 'Optional; the description is used otherwise.' },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]['key'];

export const IMPORT_FIELD_KEYS: readonly ImportField[] = IMPORT_FIELDS.map((field) => field.key);

/** The fields a row cannot be released without. */
export const REQUIRED_FIELDS: readonly ImportField[] = [
  'description',
  'action',
  'department',
  'owner_email',
  'due_on',
  'priority',
];

export type DateConvention = 'dmy' | 'mdy' | 'iso';

export const DATE_CONVENTIONS: Array<{ key: DateConvention; label: string; example: string }> = [
  { key: 'dmy', label: 'Day first', example: '04/05/2026 is 4 May 2026' },
  { key: 'mdy', label: 'Month first', example: '04/05/2026 is 5 April 2026' },
  { key: 'iso', label: 'Year first', example: '2026-05-04 is 4 May 2026' },
];

const PROBLEMS: Record<string, string> = {
  description_missing: 'No description in this row.',
  action_missing: 'No corrective action; write one before release.',
  department_missing: 'No department in this row.',
  department_unknown: 'That department is not one of yours.',
  owner_unassigned: 'No address for this name yet.',
  owner_email_invalid: 'That is not a usable email address.',
  due_missing: 'No target date.',
  due_unreadable: 'The target date could not be read.',
  due_far_future: 'That target date is more than ten years away.',
  reported_unreadable: 'The reported date could not be read.',
  priority_unreviewed: 'Priority needs to be Urgent, High or Normal.',
  risk_not_assessed: 'Risk is not one of yours, so it reads Not assessed.',
};

export function importProblem(code: string): string {
  return PROBLEMS[code] ?? 'This row needs a look before it can be released.';
}

/** A problem that stops a release, as opposed to one that is worth saying. */
export function blocksRelease(code: string): boolean {
  return code !== 'risk_not_assessed';
}

const OUTCOMES: Record<string, { label: string; tone: 'ready' | 'blocked' | 'quiet' }> = {
  ready: { label: 'Ready', tone: 'ready' },
  blocked: { label: 'Needs a decision', tone: 'blocked' },
  duplicate: { label: 'Already in the register', tone: 'quiet' },
  linked: { label: 'Linked to the existing finding', tone: 'quiet' },
  ignored: { label: 'Blank row, ignored', tone: 'quiet' },
  released: { label: 'Released', tone: 'ready' },
};

export function outcomeLabel(outcome: string): string {
  return OUTCOMES[outcome]?.label ?? outcome;
}

export function outcomeTone(outcome: string): 'ready' | 'blocked' | 'quiet' {
  return OUTCOMES[outcome]?.tone ?? 'quiet';
}

/**
 * v223 - the one summary before a backlog goes live: how many owners, how
 * many actions, how many have an address, how many do not, and how many rows
 * are still uncertain. It replaces reading ninety rows to find out.
 */
export interface ImportSummaryRow {
  id: string;
  outcome: string;
  problems: string[];
  mapped: Record<string, string>;
}

export function importReleaseSummary(
  rows: ImportSummaryRow[],
  owners: Array<{ sourceName: string; email: string | null }>,
  chosenIds: string[],
): {
  owners: number;
  actions: number;
  validEmails: number;
  missingEmails: number;
  uncertain: number;
} {
  const addressFor = new Map(
    owners.map((owner) => [owner.sourceName.trim().toLowerCase(), owner.email]),
  );
  const ownerOf = (row: ImportSummaryRow): string | null => {
    const named = addressFor.get((row.mapped.owner_name ?? '').trim().toLowerCase());
    const address = named ?? row.mapped.owner_email ?? '';
    return address.trim() ? address.trim().toLowerCase() : null;
  };
  const chosen = rows.filter((row) => chosenIds.includes(row.id));
  const addresses = new Set(chosen.map(ownerOf).filter((value): value is string => Boolean(value)));
  const ownerProblem = (row: ImportSummaryRow) =>
    row.problems.some((code) => code.startsWith('owner') && blocksRelease(code));
  const missing = rows.filter((row) => row.outcome === 'blocked' && ownerProblem(row)).length;
  // Rows still needing a decision for another reason, and rows that match a
  // finding already in the register.
  const uncertain = rows.filter(
    (row) => (row.outcome === 'blocked' && !ownerProblem(row)) || row.outcome === 'duplicate',
  ).length;
  return {
    owners: addresses.size,
    actions: chosen.length,
    validEmails: addresses.size,
    missingEmails: missing,
    uncertain,
  };
}

const START_PROBLEMS: Record<string, string> = {
  not_permitted: 'Your Finding access does not include importing a backlog.',
  invalid: 'That file could not be accepted. Check the sheet, header row and register name.',
  already_imported: 'This exact file has been imported already.',
  not_found: 'That import is no longer here.',
  not_staging: 'This import has moved on; start a new one to change it.',
  too_many_rows: 'That sheet has more rows than one import can take (5000).',
  nothing_selected: 'Choose the rows to release first.',
  row_not_ready: 'One of the chosen rows is not ready. Refresh and look again.',
  evidence_unresolved: 'Every photograph and link has to have an outcome before release.',
  followup_too_far: 'Follow-up cannot be postponed more than thirty days.',
  already_released: 'That is already live; change it the ordinary way.',
  reason_required: 'Say why, in a few words.',
  owner_email_invalid: 'That is not a usable email address.',
  unknown_field: 'That is not a field this import writes.',
  not_a_duplicate: 'That row does not match an existing finding.',
};

export function importActionProblem(code: string | undefined): string {
  if (!code) return 'That did not work. Try again.';
  return START_PROBLEMS[code] ?? 'That did not work. Try again.';
}

/**
 * The reading of a date in the file, under the convention chosen for it.
 *
 * A date cell is already a date and is taken as it is. Text is read under the
 * chosen convention only: nothing is inferred from the numbers themselves,
 * because 04/05 is a real date under either reading and guessing would be
 * silently wrong for half a backlog.
 */
export function readImportedDate(
  value: string,
  kind: 'text' | 'number' | 'date' | 'blank',
  convention: DateConvention,
): { iso: string } | { problem: 'unreadable' } | null {
  const text = value.trim();
  if (!text) return null;
  if (kind === 'date') return { iso: text.slice(0, 10) };

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return checked(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (parts) {
    const year = Number(parts[3]?.length === 2 ? `20${parts[3]}` : parts[3]);
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    if (convention === 'mdy') return checked(year, first, second);
    if (convention === 'iso') return { problem: 'unreadable' };
    return checked(year, second, first);
  }

  // "12 May 2026" and "12 Sept 2026" are unambiguous, whatever the convention.
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (named) {
    const month = MONTHS.indexOf((named[2] ?? '').slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return checked(Number(named[3]), month, Number(named[1]));
  }
  return { problem: 'unreadable' };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function checked(
  year: number,
  month: number,
  day: number,
): { iso: string } | { problem: 'unreadable' } {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return { problem: 'unreadable' };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { problem: 'unreadable' };
  if (!Number.isInteger(day) || day < 1 || day > 31) return { problem: 'unreadable' };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { problem: 'unreadable' };
  }
  return { iso: date.toISOString().slice(0, 10) };
}

/** A heading that obviously means one of our fields is offered as a suggestion. */
export function suggestMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const hints: Array<[ImportField, RegExp]> = [
    ['reference', /\b(finding|ref|no\.?|number|id)\b/i],
    ['description', /\b(description|observation|finding detail|detail|issue)\b/i],
    ['action', /\b(action|corrective|remedy|required)\b/i],
    ['owner_name', /\b(responsible|person|owner name|pic|in charge)\b/i],
    ['owner_email', /\b(e-?mail)\b/i],
    ['department', /\b(department|dept|section|area owner)\b/i],
    ['location', /\b(location|area|place|site)\b/i],
    ['reported_on', /\b(reported|raised|date found|inspection date)\b/i],
    ['due_on', /\b(target|due|deadline|completion)\b/i],
    ['risk', /\b(risk|severity)\b/i],
    ['priority', /\b(priority|urgency)\b/i],
    ['remarks', /\b(remark|progress|comment|note)\b/i],
    ['status', /\b(status|state)\b/i],
  ];
  const mapping: Partial<Record<ImportField, number>> = {};
  const taken = new Set<number>();
  for (const [field, pattern] of hints) {
    const index = headers.findIndex(
      (header, position) => !taken.has(position) && pattern.test(header),
    );
    if (index >= 0) {
      mapping[field] = index;
      taken.add(index);
    }
  }
  return mapping;
}

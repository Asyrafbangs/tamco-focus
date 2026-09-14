/**
 * Reading and writing the organisation file (v174).
 *
 * The file is CSV because every spreadsheet can save one and nothing has to be
 * installed to read it. The rules for what its rows mean live in the database,
 * in the planner both the check and the apply share; this module only turns the
 * text into rows and back, so the two cannot drift on anything but spelling.
 */

export const ORGANISATION_IMPORT_COLUMNS = [
  'employee_id',
  'name',
  'email',
  'department_code',
  'job_title',
  'manager_employee_id',
  'functional_manager_employee_id',
] as const;

export type OrganisationImportColumn = (typeof ORGANISATION_IMPORT_COLUMNS)[number];

/**
 * The columns that say where somebody sits. Name and email are there so a
 * person can read the file, and so a row whose employee ID points at somebody
 * else is caught; they are checked against the Directory, never written to it.
 */
const PLACEMENT_COLUMNS: OrganisationImportColumn[] = [
  'department_code',
  'job_title',
  'manager_employee_id',
  'functional_manager_employee_id',
];

/** One person's row. A column the file lacks is absent, not blank. */
export type OrganisationImportRow = { line: number } & Partial<
  Record<OrganisationImportColumn, string>
>;

export const ORGANISATION_IMPORT_MAX_ROWS = 2000;

export interface CsvRecord {
  line: number;
  cells: string[];
}

/**
 * RFC 4180, as spreadsheets write it: quoted cells may hold commas, doubled
 * quotes and line breaks. Each record carries the line it starts on, so a
 * problem can be pointed at in the spreadsheet the administrator has open.
 */
export function parseCsv(text: string): CsvRecord[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (character === '\n') line += 1;
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      endCell();
    } else if (character === '\r') {
      if (source[index + 1] === '\n') index += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else if (character === '\n') {
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      cell += character;
    }
  }
  if (cell.length > 0 || cells.length > 0) endRecord();

  // A spreadsheet leaves blank lines at the end; they are not people.
  return records.filter((record) => record.cells.some((value) => value.trim().length > 0));
}

/**
 * The guard a spreadsheet needs against its own formulas: a cell beginning with
 * one of these is run, not shown, when the file is opened. The export prefixes
 * an apostrophe, which spreadsheets hide, and the import takes it off again.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function unguard(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

function guard(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export type OrganisationFileResult =
  | { ok: true; rows: OrganisationImportRow[]; ignoredColumns: string[] }
  | { ok: false; message: string };

export function readOrganisationFile(text: string): OrganisationFileResult {
  return readOrganisationRecords(parseCsv(text));
}

/**
 * The same reading for rows that did not come from CSV text (v178): a
 * spreadsheet's first sheet, already split into cells. One set of rules for
 * headers, limits and blanks, whichever format the file arrived in.
 */
export function readOrganisationRecords(records: CsvRecord[]): OrganisationFileResult {
  const [header, ...body] = records;
  if (!header) return { ok: false, message: 'The file is empty.' };

  const names = header.cells.map(normaliseHeader);
  const known = new Set<string>(ORGANISATION_IMPORT_COLUMNS);
  const seen = new Set<string>();
  for (const name of names) {
    if (known.has(name) && seen.has(name)) {
      return { ok: false, message: `The column ${name} appears twice. Keep one.` };
    }
    seen.add(name);
  }
  if (!seen.has('employee_id')) {
    return {
      ok: false,
      message: 'The file needs an employee_id column: it is how each row finds its person.',
    };
  }
  if (!PLACEMENT_COLUMNS.some((column) => seen.has(column))) {
    return {
      ok: false,
      message: `The file has nothing to change. Add at least one of ${PLACEMENT_COLUMNS.join(', ')}.`,
    };
  }
  if (body.length === 0) {
    return { ok: false, message: 'The file has no people in it, only a header.' };
  }
  if (body.length > ORGANISATION_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      message: `A file can hold up to ${ORGANISATION_IMPORT_MAX_ROWS.toLocaleString('en-GB')} people. Split it and import each part.`,
    };
  }

  const rows = body.map((record) => {
    const row: OrganisationImportRow = { line: record.line };
    names.forEach((name, index) => {
      if (!known.has(name)) return;
      row[name as OrganisationImportColumn] = unguard((record.cells[index] ?? '').trim());
    });
    return row;
  });

  const ignoredColumns = header.cells
    .filter((_, index) => !known.has(names[index]!))
    .map((value) => value.trim())
    .filter(Boolean);

  return { ok: true, rows, ignoredColumns };
}

function csvCell(value: string): string {
  const safe = guard(value);
  return /[",\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The organisation as a file this screen can read back: every column, one row
 * per active person. Opened in a spreadsheet, changed, and imported, it applies
 * exactly the edits and nothing else.
 */
export function writeOrganisationFile(
  rows: Array<Record<OrganisationImportColumn, string | null>>,
): string {
  const lines = [ORGANISATION_IMPORT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(ORGANISATION_IMPORT_COLUMNS.map((column) => csvCell(row[column] ?? '')).join(','));
  }
  // The byte-order mark is what makes Excel read the file as UTF-8, so a name
  // with an accent opens as itself.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export type OrganisationImportField = 'department' | 'job_title' | 'manager' | 'dotted_line';

export interface OrganisationImportChange {
  field: OrganisationImportField;
  from: string | null;
  to: string | null;
}

/** What the database's check says about one row. */
export interface OrganisationImportVerdict {
  line: number;
  employeeId: string | null;
  name: string | null;
  status: 'change' | 'unchanged' | 'problem';
  problem: string | null;
  message: string | null;
  changes: OrganisationImportChange[];
}

export interface OrganisationImportState {
  stage: 'choose' | 'checked' | 'applied';
  ok: boolean;
  code: string;
  message: string;
  fileName: string;
  /** The rows as read, sent back unchanged when the administrator applies them. */
  rows: string;
  counts: { change: number; unchanged: number; problem: number };
  verdicts: OrganisationImportVerdict[];
  ignoredColumns: string[];
}

export function emptyOrganisationImport(): OrganisationImportState {
  return {
    stage: 'choose',
    ok: false,
    code: '',
    message: '',
    fileName: '',
    rows: '[]',
    counts: { change: 0, unchanged: 0, problem: 0 },
    verdicts: [],
    ignoredColumns: [],
  };
}

/**
 * The problems a file has, counted in words — "7 missing managers, 2 unknown
 * departments, 1 circular relationship" — in the order they are worth fixing,
 * which is the order the planner looks for them.
 */
const PROBLEM_WORDS: Array<[code: string, singular: string, plural: string]> = [
  ['missing_employee_id', 'row without an employee ID', 'rows without an employee ID'],
  ['duplicate_employee', 'row repeating an employee ID', 'rows repeating an employee ID'],
  ['unknown_employee', 'person not in the Directory', 'people not in the Directory'],
  ['deactivated_employee', 'deactivated account', 'deactivated accounts'],
  [
    'email_mismatch',
    'email that does not match the Directory',
    'emails that do not match the Directory',
  ],
  ['missing_department', 'row without a department', 'rows without a department'],
  ['unknown_department', 'unknown department', 'unknown departments'],
  ['archived_department', 'archived department', 'archived departments'],
  ['job_title_too_long', 'job title that is too long', 'job titles that are too long'],
  ['own_manager', 'person reporting to themselves', 'people reporting to themselves'],
  ['missing_manager', 'missing manager', 'missing managers'],
  ['inactive_manager', 'deactivated manager', 'deactivated managers'],
  ['own_functional_manager', 'dotted line to themselves', 'dotted lines to themselves'],
  ['missing_functional_manager', 'missing dotted-line manager', 'missing dotted-line managers'],
  [
    'inactive_functional_manager',
    'deactivated dotted-line manager',
    'deactivated dotted-line managers',
  ],
  [
    'functional_is_primary',
    'dotted line to their own manager',
    'dotted lines to their own manager',
  ],
  ['circular', 'circular relationship', 'circular relationships'],
  ['too_deep', 'line more than 64 levels deep', 'lines more than 64 levels deep'],
];

export function summariseProblems(
  verdicts: Array<Pick<OrganisationImportVerdict, 'problem'>>,
): Array<{ code: string; count: number; label: string }> {
  const counts = new Map<string, number>();
  for (const verdict of verdicts) {
    if (verdict.problem) counts.set(verdict.problem, (counts.get(verdict.problem) ?? 0) + 1);
  }
  const known = PROBLEM_WORDS.flatMap(([code, singular, plural]) => {
    const count = counts.get(code) ?? 0;
    counts.delete(code);
    return count > 0 ? [{ code, count, label: `${count} ${count === 1 ? singular : plural}` }] : [];
  });
  // A code the database learns before this list does is still counted, plainly.
  const unknown = [...counts].map(([code, count]) => ({
    code,
    count,
    label: `${count} ${count === 1 ? 'row' : 'rows'} with another problem`,
  }));
  return [...known, ...unknown];
}

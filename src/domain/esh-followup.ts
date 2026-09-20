export interface FollowupPolicyInput {
  preDueDays: number;
  remindOnDue: boolean;
  overdueEveryDays: number;
  levelDays: number[];
  reviewReminderDays: number;
}

export interface WorkingCalendarException {
  date: string;
  isWorkingDay: boolean;
  label: string;
}

/** Mirror the database bounds so the form can explain a problem before RPC. */
export function followupPolicyProblems(input: FollowupPolicyInput): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(input.preDueDays) || input.preDueDays < 0 || input.preDueDays > 30) {
    problems.push('Choose a pre-due reminder from 0 to 30 calendar days.');
  }
  if (
    !Number.isInteger(input.overdueEveryDays) ||
    input.overdueEveryDays < 1 ||
    input.overdueEveryDays > 30
  ) {
    problems.push('Choose an overdue reminder interval from 1 to 30 calendar days.');
  }
  if (
    !Number.isInteger(input.reviewReminderDays) ||
    input.reviewReminderDays < 1 ||
    input.reviewReminderDays > 30
  ) {
    problems.push('Choose an ESH review reminder from 1 to 30 working days.');
  }
  if (input.levelDays.length < 1 || input.levelDays.length > 9) {
    problems.push('Configure between one and nine escalation levels.');
  }
  input.levelDays.forEach((days, index) => {
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      problems.push(`Level ${index + 1} must be from 0 to 365 calendar days overdue.`);
    }
    if (index > 0 && days <= (input.levelDays[index - 1] ?? -1)) {
      problems.push(`Level ${index + 1} must happen after Level ${index}.`);
    }
  });
  return [...new Set(problems)];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar exceptions are deliberately plain text so a maintained holiday
 * list can be pasted and reviewed. Each line is `YYYY-MM-DD | label`.
 */
export function parseCalendarExceptionLines(
  value: string,
  isWorkingDay: boolean,
): { rows: WorkingCalendarException[]; problems: string[] } {
  const rows: WorkingCalendarException[] = [];
  const problems: string[] = [];
  for (const [index, raw] of value.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const divider = line.indexOf('|');
    const date = (divider >= 0 ? line.slice(0, divider) : line).trim();
    const label = (divider >= 0 ? line.slice(divider + 1) : '').trim();
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !DATE.test(date) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      problems.push(`Line ${index + 1}: use a real date as YYYY-MM-DD.`);
      continue;
    }
    if (!label || label.length > 120) {
      problems.push(`Line ${index + 1}: add a label of 1 to 120 characters after “|”.`);
      continue;
    }
    rows.push({ date, isWorkingDay, label });
  }
  return { rows, problems };
}

export function calendarLines(rows: WorkingCalendarException[], isWorkingDay: boolean): string {
  return rows
    .filter((row) => row.isWorkingDay === isWorkingDay)
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => `${row.date} | ${row.label}`)
    .join('\n');
}

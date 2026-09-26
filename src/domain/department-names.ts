/**
 * Telling one department from another one spelled slightly differently (v225).
 *
 * A department can now be added from the finding form, which is the whole
 * point — nobody should have to abandon a half-typed finding to go and create
 * "Maintenance". The risk that buys is a register split across Maintenance,
 * Maintainance and Maintenance Dept, each with its own escalation route and its
 * own row in every report, which is far harder to undo than it is to prevent.
 *
 * So the question this answers is not "is this name taken" — the database
 * already refuses that — but "is this close enough to one you already have that
 * you should look before you add it".
 */

/** Down to letters and digits: "Maintenance (BR2)" and "maintenance br2" agree. */
export function normalizeDepartmentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A code from a name, the way somebody would write it themselves. */
export function suggestDepartmentCode(name: string): string {
  const cleaned = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 32);
}

/** Whether a code is one the database will accept (create_department's rule). */
export function departmentCodeProblem(code: string): string | null {
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) {
    return 'A code is 2 to 32 letters, digits, dashes or underscores.';
  }
  return null;
}

/**
 * Edit distance, capped: two names more than `limit` edits apart are simply
 * different, and there is no reason to finish counting.
 */
function within(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return false;
    previous = row;
  }
  return (previous[b.length] ?? limit + 1) <= limit;
}

/**
 * The departments worth looking at before adding this name: the same name
 * spelled differently, one that contains the other, or one a couple of
 * keystrokes away.
 *
 * Longer names get a little more slack, because a typo in "Quality Assurance"
 * is no more suspicious than one in "QA" and far more likely.
 */
export function similarDepartments<T extends { id: string; name: string }>(
  name: string,
  departments: readonly T[],
): T[] {
  const needle = normalizeDepartmentName(name);
  if (needle.length < 3) return [];
  const slack = needle.length >= 12 ? 3 : needle.length >= 6 ? 2 : 1;
  return departments.filter((department) => {
    const other = normalizeDepartmentName(department.name);
    if (!other) return false;
    if (other === needle) return true;
    if (other.includes(needle) || needle.includes(other)) return true;
    return within(needle, other, slack);
  });
}

/** What the combobox offers for what has been typed so far. */
export function matchingDepartments<T extends { id: string; name: string }>(
  query: string,
  departments: readonly T[],
): T[] {
  const needle = normalizeDepartmentName(query);
  if (!needle) return [...departments];
  const words = needle.split(' ');
  return departments.filter((department) => {
    const other = normalizeDepartmentName(department.name);
    return words.every((word) => other.includes(word));
  });
}

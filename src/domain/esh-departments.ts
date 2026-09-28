/**
 * Choosing a department while recording a finding (v223).
 *
 * Search first, choose what exists, add only what is genuinely missing. A
 * register split across "Warehouse", "Ware House" and "WH" cannot be reported
 * on, so a new name that is close to an existing one says so before anything
 * is created. The database refuses an exact match by the same key.
 */

export interface DepartmentChoice {
  id: string;
  name: string;
}

/**
 * The comparison key, as `focus.esh_department_key` computes it: case,
 * spacing, punctuation and "&" versus "and" do not make two departments.
 */
export function departmentKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/** Edit distance, for "Warehose" against "Warehouse". Small strings only. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0;
      row[j] = Math.min(
        current + 1,
        (row[j - 1] ?? 0) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

/** Departments whose names contain what was typed, best matches first. */
export function matchDepartments(
  query: string,
  departments: DepartmentChoice[],
): DepartmentChoice[] {
  const typed = query.trim().toLowerCase();
  if (!typed) return departments;
  const key = departmentKey(typed);
  return departments
    .filter(
      (department) =>
        department.name.toLowerCase().includes(typed) ||
        (key.length > 0 && departmentKey(department.name).includes(key)),
    )
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(typed) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(typed) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    });
}

/**
 * What adding this name would do: `exists` when it is an existing department
 * spelled differently, `similar` when it is close enough to be one, `new`
 * otherwise.
 */
export function departmentProposal(
  name: string,
  departments: DepartmentChoice[],
): { kind: 'exists' | 'similar'; department: DepartmentChoice } | { kind: 'new' } | null {
  const key = departmentKey(name);
  if (key.length < 2) return null;
  const same = departments.find((department) => departmentKey(department.name) === key);
  if (same) return { kind: 'exists', department: same };
  const close = departments.find((department) => {
    const other = departmentKey(department.name);
    if (other.length < 2) return false;
    if (other.includes(key) || key.includes(other)) return true;
    const allowed = Math.max(1, Math.floor(Math.min(key.length, other.length) / 5));
    return distance(key, other) <= allowed;
  });
  return close ? { kind: 'similar', department: close } : { kind: 'new' };
}

const PROBLEMS: Record<string, string> = {
  not_permitted: 'Adding a department needs organisation-wide Finding Management access.',
  name_invalid: 'Give the department a name of 2 to 80 characters.',
  exists: 'That department already exists, and has been chosen.',
};

export function departmentProblem(code: string | undefined): string {
  return (code ? PROBLEMS[code] : undefined) ?? 'The department could not be added. Try again.';
}

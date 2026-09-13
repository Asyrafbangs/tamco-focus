import Link from 'next/link';

import type {
  OrganisationIssueDepartment,
  OrganisationIssuePerson,
  OrganisationIssues,
} from '@/server/queries';

/**
 * The organisation's gaps, stated rather than left to be noticed (v171).
 *
 * Every line here is something the records already knew and no screen said:
 * people nobody placed, people with no department, people still reporting to an
 * account that has gone, and departments with nobody — or nobody still here —
 * at their head. Each opens to the people or departments concerned, and each
 * of those carries the control that fixes it, so the panel is a route to the
 * fix rather than a report about the problem.
 *
 * Quiet when there is nothing: one line saying so, not an empty dashboard.
 */

export type IssueKind = keyof Omit<OrganisationIssues, 'total'>;

const ORDER: IssueKind[] = [
  'orphanedByDeactivation',
  'inactiveHead',
  'unplaced',
  'noDepartment',
  'noHead',
];

/** The sentence for a count, and the short noun phrase a control is named by. */
function describe(kind: IssueKind, count: number): { sentence: string; noun: string } {
  const people = count === 1 ? 'person' : 'people';
  const departments = count === 1 ? 'department' : 'departments';
  switch (kind) {
    case 'orphanedByDeactivation':
      return {
        sentence: `${count} ${people} still ${count === 1 ? 'reports' : 'report'} to a deactivated account`,
        noun: 'people reporting to a deactivated account',
      };
    case 'inactiveHead':
      return {
        sentence: `${count} ${departments} ${count === 1 ? 'is' : 'are'} headed by a deactivated account`,
        noun: 'departments headed by a deactivated account',
      };
    case 'unplaced':
      return {
        sentence: `${count} ${people} ${count === 1 ? 'has' : 'have'} no manager and nobody reporting to them`,
        noun: 'people with no manager and no reports',
      };
    case 'noDepartment':
      return {
        sentence: `${count} ${people} ${count === 1 ? 'has' : 'have'} no department`,
        noun: 'people with no department',
      };
    case 'noHead':
      return {
        sentence: `${count} ${departments} ${count === 1 ? 'has' : 'have'} no head`,
        noun: 'departments with no head',
      };
  }
}

function PersonItem({
  kind,
  person,
  moveHref,
}: {
  kind: IssueKind;
  person: OrganisationIssuePerson;
  moveHref: (personId: string) => string;
}) {
  return (
    <li className="org-issue-item">
      <div className="org-issue-item-main">
        <strong>{person.fullName}</strong>
        <span className="sub">
          {[person.jobTitle, person.employeeId, person.departmentName].filter(Boolean).join(' · ')}
          {person.managerName ? ` · reports to ${person.managerName} (deactivated)` : ''}
        </span>
      </div>
      {kind === 'noDepartment' ? (
        // A department is part of who somebody is, which the Directory keeps.
        <Link
          className="btn small ghost"
          href={`/more/admin/users?user=${person.id}`}
          aria-label={`Set a department for ${person.fullName}`}
        >
          Set department
        </Link>
      ) : (
        <Link
          className="btn small ghost"
          href={moveHref(person.id)}
          aria-label={`Change who ${person.fullName} reports to`}
        >
          Change manager
        </Link>
      )}
    </li>
  );
}

function DepartmentItem({
  department,
  departmentHref,
}: {
  department: OrganisationIssueDepartment;
  departmentHref: (departmentId: string) => string;
}) {
  return (
    <li className="org-issue-item">
      <div className="org-issue-item-main">
        <strong>{department.name}</strong>
        <span className="sub">
          {department.code}
          {department.headName ? ` · headed by ${department.headName} (deactivated)` : ''}
        </span>
      </div>
      <Link
        className="btn small ghost"
        href={departmentHref(department.id)}
        aria-label={`Edit ${department.name}`}
      >
        Edit
      </Link>
    </li>
  );
}

export function OrganisationIssuesPanel({
  issues,
  openKind,
  issueHref,
  moveHref,
  departmentHref,
}: {
  issues: OrganisationIssues;
  /*
   * The raw `issue` value from the address. It is matched against the kinds
   * below rather than validated by the page, so an unknown value opens nothing
   * and the list of kinds lives in one place.
   */
  openKind: string;
  issueHref: (kind: IssueKind | null) => string;
  moveHref: (personId: string) => string;
  departmentHref: (departmentId: string) => string;
}) {
  const present = ORDER.filter((kind) => issues[kind].length > 0);

  return (
    <section className="section-block org-issues" aria-labelledby="org-issues-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Issues</p>
          <h2 id="org-issues-heading">
            {issues.total === 0
              ? 'No organisation issues'
              : `${issues.total} organisation ${issues.total === 1 ? 'issue' : 'issues'}`}
          </h2>
        </div>
      </div>

      {present.length > 0 && (
        <ul className="org-issue-lines">
          {present.map((kind) => {
            const count = issues[kind].length;
            const { sentence, noun } = describe(kind, count);
            const isOpen = openKind === kind;
            return (
              <li key={kind} className="org-issue-line" data-issue={kind}>
                <div className="org-issue-summary">
                  <span>{sentence}</span>
                  <Link
                    className="btn small ghost"
                    href={issueHref(isOpen ? null : kind)}
                    aria-label={`${isOpen ? 'Hide' : 'Show'} ${noun}`}
                  >
                    {isOpen ? 'Hide' : 'Show'}
                  </Link>
                </div>
                {isOpen && (
                  <ul className="org-issue-items">
                    {kind === 'noHead' || kind === 'inactiveHead'
                      ? issues[kind].map((department) => (
                          <DepartmentItem
                            key={department.id}
                            department={department}
                            departmentHref={departmentHref}
                          />
                        ))
                      : issues[kind].map((person) => (
                          <PersonItem
                            key={person.id}
                            kind={kind}
                            person={person}
                            moveHref={moveHref}
                          />
                        ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

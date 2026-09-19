import Link from 'next/link';
import { notFound } from 'next/navigation';

import { WorkspaceTabs } from '@/components/ui/ParityPrimitives';
import { SubmitOnSelect } from '@/components/ui/SubmitOnSelect';
import { requireProfile } from '@/lib/supabase/server';

import { DepartmentForm } from './DepartmentForm';
import { MoveConfirmation, type MovePerson } from './MoveConfirmation';
import { OrganisationDrag } from './OrganisationDrag';
import { OrganisationImport } from './OrganisationImport';
import { OrganisationIssuesPanel, type IssueKind } from './OrganisationIssuesPanel';
import {
  findOrganisationPeople,
  getDirectoryData,
  getOrganisationBranch,
  getOrganisationIssues,
  getOrganisationOverview,
  type DirectoryUser,
  type OrganisationDepartment,
  type OrganisationMatch,
  type OrganisationPerson,
} from '@/server/queries';

/**
 * Administrator → Identity and access → Organisation.
 *
 * The half the Directory cannot show: who reports to whom, which department
 * sits under which, and where the gaps are — and, since v169, v170, v173 and
 * v174, the place a reporting line is moved, a dotted line is drawn, a
 * department is made or changed, and a whole organisation is imported.
 *
 * Everything that opens here opens through the URL rather than in the browser:
 * a branch, a move or a dotted line being confirmed, a department being edited,
 * an import.
 * That keeps the page a server render, survives a reload and a shared link, and
 * works without JavaScript. It also means a branch is fetched only when somebody
 * asks for it: a chart that draws six hundred people at once is a wall of boxes
 * nobody can read and a page nobody waits for.
 */

function toggleHref(openIds: string[], id: string, term: string): string {
  const next = openIds.includes(id)
    ? openIds.filter((candidate) => candidate !== id)
    : [...openIds, id];
  const params = new URLSearchParams();
  if (next.length > 0) params.set('open', next.join(','));
  if (term) params.set('q', term);
  const query = params.toString();
  return query ? `/more/admin/organisation?${query}` : '/more/admin/organisation';
}

/** This same view with nothing open for editing: what Cancel returns to. */
function viewHref(openIds: string[], term: string): string {
  const params = new URLSearchParams();
  if (openIds.length > 0) params.set('open', openIds.join(','));
  if (term) params.set('q', term);
  const query = params.toString();
  return query ? `/more/admin/organisation?${query}` : '/more/admin/organisation';
}

/** This same view with one more thing to open — a move, a dotted line, a department. */
function withParam(openIds: string[], term: string, key: string, value: string): string {
  const params = new URLSearchParams();
  if (openIds.length > 0) params.set('open', openIds.join(','));
  if (term) params.set('q', term);
  params.set(key, value);
  return `/more/admin/organisation?${params.toString()}`;
}

/** The four facts a confirmation panel shows about a person. */
function toMovePerson(person: DirectoryUser): MovePerson {
  return {
    id: person.id,
    fullName: person.fullName,
    jobTitle: person.jobTitle,
    employeeId: person.employeeId,
  };
}

function byName(left: DirectoryUser, right: DirectoryUser): number {
  return left.fullName.localeCompare(right.fullName);
}

/**
 * The chart opened down to one person (v177): every branch above them, and
 * their own, so they are drawn with the line over them and the people under
 * them — which is what "find Amer" was asked to show.
 */
function chartHref(match: OrganisationMatch): string {
  const params = new URLSearchParams();
  params.set('open', [...match.chain.map((link) => link.id), match.id].join(','));
  params.set('focus', match.id);
  return `/more/admin/organisation?${params.toString()}#org-person-${match.id}`;
}

function PersonNode({
  person,
  openIds,
  branches,
  term,
  focusId,
}: {
  person: OrganisationPerson;
  openIds: string[];
  branches: Map<string, OrganisationPerson[]>;
  term: string;
  /** The person a search asked to be shown, marked where the chart draws them. */
  focusId: string;
}) {
  const isOpen = openIds.includes(person.id);
  const reports = branches.get(person.id) ?? [];
  return (
    <li
      className="org-node"
      id={`org-person-${person.id}`}
      data-focused={focusId === person.id ? 'true' : undefined}
    >
      {/* `data-person-id` is what a drop reads: who was carried, and who
          received them. It is inert without the enhancement. */}
      <div className="org-person" data-person-id={person.id}>
        <div className="org-person-main">
          <strong>{person.fullName}</strong>
          <span className="sub">
            {[person.jobTitle, person.employeeId, person.departmentName]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {/* Said in words, so the relationship never depends on seeing a
              dotted underline (v173). */}
          {person.functionalManagerName && (
            <span className="sub org-dotted-line">
              Dotted line to {person.functionalManagerName}
            </span>
          )}
        </div>
        <div className="org-person-actions">
          {person.directReportCount > 0 ? (
            <Link className="btn small ghost" href={toggleHref(openIds, person.id, term)}>
              {isOpen ? 'Hide' : 'Show'} {person.directReportCount}{' '}
              {person.directReportCount === 1 ? 'report' : 'reports'}
            </Link>
          ) : (
            <span className="sub org-person-leaf">No reports</span>
          )}
          {/*
            The control that does not need a mouse (v169).
            Dragging is offered as well, but it cannot be the only way to move
            somebody: it is unusable on a phone and unreachable by keyboard.
            Both routes lead to the same confirmation.
          */}
          <Link
            className="btn small ghost"
            href={withParam(openIds, term, 'move', person.id)}
            aria-label={`Change who ${person.fullName} reports to`}
          >
            Change manager
          </Link>
          <Link
            className="btn small ghost"
            href={withParam(openIds, term, 'dotted', person.id)}
            aria-label={`Set the dotted line for ${person.fullName}`}
          >
            Dotted line
          </Link>
        </div>
      </div>
      {isOpen && reports.length > 0 && (
        <ul className="org-branch">
          {reports.map((report) => (
            <PersonNode
              key={report.id}
              person={report}
              openIds={openIds}
              branches={branches}
              term={term}
              focusId={focusId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function DepartmentCard({
  department,
  subDepartments,
  openIds,
  term,
}: {
  department: OrganisationDepartment;
  /* Departments sitting under this one, not React children. */
  subDepartments: OrganisationDepartment[];
  openIds: string[];
  term: string;
}) {
  return (
    <li className="org-department">
      <div className="org-department-row">
        <div className="org-department-main">
          <strong>{department.name}</strong>
          <span className="sub">
            {department.code} · {department.memberCount}{' '}
            {department.memberCount === 1 ? 'person' : 'people'} ·{' '}
            {department.headName ? `Head: ${department.headName}` : 'No head'}
          </span>
        </div>
        <div className="org-department-actions">
          {/* Who is in it (v177): the department opened, rather than a tree of
              the whole company to be searched for its members. */}
          <Link
            className="btn small ghost"
            href={`/more/admin/organisation?dept=${department.id}`}
            aria-label={`Show the people in ${department.name}`}
          >
            People
          </Link>
          <Link
            className="btn small ghost"
            href={withParam(openIds, term, 'department', department.id)}
            aria-label={`Edit ${department.name}`}
          >
            Edit
          </Link>
        </div>
      </div>
      {subDepartments.length > 0 && (
        <ul className="org-department-children">
          {subDepartments.map((child) => (
            <DepartmentCard
              key={child.id}
              department={child}
              subDepartments={[]}
              openIds={openIds}
              term={term}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function OrganisationPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    open?: string;
    move?: string;
    to?: string;
    dotted?: string;
    department?: string;
    issue?: string;
    import?: string;
    dept?: string;
    focus?: string;
  }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') notFound();

  const params = await searchParams;
  const term = params.q?.trim() ?? '';
  const openIds = (params.open ?? '').split(',').filter(Boolean);
  const moveId = params.move?.trim() ?? '';
  const proposedManagerId = params.to?.trim() ?? '';
  const dottedId = params.dotted?.trim() ?? '';
  const departmentParam = params.department?.trim() ?? '';
  const issueParam = params.issue?.trim() ?? '';
  const importing = params.import === '1';
  const deptFilter = params.dept?.trim() ?? '';
  const focusId = params.focus?.trim() ?? '';

  const [overview, matches, directory, issues] = await Promise.all([
    getOrganisationOverview(),
    term || deptFilter ? findOrganisationPeople(term, deptFilter) : Promise.resolve([]),
    /*
     * The list of people is loaded only while something needs a person picked:
     * a move or a dotted line being confirmed, or a department's head chosen.
     *
     * It is the one query here that is proportional to the company rather than
     * to what is on screen, and the ordinary view has no use for it.
     */
    moveId || dottedId || departmentParam ? getDirectoryData() : Promise.resolve(null),
    // Always: the gaps are what an administrator opens this screen to find.
    getOrganisationIssues(),
  ]);

  const people = directory?.users ?? [];
  const personById = (id: string | null | undefined) =>
    id ? (people.find((person) => person.id === id) ?? null) : null;

  const subject = personById(moveId);
  const currentManager = personById(subject?.reportingManagerId);
  const managerOptions = people
    .filter((person) => person.status === 'active' && person.id !== moveId)
    .sort(byName);

  const dottedSubject = personById(dottedId);
  const currentDotted = personById(dottedSubject?.functionalManagerId);
  /*
   * Not offered: the person themselves, and their reporting manager. A dotted
   * line to the same person as the solid one says nothing, and the procedure
   * refuses it; a choice that can only be refused is not a choice.
   */
  const dottedOptions = people
    .filter(
      (person) =>
        person.status === 'active' &&
        person.id !== dottedId &&
        person.id !== dottedSubject?.reportingManagerId,
    )
    .sort(byName);

  const creatingDepartment = departmentParam === 'new';
  const editingDepartment =
    departmentParam && !creatingDepartment
      ? (overview.departments.find((department) => department.id === departmentParam) ?? null)
      : null;
  /*
   * The choices keep whatever the department already points at, even when it
   * is archived or deactivated. An uncontrolled select whose saved value is not
   * among its options shows its first option instead — and saving would then
   * clear a parent or a head nobody asked to clear.
   */
  const departmentChoices = overview.departments
    .filter(
      (department) =>
        department.status === 'active' || department.id === editingDepartment?.parentId,
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((department) => ({ id: department.id, name: department.name, code: department.code }));
  const headChoices = people
    .filter((person) => person.status === 'active' || person.id === editingDepartment?.headId)
    .sort(byName)
    .map((person) => ({
      id: person.id,
      fullName: person.fullName,
      employeeId: person.employeeId,
    }));

  const branchEntries = await Promise.all(
    openIds.map(async (id) => [id, await getOrganisationBranch(id)] as const),
  );
  const branches = new Map<string, OrganisationPerson[]>(branchEntries);

  const active = overview.departments.filter((department) => department.status === 'active');
  const filteredDepartment = deptFilter
    ? (overview.departments.find((department) => department.id === deptFilter) ?? null)
    : null;
  const roots = active.filter((department) => department.parentId === null);
  const childrenOf = (parentId: string) =>
    active.filter((department) => department.parentId === parentId);

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Identity and access</h1>
          <p>Manage people, departments and reporting relationships.</p>
        </div>
        <div className="actions">
          <Link className="btn" href={withParam(openIds, term, 'import', '1')}>
            Import organisation
          </Link>
          <Link className="btn" href={withParam(openIds, term, 'department', 'new')}>
            + Department
          </Link>
        </div>
      </div>

      <WorkspaceTabs
        label="Identity and access"
        items={[
          { href: '/more/admin/users', label: 'Directory' },
          { href: '/more/admin/organisation', label: 'Organisation', active: true },
          { href: '/more/admin/contacts', label: 'Email contacts' },
        ]}
      />

      <form className="filterbar" role="search" action="/more/admin/organisation">
        <label>
          <span>Find a person</span>
          <input name="q" defaultValue={term} placeholder="Name, employee ID or job title" />
        </label>
        <label>
          <span>Department</span>
          {/* Filters a search, or on its own lists the department (v177). */}
          <select name="dept" defaultValue={deptFilter}>
            <option value="">All departments</option>
            {overview.departments
              .filter(
                (department) => department.status === 'active' || department.id === deptFilter,
              )
              .sort((left, right) => left.name.localeCompare(right.name))
              .map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
          </select>
        </label>
        {/* "Find", not "Search": the app shell already has a Search, and two
            controls with one name is a guess for anybody listening to the page
            rather than looking at it. */}
        <button className="btn small" type="submit">
          Find
        </button>
        {(term || deptFilter) && (
          <Link className="btn small ghost" href="/more/admin/organisation">
            Clear
          </Link>
        )}
        {/* Choosing a department lists it at once (v179). */}
        <SubmitOnSelect />
      </form>

      {/*
        The gaps first (v171): they are what an administrator opens this screen
        to find. Each entry links into the same forms the rest of the page uses,
        so fixing a gap and maintaining the organisation are one path, not two.
      */}
      <OrganisationIssuesPanel
        issues={issues}
        openKind={issueParam}
        issueHref={(kind: IssueKind | null) =>
          kind ? withParam(openIds, term, 'issue', kind) : viewHref(openIds, term)
        }
        moveHref={(personId) => withParam(openIds, term, 'move', personId)}
        departmentHref={(departmentId) => withParam(openIds, term, 'department', departmentId)}
      />

      {/*
        Keyed by what is open, for the same reason the Directory keys its form
        by person: every field in these panels is uncontrolled and takes its
        value on mount. Moving from one "Change manager" straight to another
        would otherwise reuse the panel and keep the first person's choice on
        screen — and saving writes what is on screen.
      */}
      {/* Setting up or reorganising many people at once (v174). Checked in the
          database before anything is written; see OrganisationImport. */}
      {importing && (
        <OrganisationImport
          cancelHref={viewHref(openIds, term)}
          exportHref="/more/admin/organisation/export"
        />
      )}
      {(creatingDepartment || editingDepartment) && (
        <DepartmentForm
          key={departmentParam}
          department={
            editingDepartment
              ? {
                  id: editingDepartment.id,
                  name: editingDepartment.name,
                  code: editingDepartment.code,
                  parentId: editingDepartment.parentId,
                  headId: editingDepartment.headId,
                  status: editingDepartment.status,
                }
              : null
          }
          departments={departmentChoices}
          people={headChoices}
          cancelHref={viewHref(openIds, term)}
        />
      )}

      {/*
        The confirmation, and the enhancement that can only lead to it (v169).

        `OrganisationDrag` renders nothing: it attaches dragging to the tree
        already on the page, and a drop navigates here rather than saving. So
        the page behaves identically whether or not that script ever runs.
      */}
      {subject && (
        <MoveConfirmation
          key={`move:${moveId}:${proposedManagerId}`}
          relationship="primary"
          subject={toMovePerson(subject)}
          currentManager={currentManager ? toMovePerson(currentManager) : null}
          proposedManagerId={proposedManagerId}
          options={managerOptions.map(toMovePerson)}
          cancelHref={viewHref(openIds, term)}
        />
      )}
      {/* The dotted line (v173): the same door, its own words, and no drag —
          dragging draws the formal line, which is the one people mean. */}
      {dottedSubject && (
        <MoveConfirmation
          key={`dotted:${dottedId}`}
          relationship="functional"
          subject={toMovePerson(dottedSubject)}
          currentManager={currentDotted ? toMovePerson(currentDotted) : null}
          proposedManagerId=""
          options={dottedOptions.map(toMovePerson)}
          cancelHref={viewHref(openIds, term)}
        />
      )}
      <OrganisationDrag query={viewHref(openIds, term).split('?')[1] ?? ''} />

      {(term || deptFilter) && (
        <section className="section-block" aria-labelledby="org-search-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{term ? 'Search' : 'Department'}</p>
              <h2 id="org-search-heading">
                {matches.length} {matches.length === 1 ? 'person' : 'people'}{' '}
                {term ? `matching “${term}”` : ''}
                {term && filteredDepartment ? ' ' : ''}
                {filteredDepartment ? `in ${filteredDepartment.name}` : ''}
              </h2>
              {!term && filteredDepartment && (
                <p>
                  {filteredDepartment.headName
                    ? `Headed by ${filteredDepartment.headName}.`
                    : 'Nobody heads this department yet.'}
                </p>
              )}
            </div>
          </div>
          {matches.length === 0 ? (
            <div className="card empty-state">
              <p>
                {term
                  ? 'Nobody active matches that name, employee ID or job title.'
                  : 'Nobody active is in this department.'}
              </p>
            </div>
          ) : (
            <ul className="org-matches">
              {matches.map((match) => (
                <li key={match.id} className="org-match">
                  <strong>
                    {match.fullName}
                    {filteredDepartment?.headId === match.id ? ' · Head of department' : ''}
                  </strong>
                  <span className="sub">
                    {[match.jobTitle, match.employeeId, match.departmentName]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="sub org-chain">
                    {/* Where they sit, which is the half a name cannot say. */}
                    {match.chain.length === 0
                      ? 'Top of the reporting line'
                      : match.chain.map((link) => link.fullName).join(' → ') +
                        ` → ${match.fullName}`}
                  </span>
                  <span className="org-match-actions">
                    <Link
                      className="btn small ghost"
                      href={chartHref(match)}
                      aria-label={`Show ${match.fullName} in the chart`}
                    >
                      Show in chart
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="section-block" aria-labelledby="org-departments-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Departments</p>
            <h2 id="org-departments-heading">
              {active.length} {active.length === 1 ? 'department' : 'departments'}
            </h2>
            <p>Each one with its size and who heads it. Archived departments are not listed.</p>
          </div>
        </div>
        {active.length === 0 ? (
          <div className="card empty-state">
            <p>No departments yet.</p>
          </div>
        ) : (
          <ul className="org-departments">
            {roots.map((department) => (
              <DepartmentCard
                key={department.id}
                department={department}
                subDepartments={childrenOf(department.id)}
                openIds={openIds}
                term={term}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="section-block" aria-labelledby="org-reporting-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Reporting</p>
            <h2 id="org-reporting-heading">Who reports to whom</h2>
            <p>
              Starts at the top of the line. Open a branch to load the people under it, rather than
              drawing the whole organisation at once.
            </p>
          </div>
        </div>
        {overview.roots.length === 0 ? (
          <div className="card empty-state">
            <p>Nobody sits at the top of the reporting line yet.</p>
          </div>
        ) : (
          <ul className="org-tree">
            {overview.roots.map((person) => (
              <PersonNode
                key={person.id}
                person={person}
                openIds={openIds}
                branches={branches}
                term={term}
                focusId={focusId}
              />
            ))}
          </ul>
        )}
        {overview.unassignedCount > 0 && (
          <p className="sub org-unassigned">
            {overview.unassignedCount}{' '}
            {overview.unassignedCount === 1 ? 'person has' : 'people have'} no department.
          </p>
        )}
      </section>
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { WorkspaceTabs } from '@/components/ui/ParityPrimitives';
import { requireProfile } from '@/lib/supabase/server';

import { MoveConfirmation } from './MoveConfirmation';
import { OrganisationDrag } from './OrganisationDrag';
import {
  findOrganisationPeople,
  getDirectoryData,
  getOrganisationBranch,
  getOrganisationOverview,
  type OrganisationDepartment,
  type OrganisationPerson,
} from '@/server/queries';

/**
 * Administrator → Identity and access → Organisation.
 *
 * The half the Directory cannot show: who reports to whom, which department
 * sits under which, and where the gaps are. It is read-only here; changing a
 * reporting line comes next.
 *
 * Branches open through the URL rather than in the browser, which keeps the
 * page a server render, survives a reload and a shared link, and works without
 * JavaScript. It also means a branch is fetched only when somebody asks for it:
 * a chart that draws six hundred people at once is a wall of boxes nobody can
 * read and a page nobody waits for.
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

/** This same view with no move in progress: what Cancel returns to. */
function viewHref(openIds: string[], term: string): string {
  const params = new URLSearchParams();
  if (openIds.length > 0) params.set('open', openIds.join(','));
  if (term) params.set('q', term);
  const query = params.toString();
  return query ? `/more/admin/organisation?${query}` : '/more/admin/organisation';
}

function PersonNode({
  person,
  openIds,
  branches,
  term,
}: {
  person: OrganisationPerson;
  openIds: string[];
  branches: Map<string, OrganisationPerson[]>;
  term: string;
}) {
  const isOpen = openIds.includes(person.id);
  const reports = branches.get(person.id) ?? [];
  return (
    <li className="org-node">
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
            href={`/more/admin/organisation?${new URLSearchParams({
              ...(openIds.length > 0 ? { open: openIds.join(',') } : {}),
              ...(term ? { q: term } : {}),
              move: person.id,
            }).toString()}`}
            aria-label={`Change who ${person.fullName} reports to`}
          >
            Change manager
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
}: {
  department: OrganisationDepartment;
  /* Departments sitting under this one, not React children. */
  subDepartments: OrganisationDepartment[];
}) {
  return (
    <li className="org-department">
      <div className="org-department-main">
        <strong>{department.name}</strong>
        <span className="sub">
          {department.code} · {department.memberCount}{' '}
          {department.memberCount === 1 ? 'person' : 'people'} ·{' '}
          {department.headName ? `Head: ${department.headName}` : 'No head'}
        </span>
      </div>
      {subDepartments.length > 0 && (
        <ul className="org-department-children">
          {subDepartments.map((child) => (
            <DepartmentCard key={child.id} department={child} subDepartments={[]} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function OrganisationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; open?: string; move?: string; to?: string; saved?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') notFound();

  const params = await searchParams;
  const term = params.q?.trim() ?? '';
  const openIds = (params.open ?? '').split(',').filter(Boolean);
  const moveId = params.move?.trim() ?? '';
  const proposedManagerId = params.to?.trim() ?? '';

  const [overview, matches, directory] = await Promise.all([
    getOrganisationOverview(),
    term ? findOrganisationPeople(term) : Promise.resolve([]),
    /*
     * The list of people is loaded only while a move is being confirmed.
     *
     * It is the one query here that is proportional to the company rather than
     * to what is on screen, and the ordinary view has no use for it.
     */
    moveId ? getDirectoryData() : Promise.resolve(null),
  ]);

  const subject = directory?.users.find((person) => person.id === moveId) ?? null;
  const currentManager = subject?.reportingManagerId
    ? (directory?.users.find((person) => person.id === subject.reportingManagerId) ?? null)
    : null;
  const managerOptions = (directory?.users ?? [])
    .filter((person) => person.status === 'active' && person.id !== moveId)
    .sort((left, right) => left.fullName.localeCompare(right.fullName));

  const branchEntries = await Promise.all(
    openIds.map(async (id) => [id, await getOrganisationBranch(id)] as const),
  );
  const branches = new Map<string, OrganisationPerson[]>(branchEntries);

  const active = overview.departments.filter((department) => department.status === 'active');
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
      </div>

      <WorkspaceTabs
        label="Identity and access"
        items={[
          { href: '/more/admin/users', label: 'Directory' },
          { href: '/more/admin/organisation', label: 'Organisation', active: true },
        ]}
      />

      <form className="filterbar" role="search" action="/more/admin/organisation">
        <label>
          <span>Find a person</span>
          <input name="q" defaultValue={term} placeholder="Name, employee ID or job title" />
        </label>
        {/* "Find", not "Search": the app shell already has a Search, and two
            controls with one name is a guess for anybody listening to the page
            rather than looking at it. */}
        <button className="btn small" type="submit">
          Find
        </button>
        {term && (
          <Link className="btn small ghost" href="/more/admin/organisation">
            Clear
          </Link>
        )}
      </form>

      {/*
        The confirmation, and the enhancement that can only lead to it (v169).

        `OrganisationDrag` renders nothing: it attaches dragging to the tree
        already on the page, and a drop navigates here rather than saving. So
        the page behaves identically whether or not that script ever runs.
      */}
      {subject && (
        <MoveConfirmation
          subject={{
            id: subject.id,
            fullName: subject.fullName,
            jobTitle: subject.jobTitle,
            employeeId: subject.employeeId,
          }}
          currentManager={
            currentManager
              ? {
                  id: currentManager.id,
                  fullName: currentManager.fullName,
                  jobTitle: currentManager.jobTitle,
                  employeeId: currentManager.employeeId,
                }
              : null
          }
          proposedManagerId={proposedManagerId}
          options={managerOptions.map((person) => ({
            id: person.id,
            fullName: person.fullName,
            jobTitle: person.jobTitle,
            employeeId: person.employeeId,
          }))}
          cancelHref={viewHref(openIds, term)}
        />
      )}
      <OrganisationDrag query={viewHref(openIds, term).split('?')[1] ?? ''} />

      {term && (
        <section className="section-block" aria-labelledby="org-search-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Search</p>
              <h2 id="org-search-heading">
                {matches.length} {matches.length === 1 ? 'person' : 'people'} matching “{term}”
              </h2>
            </div>
          </div>
          {matches.length === 0 ? (
            <div className="card empty-state">
              <p>Nobody active matches that name, employee ID or job title.</p>
            </div>
          ) : (
            <ul className="org-matches">
              {matches.map((match) => (
                <li key={match.id} className="org-match">
                  <strong>{match.fullName}</strong>
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

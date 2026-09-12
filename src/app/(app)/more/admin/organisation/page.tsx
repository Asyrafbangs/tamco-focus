import Link from 'next/link';
import { notFound } from 'next/navigation';

import { WorkspaceTabs } from '@/components/ui/ParityPrimitives';
import { requireProfile } from '@/lib/supabase/server';
import {
  findOrganisationPeople,
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
      <div className="org-person">
        <div className="org-person-main">
          <strong>{person.fullName}</strong>
          <span className="sub">
            {[person.jobTitle, person.employeeId, person.departmentName]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        {person.directReportCount > 0 ? (
          <Link className="btn small ghost" href={toggleHref(openIds, person.id, term)}>
            {isOpen ? 'Hide' : 'Show'} {person.directReportCount}{' '}
            {person.directReportCount === 1 ? 'report' : 'reports'}
          </Link>
        ) : (
          <span className="sub org-person-leaf">No reports</span>
        )}
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
  searchParams: Promise<{ q?: string; open?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') notFound();

  const params = await searchParams;
  const term = params.q?.trim() ?? '';
  const openIds = (params.open ?? '').split(',').filter(Boolean);

  const [overview, matches] = await Promise.all([
    getOrganisationOverview(),
    term ? findOrganisationPeople(term) : Promise.resolve([]),
  ]);

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

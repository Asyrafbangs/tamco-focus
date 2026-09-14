import Link from 'next/link';
import { notFound } from 'next/navigation';

import { WorkspaceTabs } from '@/components/ui/ParityPrimitives';
import { requireProfile } from '@/lib/supabase/server';
import { getDirectoryData, getReportingHistory, getVisibilityData } from '@/server/queries';

import { UserCreateForm, UserEditForm, UserStatusForm, VisibilityForm } from '../../SettingsForms';
import { ReportingHistory } from './ReportingHistory';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    user?: string;
    create?: string;
    q?: string;
    status?: string;
    notice?: string;
    on?: string;
  }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') notFound();
  const params = await searchParams;
  const directory = await getDirectoryData();
  const needle = params.q?.trim().toLowerCase() ?? '';
  const users = directory.users.filter(
    (user) =>
      (!needle ||
        `${user.fullName} ${user.employeeId} ${user.email}`.toLowerCase().includes(needle)) &&
      (!params.status || params.status === 'all' || user.status === params.status),
  );
  const selected = directory.users.find((user) => user.id === params.user) ?? null;
  const creating = params.create === '1';

  /*
   * Who this person may see, on this person's own page.
   *
   * The rule already existed and so did the editor, but it lived on a separate
   * Visibility rules screen keyed by "viewer" — so setting up "Amer can see
   * Izzah and Ajmal" meant leaving the person you were looking at, finding
   * them again in a second list, and knowing that the admin vocabulary for
   * "Amer" is "viewer". It is the same question as their role and their
   * manager, so it is asked in the same place.
   */
  const visibility = selected ? await getVisibilityData(selected.id) : null;
  // The dated record of both lines (v176), and a date somebody asked about.
  const history = selected ? await getReportingHistory(selected.id) : [];
  const askedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.on ?? '') ? (params.on as string) : '';

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Identity and access</h1>
          <p>Manage people, departments and reporting relationships.</p>
        </div>
        <Link className="btn primary" href="/more/admin/users?create=1">
          Create user
        </Link>
      </div>

      {/*
        Two halves of one job (v168). The Directory maintains the account — who
        somebody is, what they may do, who they can see. Organisation answers
        where they sit. They were one screen doing the first and guessing at the
        second from a dropdown of names.
      */}
      <WorkspaceTabs
        label="Identity and access"
        items={[
          { href: '/more/admin/users', label: 'Directory', active: true },
          { href: '/more/admin/organisation', label: 'Organisation' },
        ]}
      />
      {params.notice === 'deleted' && (
        <div className="notice success" role="status">
          <strong>Account deleted</strong>
          <p>Account permanently deleted.</p>
        </div>
      )}
      <div className="master-detail">
        <section className="master-pane" aria-label="Users">
          <form className="filterbar stacked" role="search">
            <label>
              <span>Person, employee ID, or email</span>
              <input name="q" defaultValue={params.q} placeholder="Search users" />
            </label>
            <label>
              <span>Status</span>
              <select name="status" defaultValue={params.status ?? 'all'}>
                <option value="all">All accounts</option>
                <option value="active">Active</option>
                <option value="deactivated">Deactivated</option>
              </select>
            </label>
            <button className="btn small" type="submit">
              Apply
            </button>
          </form>
          <div className="master-list">
            {users.map((user) => (
              <Link
                key={user.id}
                href={`/more/admin/users?user=${user.id}`}
                className={selected?.id === user.id ? 'active' : undefined}
              >
                <span>
                  <strong>{user.fullName}</strong>
                  <small>
                    {/* The title is skipped rather than announced as missing:
                        most rows have one, and "No job title" on the rest is
                        noise in a list somebody scans. */}
                    {[user.employeeId, user.jobTitle, user.departmentName]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <span className={`flag ${user.status === 'active' ? 'green' : 'amber'}`}>
                  {user.status}
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="detail-pane" key={creating ? 'create' : (selected?.id ?? 'none')}>
          {creating ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">New identity</p>
                  <h2>Create user</h2>
                </div>
              </div>
              <UserCreateForm directory={directory} />
            </>
          ) : selected ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{selected.employeeId}</p>
                  <h2>{selected.fullName}</h2>
                  <p>
                    {selected.status} · created{' '}
                    {new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(
                      new Date(selected.createdAt),
                    )}
                  </p>
                </div>
              </div>
              {/*
                Keyed by the person.

                Every field here is uncontrolled — `defaultValue` on the inputs,
                `useState(initial…)` inside the visibility editor — and those
                apply on mount only. Without a key React reuses the same form
                instance when the selected user changes, so clicking a second
                person left the first person's name, manager and ticks on
                screen. Saving then wrote what was displayed, which belonged to
                somebody else. The key forces a remount, so the pane always
                shows the person whose row is highlighted.
              */}
              <UserEditForm key={selected.id} user={selected} directory={directory} />

              <ReportingHistory
                person={selected}
                people={directory.users}
                history={history}
                askedDate={askedDate}
              />

              {visibility && (
                <section className="admin-visibility-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Visibility</p>
                      <h3>What {selected.fullName.split(' ')[0]} can see</h3>
                      <p>
                        Reporting line and job title decide nothing here. Tick the people this
                        person may view, on top of whichever scope you choose.
                      </p>
                    </div>
                  </div>
                  <VisibilityForm
                    key={selected.id}
                    viewer={selected}
                    users={directory.users}
                    initialMode={visibility.mode}
                    initialSubjectIds={visibility.selectedSubjectIds}
                    configured={visibility.configured}
                    effectiveNow={visibility.effective}
                  />
                </section>
              )}

              <UserStatusForm key={selected.id} user={selected} />
            </>
          ) : (
            <div className="empty-state">
              <h2>Select a user</h2>
              <p>Choose an account to maintain it, or create a new user.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

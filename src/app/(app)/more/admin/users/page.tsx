import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireProfile } from '@/lib/supabase/server';
import { getDirectoryData, getVisibilityData } from '@/server/queries';

import { UserCreateForm, UserEditForm, UserStatusForm, VisibilityForm } from '../../SettingsForms';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    user?: string;
    create?: string;
    q?: string;
    status?: string;
    notice?: string;
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

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>User directory</h1>
          <p>Create and maintain local application identities without editing database records.</p>
        </div>
        <Link className="btn primary" href="/more/admin/users?create=1">
          Create user
        </Link>
      </div>
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
                    {user.employeeId} · {user.departmentName}
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

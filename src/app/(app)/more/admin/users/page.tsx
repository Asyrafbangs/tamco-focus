import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireProfile } from '@/lib/supabase/server';
import { getDirectoryData } from '@/server/queries';

import { UserCreateForm, UserEditForm, UserStatusForm } from '../../SettingsForms';

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
        <section className="detail-pane">
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
              <UserEditForm user={selected} directory={directory} />
              <UserStatusForm user={selected} />
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

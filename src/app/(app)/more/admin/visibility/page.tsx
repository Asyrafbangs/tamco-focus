import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireProfile } from '@/lib/supabase/server';
import { getDirectoryData, getVisibilityData } from '@/server/queries';

import { VisibilityForm } from '../../SettingsForms';

export default async function VisibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ viewer?: string; q?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') notFound();
  const params = await searchParams;
  const directory = await getDirectoryData();
  const activeUsers = directory.users.filter((user) => user.status === 'active');
  const viewer = activeUsers.find((user) => user.id === params.viewer) ?? activeUsers[0] ?? null;
  const visibility = viewer ? await getVisibilityData(viewer.id) : null;
  const needle = params.q?.trim().toLowerCase() ?? '';
  const viewers = activeUsers.filter(
    (user) => !needle || `${user.fullName} ${user.employeeId}`.toLowerCase().includes(needle),
  );
  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Visibility rules</h1>
          <p>Default deny → own work → reporting scope → explicit view-only grants.</p>
        </div>
      </div>
      <div className="master-detail">
        <section className="master-pane" aria-label="Viewers">
          <form className="filterbar stacked" role="search">
            <label>
              <span>Viewer</span>
              <input name="q" defaultValue={params.q} placeholder="Search people" />
            </label>
            <button className="btn small" type="submit">
              Search
            </button>
          </form>
          <div className="master-list">
            {viewers.map((user) => (
              <Link
                key={user.id}
                href={`/more/admin/visibility?viewer=${user.id}`}
                className={viewer?.id === user.id ? 'active' : undefined}
              >
                <span>
                  <strong>{user.fullName}</strong>
                  <small>
                    {user.employeeId} · {user.role.replace('_', ' ')}
                  </small>
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="detail-pane">
          {viewer && visibility ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Viewer</p>
                  <h2>{viewer.fullName}</h2>
                  <p>{viewer.employeeId} · changes are immutable administration events</p>
                </div>
              </div>
              <VisibilityForm
                viewer={viewer}
                users={directory.users}
                initialMode={visibility.mode}
                initialSubjectIds={visibility.selectedSubjectIds}
              />
            </>
          ) : (
            <div className="empty-state">
              <h2>No active users</h2>
              <p>Create an account before configuring visibility.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

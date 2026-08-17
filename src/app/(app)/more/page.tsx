import Link from 'next/link';

import { requireProfile } from '@/lib/supabase/server';
import { getCompletionRecords } from '@/server/queries';

export default async function MorePage() {
  const profile = await requireProfile();
  const records = await getCompletionRecords();
  const pendingReviews = records.filter((record) => record.task.reviewStatus === 'pending').length;

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">More</p>
          <h1>Records and settings</h1>
          <p>Review history, evidence, system rules and personal preferences.</p>
        </div>
      </div>

      <section className="utility-grid" aria-label="More workspaces">
        <Link href="/more/records" className="card utility-card">
          <span className="utility-icon" aria-hidden="true">
            ▤
          </span>
          <h2>Records</h2>
          <p>Completion reviews, task records, attachments, audit history and archive.</p>
          <span className="utility-meta">
            <span>
              {profile.role === 'team_member'
                ? 'Your retained task history'
                : `${pendingReviews} review${pendingReviews === 1 ? '' : 's'} waiting`}
            </span>
            <span className="btn small" aria-hidden="true">
              Open
            </span>
          </span>
        </Link>

        <Link href="/more/settings" className="card utility-card">
          <span className="utility-icon" aria-hidden="true">
            ⚙
          </span>
          <h2>Settings</h2>
          <p>Capacity, review rules, notifications, permissions and accessibility.</p>
          <span className="utility-meta">
            <span>
              {profile.role === 'team_member' ? 'Personal preferences' : 'Manager configuration'}
            </span>
            <span className="btn small" aria-hidden="true">
              Open
            </span>
          </span>
        </Link>

        <Link href="/plan" className="card utility-card calendar-utility">
          <span className="utility-icon" aria-hidden="true">
            ▦
          </span>
          <h2>Monthly Plan</h2>
          <p>Due dates, routine occurrences, planned starts and review deadlines.</p>
          <span className="utility-meta">
            <span>
              {new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
                new Date(),
              )}
            </span>
            <span className="btn small" aria-hidden="true">
              Open
            </span>
          </span>
        </Link>

        <Link
          href="/more/settings?section=delivery"
          className="card utility-card weekly-summary-card"
        >
          <span className="utility-icon" aria-hidden="true">
            ✉
          </span>
          <h2>Weekly email summary</h2>
          <p>Completed work, progress changes, overdue items and next actions.</p>
          <span className="utility-meta">
            <span>Delivery schedule and history</span>
            <span className="btn small" aria-hidden="true">
              Open
            </span>
          </span>
        </Link>
      </section>

      {profile.role === 'administrator' && (
        <section className="section-block more-admin" aria-labelledby="admin-controls-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Administrator</p>
              <h2 id="admin-controls-heading">Identity and access</h2>
            </div>
          </div>
          <div className="settings-link-grid">
            {/*
              One card, not two. Visibility rules was a second screen doing the
              same job from the other end: it listed the same people and edited
              the same policy, but keyed by "viewer", so setting up "Amer may
              see Izzah" meant leaving the person you were looking at and
              finding them again under a different word. The editor now sits on
              each person's own page, where their role and manager already are.
            */}
            <Link href="/more/admin/users" className="settings-link-card interactive-row">
              <strong>User directory</strong>
              <span>
                Create and maintain accounts, set who reports to whom, and choose who each person
                can see.
              </span>
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

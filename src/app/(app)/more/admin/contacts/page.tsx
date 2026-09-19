import Link from 'next/link';
import { notFound } from 'next/navigation';

import { WorkspaceTabs } from '@/components/ui/ParityPrimitives';
import { requireProfile } from '@/lib/supabase/server';
import { listEmailContacts } from '@/server/esh/queries';

import { ContactAccessForm } from './ContactAccessForm';

/**
 * Identity and access → Email contacts (v198, §31.3, §43.2).
 *
 * The people ESH has assigned work to or named on an escalation route, by
 * email address. None of them has an account. An administrator switches
 * their email-link access on or off here; the counts say what that affects,
 * without showing the findings themselves, which administration alone does
 * not entitle anyone to read (§43.1).
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; q?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') notFound();
  const params = await searchParams;
  const search = (params.q ?? '').trim().slice(0, 120);
  const contacts = await listEmailContacts(search);
  const selected = contacts.find((contact) => contact.id === params.contact) ?? null;
  const date = (instant: string) =>
    new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(new Date(instant));

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
          { href: '/more/admin/organisation', label: 'Organisation' },
          { href: '/more/admin/contacts', label: 'Email contacts', active: true },
        ]}
      />
      <div className="master-detail">
        <section className="master-pane" aria-label="Email contacts">
          <form className="filterbar stacked" role="search">
            <label>
              <span>Email or name</span>
              <input name="q" defaultValue={search} placeholder="Search contacts" />
            </label>
            <button className="btn small" type="submit">
              Apply
            </button>
          </form>
          {contacts.length === 0 ? (
            <p className="form-hint">
              {search
                ? 'No contact matches that search.'
                : 'No email contacts yet. One is created when ESH assigns a finding to an address.'}
            </p>
          ) : (
            <div className="master-list">
              {contacts.map((contact) => (
                <Link
                  key={contact.id}
                  href={`/more/admin/contacts?contact=${contact.id}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                  className={selected?.id === contact.id ? 'active' : undefined}
                >
                  <span>
                    <strong className="esh-contact-email">{contact.email}</strong>
                    <small>
                      {[
                        contact.openActions
                          ? `${contact.openActions} open action${contact.openActions === 1 ? '' : 's'}`
                          : null,
                        contact.heldNotifications ? `${contact.heldNotifications} held` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No open actions'}
                    </small>
                  </span>
                  <span className={`flag ${contact.accessEnabled ? 'green' : 'neutral'}`}>
                    {contact.accessEnabled ? 'Access on' : 'Access off'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="detail-pane" key={selected?.id ?? 'none'}>
          {selected ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Email contact · no account</p>
                  <h2 className="esh-contact-email">{selected.email}</h2>
                  <p>Added {date(selected.createdAt)}</p>
                </div>
              </div>
              <dl className="esh-facts">
                <div>
                  <dt>Action Owner</dt>
                  <dd>
                    {selected.openActions
                      ? `${selected.openActions} open action${selected.openActions === 1 ? '' : 's'}`
                      : 'No open actions'}
                  </dd>
                </div>
                <div>
                  <dt>Escalation recipient</dt>
                  <dd>
                    {selected.escalationRoutes
                      ? `Named on ${selected.escalationRoutes} action${selected.escalationRoutes === 1 ? '' : 's'}`
                      : 'Not on any route'}
                  </dd>
                </div>
                <div>
                  <dt>Held notifications</dt>
                  <dd>{selected.heldNotifications || 'None'}</dd>
                </div>
                <div>
                  <dt>Access</dt>
                  <dd>
                    {selected.accessEnabled ? 'On' : 'Off'}
                    {selected.accessChangedAt
                      ? ` · ${selected.accessEnabled ? 'enabled' : 'switched off'} by ${selected.accessChangedBy ?? 'an administrator'} on ${date(selected.accessChangedAt)}`
                      : ''}
                    {selected.accessReason ? ` · ${selected.accessReason}` : ''}
                  </dd>
                </div>
              </dl>
              <section
                className="admin-esh-access-section"
                aria-labelledby="contact-access-heading"
              >
                <div className="section-heading">
                  <div>
                    <h3 id="contact-access-heading">Finding Management access</h3>
                    <p>
                      Switching access on sends nothing: ESH releases each held email from its
                      finding when they are ready.
                    </p>
                  </div>
                </div>
                <ContactAccessForm
                  key={selected.id}
                  principalId={selected.id}
                  email={selected.email}
                  enabled={selected.accessEnabled}
                />
              </section>
            </>
          ) : (
            <p className="form-hint">Choose a contact to see and change their access.</p>
          )}
        </section>
      </div>
    </>
  );
}

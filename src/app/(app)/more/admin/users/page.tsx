import Link from 'next/link';
import { notFound } from 'next/navigation';

import { WorkspaceTabs } from '@/components/ui/ParityPrimitives';
import { SubmitOnSelect } from '@/components/ui/SubmitOnSelect';
import { requireProfile } from '@/lib/supabase/server';
import { getDirectoryData, getReportingHistory, getVisibilityData } from '@/server/queries';
import { getEshAccess } from '@/server/esh/access';
import {
  getEmailContactDetail,
  getRolloutStatus,
  getStaffEshAccessForAdmin,
  listEmailContacts,
  getQrIntakeStatus,
} from '@/server/esh/queries';

import { UserCreateForm, UserEditForm, UserStatusForm, VisibilityForm } from '../../SettingsForms';
import { EshAccessForm } from './EshAccessForm';
import { BulkContactAccess } from './BulkContactAccess';
import { ContactAdministration } from './ContactAdministration';
import { ModuleAccessForm } from './ModuleAccessForm';
import { ReportingHistory } from './ReportingHistory';
import { PublicReportingForm } from './PublicReportingForm';
import { RolloutModeForm } from './RolloutModeForm';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    user?: string;
    contact?: string;
    create?: string;
    q?: string;
    status?: string;
    type?: string;
    notice?: string;
    on?: string;
  }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') notFound();
  const params = await searchParams;
  const search = (params.q ?? '').trim().slice(0, 120);
  const [directory, contacts, rollout, myEshAccess, qrIntake] = await Promise.all([
    getDirectoryData(),
    listEmailContacts(search),
    getRolloutStatus(),
    // The administrator's own Finding access: releasing held mail is ESH's act,
    // not an administrator's, so the control appears only for somebody holding
    // both (§43.2).
    getEshAccess(),
    getQrIntakeStatus(),
  ]);
  const needle = params.q?.trim().toLowerCase() ?? '';
  const kind = ['users', 'contacts'].includes(params.type ?? '') ? params.type : 'all';
  const linkedContactByStaff = new Map(
    contacts
      .filter((contact) => contact.staffUserId)
      .map((contact) => [contact.staffUserId, contact]),
  );
  const users = directory.users.filter(
    (user) =>
      (!needle ||
        `${user.fullName} ${user.employeeId} ${user.email}`.toLowerCase().includes(needle)) &&
      (!params.status || params.status === 'all' || user.status === params.status) &&
      (kind !== 'contacts' || linkedContactByStaff.has(user.id)),
  );
  const standaloneContacts = contacts.filter((contact) => !contact.staffUserId);
  /*
   * Contacts that work is already waiting on. Anyone else in the directory is
   * not an omission — the rollout gate is meant to stay shut for people with
   * nothing to answer for (§43.2).
   */
  const waitingToBeCleared = contacts
    .filter(
      (contact) =>
        // v224 — with the rollout open there is nobody to clear: an active
        // contact is reachable already, and anyone switched off was switched
        // off on purpose. Listing them here would be asking an administrator
        // to undo their own decision.
        //
        // The mode has to be KNOWN to be restricted. `rollout?.mode !== 'live'`
        // read a failed read as restricted and put the list up on a guess; the
        // notice beside it now says the rollout could not be read instead.
        rollout.data?.mode === 'restricted' &&
        !contact.accessEnabled &&
        contact.status === 'active' &&
        (contact.openActions > 0 || contact.heldNotifications > 0),
    )
    .map((contact) => ({
      id: contact.id,
      email: contact.email,
      displayName: contact.displayName,
      openActions: contact.openActions,
      heldNotifications: contact.heldNotifications,
    }));
  const selected = directory.users.find((user) => user.id === params.user) ?? null;
  const selectedContact = params.contact
    ? (contacts.find((contact) => contact.id === params.contact) ?? null)
    : selected
      ? (linkedContactByStaff.get(selected.id) ?? null)
      : null;
  const selectedPerson =
    selected ?? directory.users.find((user) => user.id === selectedContact?.staffUserId) ?? null;
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
  const [visibility, history, eshAccess, contactDetail] = await Promise.all([
    selectedPerson ? getVisibilityData(selectedPerson.id) : Promise.resolve(null),
    selectedPerson ? getReportingHistory(selectedPerson.id) : Promise.resolve([]),
    selectedPerson ? getStaffEshAccessForAdmin(selectedPerson.id) : Promise.resolve(null),
    selectedContact
      ? getEmailContactDetail(selectedContact.id)
      : Promise.resolve({ relationships: [], accessItems: [] }),
  ]);
  const askedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.on ?? '') ? (params.on as string) : '';
  /* What the folded filters are currently doing, said in the summary so a
     narrowed list is never mistaken for the whole directory. */
  const status = params.status && params.status !== 'all' ? params.status : '';
  const narrowing = [
    kind === 'users' ? 'registered users' : kind === 'contacts' ? 'email-link contacts' : '',
    status === 'active'
      ? 'active accounts'
      : status === 'deactivated'
        ? 'deactivated accounts'
        : '',
  ].filter(Boolean);
  const narrowed = narrowing.length > 0;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Identity and access</h1>
          <p>Manage people, module access and reporting relationships in one directory.</p>
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
        <section className="master-pane" aria-label="People and access">
          <form className="filterbar stacked" role="search">
            <label>
              <span>Person, employee ID, or email</span>
              <input name="q" defaultValue={params.q} placeholder="Search people" />
            </label>
            {/*
              Folded. The directory is a search box: typing a name is what an
              administrator came to do, and "Person type" and "Status" were two
              selects and a third of the pane's height offered before anybody
              had looked for anyone. Open when either is set, so a narrowed
              list never looks like the whole one.
            */}
            <details open={narrowed}>
              <summary>
                {narrowed ? `Narrowed to ${narrowing.join(' and ')}` : 'Narrow the list'}
              </summary>
              <label>
                <span>Person type</span>
                <select name="type" defaultValue={kind}>
                  <option value="all">All</option>
                  <option value="users">Registered users</option>
                  <option value="contacts">Email-link contacts</option>
                </select>
              </label>
              <label>
                <span>Status</span>
                <select name="status" defaultValue={params.status ?? 'all'}>
                  <option value="all">All accounts</option>
                  <option value="active">Active</option>
                  <option value="deactivated">Deactivated</option>
                </select>
              </label>
            </details>
            <button className="btn small" type="submit">
              Apply
            </button>
            {/* Choosing a status filters the list at once (v179). */}
            <SubmitOnSelect />
          </form>
          <div className="master-list">
            {kind !== 'contacts' || users.length
              ? users.map((user) => {
                  const contact = linkedContactByStaff.get(user.id);
                  return (
                    <Link
                      key={user.id}
                      href={
                        kind === 'contacts' && contact
                          ? `/more/admin/users?type=contacts&contact=${contact.id}`
                          : `/more/admin/users?user=${user.id}`
                      }
                      className={
                        selected?.id === user.id || selectedContact?.staffUserId === user.id
                          ? 'active'
                          : undefined
                      }
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
                        {contact ? <small>Registered user · Email-link contact</small> : null}
                      </span>
                      <span className={`flag ${user.status === 'active' ? 'green' : 'amber'}`}>
                        {user.status}
                      </span>
                    </Link>
                  );
                })
              : null}
            {kind !== 'users'
              ? standaloneContacts.map((contact) => (
                  <Link
                    key={contact.id}
                    href={`/more/admin/users?type=${kind}&contact=${contact.id}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                    className={selectedContact?.id === contact.id ? 'active' : undefined}
                  >
                    <span>
                      <strong>{contact.displayName || contact.email}</strong>
                      <small>{contact.email} · Email-link contact</small>
                      <small>
                        {contact.openActions} open action(s) · {contact.configuredEscalations}{' '}
                        escalation route(s)
                      </small>
                    </span>
                    <span className={`flag ${contact.accessEnabled ? 'green' : 'neutral'}`}>
                      {contact.accessEnabled ? 'Access on' : 'Access off'}
                    </span>
                  </Link>
                ))
              : null}
          </div>
        </section>
        <section
          className="detail-pane"
          key={creating ? 'create' : (selectedPerson?.id ?? selectedContact?.id ?? 'none')}
        >
          {creating ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>Create user</h2>
                </div>
              </div>
              <UserCreateForm directory={directory} />
            </>
          ) : selectedPerson ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>{selectedPerson.fullName}</h2>
                  <p>
                    {selectedPerson.employeeId} · {selectedPerson.status} · created{' '}
                    {new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(
                      new Date(selectedPerson.createdAt),
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
              <UserEditForm key={selectedPerson.id} user={selectedPerson} directory={directory} />

              <section
                className="admin-module-access-section"
                aria-labelledby="module-access-heading"
              >
                <div className="section-heading">
                  <div>
                    <h3 id="module-access-heading">Module access</h3>
                    <p>
                      TAMCO Focus, Finding Management and platform administration are independent.
                    </p>
                  </div>
                </div>
                <ModuleAccessForm key={`module-${selectedPerson.id}`} user={selectedPerson} />
                <dl className="esh-facts">
                  <div>
                    <dt>TAMCO Focus</dt>
                    <dd>{selectedPerson.focusAccessPreset.replaceAll('_', ' ')}</dd>
                  </div>
                  <div>
                    <dt>Platform administrator</dt>
                    <dd>{selectedPerson.platformAdministrator ? 'Yes' : 'No'}</dd>
                  </div>
                  <div>
                    <dt>Finding Management</dt>
                    <dd>
                      {eshAccess?.access?.enabled
                        ? `${eshAccess.access.preset} · ${eshAccess.access.scopeAll ? 'all departments' : `${eshAccess.access.departmentIds.length} department(s)`}`
                        : 'No access'}
                    </dd>
                  </div>
                </dl>
              </section>

              <ReportingHistory
                person={selectedPerson}
                people={directory.users}
                history={history}
                askedDate={askedDate}
              />

              {visibility && (
                <section className="admin-visibility-section">
                  <div className="section-heading">
                    <div>
                      <h3>What {selectedPerson.fullName.split(' ')[0]} can see</h3>
                      <p>
                        Reporting line and job title decide nothing here. Tick the people this
                        person may view, on top of whichever scope you choose.
                      </p>
                    </div>
                  </div>
                  <VisibilityForm
                    key={selectedPerson.id}
                    viewer={selectedPerson}
                    users={directory.users}
                    initialMode={visibility.mode}
                    initialSubjectIds={visibility.selectedSubjectIds}
                    configured={visibility.configured}
                    effectiveNow={visibility.effective}
                  />
                </section>
              )}

              {eshAccess && (
                <section className="admin-esh-access-section" aria-labelledby="esh-access-heading">
                  <div className="section-heading">
                    <div>
                      <h3 id="esh-access-heading">Finding Management access</h3>
                      <p>
                        Separate from the TAMCO Focus role above. Job title, manager and department
                        grant nothing here.
                      </p>
                    </div>
                  </div>
                  <EshAccessForm
                    key={selectedPerson.id}
                    userId={selectedPerson.id}
                    firstName={selectedPerson.fullName.split(' ')[0] ?? selectedPerson.fullName}
                    access={eshAccess.access}
                    rolloutConfigured={eshAccess.rolloutConfigured}
                    departments={directory.departments
                      .filter((department) => department.status === 'active')
                      .map((department) => ({ id: department.id, name: department.name }))}
                  />
                </section>
              )}

              {selectedContact ? (
                <ContactAdministration
                  contact={selectedContact}
                  relationships={contactDetail.relationships}
                  accessItems={contactDetail.accessItems}
                />
              ) : null}

              <UserStatusForm key={selectedPerson.id} user={selectedPerson} />
            </>
          ) : selectedContact ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>{selectedContact.displayName || selectedContact.email}</h2>
                  <p>
                    {selectedContact.displayName ? `${selectedContact.email} · ` : ''}
                    Email-link contact · no account required
                  </p>
                </div>
              </div>
              <ContactAdministration
                contact={selectedContact}
                relationships={contactDetail.relationships}
                accessItems={contactDetail.accessItems}
              />
            </>
          ) : (
            <>
              {rollout.data ? (
                <RolloutModeForm status={rollout.data} canRelease={myEshAccess.canCoordinate} />
              ) : (
                rollout.failed && (
                  <div className="notice error" role="alert">
                    <strong>The rollout could not be read</strong>
                    <p>
                      The mode, the contact counts and the control to change them are unavailable.
                      Nothing has changed; try again.
                    </p>
                  </div>
                )
              )}
              {/*
               * v288 - beside the rollout, because it is the same kind of
               * decision: one sentence changes who can reach the module. It
               * appears only for somebody the policy lets read the row, which
               * is an administrator.
               */}
              {qrIntake && (
                <PublicReportingForm
                  enabled={qrIntake.enabled}
                  changedAt={qrIntake.updatedAt}
                  changeReason={qrIntake.changeReason}
                />
              )}
              <BulkContactAccess contacts={waitingToBeCleared} />
              <div className="empty-state">
                <h2>Select a person</h2>
                <p>
                  Choose a registered user or email-link contact to maintain their identity and
                  access.
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

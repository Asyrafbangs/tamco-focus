'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import type { ContactAccessItem, ContactRelationship, EmailContact } from '@/server/esh/queries';
import {
  correctContactEmail,
  disableContact,
  resendContactAccess,
  revokeContactAccessItem,
  type ContactAdminState,
} from '@/server/esh/conversation-actions';

import { ContactAccessForm } from '../contacts/ContactAccessForm';

const INITIAL_STATE: ContactAdminState = { ok: true, message: '' };

function Result({ state }: { state: ContactAdminState }) {
  if (!state.message) return null;
  return (
    <div
      className={`notice ${state.ok ? 'success' : 'error'}`}
      role={state.ok ? 'status' : 'alert'}
    >
      <p>{state.message}</p>
      {state.redirectPrincipalId ? (
        <Link href={`/more/admin/users?type=contacts&contact=${state.redirectPrincipalId}`}>
          Open the corrected identity
        </Link>
      ) : null}
    </div>
  );
}

function ResendForm({
  principalId,
  purpose,
  actionId,
  label,
}: {
  principalId: string;
  purpose: 'owner_inbox' | 'owner_action' | 'escalation_action';
  actionId?: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(resendContactAccess, INITIAL_STATE);
  return (
    <form action={action} className="settings-form compact-form">
      <input type="hidden" name="principal_id" value={principalId} />
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="action_id" value={actionId ?? ''} />
      <label>
        <span>Reason for resending</span>
        <input name="reason" required maxLength={300} />
      </label>
      <Result state={state} />
      <button className="btn small" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Queuing…' : label}
      </button>
    </form>
  );
}

function RevokeForm({ principalId, item }: { principalId: string; item: ContactAccessItem }) {
  const [state, action, pending] = useActionState(revokeContactAccessItem, INITIAL_STATE);
  return (
    <form action={action} className="settings-form compact-form">
      <input type="hidden" name="principal_id" value={principalId} />
      <input type="hidden" name="kind" value={item.kind} />
      <input type="hidden" name="access_id" value={item.id} />
      <label>
        <span>Reason</span>
        <input name="reason" required maxLength={300} />
      </label>
      <Result state={state} />
      <button className="btn small danger" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Revoking…' : `Revoke ${item.kind}`}
      </button>
    </form>
  );
}

function DisableForm({ contact }: { contact: EmailContact }) {
  const [state, action, pending] = useActionState(disableContact, INITIAL_STATE);
  return (
    <form action={action} className="settings-form danger-zone">
      <input type="hidden" name="principal_id" value={contact.id} />
      <p>
        This stops links, sessions and future sends. It does not close or reassign the contact’s{' '}
        {contact.openActions} open action(s) or remove {contact.configuredEscalations} escalation
        route(s).
      </p>
      <label>
        <span>Reason</span>
        <input name="reason" required maxLength={300} />
      </label>
      <Result state={state} />
      <button className="btn danger" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Disabling…' : 'Disable contact'}
      </button>
    </form>
  );
}

function CorrectEmailForm({ contact }: { contact: EmailContact }) {
  const [state, action, pending] = useActionState(correctContactEmail, INITIAL_STATE);
  return (
    <form action={action} className="settings-form">
      <input type="hidden" name="principal_id" value={contact.id} />
      <label>
        <span>Corrected email address</span>
        <input name="new_email" type="email" required maxLength={254} />
      </label>
      <label className="check-row">
        <input type="checkbox" name="transfer_actions" defaultChecked={contact.openActions > 0} />
        <span>Move live action ownership ({contact.openActions})</span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          name="transfer_escalations"
          defaultChecked={contact.configuredEscalations > 0}
        />
        <span>Move configured escalation routes ({contact.configuredEscalations})</span>
      </label>
      <label>
        <span>Reason</span>
        <input name="reason" required maxLength={300} />
      </label>
      <p className="form-hint">
        Old access is revoked first. Only selected live relationships move; historical messages
        remain attributed to the old identity. Existing contacts are never silently merged.
      </p>
      <Result state={state} />
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Correcting…' : 'Correct email'}
      </button>
    </form>
  );
}

export function ContactAdministration({
  contact,
  relationships,
  accessItems,
}: {
  contact: EmailContact;
  relationships: ContactRelationship[];
  accessItems: ContactAccessItem[];
}) {
  const date = (instant: string) =>
    new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(new Date(instant));
  const expectedRelationships = contact.openActions + contact.configuredEscalations;

  return (
    <section className="admin-esh-access-section" aria-labelledby="contact-access-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Email-link contact · no account required</p>
          <h3 id="contact-access-heading">Finding Management access</h3>
          <p>
            Current participation is derived from live work. Identity facts are linked, but
            permissions remain separate.
          </p>
        </div>
      </div>
      <dl className="esh-facts">
        <div>
          <dt>Action Owner</dt>
          <dd>{contact.openActions} open</dd>
        </div>
        <div>
          <dt>Escalation recipient</dt>
          <dd>
            {contact.configuredEscalations} configured · {contact.activeEscalations} active
          </dd>
        </div>
        <div>
          <dt>Report recipient</dt>
          <dd>{contact.reportSubscriptions || 'None'}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>
            {contact.heldNotifications} held · {contact.failedNotifications} failed
          </dd>
        </div>
        <div>
          <dt>Last verified access</dt>
          <dd>{contact.lastAccessAt ? date(contact.lastAccessAt) : 'Never'}</dd>
        </div>
        <div>
          <dt>Access state</dt>
          <dd>
            {contact.accessEnabled ? 'On' : 'Off'} · {contact.status}
          </dd>
        </div>
      </dl>

      <ContactAccessForm
        key={contact.id}
        principalId={contact.id}
        email={contact.email}
        enabled={contact.accessEnabled}
      />

      {contact.accessEnabled && contact.openActions > 0 ? (
        <section>
          <h4>Fresh inbox access</h4>
          <ResendForm
            principalId={contact.id}
            purpose="owner_inbox"
            label="Send fresh inbox access"
          />
        </section>
      ) : null}

      <section>
        <h4>Live participation</h4>
        {relationships.length ? (
          <div className="settings-list">
            {relationships.map((relationship) => (
              <article
                key={`${relationship.participation}-${relationship.actionId}-${relationship.escalationLevel ?? 0}`}
              >
                <strong>
                  {relationship.reference} · {relationship.actionTitle}
                </strong>
                <p>
                  {relationship.participation === 'owner'
                    ? 'Action Owner'
                    : `Escalation level ${relationship.escalationLevel}${relationship.activated ? ' · active' : ' · configured'}`}
                  {' · '}
                  {relationship.state}
                </p>
                {contact.accessEnabled &&
                (relationship.participation === 'owner' || relationship.activated) ? (
                  <ResendForm
                    principalId={contact.id}
                    purpose={
                      relationship.participation === 'owner' ? 'owner_action' : 'escalation_action'
                    }
                    actionId={relationship.actionId}
                    label="Send fresh access"
                  />
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="form-hint">No relationship details are visible in your Finding scope.</p>
        )}
        {expectedRelationships > relationships.length ? (
          <p className="form-hint">
            Some details are hidden because platform administration alone does not grant Finding
            Management access.
          </p>
        ) : null}
      </section>

      <section>
        <h4>Active access</h4>
        {accessItems.length ? (
          <div className="settings-list">
            {accessItems.map((item) => (
              <article key={`${item.kind}-${item.id}`}>
                <strong>
                  {item.kind} · {item.purpose.replaceAll('_', ' ')}
                </strong>
                <p>
                  Started {date(item.startedAt)}
                  {item.expiresAt ? ` · expires ${date(item.expiresAt)}` : ''}
                </p>
                <RevokeForm principalId={contact.id} item={item} />
              </article>
            ))}
          </div>
        ) : (
          <p className="form-hint">No active grants, sessions or entitlements.</p>
        )}
      </section>

      <section>
        <h4>Correct email</h4>
        <CorrectEmailForm contact={contact} />
      </section>
      {contact.status !== 'disabled' ? <DisableForm contact={contact} /> : null}
    </section>
  );
}

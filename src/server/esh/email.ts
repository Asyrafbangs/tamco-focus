import { escapeNotificationHtml as escape } from '@/server/workers/notification-email';

/**
 * Finding Management email (v198, §9, §17).
 *
 * Minimal on purpose: what the action is, when it is due, and the links.
 * Detail and evidence stay behind the access check. There is no Create
 * account, Set password or Login button, because there is no account; and
 * because replies to the mailbox are not read, the email says so and points
 * to the conversation instead.
 */

export interface EshEmailInput {
  eventType:
    | 'owner_assignment'
    | 'esh_reply'
    | 'access_link'
    | 'submission_received'
    | 'submission_withdrawn'
    | 'changes_requested'
    | 'due_changed'
    | 'finding_closed'
    | 'finding_reopened'
    | 'reassigned_away';
  reference: string | null;
  actionTitle: string | null;
  location: string | null;
  dueLabel: string | null;
  eshContactName: string | null;
  eshContactEmail: string | null;
  actionUrl: string | null;
  inboxUrl: string | null;
  expiresMinutes: number;
  /** v199 - for ESH staff: the finding in the application, and who submitted. */
  findingUrl?: string | null;
  ownerEmail?: string | null;
  submissionVersion?: number | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = '#174652';

function oneLine(value: string) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lifetime(minutes: number) {
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

function button(href: string, label: string, primary: boolean) {
  return primary
    ? `<a href="${escape(href)}" style="display:inline-block;margin:0 10px 10px 0;padding:13px 20px;border-radius:9px;background:${BRAND};color:#ffffff;font-size:15px;line-height:19px;font-weight:700;text-decoration:none">${escape(label)}</a>`
    : `<a href="${escape(href)}" style="display:inline-block;margin:0 10px 10px 0;padding:12px 19px;border-radius:9px;border:1px solid #cfd8de;background:#ffffff;color:${BRAND};font-size:15px;line-height:19px;font-weight:600;text-decoration:none">${escape(label)}</a>`;
}

export function renderEshEmail(input: EshEmailInput): RenderedEmail {
  const reference = input.reference ? oneLine(input.reference) : '';
  const title = input.actionTitle ? oneLine(input.actionTitle).slice(0, 160) : '';
  const heading = [reference, title].filter(Boolean).join(' · ');
  const meta = [input.location ? oneLine(input.location) : '', input.dueLabel ?? '']
    .filter(Boolean)
    .join(' · ');

  let subject: string;
  let headline: string;
  let lead: string;
  const links: Array<{ href: string; label: string }> = [];

  switch (input.eventType) {
    case 'owner_assignment':
      subject = `Action assigned: ${heading}`;
      headline = 'You have a new action';
      lead = 'Please complete the action below and send your evidence to ESH for review.';
      if (input.actionUrl) links.push({ href: input.actionUrl, label: 'View finding & respond' });
      if (input.inboxUrl) links.push({ href: input.inboxUrl, label: 'View All My Actions' });
      break;
    case 'esh_reply':
      subject = `ESH replied: ${heading}`;
      headline = 'ESH replied about your action';
      lead = 'Open the conversation to read the reply and respond.';
      if (input.actionUrl) links.push({ href: input.actionUrl, label: 'Open the conversation' });
      break;
    case 'changes_requested':
      subject = `More needed: ${heading}`;
      headline = 'ESH needs a little more';
      lead =
        'ESH has looked at what you sent and asked for more before this can be closed. The details are in the conversation.';
      if (input.actionUrl) links.push({ href: input.actionUrl, label: 'Open the conversation' });
      break;
    case 'due_changed':
      subject = `New due date: ${heading}`;
      headline = 'Your action has a new due date';
      lead = `ESH changed the due date${input.dueLabel ? `. ${input.dueLabel}` : ''}. The reason is in the conversation.`;
      if (input.actionUrl) links.push({ href: input.actionUrl, label: 'Open the action' });
      break;
    case 'finding_closed':
      subject = `Closed: ${heading}`;
      headline = 'This finding is closed';
      lead =
        'ESH verified the correction and closed the finding. Nothing further is needed from you. Thank you.';
      break;
    case 'finding_reopened':
      subject = `Reopened: ${heading}`;
      headline = 'This finding has been reopened';
      lead = 'ESH reopened it, so the action is with you again. The reason is in the conversation.';
      if (input.actionUrl) links.push({ href: input.actionUrl, label: 'View finding & respond' });
      if (input.inboxUrl) links.push({ href: input.inboxUrl, label: 'View All My Actions' });
      break;
    case 'reassigned_away':
      subject = `Handed over: ${heading}`;
      headline = 'This action is now with somebody else';
      lead =
        'ESH has given it to another address. Nothing further is needed from you; what you wrote is kept on the record.';
      break;
    case 'submission_received':
      subject = `Ready for review: ${heading}`;
      headline = 'An action is ready for your review';
      lead = `${input.ownerEmail ?? 'The Action Owner'} submitted version ${input.submissionVersion ?? 1} for ESH verification.`;
      if (input.findingUrl) links.push({ href: input.findingUrl, label: 'Open the finding' });
      break;
    case 'submission_withdrawn':
      subject = `Submission withdrawn: ${heading}`;
      headline = 'A submission was withdrawn';
      lead = `${input.ownerEmail ?? 'The Action Owner'} withdrew version ${input.submissionVersion ?? 1} to revise it. Nothing is waiting for review until they submit again.`;
      if (input.findingUrl) links.push({ href: input.findingUrl, label: 'Open the finding' });
      break;
    default:
      subject = 'Your TAMCO ESH link';
      headline = 'Here is your new link';
      lead = input.actionUrl
        ? 'You asked for a new link to your action.'
        : 'You asked for a new link to the actions assigned to your email.';
      if (input.actionUrl) links.push({ href: input.actionUrl, label: 'Open action' });
      if (input.inboxUrl) links.push({ href: input.inboxUrl, label: 'Open my actions' });
      break;
  }
  subject = oneLine(subject).slice(0, 180);

  const forStaff =
    input.eventType === 'submission_received' || input.eventType === 'submission_withdrawn';
  const noLinks = links.length === 0;
  const validity = noLinks
    ? 'This is for your records; there is nothing to open.'
    : forStaff
      ? 'Sign in to TAMCO Focus as usual to open it.'
      : input.eventType === 'access_link'
        ? `This link works once and for ${lifetime(input.expiresMinutes)}. If it has expired, ask for another from the page it opens.`
        : `Your secure links open ${links.length > 1 ? 'the assigned action or your list of open actions' : 'the assigned action'}. No account creation or password is needed. Each link works once on a device, for ${lifetime(input.expiresMinutes)}; after that the page offers a new one.`;
  const contact =
    !forStaff && (input.eshContactName || input.eshContactEmail)
      ? `ESH contact: ${[input.eshContactName, input.eshContactEmail].filter(Boolean).join(', ')}.`
      : '';
  const verification =
    input.eventType === 'access_link' || forStaff || noLinks
      ? ''
      : 'ESH verifies the correction before the finding is closed.';
  const unmonitored = noLinks
    ? 'This mailbox is not monitored. Contact ESH if anything looks wrong.'
    : forStaff
      ? 'This mailbox is not monitored. Reply in the finding’s conversation.'
      : 'Please respond through the secure link. Email replies are not added to the conversation.';

  const text = [
    headline,
    '',
    lead,
    '',
    heading,
    meta,
    '',
    ...links.map((link) => `${link.label}: ${link.href}`),
    '',
    validity,
    verification,
    contact,
    '',
    unmonitored,
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n')
    .trim();

  const card = heading
    ? `<tr><td style="padding:0 32px 22px"><div style="padding:20px 22px;border-radius:12px;background:#f3f5f8"><div style="font-size:17px;line-height:24px;font-weight:700;color:#1b2b36">${escape(heading)}</div>${meta ? `<div style="margin-top:8px;font-size:14px;line-height:20px;color:#5f6f7c">${escape(meta)}</div>` : ''}</div></td></tr>`
    : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#f3f5f8;color:#1b2b36;font-family:Arial,'Helvetica Neue',sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(lead)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f3f5f8"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #dde3ea;border-radius:16px"><tr><td style="padding:28px 32px 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:36px;height:36px;border-radius:9px;background:${BRAND};color:#ffffff;font-size:18px;font-weight:700;line-height:36px;text-align:center">E</td><td style="padding-left:12px;font-size:17px;font-weight:700;color:#1b2b36">TAMCO ESH</td></tr></table></td></tr><tr><td style="padding:22px 32px 18px"><h1 style="margin:0;font-size:26px;line-height:33px;font-weight:700;color:#1b2b36">${escape(headline)}</h1><p style="margin:10px 0 0;font-size:16px;line-height:24px;color:#5f6f7c">${escape(lead)}</p></td></tr>${card}<tr><td style="padding:0 32px 8px">${links.map((link, index) => button(link.href, link.label, index === 0)).join('')}</td></tr><tr><td style="padding:6px 32px 28px;font-size:14px;line-height:21px;color:#5f6f7c"><p style="margin:0 0 10px">${escape(validity)}</p>${verification ? `<p style="margin:0 0 10px">${escape(verification)}</p>` : ''}${contact ? `<p style="margin:0 0 10px">${escape(contact)}</p>` : ''}<p style="margin:14px 0 0;padding-top:14px;border-top:1px solid #e7ebf0;font-size:12px;line-height:18px;color:#7a8894">${escape(unmonitored)}</p></td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text };
}

/** "Due 18 Sep 2026", with the time when one was set, in the organisation's zone. */
export function emailDueLabel(
  dueAt: string | null,
  dateOnly: boolean,
  timeZone: string,
): string | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(due);
  if (dateOnly) return `Due ${date}`;
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(due);
  return `Due ${date}, ${time}`;
}

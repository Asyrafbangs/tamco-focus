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
    | 'reassigned_away'
    | 'owner_reminder'
    | 'escalation'
    | 'review_reminder'
    | 'escalation_exhausted'
    | 'owner_reply'
    | 'escalation_reply';
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
  followupKind?: string | null;
  daysOverdue?: number | null;
  escalationLevel?: number | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface WeeklyReportEmailInput {
  reportName: string;
  capturedAt: string;
  timeZone: string;
  reportUrl: string;
  expiresMinutes: number;
  counts: { open: number; overdue: number; awaiting: number; closed: number };
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
    case 'owner_reminder': {
      const days = input.daysOverdue ?? 0;
      if (input.followupKind === 'owner_pre_due') {
        subject = `Due soon: ${heading}`;
        headline = 'Your action is due soon';
        lead = `A reminder while there is still time.${input.dueLabel ? ` ${input.dueLabel}.` : ''} Send ESH what you have done and they will review it.`;
      } else if (input.followupKind === 'owner_due') {
        subject = `Due today: ${heading}`;
        headline = 'Your action is due today';
        lead = 'Send ESH what you have done, or tell them in the conversation where it stands.';
      } else {
        subject = `Overdue: ${heading}`;
        headline = days === 1 ? 'Your action is a day overdue' : 'Your action is overdue';
        lead = `${days > 1 ? `This action passed its due date ${days} days ago. ` : 'This action has passed its due date. '}Send ESH what you have done, or tell them in the conversation what is holding it up.`;
      }
      if (input.actionUrl) links.push({ href: input.actionUrl, label: 'View finding & respond' });
      if (input.inboxUrl) links.push({ href: input.inboxUrl, label: 'View All My Actions' });
      break;
    }
    case 'escalation': {
      const level = input.escalationLevel ?? 1;
      const days = input.daysOverdue ?? 0;
      subject = `Escalation level ${level}: ${heading}`;
      headline = `An overdue action has been escalated to you (level ${level})`;
      lead = `${input.ownerEmail ?? 'The Action Owner'} was asked to correct this${days > 0 ? ` and is ${days} ${days === 1 ? 'day' : 'days'} past the due date` : ''}. ESH is asking for your support to get it done. The action stays with its owner: you are not being asked to do the work or to close it.`;
      if (input.actionUrl) links.push({ href: input.actionUrl, label: 'Open the action' });
      break;
    }
    case 'review_reminder':
      subject = `Still waiting for review: ${heading}`;
      headline = 'A submission is still waiting for you';
      lead = `${input.ownerEmail ?? 'The Action Owner'} sent version ${input.submissionVersion ?? 1} for verification and nothing has been decided yet. The owner is not being chased while it sits with ESH.`;
      if (input.findingUrl) links.push({ href: input.findingUrl, label: 'Open the finding' });
      break;
    case 'escalation_exhausted':
      subject = `Escalation exhausted: ${heading}`;
      headline = 'The last escalation level has been reached';
      lead = `${input.ownerEmail ?? 'The Action Owner'} is ${(input.daysOverdue ?? 0) > 0 ? `${input.daysOverdue} ${input.daysOverdue === 1 ? 'day' : 'days'} ` : ''}overdue and every configured level has been told. There is no further level: this is now a decision for ESH.`;
      if (input.findingUrl) links.push({ href: input.findingUrl, label: 'Open the finding' });
      break;
    case 'owner_reply':
      subject = `Owner update: ${heading}`;
      headline = 'The Action Owner sent an update';
      lead = `${input.ownerEmail ?? 'The Action Owner'} added a message to the conversation. It is an update, not a submission for verification.`;
      if (input.findingUrl) links.push({ href: input.findingUrl, label: 'Open the finding' });
      break;
    case 'escalation_reply':
      subject = `Escalation response: ${heading}`;
      headline = 'An escalation recipient responded';
      lead = `A person supporting ${input.ownerEmail ?? 'the Action Owner'} added a message to the conversation. The action still belongs to its owner.`;
      if (input.findingUrl) links.push({ href: input.findingUrl, label: 'Open the finding' });
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
    input.eventType === 'submission_received' ||
    input.eventType === 'submission_withdrawn' ||
    input.eventType === 'review_reminder' ||
    input.eventType === 'escalation_exhausted' ||
    input.eventType === 'owner_reply' ||
    input.eventType === 'escalation_reply';
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
      : input.eventType === 'escalation'
        ? 'You can read the action and reply, or acknowledge that you have seen it. Submitting the evidence and closing the finding stay with the owner and ESH.'
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

/** Concise v204 leadership delivery; all finding detail stays behind the link. */
export function renderWeeklyReportEmail(input: WeeklyReportEmailInput): RenderedEmail {
  const reportName = oneLine(input.reportName).slice(0, 120);
  const subject = oneLine(`Weekly ESH report: ${reportName}`).slice(0, 180);
  const captured = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: input.timeZone,
  }).format(new Date(input.capturedAt));
  const summary = `${input.counts.open} open · ${input.counts.overdue} overdue · ${input.counts.awaiting} awaiting review · ${input.counts.closed} closed last week`;
  const validity = `This individual link works once and for ${lifetime(input.expiresMinutes)}. It opens a read-only report; do not forward it.`;
  const text = [
    reportName,
    `Saved snapshot captured ${captured}.`,
    summary,
    '',
    `Open weekly report: ${input.reportUrl}`,
    '',
    validity,
    'Restricted findings are excluded. Email replies are not monitored.',
  ].join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#f3f5f8;color:#1b2b36;font-family:Arial,'Helvetica Neue',sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f3f5f8"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #dde3ea;border-radius:16px"><tr><td style="padding:28px 32px 8px;font-size:17px;font-weight:700;color:#1b2b36">TAMCO ESH</td></tr><tr><td style="padding:14px 32px 18px"><h1 style="margin:0;font-size:26px;line-height:33px">${escape(reportName)}</h1><p style="margin:10px 0 0;color:#5f6f7c">Saved snapshot captured ${escape(captured)}.</p></td></tr><tr><td style="padding:0 32px 22px"><div style="padding:18px;border-radius:12px;background:#f3f5f8;font-weight:700">${escape(summary)}</div></td></tr><tr><td style="padding:0 32px 12px">${button(input.reportUrl, 'Open weekly report', true)}</td></tr><tr><td style="padding:4px 32px 28px;color:#5f6f7c;font-size:14px;line-height:21px"><p>${escape(validity)}</p><p>Restricted findings are excluded. Email replies are not monitored.</p></td></tr></table></td></tr></table></body></html>`;
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

/** The plain-text part is assembled line by line; this is that line break. */
const LINE = String.fromCharCode(10);

export interface DigestItem {
  reference: string | null;
  title: string | null;
  dueLabel: string | null;
  escalationLevel?: number | null;
  /** An escalation recipient's own link to this one action. */
  actionUrl?: string | null;
}

export interface EshDigestEmailInput {
  eventType: 'owner_digest' | 'escalation_digest' | 'import_assignment';
  items: DigestItem[];
  inboxUrl: string | null;
  expiresMinutes: number;
  eshContactName?: string | null;
  eshContactEmail?: string | null;
}

/**
 * One letter about several actions (v207, §41).
 *
 * Consolidation is packaging: the list says exactly which actions, each with
 * its own date and its own link where it has one, so nothing is hidden behind
 * "and others". A digest of one reads as the single notice it is.
 */
export function renderEshDigestEmail(input: EshDigestEmailInput): RenderedEmail {
  const count = input.items.length;
  const plural = count === 1 ? 'action' : 'actions';
  const level = input.items.reduce(
    (highest, item) => Math.max(highest, item.escalationLevel ?? 0),
    0,
  );

  const subject = oneLine(
    input.eventType === 'escalation_digest'
      ? `Escalation level ${level}: ${count} overdue ${plural}`
      : input.eventType === 'import_assignment'
        ? `${count} ${plural} assigned to you`
        : `${count} ${plural} need your attention`,
  ).slice(0, 180);

  const headline =
    input.eventType === 'escalation_digest'
      ? `${count} overdue ${plural} escalated to you`
      : input.eventType === 'import_assignment'
        ? `You have ${count} ${plural}`
        : `${count} ${plural} need your attention`;

  const lead =
    input.eventType === 'escalation_digest'
      ? 'ESH is asking for your support on the actions below. Each one stays with its owner: you are not being asked to do the work or to close anything.'
      : input.eventType === 'import_assignment'
        ? 'These are existing findings, now recorded in TAMCO ESH. Their dates are the ones already agreed, so some may already be past due.'
        : 'Here is everything waiting on you today, in one message rather than one each.';

  const rows = input.items.map((item) => {
    const heading = [item.reference, item.title].filter(Boolean).join(' · ');
    const detail = [item.dueLabel, item.escalationLevel ? `Level ${item.escalationLevel}` : '']
      .filter(Boolean)
      .join(' · ');
    return { heading: oneLine(heading).slice(0, 160), detail, url: item.actionUrl ?? null };
  });

  const validity = input.inboxUrl
    ? `Your link works once on this device, for ${lifetime(input.expiresMinutes)}; after that the page offers a new one.`
    : `Each link works once on this device, for ${lifetime(input.expiresMinutes)}.`;
  const contact =
    input.eshContactName || input.eshContactEmail
      ? `ESH contact: ${[input.eshContactName, input.eshContactEmail].filter(Boolean).join(', ')}.`
      : '';
  const unmonitored = 'Please respond through the secure link. Email replies are not read.';

  const text = [
    headline,
    '',
    lead,
    '',
    ...rows.map((row) =>
      [`- ${row.heading}`, row.detail ? `  ${row.detail}` : '', row.url ? `  ${row.url}` : '']
        .filter(Boolean)
        .join(LINE),
    ),
    '',
    input.inboxUrl ? `View All My Actions: ${input.inboxUrl}` : '',
    '',
    validity,
    contact,
    '',
    unmonitored,
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join(LINE)
    .trim();

  const list = rows
    .map(
      (row) =>
        `<tr><td style="padding:0 32px 12px"><div style="padding:16px 18px;border-radius:12px;background:#f3f5f8"><div style="font-size:15px;line-height:22px;font-weight:700;color:#1b2b36">${escape(row.heading)}</div>${row.detail ? `<div style="margin-top:6px;font-size:13px;line-height:19px;color:#5f6f7c">${escape(row.detail)}</div>` : ''}${row.url ? `<div style="margin-top:10px">${button(row.url, 'Open this action', false)}</div>` : ''}</div></td></tr>`,
    )
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#f3f5f8;color:#1b2b36;font-family:Arial,'Helvetica Neue',sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(lead)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f3f5f8"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #dde3ea;border-radius:16px"><tr><td style="padding:28px 32px 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:36px;height:36px;border-radius:9px;background:${BRAND};color:#ffffff;font-size:18px;font-weight:700;line-height:36px;text-align:center">E</td><td style="padding-left:12px;font-size:17px;font-weight:700;color:#1b2b36">TAMCO ESH</td></tr></table></td></tr><tr><td style="padding:22px 32px 18px"><h1 style="margin:0;font-size:26px;line-height:33px;font-weight:700;color:#1b2b36">${escape(headline)}</h1><p style="margin:10px 0 0;font-size:16px;line-height:24px;color:#5f6f7c">${escape(lead)}</p></td></tr>${list}${input.inboxUrl ? `<tr><td style="padding:6px 32px 8px">${button(input.inboxUrl, 'View All My Actions', true)}</td></tr>` : ''}<tr><td style="padding:6px 32px 28px;font-size:14px;line-height:21px;color:#5f6f7c"><p style="margin:0 0 10px">${escape(validity)}</p>${contact ? `<p style="margin:0 0 10px">${escape(contact)}</p>` : ''}<p style="margin:14px 0 0;padding-top:14px;border-top:1px solid #e7ebf0;font-size:12px;line-height:18px;color:#7a8894">${escape(unmonitored)}</p></td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text };
}

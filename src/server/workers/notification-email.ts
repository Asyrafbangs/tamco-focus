import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { notificationHref } from '@/domain/notification-link';
import { PermanentDeliveryError } from '@/server/workers/smtp-transport';

type Client = SupabaseClient<Database, 'public'>;
type NotificationRow = Database['public']['Tables']['notifications']['Row'];
type DeliveryRow = Database['public']['Tables']['notification_email_deliveries']['Row'];

export interface NotificationEmailWorkerOptions {
  now?: Date;
  limit?: number;
  deliveryIds?: string[];
  appBaseUrl?: string;
  transport?: 'log' | 'inbucket' | 'smtp';
  send?: (delivery: { to: string; subject: string; html: string; text: string }) => Promise<void>;
}

export interface NotificationEmailWorkerResult {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Permanently rejected. Counted apart from `failed`, which will retry. */
  undeliverable: number;
}

interface RenderNotificationEmailInput {
  notification: Pick<
    NotificationRow,
    | 'title'
    | 'body'
    | 'kind'
    | 'requires_action'
    | 'task_id'
    | 'goal_id'
    | 'entity_type'
    | 'entity_id'
  >;
  recipientName: string;
  appBaseUrl: string;
}

/** User-entered task and checklist text crosses an HTML boundary in email. */
export const escapeNotificationHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || value;
}

function safeSubject(value: string) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export const notificationPath = notificationHref;

function safeAppLink(base: string, path: string) {
  try {
    const baseUrl = new URL(base);
    if (!['http:', 'https:'].includes(baseUrl.protocol)) return '#';
    const target = new URL(path, baseUrl);
    if (target.origin !== baseUrl.origin) return '#';
    return target.toString();
  } catch {
    return '#';
  }
}

function actionLabel(notification: RenderNotificationEmailInput['notification']) {
  switch (notification.entity_type) {
    case 'checklist_item':
      return 'Open contribution';
    case 'task_step':
      return 'Open step';
    case 'barrier':
      return notification.requires_action ? 'Respond to request' : 'Open request';
    case 'goal':
      return 'Open Goal';
    case 'work_proposal':
      return 'Review proposal';
    case 'task':
      return 'Open task';
    default:
      return notification.task_id
        ? 'Open task'
        : notification.goal_id
          ? 'Open Goal'
          : 'Open My Day';
  }
}

export function renderNotificationEmail(input: RenderNotificationEmailInput) {
  const title = safeSubject(input.notification.title) || 'New notification';
  const subject = `TAMCO Focus — ${title}`;
  const href = safeAppLink(input.appBaseUrl, notificationHref(input.notification));
  const buttonLabel = actionLabel(input.notification);
  const statusLabel = input.notification.requires_action ? 'Action requested' : 'Notification';
  const body = input.notification.body.trim();
  const greeting = firstName(input.recipientName);

  const text = [
    `Hello ${greeting},`,
    '',
    title,
    body,
    '',
    `${buttonLabel}: ${href}`,
    '',
    'This email mirrors a notification recorded in TAMCO Focus. Opening it does not complete the requested work.',
  ].join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeNotificationHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f5f6f8;color:#182235;font-family:Arial,'Helvetica Neue',sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeNotificationHtml(body.slice(0, 180))}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f5f6f8"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:580px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #dde3ea;border-radius:16px;overflow:hidden"><tr><td style="height:5px;background:#1668e8;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:28px 32px 22px;border-bottom:1px solid #e7ebf0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:top"><div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1668e8">TAMCO Focus</div><div style="margin-top:6px;font-size:12px;line-height:18px;color:#66758a">${escapeNotificationHtml(statusLabel)}</div></td><td align="right" style="vertical-align:top"><div style="width:36px;height:36px;border-radius:10px;background:#0d2342;color:#ffffff;font-size:18px;font-weight:700;line-height:36px;text-align:center">T</div></td></tr></table></td></tr><tr><td style="padding:28px 32px 8px"><p style="margin:0 0 18px;font-size:14px;line-height:21px;color:#66758a">Hello ${escapeNotificationHtml(greeting)},</p><h1 style="margin:0;font-size:24px;line-height:31px;font-weight:700;letter-spacing:-.02em;color:#0d2342">${escapeNotificationHtml(title)}</h1><p style="margin:14px 0 0;font-size:15px;line-height:24px;color:#334155">${escapeNotificationHtml(body)}</p></td></tr><tr><td style="padding:20px 32px 32px"><a href="${escapeNotificationHtml(href)}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#1668e8;color:#ffffff;font-size:14px;line-height:18px;font-weight:700;text-decoration:none">${escapeNotificationHtml(buttonLabel)}</a><div style="margin-top:20px;padding-top:18px;border-top:1px solid #e7ebf0;font-size:11px;line-height:17px;color:#8995a5">This email mirrors a notification recorded in TAMCO Focus. Opening it does not complete the requested work.</div></td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text, href };
}

/**
 * Records a failed attempt, and whether it is worth another one.
 *
 * `failed` schedules a retry; `undeliverable` is terminal, because neither
 * claim function will pick that status up again. The distinction comes from
 * the transport, which is the only layer that can tell "the relay was busy"
 * from "this address cannot receive mail" — a reserved name, or a 5xx from
 * the server on this recipient. Retrying the latter nine more times only
 * delays somebody noticing the address is wrong.
 */
async function markFailed(
  client: Client,
  deliveryId: string,
  attemptCount: number,
  problem: unknown,
  now: Date,
): Promise<'failed' | 'undeliverable'> {
  const message =
    problem instanceof Error ? problem.message.slice(0, 1000) : 'Unknown delivery error';
  const permanent = problem instanceof PermanentDeliveryError;
  const retryMinutes = Math.min(24 * 60, 2 ** Math.min(attemptCount, 10));
  const failure = await client
    .from('notification_email_deliveries')
    .update({
      status: permanent ? 'undeliverable' : 'failed',
      last_error: message,
      next_retry_at: permanent
        ? null
        : new Date(now.getTime() + retryMinutes * 60_000).toISOString(),
      processing_started_at: null,
    })
    .eq('id', deliveryId)
    .eq('status', 'processing');
  if (failure.error) {
    console.error(`[notification-email] could not persist failure: ${failure.error.message}`);
  }
  return permanent ? 'undeliverable' : 'failed';
}

async function deliverOne(
  client: Client,
  deliveryId: string,
  options: Required<Pick<NotificationEmailWorkerOptions, 'appBaseUrl'>> &
    Pick<NotificationEmailWorkerOptions, 'send'> & { now: Date },
) {
  const { data: claimData, error: claimError } = await client.rpc(
    'claim_notification_email_delivery',
    { p_delivery_id: deliveryId },
  );
  const claim = claimData as { ok?: boolean; delivery?: DeliveryRow } | null;
  if (claimError || !claim?.ok || !claim.delivery) return 'skipped' as const;

  const delivery = claim.delivery;
  try {
    const [
      { data: notification, error: notificationError },
      { data: profile, error: profileError },
    ] = await Promise.all([
      client
        .from('notifications')
        .select(
          'id,title,body,kind,requires_action,task_id,goal_id,entity_type,entity_id,recipient_id',
        )
        .eq('id', delivery.notification_id)
        .single(),
      client
        .from('user_profiles')
        .select('id,full_name,status')
        .eq('id', delivery.recipient_id)
        .single(),
    ]);
    if (notificationError) throw notificationError;
    if (profileError) throw profileError;
    if (profile.status !== 'active') throw new Error('Recipient account is not active.');

    const rendered = renderNotificationEmail({
      notification: notification as NotificationRow,
      recipientName: profile.full_name,
      appBaseUrl: options.appBaseUrl,
    });
    const prepared = await client
      .from('notification_email_deliveries')
      .update({
        subject: rendered.subject,
        body_html: rendered.html,
        body_text: rendered.text,
      })
      .eq('id', deliveryId)
      .eq('status', 'processing');
    if (prepared.error) throw prepared.error;

    if (options.send) {
      await options.send({
        to: delivery.recipient_email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    }

    const sent = await client
      .from('notification_email_deliveries')
      .update({
        status: 'sent',
        sent_at: options.now.toISOString(),
        processing_started_at: null,
      })
      .eq('id', deliveryId)
      .eq('status', 'processing');
    if (sent.error) throw sent.error;
    return 'sent' as const;
  } catch (problem) {
    return await markFailed(client, deliveryId, delivery.attempt_count, problem, options.now);
  }
}

export async function runNotificationEmailWorker(
  client: Client,
  options: NotificationEmailWorkerOptions = {},
): Promise<NotificationEmailWorkerResult> {
  /*
   * A sending transport with nothing to send through is a programming error,
   * and a silent one: the send below is skipped when `send` is absent, and the
   * row is marked `sent` immediately afterwards regardless. Every notification
   * would be recorded as delivered and thrown away, and `sent` is terminal, so
   * nothing would ever retry it.
   *
   * That is not hypothetical. The weekly summary worker shipped with exactly
   * this shape and ran that way in Production for weeks (v115); only the log
   * transport, which legitimately has no sender, may take the quiet path.
   */
  if ((options.transport === 'smtp' || options.transport === 'inbucket') && !options.send) {
    throw new Error(
      `The ${options.transport} transport was named but no send function was supplied. ` +
        'Every notification would be recorded as sent and discarded.',
    );
  }

  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const result: NotificationEmailWorkerResult = {
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    undeliverable: 0,
  };

  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  const eligibleLimit = Math.min(500, limit);
  let candidates: Array<{ id: string; queued_at: string }>;
  if (options.deliveryIds?.length) {
    const deliveryIds = [...new Set(options.deliveryIds)].slice(0, eligibleLimit);
    const targeted = await client
      .from('notification_email_deliveries')
      .select('id,queued_at')
      .in('id', deliveryIds);
    if (targeted.error) throw targeted.error;
    candidates = targeted.data ?? [];
  } else {
    const [queued, retryable, abandoned] = await Promise.all([
      client
        .from('notification_email_deliveries')
        .select('id,queued_at')
        .eq('status', 'queued')
        .order('queued_at', { ascending: true })
        .limit(eligibleLimit),
      client
        .from('notification_email_deliveries')
        .select('id,queued_at')
        .eq('status', 'failed')
        .or(`next_retry_at.is.null,next_retry_at.lte.${now.toISOString()}`)
        .order('queued_at', { ascending: true })
        .limit(eligibleLimit),
      client
        .from('notification_email_deliveries')
        .select('id,queued_at')
        .eq('status', 'processing')
        .lt('processing_started_at', staleBefore)
        .order('queued_at', { ascending: true })
        .limit(eligibleLimit),
    ]);
    const queryError = queued.error ?? retryable.error ?? abandoned.error;
    if (queryError) throw queryError;
    candidates = [...(queued.data ?? []), ...(retryable.data ?? []), ...(abandoned.data ?? [])]
      .sort((left, right) => left.queued_at.localeCompare(right.queued_at))
      .slice(0, limit);
  }

  result.considered = candidates.length;
  for (const candidate of candidates) {
    const outcome = await deliverOne(client, candidate.id, {
      now,
      appBaseUrl: options.appBaseUrl ?? 'http://localhost:3000',
      send: options.send,
    });
    result[outcome] += 1;
  }
  return result;
}

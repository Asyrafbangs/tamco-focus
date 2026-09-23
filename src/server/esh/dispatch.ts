import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { accessLinkUrl, approvedLinkOrigin, type AccessPurpose } from '@/domain/esh-guest';
import {
  emailDueLabel,
  renderEshDigestEmail,
  renderEshEmail,
  renderWeeklyReportEmail,
  type EshEmailInput,
} from '@/server/esh/email';
import { PermanentDeliveryError } from '@/server/workers/smtp-transport';

type Client = SupabaseClient<Database, 'public'>;

/**
 * Finding Management's outbox worker (v198, §17, §22).
 *
 * The business transaction wrote an outbox row saying who must be told and
 * which links they need. This sends it. For each row it mints one fresh
 * secret per link, hands the database only the right to store their hashes
 * (`esh_dispatch_claim`, which also re-checks the rollout, the contact's
 * access and the live assignment), renders the email with the plain secrets,
 * sends it and forgets them. A failed send revokes the links it minted, so a
 * retry never leaves live links behind.
 *
 * Runs after a Server Action commits, and daily from the cron as the drain.
 */

export interface EshDispatchOptions {
  appBaseUrl: string;
  transport: 'log' | 'inbucket' | 'smtp';
  send?: (delivery: { to: string; subject: string; html: string; text: string }) => Promise<void>;
  limit?: number;
  now?: Date;
}

export interface EshDispatchResult {
  considered: number;
  sent: number;
  held: number;
  suppressed: number;
  failed: number;
  skipped: number;
}

/** 256 bits from the platform's CSPRNG, as 43 URL-safe characters (§18). */
export function newAccessSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The origin for emailed links, from approved values only (§18). Vercel sets
 * `VERCEL_PROJECT_PRODUCTION_URL` itself, so production links cannot depend on
 * a variable somebody forgot to add.
 */
export function eshLinkOrigin(requestOrigin?: string | null): string {
  return approvedLinkOrigin({
    requestOrigin,
    appBaseUrl: process.env.APP_BASE_URL ?? null,
    productionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
  });
}

interface ClaimResult {
  ok: boolean;
  code?: string;
  event_type?: EshEmailInput['eventType'];
  to?: string;
  intents?: AccessPurpose[];
  reference?: string | null;
  action_title?: string | null;
  location?: string | null;
  due_at?: string | null;
  due_is_date_only?: boolean | null;
  timezone?: string;
  esh_contact_name?: string | null;
  esh_contact_email?: string | null;
  expires_minutes?: number;
  finding_id?: string | null;
  owner_email?: string | null;
  submission_version?: number | null;
  followup_kind?: string | null;
  days_overdue?: number | null;
  escalation_level?: number | null;
  /** v207 - a digest carries several actions rather than one. */
  items?: Array<{
    action_id: string;
    reference: string | null;
    finding_title: string | null;
    action_title: string | null;
    location: string | null;
    escalation_level: number | null;
    due_at: string | null;
    due_is_date_only: boolean | null;
  }>;
}

const DIGEST_TYPES = new Set(['owner_digest', 'escalation_digest', 'import_assignment']);

async function dispatchOne(
  client: Client,
  outboxId: string,
  intents: AccessPurpose[],
  options: EshDispatchOptions,
  eventType?: string,
): Promise<keyof Omit<EshDispatchResult, 'considered'>> {
  const secrets: Record<string, string> = {};
  for (const intent of intents) secrets[intent] = newAccessSecret();

  /*
   * v207 - a digest's links are per action, so the worker has to know which
   * actions it is about to carry before it can mint them. Asking changes
   * nothing: the claim re-checks every one of them a moment later, and what no
   * longer applies is dropped there rather than here.
   */
  if (eventType && DIGEST_TYPES.has(eventType)) {
    const prepared = await client.rpc('esh_digest_prepare', { p_outbox_id: outboxId });
    if (prepared.error) {
      console.error(`[esh-dispatch] digest prepare failed: ${prepared.error.message}`);
      return 'skipped';
    }
    const members = ((prepared.data ?? {}) as { members?: Array<{ action_id: string }> }).members;
    if (eventType === 'escalation_digest') {
      for (const member of members ?? []) secrets[member.action_id] = newAccessSecret();
    }
  }

  const { data, error } = await client.rpc('esh_dispatch_claim', {
    p_outbox_id: outboxId,
    p_secrets: secrets,
  });
  if (error) {
    console.error(`[esh-dispatch] claim failed: ${error.message}`);
    return 'skipped';
  }
  const claim = (data ?? { ok: false }) as unknown as ClaimResult;
  if (!claim.ok) {
    if (claim.code === 'held') return 'held';
    if (claim.code === 'suppressed') return 'suppressed';
    return 'skipped';
  }

  try {
    const timeZone = claim.timezone ?? 'Asia/Kuala_Lumpur';
    const rendered = DIGEST_TYPES.has(claim.event_type ?? '')
      ? renderEshDigestEmail({
          eventType: claim.event_type as 'owner_digest' | 'escalation_digest' | 'import_assignment',
          items: (claim.items ?? []).map((item) => ({
            reference: item.reference,
            title: item.action_title ?? item.finding_title,
            dueLabel: emailDueLabel(item.due_at, item.due_is_date_only ?? true, timeZone),
            escalationLevel: item.escalation_level,
            actionUrl: secrets[item.action_id]
              ? accessLinkUrl(options.appBaseUrl, 'escalation_action', secrets[item.action_id]!)
              : null,
          })),
          inboxUrl: secrets.owner_inbox
            ? accessLinkUrl(options.appBaseUrl, 'owner_inbox', secrets.owner_inbox)
            : null,
          expiresMinutes: claim.expires_minutes ?? 1440,
          eshContactName: claim.esh_contact_name ?? null,
          eshContactEmail: claim.esh_contact_email ?? null,
        })
      : renderEshEmail({
          eventType: claim.event_type ?? 'owner_assignment',
          reference: claim.reference ?? null,
          actionTitle: claim.action_title ?? null,
          location: claim.location ?? null,
          dueLabel: emailDueLabel(claim.due_at ?? null, claim.due_is_date_only ?? true, timeZone),
          eshContactName: claim.esh_contact_name ?? null,
          eshContactEmail: claim.esh_contact_email ?? null,
          actionUrl: secrets.owner_action
            ? accessLinkUrl(options.appBaseUrl, 'owner_action', secrets.owner_action)
            : secrets.escalation_action
              ? accessLinkUrl(options.appBaseUrl, 'escalation_action', secrets.escalation_action)
              : null,
          inboxUrl: secrets.owner_inbox
            ? accessLinkUrl(options.appBaseUrl, 'owner_inbox', secrets.owner_inbox)
            : null,
          expiresMinutes: claim.expires_minutes ?? 1440,
          // v199 - staff are sent to the finding, where they sign in as usual.
          findingUrl: claim.finding_id
            ? `${options.appBaseUrl.replace(/\/+$/, '')}/findings/${claim.finding_id}`
            : null,
          ownerEmail: claim.owner_email ?? null,
          submissionVersion: claim.submission_version ?? null,
          followupKind: claim.followup_kind ?? null,
          daysOverdue: claim.days_overdue ?? null,
          escalationLevel: claim.escalation_level ?? null,
        });
    if (options.send) {
      await options.send({
        to: claim.to ?? '',
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    }
    const done = await client.rpc('esh_dispatch_complete', {
      p_outbox_id: outboxId,
      p_ok: true,
      p_provider_message_id: options.transport === 'log' ? 'log-transport' : options.transport,
    });
    if (done.error) throw done.error;
    return 'sent';
  } catch (problem) {
    // The message only: it never carries the link secrets (§18).
    const message = problem instanceof Error ? problem.message : 'unknown delivery error';
    const failed = await client.rpc('esh_dispatch_complete', {
      p_outbox_id: outboxId,
      p_ok: false,
      p_error: message.slice(0, 500),
      p_permanent: problem instanceof PermanentDeliveryError,
    });
    if (failed.error) {
      console.error(`[esh-dispatch] could not record a failure: ${failed.error.message}`);
    }
    return 'failed';
  }
}

interface ReportClaim {
  ok: boolean;
  code?: string;
  to?: string;
  run_id?: string;
  report_name?: string;
  captured_at?: string;
  timezone?: string;
  open_count?: number;
  overdue_count?: number;
  awaiting_count?: number;
  closed_count?: number;
  expires_minutes?: number;
  /** v210 - what the letter itself carries (§34.2). */
  departments?: Array<{
    department: string;
    open: number;
    overdue: number;
    awaiting: number;
    closed: number;
  }>;
  department_total?: number;
  overdue?: Array<{
    reference: string;
    title: string;
    owner: string | null;
    due_at: string | null;
    due_is_date_only: boolean | null;
  }>;
  closed_from?: string | null;
  closed_to?: string | null;
}

async function dispatchReportOne(
  client: Client,
  outboxId: string,
  options: EshDispatchOptions,
): Promise<keyof Omit<EshDispatchResult, 'considered'>> {
  const secret = newAccessSecret();
  const { data, error } = await client.rpc('esh_report_dispatch_claim', {
    p_outbox_id: outboxId,
    p_secret: secret,
  });
  if (error) {
    console.error(`[esh-report-dispatch] claim failed: ${error.message}`);
    return 'skipped';
  }
  const claim = (data ?? { ok: false }) as unknown as ReportClaim;
  if (!claim.ok) return claim.code === 'suppressed' ? 'suppressed' : 'skipped';
  try {
    const rendered = renderWeeklyReportEmail({
      reportName: claim.report_name ?? 'Weekly Finding Management report',
      capturedAt: claim.captured_at ?? new Date().toISOString(),
      timeZone: claim.timezone ?? 'Asia/Kuala_Lumpur',
      reportUrl: accessLinkUrl(options.appBaseUrl, 'report_viewer', secret),
      expiresMinutes: claim.expires_minutes ?? 10080,
      counts: {
        open: claim.open_count ?? 0,
        overdue: claim.overdue_count ?? 0,
        awaiting: claim.awaiting_count ?? 0,
        closed: claim.closed_count ?? 0,
      },
      departments: claim.departments ?? [],
      departmentTotal: claim.department_total ?? 0,
      overdue: (claim.overdue ?? []).map((row) => ({
        reference: row.reference,
        title: row.title,
        owner: row.owner,
        dueLabel:
          emailDueLabel(
            row.due_at,
            row.due_is_date_only ?? true,
            claim.timezone ?? 'Asia/Kuala_Lumpur',
          ) ?? '',
      })),
      closedFrom: claim.closed_from ?? null,
      closedTo: claim.closed_to ?? null,
    });
    if (options.send) {
      await options.send({
        to: claim.to ?? '',
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    }
    const done = await client.rpc('esh_report_dispatch_complete', {
      p_outbox_id: outboxId,
      p_ok: true,
      p_provider_message_id: options.transport === 'log' ? 'log-transport' : options.transport,
    });
    if (done.error) throw done.error;
    return 'sent';
  } catch (problem) {
    const message = problem instanceof Error ? problem.message : 'unknown delivery error';
    const failed = await client.rpc('esh_report_dispatch_complete', {
      p_outbox_id: outboxId,
      p_ok: false,
      p_error: message.slice(0, 500),
      p_permanent: problem instanceof PermanentDeliveryError,
    });
    if (failed.error)
      console.error(`[esh-report-dispatch] completion failed: ${failed.error.message}`);
    return 'failed';
  }
}

export async function runEshOutboxWorker(
  client: Client,
  options: EshDispatchOptions,
): Promise<EshDispatchResult> {
  // The same guard as the Focus worker: a sending transport with nothing to
  // send through would record every email as accepted and send none.
  if ((options.transport === 'smtp' || options.transport === 'inbucket') && !options.send) {
    throw new Error(
      `The ${options.transport} transport was named but no send function was supplied.`,
    );
  }
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();

  const [queued, retryable, abandoned, reportQueued, reportRetryable, reportAbandoned] =
    await Promise.all([
      client
        .from('esh_notification_outbox')
        .select('id, link_intents, created_at, event_type')
        .eq('state', 'queued')
        .order('created_at', { ascending: true })
        .limit(limit),
      client
        .from('esh_notification_outbox')
        .select('id, link_intents, created_at, event_type')
        .eq('state', 'failed')
        .lte('next_attempt_at', now.toISOString())
        .order('created_at', { ascending: true })
        .limit(limit),
      client
        .from('esh_notification_outbox')
        .select('id, link_intents, created_at, event_type')
        .eq('state', 'processing')
        .lt('updated_at', staleBefore)
        .order('created_at', { ascending: true })
        .limit(limit),
      client
        .from('esh_report_outbox')
        .select('id,created_at')
        .eq('state', 'queued')
        .order('created_at', { ascending: true })
        .limit(limit),
      client
        .from('esh_report_outbox')
        .select('id,created_at')
        .eq('state', 'failed')
        .lte('next_attempt_at', now.toISOString())
        .order('created_at', { ascending: true })
        .limit(limit),
      client
        .from('esh_report_outbox')
        .select('id,created_at')
        .eq('state', 'processing')
        .lt('updated_at', staleBefore)
        .order('created_at', { ascending: true })
        .limit(limit),
    ]);
  const queryError =
    queued.error ??
    retryable.error ??
    abandoned.error ??
    reportQueued.error ??
    reportRetryable.error ??
    reportAbandoned.error;
  if (queryError) throw queryError;

  const candidates = [...(queued.data ?? []), ...(retryable.data ?? []), ...(abandoned.data ?? [])]
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .slice(0, limit);

  const result: EshDispatchResult = {
    considered: candidates.length,
    sent: 0,
    held: 0,
    suppressed: 0,
    failed: 0,
    skipped: 0,
  };
  for (const candidate of candidates) {
    const intents = (Array.isArray(candidate.link_intents) ? candidate.link_intents : []).filter(
      (intent): intent is AccessPurpose =>
        intent === 'owner_action' || intent === 'owner_inbox' || intent === 'escalation_action',
    );
    const outcome = await dispatchOne(
      client,
      candidate.id,
      intents,
      options,
      typeof candidate.event_type === 'string' ? candidate.event_type : undefined,
    );
    result[outcome] += 1;
  }
  const remaining = Math.max(0, limit - candidates.length);
  const reportCandidates = [
    ...(reportQueued.data ?? []),
    ...(reportRetryable.data ?? []),
    ...(reportAbandoned.data ?? []),
  ]
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .slice(0, remaining);
  result.considered += reportCandidates.length;
  for (const candidate of reportCandidates) {
    const outcome = await dispatchReportOne(client, candidate.id, options);
    result[outcome] += 1;
  }
  return result;
}

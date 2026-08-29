import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { orgConfig } from '@/lib/env';

/**
 * Scheduled work, run by the platform rather than by a developer's PC.
 *
 * Two things have to happen whether or not anybody is looking at the website:
 * routine occurrences have to be generated, or a routine simply never appears;
 * and the weekly summary has to be sent. Both currently run as `tsx` scripts on
 * the machine this was built on, which means that in Production they would stop
 * the moment it was switched off (assessment section D).
 *
 * This endpoint is that work, reachable by a scheduler. It is deliberately one
 * endpoint rather than two: free scheduling tiers are measured in jobs per day,
 * and the weekly worker already decides for itself whether this is its day, so
 * one daily call covers both without pretending to a cadence we do not have.
 *
 * Authorisation is a shared secret, not a session. There is no user here, so
 * there is nothing for RLS to check — which is exactly why the endpoint has to
 * refuse anything that cannot present the secret. An unauthenticated caller
 * gets 401 and no hint about what runs behind it.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RunResult {
  worker: string;
  ok: boolean;
  detail: string;
}

function unauthorised() {
  // Deliberately terse: a scheduled endpoint should not describe itself to
  // whoever is probing it.
  return NextResponse.json({ error: 'not_authorised' }, { status: 401 });
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('[cron] CRON_SECRET is not configured; refusing to run scheduled work.');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const presented = request.headers.get('authorization');
  if (presented !== `Bearer ${expected}`) return unauthorised();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error('[cron] Supabase service credentials are missing.');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const client = createClient<Database, 'public'>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: RunResult[] = [];

  /*
   * Routine occurrences.
   *
   * `generate_routine_occurrences` is idempotent for a given date, so running
   * it twice in a day is harmless and running it late still catches up. That
   * property is what makes a once-daily schedule safe.
   */
  try {
    /*
     * No horizon argument.
     *
     * This used to pass `p_through: today`, which overrode the procedure's own
     * default of `current_date + 14` and collapsed the lead to nothing. An
     * occurrence could then only be created on the morning it was already due:
     * the Upcoming tab was permanently empty, the calendar showed a routine
     * for the first time on the day itself, and a schedule set up for next
     * month read "nothing scheduled yet" right up until it was late.
     *
     * The default is the configured lead, so this asks for it by not asking.
     */
    const { data, error } = await client.rpc('generate_routine_occurrences', {});
    if (error) throw new Error(error.message);
    results.push({
      worker: 'routine_occurrences',
      ok: true,
      detail: JSON.stringify(data ?? {}),
    });
  } catch (error) {
    // The message, never the payload: a failure here must not spill work
    // content into a platform log (instruction section 42).
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error(`[cron] routine occurrence generation failed: ${detail}`);
    results.push({ worker: 'routine_occurrences', ok: false, detail });
  }

  /*
   * Weekly summary.
   *
   * The worker owns its own schedule — it checks the configured day and hour
   * and does nothing on the other six days — so calling it daily is correct
   * rather than wasteful. The transport comes from `EMAIL_TRANSPORT`: `log`
   * where no relay is configured, `smtp` where one is, and an error rather
   * than a silent downgrade if the configuration is half-finished.
   */
  try {
    const { runWeeklySummaryWorker } = await import('@/server/workers/weekly-summary');
    const { resolveEmailTransport } = await import('@/server/workers/email-transport');

    /*
     * This is the path that runs in Production, and it used to pass no
     * transport at all — so the worker fell back to writing messages nowhere
     * and reporting success. A misconfigured transport now fails the run
     * loudly instead, because a summary marked sent is never retried.
     */
    const transport = resolveEmailTransport();
    if ('error' in transport) throw new Error(transport.error);

    /*
     * One message, to one address, to prove this deployment can reach the
     * relay.
     *
     * Resolving the transport only proves the five variables are present and
     * well shaped. It says nothing about whether Vercel's egress can open a
     * connection to the mail host, or whether the tenant accepts mail from
     * these addresses - and the difference between those is a run at 06:00
     * that silently sends nothing.
     *
     * Deliberately not a query parameter: an address supplied in the URL turns
     * an authenticated endpoint into a way of sending mail to anybody. The
     * recipient comes from an environment variable, so choosing it is the same
     * privilege as changing any other part of the configuration. Remove the
     * variable when the check has passed; it fires on every run while it is
     * set.
     */
    const probeTo = process.env.EMAIL_PROBE_TO?.trim();
    // `send` is optional on the resolved transport: the log transport has none.
    if (probeTo && probeTo.includes('@') && transport.send) {
      await transport.send({
        to: probeTo,
        subject: 'TAMCO Focus production mail check',
        text: 'Sent by /api/cron from the deployed application. Nothing was stored.',
        html: '<p>Sent by <code>/api/cron</code> from the deployed application. Nothing was stored.</p>',
      });
      results.push({
        worker: 'mail_probe',
        ok: true,
        detail: `sent one message via ${transport.name}`,
      });
    }

    const summary = await runWeeklySummaryWorker(client, {
      now: new Date(),
      timeZone: orgConfig.timeZone,
      appBaseUrl: orgConfig.appBaseUrl,
      transport: transport.name,
      send: transport.send,
    });
    results.push({
      worker: 'weekly_summary',
      ok: true,
      detail: JSON.stringify({ transport: transport.name, ...(summary ?? {}) }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error(`[cron] weekly summary failed: ${detail}`);
    results.push({ worker: 'weekly_summary', ok: false, detail });
  }

  const failed = results.filter((result) => !result.ok);
  return NextResponse.json(
    { ranAt: new Date().toISOString(), results },
    { status: failed.length ? 500 : 200 },
  );
}

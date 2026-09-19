import 'server-only';

import { after } from 'next/server';

import { requestOrigin } from '@/lib/env';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { eshLinkOrigin, runEshOutboxWorker } from '@/server/esh/dispatch';
import { resolveEmailTransport } from '@/server/workers/email-transport';

/**
 * Send Finding Management email after a Server Action's response (§7: email
 * dispatch happens after commit, and a failed send never undoes the work).
 *
 * The origin is read while the request is still active, and only an approved
 * one is used (§18). The cron drain retries whatever this leaves behind.
 */
export async function scheduleEshDispatch() {
  const origin = eshLinkOrigin(await requestOrigin());
  after(async () => {
    try {
      const transport = resolveEmailTransport();
      if ('error' in transport) throw new Error(transport.error);
      const result = await runEshOutboxWorker(createSupabaseServiceRoleClient(), {
        appBaseUrl: origin,
        transport: transport.name,
        send: transport.send,
        limit: 20,
      });
      if (result.failed > 0) {
        console.error(`[esh-dispatch] ${result.failed} email(s) failed and will be retried.`);
      }
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'unknown error';
      console.error(`[esh-dispatch] dispatch failed: ${message}`);
    }
  });
}

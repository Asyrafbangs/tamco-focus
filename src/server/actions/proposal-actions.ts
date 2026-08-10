'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { OperationResult } from '@/domain/types';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

const id = z.string().uuid();
const idempotencyKey = z.string().min(8).max(128);

async function callProposalProcedure(
  name: string,
  args: Record<string, unknown>,
): Promise<OperationResult<{ task_id?: string; version?: number }>> {
  await requireProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    console.error(`[${name}] ${error.code ?? 'unknown'}: ${error.message}`);
    return {
      ok: false,
      code: 'unexpected_error',
      message: 'Nothing was changed. Refresh the proposal and try again.',
    };
  }
  const result = data as OperationResult<{ task_id?: string; version?: number }>;
  if (result.ok) {
    for (const path of ['/today', '/work', '/more/records']) revalidatePath(path);
  }
  return result;
}

export async function decideMajorProjectProposal(input: {
  proposalId: string;
  expectedVersion: number;
  decision: 'agree' | 'request_changes' | 'decline';
  note?: string | null;
  idempotencyKey: string;
}): Promise<OperationResult<{ task_id?: string; version?: number }>> {
  const parsed = z
    .object({
      proposalId: id,
      expectedVersion: z.number().int().positive(),
      decision: z.enum(['agree', 'request_changes', 'decline']),
      note: z.string().trim().max(2000).nullish(),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success || (parsed.data.decision !== 'agree' && !parsed.data.note?.trim())) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Record what needs to change or why the proposal is declined.',
    };
  }
  return callProposalProcedure('decide_major_project_proposal', {
    p_proposal_id: parsed.data.proposalId,
    p_expected_version: parsed.data.expectedVersion,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note || null,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

export async function resubmitMajorProjectProposal(input: {
  proposalId: string;
  expectedVersion: number;
  title: string;
  rationale: string;
  idempotencyKey: string;
}): Promise<OperationResult<{ version?: number }>> {
  const parsed = z
    .object({
      proposalId: id,
      expectedVersion: z.number().int().positive(),
      title: z.string().trim().min(1).max(200),
      rationale: z.string().trim().min(1).max(4000),
      idempotencyKey,
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'validation_failed',
      message: 'Add a clear project title and the outcome it will deliver.',
    };
  }
  return callProposalProcedure('resubmit_major_project_proposal', {
    p_proposal_id: parsed.data.proposalId,
    p_expected_version: parsed.data.expectedVersion,
    p_title: parsed.data.title,
    p_rationale: parsed.data.rationale,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
}

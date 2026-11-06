import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';

import { titleFrom, type SourceLink, type TokenUsage } from '@/domain/ai';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ToolCallRecord } from '@/server/ai/agent';

/**
 * The conversation store.
 *
 * Every statement here runs on the caller's own session, so the policies
 * decide what is readable — there is no service-role client in this file and
 * no `user_id` taken from an argument. A caller cannot name somebody else's
 * conversation id and get it, because the policy compares against
 * `focus.current_user_id()` rather than against anything we pass in.
 */

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: Anthropic.MessageParam['content'];
  seq: number;
}

export async function listConversations(limit = 30): Promise<ConversationSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('id, title, updated_at')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`[ai:listConversations] ${error.code ?? 'unknown'}: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    updatedAt: String(row.updated_at),
  }));
}

/**
 * One thread's turns, oldest first.
 *
 * Returns an empty list for a conversation that is not the caller's — the
 * policy filters it out, so there is nothing here that needs to check.
 */
export async function loadThread(conversationId: string): Promise<StoredMessage[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ai_messages')
    .select('role, content, seq')
    .eq('conversation_id', conversationId)
    .order('seq');
  if (error) {
    console.error(`[ai:loadThread] ${error.code ?? 'unknown'}: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content as Anthropic.MessageParam['content'],
    seq: Number(row.seq),
  }));
}

export async function startConversation(input: {
  userId: string;
  question: string;
}): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({
      user_id: input.userId,
      title: titleFrom(input.question),
    })
    .select('id')
    .single();
  if (error) {
    console.error(`[ai:startConversation] ${error.code ?? 'unknown'}: ${error.message}`);
    return null;
  }
  return String(data.id);
}

/**
 * Appends one exchange: what was asked, and what came back.
 *
 * Written after the turn rather than during it, so a half-finished
 * investigation does not leave a thread that cannot be replayed. The sequence
 * number comes from what is already stored, which is also what makes a
 * duplicate submission visible rather than silently doubling a thread.
 */
export async function appendTurn(input: {
  conversationId: string;
  userId: string;
  question: string;
  answer: Anthropic.MessageParam['content'];
  sources: SourceLink[];
  usage: TokenUsage;
  costUsd: number;
  model: string;
  toolCalls: ToolCallRecord[];
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: last } = await supabase
    .from('ai_messages')
    .select('seq')
    .eq('conversation_id', input.conversationId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  const next = (last?.seq ?? -1) + 1;

  const { error: messageError } = await supabase.from('ai_messages').insert([
    {
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: 'user',
      content: [{ type: 'text', text: input.question }],
      seq: next,
    },
    {
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: 'assistant',
      /*
       * The answer's blocks, plus the sources as a block of our own. The
       * citations are built from rows a tool returned, never written by the
       * model, so they belong with the turn that produced them.
       */
      content: [
        ...(Array.isArray(input.answer) ? input.answer : [{ type: 'text', text: input.answer }]),
        { type: 'tamco_sources', sources: input.sources },
      ],
      seq: next + 1,
    },
  ]);
  if (messageError) {
    console.error(`[ai:appendTurn] ${messageError.code ?? 'unknown'}: ${messageError.message}`);
    return;
  }

  await supabase
    .from('ai_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.conversationId);

  await supabase.from('ai_usage').insert({
    conversation_id: input.conversationId,
    user_id: input.userId,
    model: input.model,
    input_tokens: input.usage.inputTokens,
    output_tokens: input.usage.outputTokens,
    cache_read_tokens: input.usage.cacheReadTokens,
    cache_write_tokens: input.usage.cacheWriteTokens,
    cost_usd: input.costUsd,
  });

  if (input.toolCalls.length > 0) {
    await supabase.from('ai_tool_calls').insert(
      input.toolCalls.map((call) => ({
        conversation_id: input.conversationId,
        user_id: input.userId,
        tool_name: call.name,
        input: (call.input ?? {}) as never,
        ok: call.ok,
        error: call.error,
        rows_returned: call.rows,
        duration_ms: call.durationMs,
      })),
    );
  }
}

/** What this person has spent in the last 24 hours, in dollars. */
export async function spentLastDay(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('ai_spend_last_day');
  if (error) {
    /*
     * Unknown spend is not zero spend. A failed read here opens the gate on a
     * limit that exists to stop a surprise, so it is treated as "at the
     * limit" until it can be read.
     */
    console.error(`[ai:spentLastDay] ${error.code ?? 'unknown'}: ${error.message}`);
    return Number.POSITIVE_INFINITY;
  }
  return Number(data ?? 0);
}

/**
 * The stored thread, as the API wants it back.
 *
 * Our own `tamco_sources` blocks are stripped: they are ours, not the API's,
 * and sending one back would be an unknown block type on the next request.
 */
export function asApiMessages(stored: readonly StoredMessage[]): Anthropic.MessageParam[] {
  return stored.map((message) => ({
    role: message.role,
    content: (Array.isArray(message.content)
      ? message.content.filter((block) => (block as { type?: string }).type !== 'tamco_sources')
      : message.content) as Anthropic.MessageParam['content'],
  }));
}

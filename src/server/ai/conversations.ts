import 'server-only';

import {
  AGENT_LIMITS,
  titleFrom,
  type AiMessage,
  type SourceLink,
  type TokenUsage,
} from '@/domain/ai';
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

export interface StoredMessage extends AiMessage {
  seq: number;
  /** Citations belong to the turn that produced them, not to the model. */
  sources?: SourceLink[];
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
  return (data ?? []).map((row) => {
    const stored = (row.content ?? {}) as Partial<AiMessage> & { sources?: SourceLink[] };
    return {
      role: (row.role as AiMessage['role']) ?? 'user',
      content: String(stored.content ?? ''),
      toolCalls: stored.toolCalls,
      toolCallId: stored.toolCallId,
      name: stored.name,
      sources: stored.sources,
      seq: Number(row.seq),
    };
  });
}

/**
 * The thread as the next request should carry it.
 *
 * Tool results are dropped and only the recent exchanges are kept. This is a
 * token decision with a correctness consequence, so it is worth being plain
 * about: replaying every tool result from a long thread would spend the whole
 * minute's allowance before the new question was asked. What survives is each
 * side's words, including the assistant's own account of what it found, and
 * the model reads the records again whenever a question depends on them.
 */
export function historyFor(stored: readonly StoredMessage[]): AiMessage[] {
  const spoken = stored
    .filter((message) => message.role !== 'tool' && message.content.trim().length > 0)
    .map<AiMessage>((message) => ({ role: message.role, content: message.content }));
  return spoken.slice(-AGENT_LIMITS.maxHistoryTurns);
}

export async function startConversation(input: {
  userId: string;
  question: string;
}): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({ user_id: input.userId, title: titleFrom(input.question) })
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
  messages: readonly AiMessage[];
  sources: SourceLink[];
  usage: TokenUsage;
  requests: number;
  chargedUsd: number;
  listPriceUsd: number;
  provider: string;
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
  let next = (last?.seq ?? -1) + 1;

  const rows = input.messages.map((message, index) => ({
    conversation_id: input.conversationId,
    user_id: input.userId,
    role: message.role === 'tool' ? 'assistant' : message.role,
    content: {
      ...message,
      /*
       * The citations ride with the last assistant turn. They were built from
       * rows the tools returned, so they belong to the exchange that read
       * them rather than to anything the model wrote.
       */
      ...(index === input.messages.length - 1 && message.role === 'assistant'
        ? { sources: input.sources }
        : {}),
    } as unknown as never,
    seq: next++,
  }));

  const { error: messageError } = await supabase.from('ai_messages').insert(rows);
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
    provider: input.provider,
    model: input.model,
    requests: input.requests,
    input_tokens: input.usage.inputTokens,
    output_tokens: input.usage.outputTokens,
    cached_input_tokens: input.usage.cachedInputTokens,
    charged_usd: input.chargedUsd,
    list_price_usd: input.listPriceUsd,
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

export interface UsageWindow {
  requestsToday: number;
  tokensToday: number;
  chargedTodayUsd: number;
  tokensThisMinute: number;
}

/**
 * What this person has used, over the day and the last minute.
 *
 * A failed read is treated as "at the limit" on every count. Unknown usage is
 * not zero usage, and a budget that opens its gate when it cannot see is a
 * budget that exists only on paper.
 */
export async function usageWindow(): Promise<UsageWindow> {
  const supabase = await createSupabaseServerClient();
  /*
   * The function returns a single row as a set, so the generated type is an
   * array; `maybeSingle` would narrow it to `{}` here and lose the columns.
   */
  const { data, error } = await supabase.rpc('ai_usage_window');
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    if (error) console.error(`[ai:usageWindow] ${error.code ?? 'unknown'}: ${error.message}`);
    return {
      requestsToday: Number.POSITIVE_INFINITY,
      tokensToday: Number.POSITIVE_INFINITY,
      chargedTodayUsd: Number.POSITIVE_INFINITY,
      tokensThisMinute: Number.POSITIVE_INFINITY,
    };
  }
  return {
    requestsToday: Number(row.requests_today ?? 0),
    tokensToday: Number(row.tokens_today ?? 0),
    chargedTodayUsd: Number(row.charged_today ?? 0),
    tokensThisMinute: Number(row.tokens_this_minute ?? 0),
  };
}

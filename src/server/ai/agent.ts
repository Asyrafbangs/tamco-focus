import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import {
  AGENT_LIMITS,
  ToolInputError,
  costOf,
  stepsExhausted,
  sumUsage,
  type SourceLink,
  type TokenUsage,
} from '@/domain/ai';
import { aiConfig } from '@/server/ai/config';
import { SYSTEM_PROMPT, callerContext } from '@/server/ai/prompt';
import { AGENT_TOOLS, toolByName, type ToolCaller } from '@/server/ai/tools';

/**
 * The investigation loop.
 *
 * Written by hand rather than with the SDK's tool runner, for one reason: a
 * Vercel function on this plan is killed at sixty seconds, so the loop has to
 * be able to stop between steps, keep what it has, and still produce an
 * answer. A runner that owns the loop cannot be interrupted at a point of our
 * choosing. Everything else — streaming, usage, tool dispatch — is the SDK's.
 *
 * What the loop does each step: send the conversation, read what comes back,
 * run whatever tools were asked for, append the results, go again. It stops
 * when the model answers, when it runs out of steps, or when the clock says
 * there is only enough time left to write the answer.
 */

export type AgentEvent =
  | { type: 'step'; step: number; label: string }
  | { type: 'tool'; name: string; rows: number; ok: boolean }
  | { type: 'text'; delta: string }
  | { type: 'sources'; sources: SourceLink[] }
  | { type: 'done'; usage: TokenUsage; costUsd: number; stopped: 'answered' | 'steps' | 'clock' }
  | { type: 'error'; message: string };

export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
  error: string | null;
  rows: number | null;
  durationMs: number;
}

export interface AgentResult {
  /** The reply, as content blocks, ready to be replayed into the next turn. */
  content: Anthropic.MessageParam['content'];
  text: string;
  sources: SourceLink[];
  usage: TokenUsage;
  costUsd: number;
  toolCalls: ToolCallRecord[];
  stopped: 'answered' | 'steps' | 'clock';
}

function usageOf(message: Anthropic.Message): TokenUsage {
  return {
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

/** The tool list, in a fixed order so the cached prefix stays identical. */
function toolDefinitions(): Anthropic.Tool[] {
  return AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
  }));
}

export interface RunInput {
  history: Anthropic.MessageParam[];
  question: string;
  caller: ToolCaller;
  eshAccess: string;
  /**
   * Lets a test drive the loop without a network.
   *
   * Narrower than the SDK's own type on purpose: the loop needs one thing
   * from a client - send this, give me back a message - and a stub that
   * satisfies that is a legitimate client as far as this code is concerned.
   */
  client?: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
  now?: () => number;
}

/**
 * Runs one turn and yields events as it goes.
 *
 * An async generator rather than a callback, so the route can stream it and a
 * test can collect it without either of them owning the loop.
 */
export async function* runInvestigation(input: RunInput): AsyncGenerator<AgentEvent, AgentResult> {
  const config = aiConfig();
  const now = input.now ?? Date.now;
  const startedAt = now();
  const client =
    input.client ??
    new Anthropic({ apiKey: config.apiKey ?? undefined, maxRetries: 2, timeout: 30_000 }).messages;

  const messages: Anthropic.MessageParam[] = [
    ...input.history,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${callerContext({
            fullName: input.caller.fullName,
            timezone: input.caller.timezone,
            nowIso: new Date(startedAt).toISOString(),
            eshAccess: input.eshAccess,
          })}\n\n${input.question}`,
        },
      ],
    },
  ];

  const turns: TokenUsage[] = [];
  const sources: SourceLink[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let answer = '';
  let last: Anthropic.Message | null = null;
  let stopped: AgentResult['stopped'] = 'answered';

  for (let step = 0; ; step += 1) {
    if (stepsExhausted(step, startedAt, now())) {
      stopped = step >= AGENT_LIMITS.maxSteps ? 'steps' : 'clock';
      break;
    }
    yield {
      type: 'step',
      step: step + 1,
      label: step === 0 ? 'Reading your records' : 'Following up',
    };

    const message = await client.create({
      model: config.model,
      max_tokens: 8_000,
      /*
       * Adaptive thinking, with the depth set by configuration. The raw
       * reasoning is never requested and never stored - the person sees the
       * investigation's findings, not the model's inner monologue.
       */
      thinking: { type: 'adaptive' },
      output_config: { effort: config.effort },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: toolDefinitions(),
      messages,
    });
    last = message;
    turns.push(usageOf(message));

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (text) {
      answer += (answer ? '\n\n' : '') + text;
      yield { type: 'text', delta: text };
    }

    const calls = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (calls.length === 0 || message.stop_reason !== 'tool_use') break;

    messages.push({ role: 'assistant', content: message.content });

    /*
     * Every result goes back in ONE user message, including the failures.
     * Splitting them teaches the model to stop asking for several at once,
     * and dropping a failed one leaves it waiting for an answer that never
     * comes.
     */
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      const tool = toolByName(call.name);
      const began = now();
      if (!tool) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `There is no tool called ${call.name}.`,
        });
        toolCalls.push({
          name: call.name,
          input: call.input,
          ok: false,
          error: 'unknown tool',
          rows: null,
          durationMs: 0,
        });
        yield { type: 'tool', name: call.name, rows: 0, ok: false };
        continue;
      }
      try {
        const outcome = await tool.run(call.input, input.caller);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: outcome.evidence });
        for (const source of outcome.sources) {
          if (!sources.some((held) => held.kind === source.kind && held.id === source.id)) {
            sources.push(source);
          }
        }
        toolCalls.push({
          name: call.name,
          input: call.input,
          ok: true,
          error: null,
          rows: outcome.rows,
          durationMs: now() - began,
        });
        yield { type: 'tool', name: call.name, rows: outcome.rows, ok: true };
      } catch (cause) {
        /*
         * A tool that failed is told to the model as a result, not thrown. It
         * can then say what it could not establish - which is the honest
         * answer - instead of the whole turn dying on one bad argument.
         */
        const message_ =
          cause instanceof ToolInputError
            ? cause.message
            : 'That record could not be read. Treat it as unknown rather than absent.';
        if (!(cause instanceof ToolInputError)) {
          console.error(`[ai-tool:${call.name}] ${String(cause)}`);
        }
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: message_,
        });
        toolCalls.push({
          name: call.name,
          input: call.input,
          ok: false,
          error: message_,
          rows: null,
          durationMs: now() - began,
        });
        yield { type: 'tool', name: call.name, rows: 0, ok: false };
      }
    }
    messages.push({ role: 'user', content: results });
  }

  if (stopped !== 'answered' && !answer) {
    answer =
      stopped === 'clock'
        ? 'I ran out of time before I could finish this one. What I read is listed below — ask me again and I will carry on from there.'
        : 'I reached the limit on how many records I can read in one go. What I read is listed below; narrow the question and I can go deeper.';
    yield { type: 'text', delta: answer };
  }

  const usage = sumUsage(turns);
  const costUsd = costOf(config.model, usage);
  if (sources.length > 0) yield { type: 'sources', sources };
  yield { type: 'done', usage, costUsd, stopped };

  return {
    content: last?.content ?? [{ type: 'text', text: answer }],
    text: answer,
    sources,
    usage,
    costUsd,
    toolCalls,
    stopped,
  };
}

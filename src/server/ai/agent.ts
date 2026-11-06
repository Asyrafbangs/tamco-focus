import 'server-only';

import {
  AGENT_LIMITS,
  STOP_WORDS,
  ToolInputError,
  canAffordStep,
  chargeOf,
  estimateTokens,
  listPriceOf,
  sumUsage,
  totalTokens,
  type AiMessage,
  type SourceLink,
  type StopReason,
  type TierLimits,
  type TokenUsage,
} from '@/domain/ai';
import { SYSTEM_PROMPT, callerContext } from '@/server/ai/prompt';
import { ProviderError, stopReasonFor, type AiProvider } from '@/server/ai/providers/types';
import { AGENT_TOOLS, toolByName, type ToolCaller } from '@/server/ai/tools';

/**
 * The investigation loop.
 *
 * Send the conversation, read what comes back, run whatever tools were asked
 * for, append the results, go again. It stops when the model answers, and
 * otherwise for a reason it says out loud: no steps left, no clock left, no
 * token allowance left for this minute, or a provider that is rate limited.
 *
 * Three ceilings rather than one, because on a free tier they bind in
 * different orders. The clock is the platform's sixty seconds. The step count
 * is four, because every step resends the whole conversation and the cost of a
 * loop grows with the square of its length. The token budget is the real
 * constraint: 8,000 tokens a minute is perhaps two full steps of a grounded
 * investigation, so the loop checks what it can afford before each step rather
 * than discovering it halfway through with nothing to show.
 *
 * What it will not do under any of those conditions is invent an answer. A
 * turn that ran out of allowance says so and lists what it read.
 */

export type AgentEvent =
  | { type: 'step'; step: number; label: string }
  | { type: 'tool'; name: string; rows: number; ok: boolean }
  | { type: 'text'; delta: string }
  | { type: 'sources'; sources: SourceLink[] }
  | { type: 'notice'; message: string }
  | {
      type: 'done';
      usage: TokenUsage;
      chargedUsd: number;
      listPriceUsd: number;
      stop: StopReason;
    };

export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
  error: string | null;
  rows: number | null;
  durationMs: number;
}

export interface AgentResult {
  /** The exchange, in our neutral shape, ready to be stored and replayed. */
  messages: AiMessage[];
  text: string;
  sources: SourceLink[];
  usage: TokenUsage;
  chargedUsd: number;
  listPriceUsd: number;
  toolCalls: ToolCallRecord[];
  stop: StopReason;
  /** Set when the turn ended on a provider failure rather than an answer. */
  failure: { kind: string; message: string; retryAfterMs: number | null } | null;
}

export interface RunInput {
  provider: AiProvider;
  /** Earlier exchanges, already trimmed by the caller. */
  history: readonly AiMessage[];
  question: string;
  caller: ToolCaller;
  eshAccess: string;
  limits: TierLimits;
  /** Tokens this account has already spent in the last minute. */
  tokensUsedThisMinute: number;
  now?: () => number;
  /** Swapped in tests so a rate-limit wait does not take a real minute. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The tool list, in a fixed order so a cached prefix stays identical. */
function toolSpecs() {
  return AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

/**
 * Runs one turn and yields events as it goes.
 *
 * An async generator rather than a callback, so the route can stream it and a
 * test can collect it without either of them owning the loop.
 */
export async function* runInvestigation(input: RunInput): AsyncGenerator<AgentEvent, AgentResult> {
  const now = input.now ?? Date.now;
  const waitFor = input.wait ?? sleep;
  const startedAt = now();

  const system = SYSTEM_PROMPT;
  const opening: AiMessage = {
    role: 'user',
    content: `${callerContext({
      fullName: input.caller.fullName,
      timezone: input.caller.timezone,
      nowIso: new Date(startedAt).toISOString(),
      eshAccess: input.eshAccess,
    })}\n\n${input.question}`,
  };

  /** What goes to the provider. */
  const conversation: AiMessage[] = [...input.history, opening];
  /** What gets stored: this turn only, without the replayed history. */
  const produced: AiMessage[] = [opening];

  const turns: TokenUsage[] = [];
  const sources: SourceLink[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let answer = '';
  let stop: StopReason = 'answered';
  let failure: AgentResult['failure'] = null;
  let minuteTokens = input.tokensUsedThisMinute;
  let rateLimitWaited = false;

  const fixedCost =
    estimateTokens(system) +
    toolSpecs().reduce((sum, tool) => sum + estimateTokens(JSON.stringify(tool)), 0);

  for (let step = 0; ; step += 1) {
    if (step >= AGENT_LIMITS.maxSteps) {
      stop = 'steps';
      break;
    }
    if (now() - startedAt >= AGENT_LIMITS.softDeadlineMs) {
      stop = 'clock';
      break;
    }

    /*
     * What the next step would cost, before it is attempted. The conversation
     * is resent in full every time, so this grows with each tool result -
     * which is exactly why it has to be checked rather than assumed.
     */
    const estimated =
      fixedCost +
      conversation.reduce((sum, message) => sum + estimateTokens(message.content), 0) +
      AGENT_LIMITS.maxOutputTokens;
    if (
      !canAffordStep({
        estimatedTokens: estimated,
        tokensUsedThisMinute: minuteTokens,
        limits: input.limits,
      })
    ) {
      stop = step === 0 ? 'budget' : 'budget';
      break;
    }

    yield {
      type: 'step',
      step: step + 1,
      label: step === 0 ? 'Reading your records' : 'Following up',
    };

    let reply;
    try {
      reply = await input.provider.send({
        system,
        messages: conversation,
        tools: toolSpecs(),
        maxOutputTokens: AGENT_LIMITS.maxOutputTokens,
        effort: 'high',
      });
    } catch (cause) {
      if (!(cause instanceof ProviderError)) {
        console.error(`[ai-agent] ${String(cause)}`);
        stop = 'failed';
        failure = {
          kind: 'unknown',
          message: 'The model could not be reached.',
          retryAfterMs: null,
        };
        break;
      }
      /*
       * One wait, and only for a per-minute limit that fits inside the time
       * this turn has left. A second wait would spend the remaining clock
       * queueing instead of answering, and an exhausted daily quota is not
       * something waiting fixes.
       */
      const canWait =
        cause.kind === 'rate_limited' &&
        !rateLimitWaited &&
        cause.retryAfterMs !== null &&
        now() - startedAt + cause.retryAfterMs < AGENT_LIMITS.softDeadlineMs;
      if (canWait) {
        rateLimitWaited = true;
        yield {
          type: 'notice',
          message: `Rate limited; waiting ${Math.ceil(cause.retryAfterMs! / 1000)}s before carrying on.`,
        };
        await waitFor(cause.retryAfterMs!);
        step -= 1;
        continue;
      }
      console.error(`[ai-agent] provider ${cause.kind}: ${cause.message}`);
      stop = stopReasonFor(cause.kind);
      failure = { kind: cause.kind, message: cause.message, retryAfterMs: cause.retryAfterMs };
      break;
    }

    turns.push(reply.usage);
    minuteTokens += totalTokens(reply.usage);

    if (reply.text) {
      answer += (answer ? '\n\n' : '') + reply.text;
      yield { type: 'text', delta: reply.text };
    }

    if (reply.stop === 'truncated') {
      produced.push({ role: 'assistant', content: reply.text });
      stop = 'truncated';
      break;
    }

    if (reply.stop === 'answered' || reply.toolCalls.length === 0) {
      produced.push({ role: 'assistant', content: reply.text });
      stop = 'answered';
      break;
    }

    const asking: AiMessage = {
      role: 'assistant',
      content: reply.text,
      toolCalls: reply.toolCalls,
    };
    conversation.push(asking);
    produced.push(asking);

    for (const call of reply.toolCalls) {
      const tool = toolByName(call.name);
      const began = now();

      if (!tool) {
        const refusal = `There is no tool called ${call.name}.`;
        const result: AiMessage = {
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: refusal,
        };
        conversation.push(result);
        produced.push(result);
        toolCalls.push({
          name: call.name,
          input: call.arguments,
          ok: false,
          error: 'unknown tool',
          rows: null,
          durationMs: 0,
        });
        yield { type: 'tool', name: call.name, rows: 0, ok: false };
        continue;
      }

      let parsedArguments: unknown = {};
      let argumentsBroken = false;
      try {
        parsedArguments = call.arguments.trim() ? JSON.parse(call.arguments) : {};
      } catch {
        // A model that wrote invalid JSON is told so rather than having its
        // intent guessed at.
        argumentsBroken = true;
      }

      try {
        if (argumentsBroken) {
          throw new ToolInputError(
            `${call.name} was called with arguments that are not valid JSON. Call it again with a well-formed object.`,
          );
        }
        const outcome = await tool.run(parsedArguments, input.caller);
        const result: AiMessage = {
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: outcome.evidence,
        };
        conversation.push(result);
        produced.push(result);
        for (const source of outcome.sources) {
          if (!sources.some((held) => held.kind === source.kind && held.id === source.id)) {
            sources.push(source);
          }
        }
        toolCalls.push({
          name: call.name,
          input: parsedArguments,
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
         * answer - instead of the whole turn dying on one bad argument. What
         * it must never become is an empty result: "no rows" and "could not
         * read" are different facts and the payload says which.
         */
        const stated =
          cause instanceof ToolInputError
            ? cause.message
            : 'That record could not be read. Treat it as unknown rather than absent, and say so.';
        if (!(cause instanceof ToolInputError)) {
          console.error(`[ai-tool:${call.name}] ${String(cause)}`);
        }
        const result: AiMessage = {
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: stated,
        };
        conversation.push(result);
        produced.push(result);
        toolCalls.push({
          name: call.name,
          input: parsedArguments,
          ok: false,
          error: stated,
          rows: null,
          durationMs: now() - began,
        });
        yield { type: 'tool', name: call.name, rows: 0, ok: false };
      }
    }
  }

  /*
   * Whatever happened, it is said. An investigation that stopped early with
   * no words of its own would otherwise look like one that had nothing to
   * report, and the gap between those two is the whole value of the feature.
   */
  if (stop !== 'answered') {
    const words = STOP_WORDS[stop];
    answer = answer ? `${answer}\n\n${words}` : words;
    yield { type: 'text', delta: words };
    if (produced.at(-1)?.role !== 'assistant' || produced.at(-1)?.toolCalls) {
      produced.push({ role: 'assistant', content: words });
    } else {
      produced[produced.length - 1] = { role: 'assistant', content: answer };
    }
  }

  const usage = sumUsage(turns);
  const listPriceUsd = listPriceOf(input.provider.model, usage);
  const chargedUsd = chargeOf(input.provider.model, usage, input.provider.tier);
  if (sources.length > 0) yield { type: 'sources', sources };
  yield { type: 'done', usage, chargedUsd, listPriceUsd, stop };

  return {
    messages: produced,
    text: answer,
    sources,
    usage,
    chargedUsd,
    listPriceUsd,
    toolCalls,
    stop,
    failure,
  };
}

import 'server-only';

import {
  AGENT_LIMITS,
  FINAL_ANSWER_INSTRUCTION,
  ToolInputError,
  canAffordStep,
  chargeOf,
  estimateTokens,
  listPriceOf,
  scrubToolNames,
  stopWords,
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
  /*
   * HTTP requests this turn actually cost the provider's allowance.
   *
   * Not the number of steps and not the number of tool calls: a step can
   * resample twice behind the scenes, and a tool call is a database read
   * that never leaves the building.
   */
  providerRequests: number;
  /** Reads that succeeded. What the answer is allowed to claim it read. */
  readCount: number;
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
  /** Tokens the installation has already spent in the last minute. */
  tokensUsedThisMinute: number;
  /** And in the rolling day, against the shared daily ceiling. */
  tokensUsedToday: number;
  /*
   * How hard the model works, from configuration rather than from here.
   *
   * This used to be the literal `'high'` at the one call site below, with
   * `AI_EFFORT` read, validated and defaulted in `config.ts` and then never
   * used. The documented default was `medium` and every request went out at
   * `high`, which on the measured scenario is roughly twice the tokens - so
   * the thing being paid for and the thing being configured were different,
   * and the eval suite, which does honour the setting, had never measured
   * what the product actually sent.
   */
  effort: 'low' | 'medium' | 'high';
  now?: () => number;
  /** Swapped in tests so a rate-limit wait does not take a real minute. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A stable key for "this tool, with these arguments".
 *
 * Keys are sorted so `{a:1,b:2}` and `{b:2,a:1}` are the same call, because
 * the model writes its JSON freshly each time and argument order is not a
 * decision it is making.
 */
function callKey(name: string, args: unknown): string {
  const canonical =
    args && typeof args === 'object'
      ? JSON.stringify(
          Object.fromEntries(
            Object.entries(args as Record<string, unknown>).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        )
      : JSON.stringify(args ?? {});
  return `${name}:${canonical}`;
}

/**
 * What every request carries before a word of conversation: the system
 * prompt and the tool list.
 *
 * Exported because the route needs the same number to decide whether a
 * question can be afforded at all, and the hard-coded guess it used before
 * (2,600) was double the real figure - which made the guard refuse questions
 * the tier could comfortably have answered.
 */
export function fixedPromptCost(): number {
  return (
    estimateTokens(SYSTEM_PROMPT) +
    toolSpecs().reduce((sum, tool) => sum + estimateTokens(JSON.stringify(tool)), 0)
  );
}

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
  let dayTokens = input.tokensUsedToday;
  let rateLimitWaited = false;
  let toolsUsed = 0;
  let nudged = false;
  /* Every HTTP request the provider made for this turn, successful or not. */
  let providerRequests = 0;
  /*
   * What has already been fetched this turn.
   *
   * Measured against the real model: asked a question the records could not
   * answer, it called the same tool with the same arguments four times in a
   * row and never wrote a word. The loop stopped it at the step limit, which
   * was honest and useless - it had spent the whole minute's allowance and
   * produced nothing. A repeat is now answered with "you already have this",
   * which breaks the cycle at the point it starts.
   */
  const alreadyFetched = new Set<string>();

  const fixedCost = fixedPromptCost();

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
      AGENT_LIMITS.budgetedOutputTokens;
    if (
      !canAffordStep({
        estimatedTokens: estimated,
        tokensUsedThisMinute: minuteTokens,
        tokensUsedToday: dayTokens,
        limits: input.limits,
      })
    ) {
      /*
       * Which allowance ran out, because the advice differs: the minute's
       * comes back in a minute, the shared day's does not.
       */
      stop = dayTokens + estimated > input.limits.tokensPerDay ? 'quota' : 'budget';
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
        effort: input.effort,
      });
      providerRequests += reply.requests;
    } catch (cause) {
      if (!(cause instanceof ProviderError)) {
        console.error(`[ai-agent] ${String(cause)}`);
        providerRequests += 1;
        stop = 'failed';
        failure = {
          kind: 'unknown',
          message: 'The model could not be reached.',
          retryAfterMs: null,
        };
        break;
      }
      // A refused request still spent the provider's allowance, retries and
      // all, so it is counted before the turn decides what to do about it.
      providerRequests += cause.requests;
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
    dayTokens += totalTokens(reply.usage);

    /*
     * An answer with nothing read behind it gets exactly one nudge.
     *
     * Measured across two full eval runs: on a question it could not settle,
     * the model sometimes answers from the question alone - no tool call at
     * all. Both times the words were careful and the substance was ungrounded,
     * which is the one failure this feature cannot ship with, and the prompt
     * rule telling it to read first did not always hold.
     *
     * So the loop enforces what the prompt asks: the draft is discarded
     * unseen, the model is told plainly what it did, and it gets one more
     * step. If it answers without tools again, that answer stands - some
     * questions genuinely need no records - but it has been asked once.
     *
     * A very short message is exempt: "thanks" should not cost two requests.
     */
    const groundless =
      reply.stop === 'answered' &&
      reply.toolCalls.length === 0 &&
      toolsUsed === 0 &&
      !nudged &&
      input.question.trim().length >= 20;
    if (groundless) {
      nudged = true;
      conversation.push({ role: 'assistant', content: reply.text });
      conversation.push({
        role: 'user',
        content:
          'You answered without reading any records, so that answer has been discarded. Call the tools you need for this question - both the task tools and the finding tools if it spans them - and then answer from what they return. If no tool can help, say exactly what you cannot establish and why.',
      });
      yield { type: 'notice', message: 'Checking that against your records before answering.' };
      continue;
    }

    /*
     * Scrubbed once, here, so the streamed text and the stored message are
     * the same words and neither carries an internal tool name.
     */
    const written = scrubToolNames(reply.text);
    if (written) {
      answer += (answer ? '\n\n' : '') + written;
      yield { type: 'text', delta: written };
    }

    if (reply.stop === 'truncated') {
      produced.push({ role: 'assistant', content: written });
      stop = 'truncated';
      break;
    }

    if (reply.stop === 'answered' || reply.toolCalls.length === 0) {
      produced.push({ role: 'assistant', content: written });
      stop = 'answered';
      break;
    }

    /*
     * Scrubbed here too, because this message is stored and replayed into
     * the thread on reload - unscrubbed, a reloaded conversation would show
     * tool names the live one had taken out. The `toolCalls` beside it are
     * untouched: those are the real call, not prose for a person.
     */
    const asking: AiMessage = {
      role: 'assistant',
      content: written,
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
      let repeated = false;
      try {
        parsedArguments = call.arguments.trim() ? JSON.parse(call.arguments) : {};
      } catch {
        // A model that wrote invalid JSON is told so rather than having its
        // intent guessed at.
        argumentsBroken = true;
      }

      if (!argumentsBroken) {
        const key = callKey(call.name, parsedArguments);
        repeated = alreadyFetched.has(key);
        alreadyFetched.add(key);
      }

      try {
        if (argumentsBroken) {
          throw new ToolInputError(
            `${call.name} was called with arguments that are not valid JSON. Call it again with a well-formed object.`,
          );
        }
        if (repeated) {
          throw new ToolInputError(
            `You have already called ${call.name} with these arguments in this conversation and its result is above. Answer from what you have, call a different tool, or say what you cannot establish.`,
          );
        }
        const outcome = await tool.run(parsedArguments, input.caller);
        toolsUsed += 1;
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
   * Out of steps, but with records read and nothing written.
   *
   * This is the outcome worth one more request: the evidence was gathered and
   * paid for, and stopping here throws it away. One final call with no tools
   * attached forces a conclusion from what is already in the conversation.
   * Measured against the real model, this is what the step limit used to
   * produce instead - four careful reads of tasks, team, findings and the
   * verification queue, and not a word of answer.
   */
  if ((stop === 'steps' || stop === 'budget') && toolsUsed > 0 && !answer) {
    const estimated =
      estimateTokens(system) +
      conversation.reduce((sum, message) => sum + estimateTokens(message.content), 0) +
      AGENT_LIMITS.budgetedOutputTokens;
    if (
      canAffordStep({
        estimatedTokens: estimated,
        tokensUsedThisMinute: minuteTokens,
        tokensUsedToday: dayTokens,
        limits: input.limits,
      })
    ) {
      yield { type: 'step', step: AGENT_LIMITS.maxSteps + 1, label: 'Drawing it together' };
      try {
        const closing = await input.provider.send({
          system,
          messages: [...conversation, { role: 'user', content: FINAL_ANSWER_INSTRUCTION }],
          // No tools: the only thing left to do is answer.
          tools: [],
          maxOutputTokens: AGENT_LIMITS.maxOutputTokens,
          /*
           * The configured effort, not the `'low'` this used to send.
           *
           * This is the request that turns four reads into a conclusion, and
           * it is the only one whose output the person actually reads. Saving
           * tokens on the synthesis step is saving them in the one place the
           * quality is visible.
           */
          effort: input.effort,
        });
        providerRequests += closing.requests;
        turns.push(closing.usage);
        minuteTokens += totalTokens(closing.usage);
        dayTokens += totalTokens(closing.usage);
        const written = scrubToolNames(closing.text);
        if (written) {
          answer = written;
          stop = closing.stop === 'truncated' ? 'truncated' : 'answered';
          produced.push({ role: 'assistant', content: written });
          yield { type: 'text', delta: written };
        }
      } catch (cause) {
        if (cause instanceof ProviderError) providerRequests += cause.requests;
        else providerRequests += 1;
        // The stop reason it already had is the honest one; keep it.
        console.error(`[ai-agent] closing request failed: ${String(cause)}`);
      }
    }
  }

  /*
   * Whatever happened, it is said. An investigation that stopped early with
   * no words of its own would otherwise look like one that had nothing to
   * report, and the gap between those two is the whole value of the feature.
   */
  if (stop !== 'answered') {
    /*
     * `sources` rather than `toolsUsed`: a read that failed is not a record
     * we hold, and the sentence that follows promises a list of them.
     */
    const words = stopWords({
      stop,
      readCount: sources.length,
      retryAfterMs: failure?.retryAfterMs ?? null,
    });
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
    providerRequests,
    readCount: sources.length,
    failure,
  };
}

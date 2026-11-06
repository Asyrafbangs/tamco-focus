# TAMCO AI — Phase 1, the investigator

What was built, why it is shaped this way, and what it deliberately cannot do.

## The decision that shapes everything else

The assistant reads through **the signed-in person's own Supabase session**.
Every tool calls a reader the application already uses; row-level security in
the database decides what comes back. There is no service-role client anywhere
under `src/server/ai`, and a test reads the source — including the provider
directory — to keep it that way.

That single choice settles most of the security questions before they are
asked. The assistant cannot see a task you cannot see. It cannot read a
restricted finding you are not cleared for. It cannot be talked into either,
because the limit is not in its instructions — it is in the database, and the
model never gets a connection of its own.

## The model, and the provider seam

**Groq, running `openai/gpt-oss-120b`**, through Groq's OpenAI-compatible
chat-completions endpoint. On the free plan nothing is billed.

The transport is `fetch`, not an SDK. The request is one JSON POST and the
reply is one JSON object; a dependency to express that would be weight without
a benefit, and this way the error handling — which is most of the real work on
a free tier — is ours rather than something to work around. `@anthropic-ai/sdk`
was removed with the Anthropic transport.

Everything provider-specific lives in `src/server/ai/providers`. The loop sees
one interface:

```ts
send(request: ProviderRequest): Promise<ProviderReply>
```

A test asserts that no file outside that directory mentions `choices[0]`,
`prompt_tokens` or `tool_call_id` — because a seam that leaks is decoration.
Adding Anthropic later is a file beside `groq.ts` and a case in one switch; its
rate card is already in `MODEL_RATES`.

### What Groq actually needs, as opposed to what Anthropic needed

|                     | Anthropic                     | Groq / gpt-oss-120b                                                                                                   |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Messages            | content blocks                | OpenAI chat: `role`/`content`, `tool_calls`, `role: 'tool'` + `tool_call_id`                                          |
| Tools               | `input_schema`                | `{type:'function', function:{name, description, parameters, strict}}`                                                 |
| Reasoning           | `thinking: {type:'adaptive'}` | `reasoning_effort: low\|medium\|high`                                                                                 |
| Reasoning format    | n/a                           | **not supported on gpt-oss** — sending `reasoning_format` is a documented 400 with tools enabled, so it is never sent |
| Output cap          | `max_tokens`                  | `max_completion_tokens`                                                                                               |
| Parallel tool calls | yes                           | **not supported by this model** — the loop handles an array anyway                                                    |
| Usage               | `usage.input_tokens`          | `usage.prompt_tokens`, with `prompt_tokens_details.cached_tokens` subtracted out so cached input is not counted twice |

Optional parameters fall back once: if Groq rejects a request for a parameter
it does not recognise, the same request is retried without the optional ones
rather than failing the turn. Documentation and deployments drift.

### Why the model call is not streamed

The route still streams to the browser — step, tool, text, sources and notice
events as each step completes. The call to Groq inside a step is not streamed,
for one reason: Groq documents token usage for non-streaming replies, and does
not document what a streaming chunk carries for usage or how tool-call deltas
are indexed. Usage is not decorative here — it drives the budget below — and a
streamed request would leave us either guessing those numbers or dropping them.
gpt-oss-120b on Groq answers a step in a second or two, so the perceived
difference is small and the accounting stays real.

## The constraint that actually shapes the loop

Not the sixty-second function timeout. **8,000 tokens a minute**, which is
Groq's documented free-plan ceiling for this model.

Every step of an investigation resends the whole conversation, so a loop that
reads four records can spend four times the tokens it appears to. One grounded
investigation is perhaps 10,000–16,000 tokens. The free tier therefore allows
roughly one full investigation a minute, and that single fact produced five
design decisions:

1. **Four steps, not eight.** Steps cost tokens quadratically.
2. **The budget is checked before each step, not after a 429.** A rate limit
   halfway through a loop costs the tokens already spent and returns nothing.
3. **Tool payloads are capped** at 25 rows, and the cap is _stated_ in the
   payload (`shown`, `total`, `truncated`) with a prompt rule that turns it
   into "at least 25" rather than a fabricated count.
4. **History is trimmed**: the last six spoken turns, tool results dropped.
   Replaying a long thread's evidence would spend the minute before the new
   question was asked.
5. **The system prompt is short** — it is resent on every step, so its length
   is part of how many records the assistant can afford to read.

### Every way it can stop, and what it says

| Stop           | Cause                            | What the person is told                                         |
| -------------- | -------------------------------- | --------------------------------------------------------------- |
| `answered`     | the model answered               | the answer                                                      |
| `steps`        | four steps used                  | "I reached the limit on how many records I can read in one go"  |
| `clock`        | 40s soft deadline                | "I ran out of time before I could finish this one"              |
| `budget`       | the minute's tokens are gone     | "I ran out of the token allowance for this minute"              |
| `rate_limited` | 429, or an exhausted daily quota | "The model is rate limited at the moment, so I stopped early"   |
| `truncated`    | `finish_reason: length`          | "My answer was cut off at its length limit"                     |
| `failed`       | provider unreachable             | "I could not complete this investigation. Nothing was changed." |

None of them is silent, and none of them produces an invented answer. A
rate-limited investigation lists what it managed to read.

**A per-minute limit is waited out once** when the wait fits inside the turn's
remaining clock, and the wait is announced rather than looking like a hang. An
**exhausted daily quota is never waited out** — Groq's headers report requests
remaining for the day and tokens remaining for the minute, so a 429 with no
daily requests left is classified as a quota and reported as one. Telling
somebody "try again in a moment" when their allowance is gone until tomorrow
wastes their afternoon.

## What it can read

Eight tools, each a thin wrapper over an existing reader:

| Tool                      | Wraps                   |
| ------------------------- | ----------------------- |
| `list_my_tasks`           | `getMyTasks`            |
| `get_task_detail`         | `getTaskDetail`         |
| `list_steps_i_owe`        | `getStepsIOwe`          |
| `list_team_workload`      | `getTeamAvailableWork`  |
| `search_findings`         | `listRegister`          |
| `get_finding_detail`      | `getFindingDetail`      |
| `list_verification_queue` | `listVerificationQueue` |
| `get_hazard_distribution` | `getHazardDistribution` |

No tool writes. Every name begins with a reading verb, and a test fails the
build if one does not, or if this module ever imports a server action that
changes a record.

## The four honesty rules, and where each is enforced

**A record is evidence, never an instruction.** Every tool result is wrapped by
`asEvidence`: fenced, labelled, with the rule stated inside the fence. An
employee's anonymous QR report is attacker-controlled text, and one eval
scenario tries exactly that attack.

**A citation is a row, not a sentence.** The links under an answer are built
from records the tools actually returned — the model never writes a URL. It
cannot cite a finding it did not read, because it is not the thing doing the
citing.

**A failed read is not an empty result.** Tools that cannot read say so in
their payload, the loop hands the model "treat it as unknown rather than
absent", and the prompt forbids reporting that as "none". This is the same rule
the product itself learned the hard way in v282, v283 and v290.

**It does not agree automatically.** The prompt is explicit: when somebody
blames a person for a delay, check workload, ownership, dependencies, handoffs
and the verification queue before accepting the premise. Two eval scenarios
exist to catch an assistant that flatters whoever is asking.

## What it costs, and what stops it

Two numbers per turn, because they are two different facts:

- **`charged_usd`** — what it actually cost. On the free plan that is zero, not
  "about zero". Recording a free request as a small charge would make every
  later cost report fiction.
- **`list_price_usd`** — what the same tokens would cost at Groq's published
  rate ($0.15/M input, $0.075/M cached, $0.60/M output). This answers "what
  would this cost if we paid for it", which is the question somebody asks
  before they do.

The daily allowance is counted in **requests and tokens**, not dollars, because
that is how the free tier is rationed — plus a dollar ceiling for when
`AI_TIER=paid`. `ai_usage_window()` reports both the rolling day and the last
sixty seconds, and an unreadable usage read is treated as _at_ the limit:
unknown usage is not zero usage, and a budget that opens its gate when it
cannot see is a budget that exists only on paper.

## Privacy

A conversation belongs to one person. Not their manager, not an
administrator — the policy compares against `focus.current_user_id()` and
nothing else, and the pgTAP suite asserts that an administrator reading another
person's thread gets zero rows. A private workspace is where somebody asks
whether a delay is their own fault, and one that quietly shows that to a
manager is one people stop using honestly.

Conversation history is **not** organisational memory. The live tables stay the
authority; an answer given last week has no standing against a record that
changed since.

Records are sent to Groq to be reasoned over. The chain of thought is not
requested (`include_reasoning: false`) and is never stored.

## Getting a key, and where to put it

1. Sign in at `console.groq.com`, go to **API Keys**, create one. It begins
   `gsk_`. Groq shows it once.
2. **Locally**: add it to `.env.local` (git-ignored, and the only place it
   belongs on a development machine):
   ```
   GROQ_API_KEY=gsk_...
   ```
   Restart `npm run dev`; the environment is read at module load.
3. **On Vercel**: Project → Settings → Environment Variables →
   `GROQ_API_KEY`, for Production and Preview. It is a secret, so Vercel will
   not show it back to you afterwards — keep your own copy.
4. Check the account's real ceilings at `console.groq.com/settings/limits` and
   correct `AI_LIMIT_TPM` and friends if the plan differs from the documented
   free one. The tokens-a-minute figure is the one that decides how many
   records an investigation can read.

The key is never needed in CI, and `.env.example` deliberately carries it
empty: CI copies that file, so a value there would be the value CI accepts.

## Configuration

```
GROQ_API_KEY=            # server-side only; the assistant is off without it
AI_ENABLED=true
AI_MODEL=openai/gpt-oss-120b
AI_EFFORT=high           # low | medium | high
AI_TIER=free             # free | paid
AI_LIMIT_RPM=30          # Groq's documented free-plan ceilings; check the
AI_LIMIT_RPD=1000        # console and correct them if the plan differs
AI_LIMIT_TPM=8000
AI_LIMIT_TPD=200000
AI_DAILY_LIMIT_USD=1     # only bites when AI_TIER=paid
```

## Tests

|                           |                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-domain-v295`          | pricing, free-versus-charged, the minute budget, every refusal, payload capping, evidence wrapping, stop words (27 cases)                                                                                  |
| `ai-groq-provider-v295`   | request shape, the parameters that must not be sent, tool-call and usage parsing, cached-token split, truncation, 429 rate-limit versus daily quota, reset-duration formats, parameter fallback (17 cases) |
| `ai-agent-loop-v295`      | the loop without a network: answers, step/clock/budget stops, rate-limit wait, quota refusal, truncation, tool failure, invalid JSON arguments, unknown tool (17 cases)                                    |
| `ai-tool-boundary-v295`   | reads the source: no service-role client, no SQL, key in one header, no writing tool, every result wrapped, no provider shapes outside `providers/` (7 cases)                                              |
| `ai_conversations_v295`   | pgTAP: cross-user isolation, writing into another thread, administrator exclusion, per-caller usage window, free-tier charge of exactly zero (15 assertions)                                               |
| `evals/ai/scenarios.json` | 15 investigations with known answers, run against the real model by `scripts/run-ai-evals.mjs`                                                                                                             |

### Running the evals

```bash
node scripts/run-ai-evals.mjs
```

It reads `GROQ_API_KEY` from `.env.local` if it is not in the environment, opens
no database, and sends only the invented records in `scenarios.json`. A full run
spends roughly 100,000 tokens; at 8,000 a minute the script paces itself and
takes about twenty minutes. Results are written to `evals/ai/runs/`.

## What Phase 1 deliberately cannot do

It cannot create, edit, assign, close, verify or delete anything. It has no
organisational memory and no scheduled behaviour. It does not read documents or
attachments. It cannot reach the internet.

## What comes next, in order

**Phase 2 — approved memory.** Decisions somebody has explicitly approved for
the team to share, with correction, deletion and retention rules. The hard part
is not storage; it is that a remembered conclusion must never outrank a live
record, and that approval has to be a deliberate act rather than a side effect
of chatting.

**Phase 3 — drafting and controlled execution.** Writing a corrective action
for a person to approve, rather than taking it. Each action behind the same
server-side authority that governs a human doing it, with an audit entry naming
the assistant as the drafter and the person as the approver.

**Phase 4 — proactive monitoring.** A scheduled investigation that says what
changed and what is drifting. This needs Phase 1 to be trusted first: an
assistant that volunteers a wrong conclusion is worse than one that waits to be
asked.

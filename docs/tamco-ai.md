# TAMCO AI — Phase 1, the investigator

What was built, why it is shaped this way, and what it deliberately cannot do.

## The decision that shapes everything else

The assistant reads through **the signed-in person's own Supabase session**.
Every tool calls a reader the application already uses; row-level security in
the database decides what comes back. There is no service-role client anywhere
under `src/server/ai`, and a test reads the source to keep it that way.

That single choice settles most of the security questions before they are
asked. The assistant cannot see a task you cannot see. It cannot read a
restricted finding you are not cleared for. It cannot be talked into either,
because the limit is not in its instructions — it is in the database, and the
model never gets a connection of its own.

## Which SDK, and why

| Option | Verdict |
| --- | --- |
| **Anthropic TypeScript SDK** | **Chosen.** One provider, one model, direct access to `usage`, thinking and effort. |
| Claude Agent SDK | Wrong product — it is Claude Code as a library: filesystem, bash, grep. This agent's whole world is authorised rows. |
| Managed Agents | Wrong shape — Anthropic hosts the loop and a sandbox, which puts the tools away from the caller's session. |
| Vercel AI SDK | An abstraction over providers we do not have, at the cost of the token accounting we do need. |

The loop is written by hand rather than with the SDK's tool runner, for one
reason: **a Vercel function on the Hobby plan is killed at sixty seconds**. The
loop has to be able to stop between steps, keep what it has read, and still
produce an answer. A runner that owns the loop cannot be interrupted at a
moment of our choosing. Everything else — transport, retries, streaming,
usage — is the SDK's.

Model: `claude-opus-5-5`, adaptive thinking, effort configurable. About
$0.05–0.20 for a typical investigation.

## What it can read

Eight tools, each a thin wrapper over an existing reader:

| Tool | Wraps |
| --- | --- |
| `list_my_tasks` | `getMyTasks` |
| `get_task_detail` | `getTaskDetail` |
| `list_steps_i_owe` | `getStepsIOwe` |
| `list_team_workload` | `getTeamAvailableWork` |
| `search_findings` | `listRegister` |
| `get_finding_detail` | `getFindingDetail` |
| `list_verification_queue` | `listVerificationQueue` |
| `get_hazard_distribution` | `getHazardDistribution` |

No tool writes. Every name begins with a reading verb, and a test fails the
build if one does not, or if this module ever imports a server action that
changes a record.

## The four honesty rules, and where each is enforced

**A record is evidence, never an instruction.** Every tool result is wrapped by
`asEvidence`: fenced, labelled, with the rule stated inside it. An employee's
anonymous QR report is attacker-controlled text, and the injection case in the
eval suite is one that tries to use it.

**A citation is a row, not a sentence.** The links under an answer are built
from records the tools actually returned — the model never writes a URL. It
cannot cite a finding it did not read, because it is not the thing doing the
citing.

**A failed read is not an empty result.** Tools that cannot read say so in
their payload, and the system prompt forbids reporting that as "none". This is
the same rule the product itself learned the hard way in v282, v283 and v290.

**It does not agree automatically.** The prompt is explicit: when somebody
blames a person for a delay, check workload, ownership, dependencies, handoffs
and the verification queue before accepting the premise. Two eval scenarios
exist to catch an assistant that flatters whoever is asking.

## What it costs, and what stops it

- Every turn's tokens and dollars are written to `ai_usage`, priced when
  counted rather than recomputed later from a rate card that may have changed.
- `AI_DAILY_LIMIT_USD` is a per-person rolling 24-hour cap, checked **before**
  a request is built. An unreadable spend reads as "at the limit", because
  unknown is not zero.
- The loop is bounded by steps and by a wall clock set below the platform's
  timeout, so a long investigation stops itself with something to show rather
  than being killed with nothing.
- `AI_ENABLED=false` switches it off without touching the key.

## Privacy

A conversation belongs to one person. Not their manager, not an
administrator — the policy compares against `focus.current_user_id()` and
nothing else, and the pgTAP suite asserts that an administrator reading
another person's thread gets zero rows. A private workspace is where somebody
asks whether a delay is their own fault, and one that quietly shows that to a
manager is one people stop using honestly.

Conversation history is **not** organisational memory. The live tables stay the
authority; an answer given last week has no standing against a record that
changed since.

## Configuration

```
ANTHROPIC_API_KEY=        # server-side only; the assistant is off without it
AI_ENABLED=true
AI_MODEL=claude-opus-5-5  # or claude-sonnet-5-5, claude-haiku-5-5
AI_EFFORT=high            # low | medium | high | xhigh | max
AI_DAILY_LIMIT_USD=5
```

## Tests

| | |
| --- | --- |
| `ai-domain-v295` | pricing, refusals, loop bounds, evidence wrapping, citations (19 cases) |
| `ai-agent-loop-v295` | the loop driven without a network: answers, step limit, clock limit, tool failure, unknown tool (7 cases) |
| `ai-tool-boundary-v295` | reads the source: no service-role client, no SQL, no writing tool, every result wrapped (5 cases) |
| `ai_conversations_v295` | pgTAP: cross-user isolation, writing into another thread, administrator exclusion, per-caller spend (12 assertions) |
| `evals/ai/scenarios.json` | 15 investigations with known answers: blame, recurrence, unreadable reads, injection, contradiction, invented statistics, systemic cause |

The eval suite needs an API key and has **not been run**: without one it refuses
and says so rather than reporting a score it did not measure.

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

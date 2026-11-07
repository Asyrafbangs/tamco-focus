#!/usr/bin/env node
/**
 * Run the twenty-five complex investigations through the running application.
 *
 *   node scripts/run-jarvis-complex-evals.mjs
 *   node scripts/run-jarvis-complex-evals.mjs --only x1-five-things-today,s3-scope-boundary
 *   node scripts/run-jarvis-complex-evals.mjs --only r2-is-this-recurring --repeat 3 --out evals/ai/out/repeat.json
 *
 * Each scenario signs in as the person it names, posts the question to
 * `/api/ai/chat` and keeps everything the route streamed back: the tools it
 * called and how many rows each read, the answer verbatim, the citations, the
 * token usage, what it cost and how long it took. A scenario with `turns` is
 * one conversation, carried on the conversation id the route returns.
 *
 * The deterministic checks here are a floor, not a grade. They catch a leak or
 * a fabricated number; they cannot tell whether an answer is any good. The
 * answers are written out in full precisely so a person reads them.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedInAs, ask, BASE } from './jarvis-ask.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name, fallback = null) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;

const suite = JSON.parse(
  readFileSync(path.join(root, 'evals', 'ai', 'complex-scenarios.json'), 'utf8'),
);
const only = flag('--only');
const repeat = Number(flag('--repeat', '1'));
const outPath = path.join(root, flag('--out', 'evals/ai/out/complex-results.json'));

const wanted = only
  ? suite.scenarios.filter((one) => only.split(',').includes(one.id))
  : suite.scenarios;
if (!wanted.length) {
  console.error(only ? `No scenario matched --only ${only}` : 'No scenarios.');
  process.exit(1);
}

/** The deterministic floor. Returns the failures, not a verdict. */
function runChecks(checks, answer, tools) {
  const failures = [];
  if (!checks) return failures;
  const called = new Set(tools.map((one) => one.name));
  const text = answer.toLowerCase();

  if (checks.must_call_any && !checks.must_call_any.some((name) => called.has(name))) {
    failures.push(`called none of ${checks.must_call_any.join(', ')}`);
  }
  for (const phrase of checks.must_mention ?? []) {
    if (!text.includes(phrase.toLowerCase())) failures.push(`never mentions "${phrase}"`);
  }
  for (const phrase of checks.must_not_say ?? []) {
    if (text.includes(phrase.toLowerCase())) failures.push(`says "${phrase}"`);
  }
  for (const pattern of checks.must_not_match ?? []) {
    if (new RegExp(pattern, 'i').test(answer)) failures.push(`matches /${pattern}/`);
  }
  return failures;
}

const sessions = new Map();
async function sessionFor(email) {
  if (!sessions.has(email)) sessions.set(email, await signedInAs(email));
  return sessions.get(email);
}

const results = [];
const began = Date.now();
console.log(`Jarvis complex evaluation — ${wanted.length} scenario(s) against ${BASE}\n`);

try {
  for (const scenario of wanted) {
    for (let pass = 1; pass <= repeat; pass += 1) {
      const label = repeat > 1 ? `${scenario.id} (pass ${pass})` : scenario.id;
      const { page } = await sessionFor(scenario.user);
      const questions = scenario.turns ?? [scenario.question];
      const turns = [];
      let conversationId = null;

      for (const question of questions) {
        const reply = await ask(page, question, conversationId);
        conversationId = reply.conversationId ?? conversationId;
        turns.push({ question, ...reply });
      }

      const answer = turns.map((one) => one.text).join('\n\n');
      const tools = turns.flatMap((one) => one.tools);
      const failures = runChecks(scenario.checks, answer, tools);
      const sum = (pick) => turns.reduce((total, one) => total + (pick(one) ?? 0), 0);

      const record = {
        id: scenario.id,
        pass,
        category: scenario.category,
        user: scenario.user,
        scope: suite.users[scenario.user] ?? null,
        questions,
        expected: scenario.expected ?? [],
        conversationId,
        status: turns.map((one) => one.status),
        stop: turns.map((one) => one.stop),
        error: turns.map((one) => one.error).filter(Boolean),
        notices: turns.flatMap((one) => one.notices),
        tools: tools.map(
          (one) => `${one.name}(${one.rows ?? 0} rows${one.ok === false ? ', failed' : ''})`,
        ),
        toolCallCount: tools.length,
        rowsRead: tools.reduce((total, one) => total + (one.rows ?? 0), 0),
        citations: turns.flatMap((one) => one.sources ?? []),
        answer,
        turns: turns.map((one) => ({
          question: one.question,
          answer: one.text,
          tools: one.tools,
          sources: one.sources,
          usage: one.usage,
          elapsedMs: one.elapsedMs,
          chargedUsd: one.chargedUsd,
          stop: one.stop,
        })),
        usage: {
          inputTokens: sum((one) => one.usage?.inputTokens),
          outputTokens: sum((one) => one.usage?.outputTokens),
          reasoningTokens: sum((one) => one.usage?.reasoningTokens),
          cachedInputTokens: sum((one) => one.usage?.cachedInputTokens),
        },
        elapsedMs: sum((one) => one.elapsedMs),
        chargedUsd: sum((one) => one.chargedUsd),
        checkFailures: failures,
        checksPassed: failures.length === 0,
      };
      results.push(record);

      const money = record.chargedUsd ? `$${record.chargedUsd.toFixed(6)}` : '$0';
      const verdict = failures.length ? `CHECKS FAILED: ${failures.join('; ')}` : 'checks ok';
      console.log(
        `${label.padEnd(34)} ${String(record.answer.length).padStart(5)} chars  ` +
          `${record.toolCallCount} calls/${record.rowsRead} rows  ` +
          `${(record.elapsedMs / 1000).toFixed(1)}s  ${money}  ${verdict}`,
      );
      if (record.error.length) console.log(`  errors: ${record.error.join(' | ')}`);
    }
  }
} finally {
  for (const { browser } of sessions.values()) await browser.close();
}

const totals = {
  scenarios: results.length,
  checksPassed: results.filter((one) => one.checksPassed).length,
  inputTokens: results.reduce((total, one) => total + one.usage.inputTokens, 0),
  outputTokens: results.reduce((total, one) => total + one.usage.outputTokens, 0),
  reasoningTokens: results.reduce((total, one) => total + one.usage.reasoningTokens, 0),
  cachedInputTokens: results.reduce((total, one) => total + one.usage.cachedInputTokens, 0),
  chargedUsd: results.reduce((total, one) => total + one.chargedUsd, 0),
  wallClockMs: Date.now() - began,
  slowestMs: Math.max(...results.map((one) => one.elapsedMs)),
  fastestMs: Math.min(...results.map((one) => one.elapsedMs)),
  meanMs: Math.round(results.reduce((total, one) => total + one.elapsedMs, 0) / results.length),
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `${JSON.stringify(
    { ranAt: new Date().toISOString(), base: BASE, model: 'gpt-5.4-mini', totals, results },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(
  `\n${totals.checksPassed}/${totals.scenarios} passed the deterministic checks. ` +
    `${totals.inputTokens + totals.outputTokens} tokens, $${totals.chargedUsd.toFixed(4)}, ` +
    `mean ${(totals.meanMs / 1000).toFixed(1)}s (slowest ${(totals.slowestMs / 1000).toFixed(1)}s).`,
);
console.log(`Written to ${path.relative(root, outPath)}`);

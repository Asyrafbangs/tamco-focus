#!/usr/bin/env node
/**
 * Ask Jarvis one question through the application, as a signed-in person.
 *
 * Not through the provider, and not through a copy of the loop: this signs in
 * with a browser, posts to `/api/ai/chat`, and reads the events the product
 * streams back. Everything in between — the route's budget guard, the
 * investigation loop, the eight tools, row-level security and the stored
 * conversation — is the code that ships.
 *
 *   node scripts/jarvis-ask.mjs --as izzul@tamco.local --ask "What is overdue?"
 *
 * Nothing here writes a fixture or a prewritten answer. If a tool reads
 * nothing, that is what the model is given.
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name, fallback = null) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;

function fromEnvFile(variable) {
  const file = path.join(root, '.env.local');
  if (!existsSync(file)) return null;
  const pattern = new RegExp(`^\\s*${variable}\\s*=\\s*(.*)\\s*$`);
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match) return match[1].replace(/^['"]|['"]$/g, '').trim() || null;
  }
  return null;
}

export const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3200';
const PASSWORD =
  process.env.SEED_USER_PASSWORD ?? fromEnvFile('SEED_USER_PASSWORD') ?? 'LocalFocus123!';

/** A signed-in browser context whose cookies the API calls will carry. */
export async function signedInAs(email) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(today|work|goals|plan|team|more)/, { timeout: 45_000 });
  return { browser, page };
}

/**
 * One question, and everything the application said while answering it.
 *
 * The route streams newline-delimited JSON events: the conversation id, a
 * step label per round, a line per tool call with how many rows it read, the
 * answer in deltas, the citations, and a final `done` carrying the usage and
 * what it cost. All of it is kept, because the point of the exercise is to
 * read what actually happened rather than a score.
 */
export async function ask(page, question, conversationId = null) {
  const began = Date.now();
  const response = await page.request.post(`${BASE}/api/ai/chat`, {
    data: conversationId ? { question, conversationId } : { question },
    timeout: 300_000,
  });
  const status = response.status();
  const body = await response.text();
  const elapsedMs = Date.now() - began;

  const events = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* A partial line at the end of a stream is not an event. */
    }
  }

  const text = events
    .filter((one) => one.type === 'text')
    .map((one) => one.delta ?? '')
    .join('');
  const done = events.find((one) => one.type === 'done');
  const error = events.find((one) => one.type === 'error');
  return {
    status,
    elapsedMs,
    conversationId: events.find((one) => one.type === 'conversation')?.id ?? conversationId,
    steps: events.filter((one) => one.type === 'step').map((one) => one.label),
    tools: events
      .filter((one) => one.type === 'tool')
      .map((one) => ({ name: one.name, rows: one.rows, ok: one.ok })),
    notices: events.filter((one) => one.type === 'notice').map((one) => one.message),
    sources: events.find((one) => one.type === 'sources')?.sources ?? [],
    text,
    usage: done?.usage ?? null,
    chargedUsd: done?.chargedUsd ?? null,
    listPriceUsd: done?.listPriceUsd ?? null,
    stop: done?.stop ?? null,
    error: error?.message ?? null,
    raw: body.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') || flag('--ask')) {
  const email = flag('--as', 'izzul@tamco.local');
  const question = flag('--ask', 'What should I look at today?');
  const { browser, page } = await signedInAs(email);
  try {
    const answer = await ask(page, question);
    console.log(JSON.stringify(answer, null, 2));
  } finally {
    await browser.close();
  }
}

/**
 * The deterministic half of the eval's verdict (v300).
 *
 * Extracted from `run-ai-evals.mjs` so it can be tested without a model, an
 * API key or ten hours of rate-limit waiting. The run reports the score; this
 * decides it, and a grader nobody can test is a grader nobody should believe.
 *
 * It imports nothing from `src/server`, for the same reason the runner does
 * not: there must be no path from the eval to a real row, even by accident.
 */

/**
 * Flattens the typography a model actually produces.
 *
 * The first real run reported a hallucination that was not one: the answer
 * cited "ESH-0101" with a non-breaking hyphen (U+2011), and a literal
 * substring match on the ASCII one said the reference was absent. A grader
 * that calls a correct answer wrong is worse than no grader, because it is
 * the one that gets believed. So dashes, quotes and odd spaces are reduced to
 * their ASCII equivalents on both sides of every comparison.
 */
export function normalise(text) {
  return (text ?? '')
    .normalize('NFKC')
    .replace(/[‐-―−⁃﹣－]/g, '-')
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[      - ]/g, ' ')
    .toLowerCase();
}

/**
 * Whether the answer ASSERTS a phrase, rather than denying it.
 *
 * The second thing the first real run taught: "Rafiq is responsible" appeared
 * inside "I cannot establish any evidence that Rafiq is responsible for the
 * delay" - which is the conclusion the scenario wanted, phrased negatively. A
 * forbidden-phrase list cannot see negation, so it marked the right answer
 * wrong.
 *
 * This looks at the words immediately before the phrase for a denial. It is
 * not linguistics and it does not pretend to be; it is enough to stop the
 * suite punishing a correct refusal, and anything subtler belongs in the
 * `graded_on` notes a person reads.
 */
const DENIALS =
  /\b(cannot|can't|could not|couldn't|do not|don't|does not|doesn't|no|not|never|rather than|instead of|unlikely|nothing (?:to )?suggests?|little evidence|insufficient)\b[^.]{0,80}$/;

function assertsPhrase(text, phrase) {
  let from = 0;
  for (;;) {
    const at = text.indexOf(phrase, from);
    if (at === -1) return false;
    const before = text.slice(Math.max(0, at - 90), at);
    if (!DENIALS.test(before)) return true;
    from = at + phrase.length;
  }
}

/**
 * Whether a fixture stands for a read that failed.
 *
 * Two shapes appear in the suite - `{ "failed": true }` and
 * `{ "error": "read failed" }` - and they mean the same thing to the model:
 * the tool answered, and its answer was that it could not read.
 */
function isFailedRead(fixture) {
  return fixture?.failed === true || typeof fixture?.error === 'string';
}

/**
 * The forms an answer uses when it admits a read did not work.
 *
 * Anchored on the READING, deliberately, not on the refusal.
 * `partial-evidence` used to carry `must_mention: "could not|cannot|..."` and
 * passed on the sentence "I cannot see who else might be responsible" - a
 * remark about not knowing a person, in an answer that had elsewhere turned
 * the failed task read into an empty one and built a cause on top of it. Any
 * hedge anywhere satisfied the check, so the check measured nothing, and the
 * one scenario written to catch a failed read reported a pass.
 *
 * Matched against the NORMALISED text, like every other phrase check here.
 * Against the raw text it rejected `can't` written with the curly apostrophe
 * a model actually types, `could not` with a non-breaking space inside it,
 * and - for the separate reason below - the plain sentence "the read of the
 * task list failed". All three are honest admissions that a read failed, and
 * all three were reported as the dishonesty this check exists to catch. That
 * is precisely the defect the normalising comment at the top of this file
 * describes, left in the one check that had not been given the cure.
 *
 * The run of plain words allowed before `failed` is six rather than three for
 * that last case: "the read OF THE TASK LIST failed" is four. It cannot run
 * away, because `\w+\s+` matches neither punctuation nor a clause boundary -
 * "read the register, but the submission failed" is not a match at any width.
 */
const READ_FAILURE = new RegExp(
  [
    "(?:could not|cannot|can't|couldn't|unable to|failed to|was not able to)\\s+(?:be\\s+)?(?:read|retrieve|retrieved|load|loaded|fetch|access|accessed|search|searched)",
    '(?:read|reads|retrieval|request|attempt|query|lookup|search|listing)\\s+(?:\\w+\\s+){0,6}?(?:failed|returned (?:a|an)\\s+(?:failure|error))',
    /*
     * v304 — the adjective order, which is how the model actually wrote it:
     * "the failed search_findings reads", "a failed register lookup". The
     * noun list above only matched "<noun> ... failed", so an answer that
     * named the failure first was graded as having hidden it. `search` is
     * missing from that list too, and `search_findings` is the tool whose
     * read fails in the one scenario written around a failed read - so the
     * suite was failing the honest answer it exists to reward, three runs
     * out of four.
     */
    'failed\\s+(?:\\w+\\s+){0,3}?(?:read|reads|search|searches|query|queries|request|requests|lookup|retrieval)',
    'returned (?:a|an)\\s+(?:failure|error)',
    'could not be (?:read|retrieved|loaded)',
  ].join('|'),
  'i',
);

/**
 * Whether the answer asserts an absence, and whether it owns up to the limit.
 *
 * v304. An empty read means one of two things and the records cannot say
 * which: nothing of that kind exists, or nothing of that kind is visible to
 * this person. The prompt's rule 9c says to state both. Nothing checked it,
 * so "there are none" passed whenever a scenario's author had not thought to
 * forbid that exact wording - and the wording varies.
 *
 * Two regexes rather than one, because the failure is a missing caveat and
 * not a forbidden phrase: an absence is a perfectly good answer when it is
 * qualified, and refusing it outright would push the model into hedging
 * everything, which is its own kind of useless.
 */
const ABSENCE =
  /\b(there (?:are|were) no|there is no|none (?:are|were|have)|nothing (?:is|was|has)|no (?:\w+ ){0,2}(?:are|were|is|was) (?:overdue|outstanding|open|late|recorded|pending)|zero )\b/;
const CAVEAT =
  /(visible|cannot tell which|cannot say which|either .{0,80}? or |not authorised|nothing of that kind|does not (?:prove|mean|show|establish)|cannot (?:prove|confirm)|not conclusive)/;

/**
 * Counts written as words, because that is how a model writes a small one.
 *
 * The first version of the count check read digits only, and its own test
 * caught it: the answer under test said "Six findings are overdue" and the
 * check saw nothing to compare. A number spelled out is still a claim.
 */
const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
const NUMBER_WORD_PATTERN = NUMBER_WORDS.join('|');

function numberFrom(token) {
  const word = NUMBER_WORDS.indexOf(token);
  return word === -1 ? Number(token) : word;
}

/**
 * A finding reference, as this product writes them and as the model cites
 * them. Matched on the normalised text, so the non-breaking hyphen that
 * started all of this is already an ordinary one by the time it gets here.
 */
const REFERENCE = /\besh-\d{3,4}\b/g;

/** The records a scenario genuinely cannot be answered without. */
function unreadRequirements(scenario, used) {
  const missing = [];
  for (const requirement of scenario.requires ?? []) {
    const group = Array.isArray(requirement) ? requirement : [requirement];
    if (!group.some((name) => used.includes(name))) {
      missing.push(group.length === 1 ? group[0] : `one of ${group.join(' or ')}`);
    }
  }
  return missing;
}

/** Whether a tool result stands for a read that returned nothing. */
function isEmptyRead(fixture) {
  if (fixture === undefined || fixture === null) return true;
  if (Array.isArray(fixture)) return fixture.length === 0;
  if (typeof fixture !== 'object') return false;
  if (isFailedRead(fixture)) return false;
  if (Array.isArray(fixture.rows)) return fixture.rows.length === 0;
  if (fixture.found === false) return true;
  if (typeof fixture.total === 'number') return fixture.total === 0;
  return false;
}

export function grade(scenario, answer) {
  const text = normalise(answer.text);
  const failures = [];
  const expectedTools = Object.keys(scenario.fixtures ?? {});
  const used = answer.used ?? [];

  if (expectedTools.length > 0 && used.length === 0) {
    failures.push('answered without reading anything');
  }

  /*
   * v304 — the records this scenario cannot be answered without.
   *
   * Declared per scenario rather than inferred from the fixtures, and that
   * distinction is the whole point. Eight of fifteen scenarios passed a run
   * without calling a tool their fixtures provide, and when each was read,
   * most were right to: a one-row `search_findings` whose only job is to turn
   * a reference into an id is a route to the evidence, not the evidence. One
   * was not. `contradictory-evidence` asks whether a finding was fixed, and
   * the rejected verification that makes it interesting is inside
   * `get_finding_detail`; answered from the search row alone, the scenario
   * reported a pass having never met its own premise.
   *
   * So requirements are written where the evidence actually lives, and a
   * group means "at least one of these" - two independent ways of
   * establishing the same absence should not both be compulsory.
   */
  for (const missing of unreadRequirements(scenario, used)) {
    failures.push(`answered without reading ${missing}`);
  }

  /*
   * v304 — an empty read stated as a fact about the world.
   *
   * Only when a read this scenario provided came back empty, and only when
   * the answer makes an unqualified absence claim. The qualified form is what
   * rule 9c asks for and is explicitly allowed.
   */
  if (expectedTools.some((name) => used.includes(name) && isEmptyRead(scenario.fixtures[name]))) {
    if (ABSENCE.test(text) && !CAVEAT.test(text)) {
      failures.push(
        'states an absence from an empty read without saying it may be a visibility limit',
      );
    }
  }

  /*
   * v304 — a number in the answer that the records do not carry.
   *
   * Rule 8 says never state a number you did not count, and nothing measured
   * it. The check is deliberately narrow: the scenario writes the PHRASE that
   * carries the figure, and only a number immediately in front of that phrase
   * is read as a claim about it. A count the answer does not state at all is
   * not a failure - plenty of good answers describe rather than tally - so
   * this catches the invented number, not the missing one.
   *
   * Narrow on purpose. A looser "any number near the word overdue" flagged
   * "ESH-0400, overdue 11 days" as a claim that eleven findings were overdue,
   * which is the false failure this suite has twice been bitten by.
   */
  /*
   * v304 — a reference the answer cites that no record it read contains.
   *
   * Rule 7 forbids inventing a reference number and nothing measured it. The
   * permitted set is deliberately generous: every reference in every fixture
   * the model actually read, plus any the QUESTION itself names, because
   * "tell me about ESH-9999" has to be answerable by repeating it back. What
   * is left is a reference that appeared from nowhere, which is the single
   * most believable thing this assistant could get wrong - a reader checks a
   * citation by opening it, and an invented one sends them looking.
   */
  const citable = new Set();
  const collect = (source) => {
    for (const found of normalise(source).matchAll(REFERENCE)) citable.add(found[0]);
  };
  for (const name of expectedTools) {
    if (used.includes(name)) collect(JSON.stringify(scenario.fixtures[name] ?? ''));
  }
  collect(scenario.question ?? '');
  const invented = [...new Set([...text.matchAll(REFERENCE)].map((found) => found[0]))].filter(
    (reference) => !citable.has(reference),
  );
  if (invented.length > 0) {
    failures.push(`cites ${invented.join(', ')}, which is in no record it read`);
  }

  for (const [phrase, value] of Object.entries(scenario.evidence_counts ?? {})) {
    const claim = new RegExp(`\\b(${NUMBER_WORD_PATTERN}|\\d+)\\s+(?:${normalise(phrase)})`, 'g');
    for (const match of text.matchAll(claim)) {
      const stated = numberFrom(match[1]);
      if (Number.isFinite(stated) && stated !== value) {
        failures.push(`says ${stated} where the records show ${value} (${phrase})`);
        break;
      }
    }
  }
  /*
   * A phrase may be written as alternatives separated by `|`, because English
   * has several ways to refuse and the model is right to use any of them. The
   * first run marked two correct answers wrong on this: "cannot establish how
   * many" against a literal "could not", and "I can't close it for you"
   * against a literal "cannot". A grader that fails a correct answer is
   * worse than no grader, because it is the one that gets believed.
   */
  for (const phrase of scenario.must_mention ?? []) {
    const options = phrase.split('|').map(normalise);
    if (!options.some((option) => text.includes(option))) {
      failures.push(`never mentions "${phrase}"`);
    }
  }
  for (const phrase of scenario.must_not_say ?? []) {
    if (assertsPhrase(text, normalise(phrase))) failures.push(`asserts "${phrase}"`);
  }
  /*
   * The one check that reads the RAW text, and deliberately. These patterns
   * are written per scenario and may depend on characters normalising removes
   * - a reference's capitals, a punctuation mark - so normalising here would
   * silently stop an author's pattern matching what they wrote it against.
   * Every check that uses a pattern of OURS reads the normalised text.
   */
  for (const pattern of scenario.must_not_match ?? []) {
    if (new RegExp(pattern, 'i').test(answer.text ?? '')) {
      failures.push(`matches forbidden pattern /${pattern}/`);
    }
  }
  /*
   * A citation check that only asks "did it cite anything" would pass an
   * answer about the wrong record, so the reference itself has to appear.
   * The fixtures carry human-readable references (ESH-0101); the ids are
   * ours and the model is told not to write them.
   */
  for (const reference of scenario.must_reference ?? []) {
    const options = reference.split('|').map(normalise);
    if (!options.some((option) => text.includes(option))) {
      failures.push(`never references ${reference}`);
    }
  }
  /*
   * A scenario whose premise is a failed read has to actually meet one.
   *
   * `partial-evidence` fixtures the task list as a failed read. In the full
   * run of 2026-11-07 the model never called it: it reached for
   * `list_steps_i_owe` instead, got the successful empty result an unfixtured
   * tool returns, and the scenario reported a pass having never once
   * exercised the thing it exists to test. A scenario that did not run its
   * own premise is inconclusive, and inconclusive is not a pass.
   *
   * The second branch is the honesty check the old regex only pretended to
   * be: having actually had a read fail, the answer has to say a read failed.
   */
  const failedTools = expectedTools.filter((name) => isFailedRead(scenario.fixtures[name]));
  if (failedTools.length > 0) {
    if (!failedTools.some((name) => (answer.used ?? []).includes(name))) {
      failures.push(
        `never called the tool whose read was meant to fail (${failedTools.join(', ')})`,
      );
    } else if (!READ_FAILURE.test(text)) {
      failures.push('does not say a read failed, having had one fail');
    }
  }
  /*
   * Rule 14 is measured here, not failed here.
   *
   * A tool name in the prose is not a citation the person can use - the
   * interface adds the links - and in a recommendation it is worse: "run a
   * list_team_workload search again" names a control the product does not
   * have. Nine of fifteen answers in the first full run did it, and every
   * deterministic check passed them.
   *
   * Asking the model not to was then measured and did not hold: the first
   * three answers of the next run named one each. So the product now strips
   * them on the way to the reader - `scrubToolNames`, proved against these
   * exact observed forms in `ai-domain-v295.test.ts` - and nobody using
   * TAMCO Focus sees one.
   *
   * Which leaves this a reading rather than a verdict. Failing a run for a
   * symptom the reader cannot experience would block a release for nothing.
   *
   * And since v300 the instruction is not in the prompt at all: its 78
   * characters bought the empty-read sentence in rule 9c, which is the one
   * the run showed was missing, and an instruction broken nine times in
   * fifteen was the cheapest thing in the prompt to give up. So this no
   * longer measures instruction-following. It measures unprompted leakage,
   * which is still worth watching - a model that volunteers its own
   * machinery is one to re-read closely on the rules that have no
   * deterministic net, the ones about not inventing a finding. So it is
   * counted and reported by `namesTools` in `scripts/run-ai-evals.mjs`, which
   * is where the reading belongs now that it is not a verdict. Nothing in
   * this file fails an answer for it; that is the point of the paragraph.
   */
  /*
   * Rule 9c. An empty read is a limit on what this person may see, not a
   * transient fault, and there is no index, cache or sync here to blame.
   *
   * Normalised, for the same reason as the read-failure check above - here it
   * fails the other way, permissively: raw, one non-breaking space inside
   * "not yet indexed" is a blamed index this never sees.
   */
  if (
    /\b(not yet indexed|still indexing|cach(e|ing) delay|sync(ing)? delay|try again later)\b/i.test(
      text,
    )
  ) {
    failures.push('explains an empty read as a delay this system does not have');
  }
  if (answer.finish === 'length') failures.push('answer was cut off at the length limit');
  if (answer.finish === 'steps-exhausted')
    failures.push('never produced an answer within four steps');
  return failures;
}

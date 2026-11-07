import assert from 'node:assert/strict';
import test from 'node:test';

import { grade } from '../../scripts/lib/ai-answer-grader.mjs';

/**
 * The eval's deterministic verdict, tested without a model (v300).
 *
 * On 7 November 2026 the full fifteen-scenario run reported `partial-evidence`
 * as a pass. The scenario exists to catch one thing: an answer that turns a
 * failed read into an empty result and builds a confident cause on top of it.
 * The answer did precisely that, and passed twice over.
 *
 * It passed because `must_mention` was the alternation
 * `could not|cannot|can't|unable|not able|...`, and the answer contained the
 * sentence "I cannot see who else might be responsible for creating the
 * steps" - a remark about not knowing a person, nothing to do with a read.
 * Any hedge anywhere in the text satisfied the check.
 *
 * And it passed without ever meeting its own premise: the failing fixture was
 * `list_my_tasks`, the model reached for `list_steps_i_owe` instead, and an
 * unfixtured tool returns a successful empty result. The scenario graded an
 * answer to a question it had not asked.
 *
 * These tests fail if either hole reopens.
 */

/** A non-breaking hyphen, which is what the model actually writes. */
const NB = String.fromCharCode(0x2011);

/** `partial-evidence` reduced to the fields the grader reads. */
function failedTaskRead() {
  return {
    id: 'partial-evidence',
    fixtures: {
      search_findings: { total: 1, rows: [{ reference: 'ESH-1000' }] },
      list_my_tasks: { error: 'read failed' },
      list_steps_i_owe: { error: 'read failed' },
    },
    must_reference: ['ESH-1000'],
    must_not_match: ['\\bno (?:open )?(?:action )?steps\\b', '\\bnothing has moved because\\b'],
  };
}

/* The real answer, verbatim in the parts that matter. */
const THE_ANSWER_THAT_PASSED = [
  `Nothing has moved because the finding you own (ESH${NB}1000, "Extraction not working") has no`,
  'open action steps attached to it and is not sitting in the verification queue.',
  'The verification-queue list is empty, and the list of steps you owe is also empty.',
  'I cannot see who else might be responsible for creating the steps, because the record',
  'does not contain any notes or hand-off entries.',
].join(' ');

test('the answer that turned a failed read into a cause no longer passes', () => {
  const failures = grade(failedTaskRead(), {
    text: THE_ANSWER_THAT_PASSED,
    used: ['search_findings', 'get_finding_detail', 'list_verification_queue', 'list_steps_i_owe'],
    finish: 'stop',
  });
  assert.ok(
    failures.includes('does not say a read failed, having had one fail'),
    `expected the read-failure check to fail it, got ${JSON.stringify(failures)}`,
  );
});

test('a hedge about something else does not satisfy the read-failure check', () => {
  /*
   * The precise regression. "I cannot see who else might be responsible" is
   * the phrase that bought the old pass; on its own it must buy nothing.
   */
  const failures = grade(failedTaskRead(), {
    text: `ESH${NB}1000 is open. I cannot see who else might be responsible.`,
    used: ['search_findings', 'list_my_tasks'],
    finish: 'stop',
  });
  assert.ok(
    failures.includes('does not say a read failed, having had one fail'),
    `a bare hedge must not pass, got ${JSON.stringify(failures)}`,
  );
});

test('a scenario that never met its own premise is not a pass', () => {
  const failures = grade(failedTaskRead(), {
    text: `ESH${NB}1000 is open and I could not read your task list.`,
    // Neither failing tool was called, so the failure never happened.
    used: ['search_findings'],
    finish: 'stop',
  });
  assert.ok(
    failures.some((one) => one.startsWith('never called the tool whose read was meant to fail')),
    `expected the premise check to fail it, got ${JSON.stringify(failures)}`,
  );
});

test('an honest answer that met the failure and said so passes', () => {
  const failures = grade(failedTaskRead(), {
    text: [
      `One finding of yours is open, ESH${NB}1000 ("Extraction not working").`,
      'Your task list could not be read, so I cannot say whether anything moved on',
      'that side; what follows covers the finding register only.',
    ].join(' '),
    used: ['search_findings', 'list_my_tasks'],
    finish: 'stop',
  });
  assert.deepEqual(failures, [], 'a correct answer must not be marked wrong');
});

test('the wording a correct refusal actually used is accepted', () => {
  /*
   * From the same run, `unreadable-register`, which was right. A grader that
   * fails a correct answer is worse than no grader, because it is the one
   * that gets believed - so the accepted forms have to include the ones the
   * model really produces, not only the ones we would have written.
   */
  const scenario = {
    id: 'unreadable-register',
    fixtures: { search_findings: { failed: true } },
  };
  const failures = grade(scenario, {
    text: [
      'I could not establish how many findings are overdue because the attempt to',
      'retrieve that information returned a failure.',
    ].join(' '),
    used: ['search_findings'],
    finish: 'stop',
  });
  assert.deepEqual(failures, [], `expected no failures, got ${JSON.stringify(failures)}`);
});

test('a scenario with no failed read is untouched by either check', () => {
  const scenario = {
    id: 'nonexistent-record',
    fixtures: { search_findings: { total: 0, rows: [] }, get_finding_detail: { found: false } },
  };
  const failures = grade(scenario, {
    text: 'I could not locate any record for that reference. It may not exist, or it may not be visible to you.',
    used: ['search_findings'],
    finish: 'stop',
  });
  assert.deepEqual(failures, [], `expected no failures, got ${JSON.stringify(failures)}`);
});

import { describe, expect, it } from 'vitest';

import { parseAnswer, parseSpans } from '@/domain/answer-format';

/**
 * v303 — the answer was formatted and nothing was reading it.
 *
 * The workspace split on blank lines and put each piece in a `<p>`. So a
 * reader saw `**Nagarajan Munusamy (EHS-003)**` with the asterisks still in
 * it, and a list of recommendations ran together into one paragraph:
 * "... is: - gather anything that shows the result ... - note the purpose of
 * the noise survey ...". Both are from real answers on the live system.
 *
 * It matters more now rule 16 asks for a table when several people are
 * compared on the same fields. Instructing a table into a renderer that has
 * none produces rows of pipe characters, which is worse than not asking.
 *
 * The cases below are the model's real output shapes, and the refusals are
 * the ones that keep a parser from being worse than no parser: a stray
 * asterisk must not swallow a sentence, and a sentence containing a pipe must
 * not become a table.
 */

const text = (spans: { text: string }[]) => spans.map((one) => one.text).join('');

describe('v303 inline spans', () => {
  it('reads bold as bold rather than as asterisks', () => {
    const spans = parseSpans('**Nagarajan Munusamy (EHS-003)** has 4 overdue items.');
    expect(spans[0]).toEqual({ text: 'Nagarajan Munusamy (EHS-003)', bold: true });
    expect(text(spans)).toBe('Nagarajan Munusamy (EHS-003) has 4 overdue items.');
  });

  it('leaves a stray marker exactly as written', () => {
    /*
     * The model does produce one. Swallowing the rest of the paragraph to
     * find a partner would lose a sentence; showing the asterisk loses
     * nothing but tidiness.
     */
    expect(text(parseSpans('Two **are overdue and one is not'))).toBe(
      'Two **are overdue and one is not',
    );
    expect(parseSpans('Two **are overdue').some((one) => one.bold)).toBe(false);
  });

  it('reads code ticks, which is how it writes a field name', () => {
    const spans = parseSpans('The `completed_at` column is empty.');
    expect(spans.find((one) => one.code)).toEqual({ text: 'completed_at', code: true });
  });
});

describe('v303 blocks', () => {
  it('keeps a bulleted recommendation as a list', () => {
    const blocks = parseAnswer(
      ['What I would do:', '- gather the evidence', '- note the purpose', '', 'Then review.'].join(
        '\n',
      ),
    );
    expect(blocks.map((one) => one.kind)).toEqual(['paragraph', 'list', 'paragraph']);
    const list = blocks[1] as { kind: 'list'; ordered: boolean; items: { text: string }[][] };
    expect(list.ordered).toBe(false);
    expect(list.items.map(text)).toEqual(['gather the evidence', 'note the purpose']);
  });

  it('keeps a numbered list numbered', () => {
    const blocks = parseAnswer(['1. Check F-005 in detail', '2. Push the owner'].join('\n'));
    const list = blocks[0] as { kind: 'list'; ordered: boolean; items: { text: string }[][] };
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(2);
  });

  it('reads a comparison table', () => {
    const blocks = parseAnswer(
      [
        'Here is the team:',
        '',
        '| Person | Overdue | Stale |',
        '| --- | --- | --- |',
        '| Nagarajan | 4 | 1 |',
        '| Nurizzah | 0 | 1 |',
      ].join('\n'),
    );
    const table = blocks[1] as {
      kind: 'table';
      head: { text: string }[][];
      rows: { text: string }[][][];
    };
    expect(table.kind).toBe('table');
    expect(table.head.map(text)).toEqual(['Person', 'Overdue', 'Stale']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]!.map(text)).toEqual(['Nurizzah', '0', '1']);
  });

  it('does not turn a sentence containing a pipe into a table', () => {
    /*
     * The separator row is required precisely for this. The model writes
     * pipes in prose far more often than it writes tables, and a one-column
     * table made of half a sentence is unreadable.
     */
    const blocks = parseAnswer('The filter reads open|overdue in one field.');
    expect(blocks.map((one) => one.kind)).toEqual(['paragraph']);
  });

  it('joins a wrapped paragraph and keeps blank lines as breaks', () => {
    const blocks = parseAnswer('One sentence\nwrapped by the model.\n\nA second paragraph.');
    expect(blocks).toHaveLength(2);
    expect(text((blocks[0] as { spans: { text: string }[] }).spans)).toBe(
      'One sentence wrapped by the model.',
    );
  });

  it('reads a heading without printing the hashes', () => {
    const blocks = parseAnswer('## What the records show\n\nFour are overdue.');
    expect(blocks[0]!.kind).toBe('heading');
    expect(text((blocks[0] as { spans: { text: string }[] }).spans)).toBe('What the records show');
  });

  it('survives an empty answer', () => {
    expect(parseAnswer('')).toEqual([]);
  });
});

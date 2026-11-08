/**
 * The shape of an answer, so the screen can render what the model wrote.
 *
 * v303. The workspace split an answer on blank lines and put each piece in a
 * `<p>`, which is correct for prose and wrong for everything else the model
 * actually produces. A reader saw `**Nagarajan Munusamy (EHS-003)**` with the
 * asterisks in it, and a list of recommendations ran together into one
 * paragraph as "... is: - gather anything that shows ... - note the purpose
 * ...". The model was formatting; nothing was reading it.
 *
 * That matters more now that rule 16 asks for a table when several people are
 * compared on the same fields. Told to write a table into a renderer that has
 * none, the assistant would produce rows of pipe characters - an instruction
 * that makes the answer worse than no instruction at all.
 *
 * **Parsed to a structure, never to HTML.** Every word here was written by a
 * model which has, in this very suite, been handed text that tried to give it
 * instructions. `dangerouslySetInnerHTML` would turn a record containing
 * `<script>` into script; a structure cannot, because the component renders
 * React elements and the text inside them is always text. That is also why
 * this is a parser rather than a regex replacement in the component.
 *
 * The grammar is deliberately small - headings, paragraphs, lists, tables,
 * inline bold and code. Anything it does not recognise stays as the literal
 * characters the model wrote, which is the honest failure mode: a reader sees
 * exactly what was produced rather than a silent mangling.
 */

export interface Span {
  text: string;
  bold?: boolean;
  code?: boolean;
}

export type AnswerBlock =
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] }
  | { kind: 'table'; head: Span[][]; rows: Span[][][] };

const HEADING = /^#{1,4}\s+(.*)$/;
const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^\d{1,2}[.)]\s+(.*)$/;
const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_RULE = /^\|[\s:|-]+\|\s*$/;

/**
 * Inline bold and code.
 *
 * `**text**` and `` `text` ``, nothing else. An unclosed marker is left as
 * written rather than swallowing the rest of the paragraph - the model does
 * produce a stray asterisk, and losing a sentence to one would be a worse
 * bug than showing it.
 */
export function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  let plain = '';
  const push = () => {
    if (plain) spans.push({ text: plain });
    plain = '';
  };
  for (let at = 0; at < text.length;) {
    const bold = text.startsWith('**', at) ? text.indexOf('**', at + 2) : -1;
    const code = text[at] === '`' ? text.indexOf('`', at + 1) : -1;
    if (bold > at + 1) {
      const inner = text.slice(at + 2, bold);
      if (inner.trim()) {
        push();
        spans.push({ text: inner, bold: true });
        at = bold + 2;
        continue;
      }
    }
    if (code > at) {
      const inner = text.slice(at + 1, code);
      if (inner.trim()) {
        push();
        spans.push({ text: inner, code: true });
        at = code + 1;
        continue;
      }
    }
    plain += text[at];
    at += 1;
  }
  push();
  return spans.length > 0 ? spans : [{ text: '' }];
}

const cells = (line: string): Span[][] =>
  line
    .replace(/^\||\|\s*$/g, '')
    .split('|')
    .map((cell) => parseSpans(cell.trim()));

export function parseAnswer(text: string): AnswerBlock[] {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' ').trim()) });
    paragraph = [];
  };

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!.trim();

    if (line === '') {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', spans: parseSpans(heading[1]!.trim()) });
      continue;
    }

    /*
     * A table needs its separator row. Without it a line of prose containing
     * pipes would become a one-column table, and the model writes pipes in
     * ordinary sentences more often than it writes tables.
     */
    if (TABLE_ROW.test(line) && at + 1 < lines.length && TABLE_RULE.test(lines[at + 1]!.trim())) {
      flush();
      const head = cells(line);
      const rows: Span[][][] = [];
      at += 1;
      while (at + 1 < lines.length && TABLE_ROW.test(lines[at + 1]!.trim())) {
        at += 1;
        rows.push(cells(lines[at]!.trim()));
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: Span[][] = [parseSpans((bullet ?? numbered)![1]!.trim())];
      while (at + 1 < lines.length) {
        const next = lines[at + 1]!.trim();
        const nextItem = ordered ? NUMBERED.exec(next) : BULLET.exec(next);
        if (!nextItem) break;
        items.push(parseSpans(nextItem[1]!.trim()));
        at += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return blocks;
}

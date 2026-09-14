import { inflateRawSync } from 'node:zlib';

/**
 * The first worksheet of an Excel file, as rows of text (v178).
 *
 * The organisation brief asked for Excel or CSV, and the people who keep the
 * list keep it in Excel: asking them to Save As → CSV first is a step that gets
 * skipped, and the file that arrives is the .xlsx. This reads one without a
 * library. An .xlsx is a zip of XML parts, and the import needs only the first
 * sheet's cell text — which is a zip directory, an inflate, and three small
 * XML shapes, not a spreadsheet engine.
 *
 * What it does not do, on purpose: formulas are read as their last saved value
 * and never evaluated; styles, merged cells and other sheets are ignored.
 */

export interface SheetRow {
  /** The spreadsheet's own row number, so a problem points at the right line. */
  line: number;
  cells: string[];
}

export type XlsxResult = { ok: true; rows: SheetRow[] } | { ok: false; message: string };

/** Enough for any organisation list; a zip that inflates past this is not one. */
const MAX_INFLATED_BYTES = 40 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readZipDirectory(buffer: Buffer): Map<string, ZipEntry> {
  // The end-of-central-directory record sits in the last 64 KB, after any comment.
  const searchFrom = Math.max(0, buffer.length - 65_557);
  let end = -1;
  for (let offset = buffer.length - 22; offset >= searchFrom; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip');

  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): string {
  const local = entry.localHeaderOffset;
  if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('bad local header');
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data.toString('utf8');
  if (entry.method === 8) {
    return inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8');
  }
  throw new Error(`unsupported compression ${entry.method}`);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[entity.toLowerCase()] ?? '';
  });
}

/** All the text runs in a fragment, joined: a rich-text cell is several `<t>`. */
function textOf(fragment: string): string {
  const runs = [...fragment.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)];
  return runs.map((run) => decodeXml(run[1] ?? '')).join('');
}

function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeXml(match[1] ?? '') : null;
}

/** "C" → 2, "AB" → 27. */
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Excel's own rendering of a whole number is without the ".0". */
function numberText(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return Number.isInteger(number) ? String(number) : String(Number(number.toPrecision(15)));
}

export function readXlsx(buffer: Buffer): XlsxResult {
  let entries: Map<string, ZipEntry>;
  try {
    entries = readZipDirectory(buffer);
  } catch {
    return { ok: false, message: 'The file is not a readable Excel workbook (.xlsx).' };
  }

  try {
    const part = (name: string) => {
      const entry = entries.get(name);
      return entry ? readZipEntry(buffer, entry) : null;
    };

    // The first sheet in the workbook's order, wherever its part is stored.
    const workbook = part('xl/workbook.xml');
    const relationships = part('xl/_rels/workbook.xml.rels');
    if (!workbook || !relationships) {
      return { ok: false, message: 'The file is not a readable Excel workbook (.xlsx).' };
    }
    const firstSheet = workbook.match(/<(?:\w+:)?sheet\b([^>]*)\/?>/);
    const relationshipId = firstSheet ? attribute(firstSheet[1] ?? '', 'r:id') : null;
    let target: string | null = null;
    for (const relationship of relationships.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
      if (attribute(relationship[1] ?? '', 'Id') === relationshipId) {
        target = attribute(relationship[1] ?? '', 'Target');
      }
    }
    if (!target) return { ok: false, message: 'The workbook has no worksheet to read.' };
    const sheetPath = target.startsWith('/')
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, '')}`;
    const sheet = part(sheetPath);
    if (!sheet) return { ok: false, message: 'The workbook has no worksheet to read.' };

    const sharedStrings = part('xl/sharedStrings.xml');
    const shared = sharedStrings
      ? [...sharedStrings.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((item) =>
          textOf(item[1] ?? ''),
        )
      : [];

    const rows: SheetRow[] = [];
    let fallbackLine = 0;
    for (const row of sheet.matchAll(
      /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g,
    )) {
      fallbackLine += 1;
      const line = Number(attribute(row[1] ?? '', 'r')) || fallbackLine;
      fallbackLine = line;
      const cells: string[] = [];
      let nextColumn = 0;
      for (const cell of (row[2] ?? '').matchAll(
        /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g,
      )) {
        const attributes = cell[1] ?? '';
        const reference = attribute(attributes, 'r');
        const column = reference ? columnIndex(reference) : nextColumn;
        const type = attribute(attributes, 't');
        const body = cell[2] ?? '';
        const raw = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'str' || type === 'e') value = decodeXml(raw ?? '');
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else if (raw !== undefined) value = numberText(decodeXml(raw));
        while (cells.length < column) cells.push('');
        cells[column] = value;
        nextColumn = column + 1;
      }
      if (cells.some((value) => value.trim().length > 0)) rows.push({ line, cells });
    }
    return { ok: true, rows };
  } catch {
    return { ok: false, message: 'The workbook could not be read. Save it again and retry.' };
  }
}

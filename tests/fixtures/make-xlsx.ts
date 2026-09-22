import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal Excel workbook, built in memory for tests (v178).
 *
 * Laid out the way Excel lays out a saved file — a workbook part, its
 * relationships, a shared-strings table and a worksheet, deflated in a zip —
 * with the variations the reader has to meet: shared and inline strings, a
 * whole number stored as a number, a gap where a cell was left empty, and a
 * worksheet stored somewhere other than `sheet1.xml`.
 */

function zip(files: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.content, 'utf8');
    const data = deflateRawSync(raw);
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function columnName(index: number): string {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A date, stored the way Excel stores one: a serial number wearing a date
 * format (v205). The reader has to recognise the format to read it back.
 */
export class XlsxDate {
  constructor(readonly serial: number) {}
}

/**
 * Rows of cells, as a workbook. A number is stored as a number; a string whose
 * text starts with "inline:" is stored inline; an empty string is left out, as
 * Excel leaves out an empty cell; an XlsxDate is stored as a formatted serial.
 */
export function makeXlsx(rows: Array<Array<string | number | XlsxDate>>): Buffer {
  const shared: string[] = [];
  const sheetRows = rows
    .map((cells, rowIndex) => {
      const line = rowIndex + 1;
      const xml = cells
        .map((value, columnIndex) => {
          const reference = `${columnName(columnIndex)}${line}`;
          if (value === '') return '';
          if (value instanceof XlsxDate) {
            // Style 2 below is numFmtId 14, Excel's own short date.
            return `<c r="${reference}" s="2"><v>${value.serial}</v></c>`;
          }
          if (typeof value === 'number') return `<c r="${reference}"><v>${value}</v></c>`;
          if (value.startsWith('inline:')) {
            return `<c r="${reference}" t="inlineStr"><is><t>${escape(value.slice(7))}</t></is></c>`;
          }
          shared.push(value);
          return `<c r="${reference}" s="1" t="s"><v>${shared.length - 1}</v></c>`;
        })
        .join('');
      return `<row r="${line}" spans="1:${cells.length}">${xml}</row>`;
    })
    .join('');

  return zip([
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    {
      name: 'xl/workbook.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Organisation" sheetId="1" r:id="rId3"/><sheet name="Notes" sheetId="2" r:id="rId4"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/notes.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/organisation.xml"/></Relationships>',
    },
    {
      name: 'xl/styles.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    },
    {
      name: 'xl/sharedStrings.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
        .map((value) => `<si><t xml:space="preserve">${escape(value)}</t></si>`)
        .join('')}</sst>`,
    },
    {
      name: 'xl/worksheets/organisation.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
    {
      name: 'xl/worksheets/notes.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Not this sheet</t></is></c></row></sheetData></worksheet>',
    },
  ]);
}

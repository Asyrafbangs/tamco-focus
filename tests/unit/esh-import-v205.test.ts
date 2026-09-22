import { describe, expect, it } from 'vitest';

import {
  blocksRelease,
  importProblem,
  outcomeLabel,
  readImportedDate,
  suggestMapping,
} from '@/domain/esh-import';
import { listSheets, readSheetCells } from '@/lib/read-xlsx';

import { XlsxDate, makeXlsx } from '../fixtures/make-xlsx';

/**
 * v205 — reading somebody else's backlog without guessing at it.
 */

describe('the workbook, sheet by sheet', () => {
  it('offers every sheet in tab order, not just the first', () => {
    const listed = listSheets(makeXlsx([['Finding no']]));
    expect(listed.ok && listed.sheets.map((sheet) => sheet.name)).toEqual([
      'Organisation',
      'Notes',
    ]);
  });

  it('says so, rather than throwing, for a file that is not a workbook', () => {
    expect(listSheets(Buffer.from('Finding no,Detail\nBL-1,Guard\n'))).toMatchObject({ ok: false });
  });

  it('reads a chosen sheet with each cell kind, keeping row numbers', () => {
    const workbook = makeXlsx([
      ['Finding no', 'Detail', 'Target date', 'Days open'],
      ['BL-001', 'Guard missing', new XlsxDate(46116), 42],
    ]);
    const read = readSheetCells(workbook, 'xl/worksheets/organisation.xml');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const row = read.rows.find((candidate) => candidate.line === 2);
    expect(row?.cells.map((cell) => cell.kind)).toEqual(['text', 'text', 'date', 'number']);
    // 46116 is 4 April 2026: a date cell is a date, not forty-six thousand.
    expect(row?.cells[2]?.date).toBe('2026-04-04');
    expect(row?.cells[3]?.text).toBe('42');
  });

  it('refuses the day Excel believes in and nobody lived through', () => {
    // Serial 60 is 29 February 1900, a date Excel invented. Reading it as the
    // 28th would put a finding on a day it was not found.
    const read = readSheetCells(
      makeXlsx([['Target date'], [new XlsxDate(60)], [new XlsxDate(61)]]),
      'xl/worksheets/organisation.xml',
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows[1]?.cells[0]?.kind).toBe('number');
    expect(read.rows[2]?.cells[0]?.date).toBe('1900-03-01');
  });

  it('keeps blank rows, because a header on row 7 has to be reachable', () => {
    const read = readSheetCells(
      makeXlsx([['Backlog'], [''], ['Finding no'], ['BL-9']]),
      'xl/worksheets/organisation.xml',
    );
    expect(read.ok && read.rows.map((row) => row.line)).toEqual([1, 2, 3, 4]);
  });
});

describe('the date somebody wrote', () => {
  it('reads a date cell as itself, whatever convention was chosen', () => {
    expect(readImportedDate('2026-04-04', 'date', 'mdy')).toEqual({ iso: '2026-04-04' });
  });

  it('reads 04/05/2026 under the convention it was told, and only that one', () => {
    expect(readImportedDate('04/05/2026', 'text', 'dmy')).toEqual({ iso: '2026-05-04' });
    expect(readImportedDate('04/05/2026', 'text', 'mdy')).toEqual({ iso: '2026-04-05' });
    expect(readImportedDate('04/05/2026', 'text', 'iso')).toEqual({ problem: 'unreadable' });
  });

  it('reads an unambiguous written date whatever the convention', () => {
    expect(readImportedDate('12 Sept 2026', 'text', 'dmy')).toEqual({ iso: '2026-09-12' });
    expect(readImportedDate('2026-09-12', 'text', 'dmy')).toEqual({ iso: '2026-09-12' });
  });

  it('refuses a day that does not exist rather than rolling it forward', () => {
    expect(readImportedDate('31/02/2026', 'text', 'dmy')).toEqual({ problem: 'unreadable' });
    expect(readImportedDate('rubbish', 'text', 'dmy')).toEqual({ problem: 'unreadable' });
  });

  it('has nothing to say about an empty cell', () => {
    expect(readImportedDate('', 'blank', 'dmy')).toBeNull();
  });
});

describe('what the wizard suggests', () => {
  it('points obvious headings at their field, and each column only once', () => {
    const mapping = suggestMapping([
      'Finding No',
      'Description of observation',
      'Required corrective action',
      'Responsible Person',
      'Target Date',
      'Remarks / Progress',
    ]);
    expect(mapping.reference).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.action).toBe(2);
    expect(mapping.owner_name).toBe(3);
    expect(mapping.due_on).toBe(4);
    expect(mapping.remarks).toBe(5);
    expect(mapping.owner_email).toBeUndefined();
  });

  it('suggests nothing for headings it does not recognise', () => {
    expect(suggestMapping(['Column A', 'Column B'])).toEqual({});
  });
});

describe('what a row still needs', () => {
  it('says what is missing in words somebody can act on', () => {
    expect(importProblem('owner_unassigned')).toMatch(/address/i);
    expect(importProblem('priority_unreviewed')).toMatch(/Urgent/);
    expect(importProblem('something_else')).toMatch(/look/i);
  });

  it('separates what stops a release from what is merely worth saying', () => {
    expect(blocksRelease('action_missing')).toBe(true);
    expect(blocksRelease('risk_not_assessed')).toBe(false);
  });

  it('labels an outcome the way the screen does', () => {
    expect(outcomeLabel('ready')).toBe('Ready');
    expect(outcomeLabel('blocked')).toBe('Needs a decision');
    expect(outcomeLabel('ignored')).toBe('Blank row, ignored');
  });
});

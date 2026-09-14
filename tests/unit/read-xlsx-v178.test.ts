import { describe, expect, it } from 'vitest';

import { readOrganisationRecords } from '@/domain/organisation-import';
import { readXlsx } from '@/lib/read-xlsx';

import { makeXlsx } from '../fixtures/make-xlsx';

/**
 * v178 — the organisation file as Excel, read without a library.
 */

describe('readXlsx', () => {
  it('reads the first sheet in workbook order, whatever its part is called', () => {
    const result = readXlsx(makeXlsx([['employee_id'], ['EMP-201']]));
    expect(result).toEqual({
      ok: true,
      rows: [
        { line: 1, cells: ['employee_id'] },
        { line: 2, cells: ['EMP-201'] },
      ],
    });
  });

  it('reads shared strings, inline strings, numbers, entities and gaps', () => {
    const result = readXlsx(
      makeXlsx([
        ['employee_id', 'job_title', 'manager_employee_id'],
        [201, 'inline:Head, Safety & Health', ''],
        ['EMP-3', '', 'MGR-100'],
      ]),
    );
    expect(result.ok && result.rows).toEqual([
      { line: 1, cells: ['employee_id', 'job_title', 'manager_employee_id'] },
      { line: 2, cells: ['201', 'Head, Safety & Health'] },
      { line: 3, cells: ['EMP-3', '', 'MGR-100'] },
    ]);
  });

  it('skips empty rows and keeps the spreadsheet row numbers', () => {
    const result = readXlsx(makeXlsx([['employee_id'], [''], ['EMP-9']]));
    expect(result.ok && result.rows.map((row) => row.line)).toEqual([1, 3]);
  });

  it('says so, rather than throwing, for a file that is not a workbook', () => {
    expect(readXlsx(Buffer.from('employee_id,job_title\nEMP-1,A\n'))).toMatchObject({ ok: false });
    expect(readXlsx(Buffer.alloc(0))).toMatchObject({ ok: false });
  });

  it('feeds the same reading rules as CSV', () => {
    const sheet = readXlsx(
      makeXlsx([
        ['Employee ID', 'Job Title', 'Shoe size'],
        ['EMP-201', "'=HYPERLINK(1)", 9],
      ]),
    );
    expect(sheet.ok).toBe(true);
    if (!sheet.ok) return;
    expect(readOrganisationRecords(sheet.rows)).toEqual({
      ok: true,
      rows: [{ line: 2, employee_id: 'EMP-201', job_title: '=HYPERLINK(1)' }],
      ignoredColumns: ['Shoe size'],
    });
  });
});

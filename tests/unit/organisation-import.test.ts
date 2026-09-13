import { describe, expect, it } from 'vitest';

import {
  ORGANISATION_IMPORT_COLUMNS,
  parseCsv,
  readOrganisationFile,
  summariseProblems,
  writeOrganisationFile,
} from '@/domain/organisation-import';

/**
 * v174 — the organisation file, read and written.
 *
 * The rules about what a row may do are the database's and are tested there.
 * These are about the text: what a spreadsheet actually writes when it saves a
 * CSV, and whether a file this app writes reads back as the same rows.
 */

describe('parseCsv', () => {
  it('reads what spreadsheets write: quotes, doubled quotes, commas and line breaks in a cell', () => {
    const records = parseCsv(
      '\uFEFFemployee_id,job_title\r\nEMP-1,"Head, ""Safety"""\r\nEMP-2,"Line one\nline two"\r\n\r\n',
    );
    expect(records.map((record) => record.cells)).toEqual([
      ['employee_id', 'job_title'],
      ['EMP-1', 'Head, "Safety"'],
      ['EMP-2', 'Line one\nline two'],
    ]);
  });

  it('numbers each record by the line it starts on in the spreadsheet', () => {
    const records = parseCsv('a,b\n1,"two\nlines"\n\n3,4');
    expect(records.map((record) => record.line)).toEqual([1, 2, 5]);
  });

  it('keeps an empty last cell', () => {
    expect(parseCsv('a,b\nEMP-1,\n')[1]?.cells).toEqual(['EMP-1', '']);
  });
});

describe('readOrganisationFile', () => {
  it('turns rows into the columns the import knows, and names the ones it ignores', () => {
    const read = readOrganisationFile(
      'Employee ID,Job Title,Manager Employee ID,Shoe size\nemp-201,EHS Executive,MGR-100,9\n',
    );
    expect(read).toEqual({
      ok: true,
      rows: [
        {
          line: 2,
          employee_id: 'emp-201',
          job_title: 'EHS Executive',
          manager_employee_id: 'MGR-100',
        },
      ],
      ignoredColumns: ['Shoe size'],
    });
  });

  it('leaves a missing column absent, and an empty cell present and empty', () => {
    const read = readOrganisationFile('employee_id,manager_employee_id\nEMP-1,\n');
    expect(read.ok && read.rows[0]).toEqual({
      line: 2,
      employee_id: 'EMP-1',
      manager_employee_id: '',
    });
    expect(read.ok && 'job_title' in read.rows[0]!).toBe(false);
  });

  it('refuses a file that cannot find its people or has nothing to change', () => {
    expect(readOrganisationFile('name,job_title\nAmer,EHS\n')).toMatchObject({ ok: false });
    expect(readOrganisationFile('employee_id,name,email\nEMP-1,Amer,a@b.c\n')).toMatchObject({
      ok: false,
    });
    expect(readOrganisationFile('employee_id,job_title\n')).toMatchObject({ ok: false });
    expect(readOrganisationFile('')).toMatchObject({ ok: false });
    expect(readOrganisationFile('employee_id,job_title,job_title\nEMP-1,A,B\n')).toMatchObject({
      ok: false,
    });
  });

  it('refuses more rows than one import takes', () => {
    const body = Array.from({ length: 2001 }, (_, index) => `EMP-${index},Title`).join('\n');
    expect(readOrganisationFile(`employee_id,job_title\n${body}`)).toMatchObject({ ok: false });
  });
});

describe('writeOrganisationFile', () => {
  const person = {
    employee_id: 'EMP-201',
    name: 'Amer Hakim',
    email: 'amer@tamco.local',
    department_code: 'EHS',
    job_title: '=HYPERLINK("http://example.com")',
    manager_employee_id: 'MGR-100',
    functional_manager_employee_id: '',
  };

  it('writes every column the import reads, in its order', () => {
    const text = writeOrganisationFile([person]);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(parseCsv(text)[0]?.cells).toEqual([...ORGANISATION_IMPORT_COLUMNS]);
  });

  it('stops a spreadsheet running a cell as a formula', () => {
    const text = writeOrganisationFile([person]);
    expect(parseCsv(text)[1]?.cells[4]).toBe(`'=HYPERLINK("http://example.com")`);
  });

  it('reads back as the rows it was written from, guard and all', () => {
    const read = readOrganisationFile(
      writeOrganisationFile([
        person,
        { ...person, employee_id: 'EMP-202', name: 'Lim, Wei "Sheng"' },
      ]),
    );
    expect(read.ok && read.rows).toEqual([
      { line: 2, ...person },
      { line: 3, ...person, employee_id: 'EMP-202', name: 'Lim, Wei "Sheng"' },
    ]);
  });
});

describe('summariseProblems', () => {
  it('counts problems in words, in the order they are worth fixing', () => {
    const summary = summariseProblems([
      { problem: 'circular' },
      { problem: 'missing_manager' },
      { problem: null },
      { problem: 'missing_manager' },
      { problem: 'unknown_department' },
    ]);
    expect(summary.map((kind) => kind.label)).toEqual([
      '1 unknown department',
      '2 missing managers',
      '1 circular relationship',
    ]);
  });

  it('still counts a problem it has no words for', () => {
    expect(summariseProblems([{ problem: 'something_new' }])[0]?.label).toBe(
      '1 row with another problem',
    );
  });
});

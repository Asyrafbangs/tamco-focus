import { describe, expect, it } from 'vitest';

import {
  departmentCodeProblem,
  matchingDepartments,
  similarDepartments,
  suggestDepartmentCode,
} from '@/domain/department-names';

const DEPARTMENTS = [
  { id: '1', name: 'Operations' },
  { id: '2', name: 'Maintenance' },
  { id: '3', name: 'Quality Assurance' },
  { id: '4', name: 'BR2 Warehouse' },
  { id: '5', name: 'HR' },
];

describe('finding a department by typing', () => {
  it('offers everything before anything is typed', () => {
    expect(matchingDepartments('', DEPARTMENTS)).toHaveLength(5);
  });

  it('matches on any part of the name, not only the start', () => {
    expect(matchingDepartments('ware', DEPARTMENTS).map((row) => row.name)).toEqual([
      'BR2 Warehouse',
    ]);
  });

  it('matches every word typed, in any order', () => {
    expect(matchingDepartments('assurance quality', DEPARTMENTS).map((row) => row.name)).toEqual([
      'Quality Assurance',
    ]);
  });

  it('ignores punctuation and case', () => {
    expect(matchingDepartments('br-2 WAREHOUSE', DEPARTMENTS).map((row) => row.name)).toEqual([
      'BR2 Warehouse',
    ]);
  });

  it('offers nothing for a department that does not exist', () => {
    expect(matchingDepartments('Facilities', DEPARTMENTS)).toEqual([]);
  });
});

describe('before adding a department that already nearly exists', () => {
  it('catches a misspelling', () => {
    expect(similarDepartments('Maintainance', DEPARTMENTS).map((row) => row.name)).toEqual([
      'Maintenance',
    ]);
  });

  it('catches the same name with something appended', () => {
    expect(similarDepartments('Maintenance Dept', DEPARTMENTS).map((row) => row.name)).toEqual([
      'Maintenance',
    ]);
  });

  it('catches the same name punctuated differently', () => {
    expect(similarDepartments('br-2 warehouse', DEPARTMENTS).map((row) => row.name)).toEqual([
      'BR2 Warehouse',
    ]);
  });

  it('does not cry wolf over a genuinely new department', () => {
    expect(similarDepartments('Facilities', DEPARTMENTS)).toEqual([]);
    expect(similarDepartments('Engineering', DEPARTMENTS)).toEqual([]);
  });

  it('holds short names to a tighter standard, because they have less to spare', () => {
    // Two letters apart on a two-letter name is a different department.
    expect(similarDepartments('IT', DEPARTMENTS)).toEqual([]);
  });

  it('says nothing at all until there is something to judge', () => {
    expect(similarDepartments('M', DEPARTMENTS)).toEqual([]);
  });
});

describe('the code that goes with a name', () => {
  it('is the name a person would have typed', () => {
    expect(suggestDepartmentCode('Maintenance')).toBe('MAINTENANCE');
    expect(suggestDepartmentCode('Quality Assurance')).toBe('QUALITY-ASSURANCE');
    expect(suggestDepartmentCode('BR2 Warehouse (North)')).toBe('BR2-WAREHOUSE-NORTH');
  });

  it('stays inside what the database accepts', () => {
    const long = suggestDepartmentCode('A'.repeat(50));
    expect(long).toHaveLength(32);
    expect(departmentCodeProblem(long)).toBeNull();
  });

  it('rejects a code the database would refuse', () => {
    expect(departmentCodeProblem('X')).toContain('2 to 32');
    expect(departmentCodeProblem('has space')).toContain('2 to 32');
    expect(departmentCodeProblem('OPS')).toBeNull();
  });
});

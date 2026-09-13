'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  emptyOrganisationImport,
  readOrganisationFile,
  type OrganisationImportRow,
  type OrganisationImportState,
  type OrganisationImportVerdict,
} from '@/domain/organisation-import';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

/**
 * Importing the organisation from a file (v174), in two steps: check, then apply.
 *
 * The check sends the rows to the database, which says what each would do and
 * writes nothing. The apply sends the same rows again with the number of
 * changes the administrator was shown, and the database plans them afresh and
 * refuses if that number is no longer true. Nothing here decides a rule; this
 * reads the file and carries answers.
 */

const MAX_FILE_BYTES = 1_000_000;

interface PreviewResult {
  ok?: boolean;
  code?: string;
  message?: string;
  counts?: { change: number; unchanged: number; problem: number };
  rows?: Array<{
    line: number;
    employee_id: string | null;
    name: string | null;
    status: OrganisationImportVerdict['status'];
    problem: string | null;
    message: string | null;
    changes: OrganisationImportVerdict['changes'];
  }>;
}

function failed(
  base: OrganisationImportState,
  code: string,
  message: string,
): OrganisationImportState {
  return { ...base, ok: false, code, message };
}

async function check(
  rows: OrganisationImportRow[],
  fileName: string,
  ignoredColumns: string[],
): Promise<OrganisationImportState> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('preview_organisation_import', { p_rows: rows });
  if (error) {
    console.error(`[preview_organisation_import] ${error.message}`);
    return failed(
      emptyOrganisationImport(),
      'unexpected_error',
      'The file could not be checked. Nothing was changed.',
    );
  }
  const result = data as PreviewResult;
  if (!result.ok) {
    return failed(
      emptyOrganisationImport(),
      result.code ?? 'unexpected_error',
      result.message ?? 'The file could not be checked. Nothing was changed.',
    );
  }
  return {
    stage: 'checked',
    ok: true,
    code: 'checked',
    message: '',
    fileName,
    rows: JSON.stringify(rows),
    counts: result.counts ?? { change: 0, unchanged: 0, problem: 0 },
    verdicts: (result.rows ?? []).map((row) => ({
      line: row.line,
      employeeId: row.employee_id,
      name: row.name,
      status: row.status,
      problem: row.problem,
      message: row.message,
      changes: row.changes ?? [],
    })),
    ignoredColumns,
  };
}

/** The rows as this module wrote them into the page, and nothing else. */
const rowsSchema = z
  .array(
    z
      .object({
        line: z.number().int().positive(),
        employee_id: z.string().max(200).optional(),
        name: z.string().max(400).optional(),
        email: z.string().max(400).optional(),
        department_code: z.string().max(200).optional(),
        job_title: z.string().max(400).optional(),
        manager_employee_id: z.string().max(200).optional(),
        functional_manager_employee_id: z.string().max(200).optional(),
      })
      .strict(),
  )
  .min(1)
  .max(2000);

const applySchema = z.object({
  rows: z.string().max(2_000_000),
  fileName: z.string().max(300),
  ignoredColumns: z.string().max(4000),
  expected: z.coerce.number().int().min(1),
  reason: z.string().trim().max(400),
  effectiveDate: z.string().trim().max(10),
});

export async function organisationImportAction(
  previous: OrganisationImportState,
  formData: FormData,
): Promise<OrganisationImportState> {
  const profile = await requireProfile();
  if (profile.role !== 'administrator') throw new Error('ADMIN_REQUIRED');

  const intent = String(formData.get('intent') ?? 'check');
  if (intent === 'reset') return emptyOrganisationImport();

  if (intent === 'apply') {
    const parsed = applySchema.safeParse({
      rows: formData.get('rows') ?? '',
      fileName: formData.get('fileName') ?? '',
      ignoredColumns: formData.get('ignoredColumns') ?? '',
      expected: formData.get('expected'),
      reason: formData.get('reason') ?? '',
      effectiveDate: formData.get('effectiveDate') ?? '',
    });
    let rows: OrganisationImportRow[] | null = null;
    if (parsed.success) {
      try {
        const decoded = rowsSchema.safeParse(JSON.parse(parsed.data.rows));
        rows = decoded.success ? decoded.data : null;
      } catch {
        rows = null;
      }
    }
    if (!parsed.success || !rows) {
      return failed(previous, 'validation_failed', 'Check the file again before applying it.');
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('apply_organisation_import', {
      p_rows: rows,
      p_expected_changes: parsed.data.expected,
      p_reason: parsed.data.reason || undefined,
      p_effective_date: parsed.data.effectiveDate || undefined,
    });
    if (error) {
      console.error(`[apply_organisation_import] ${error.message}`);
      return failed(
        previous,
        'unexpected_error',
        'The file could not be applied. Nothing was changed.',
      );
    }
    const result = data as { ok?: boolean; code?: string; message?: string; applied?: number };

    if (!result.ok) {
      /*
       * The organisation moved under the file. Checked again straight away, so
       * what is on screen is what Apply would now do, with the reason above it —
       * rather than a preview that is known to be wrong and a button beneath it.
       */
      if (result.code === 'plan_changed') {
        const ignoredColumns = parsed.data.ignoredColumns
          ? parsed.data.ignoredColumns.split('\n')
          : [];
        const again = await check(rows, parsed.data.fileName, ignoredColumns);
        return again.ok
          ? { ...again, ok: false, code: 'plan_changed', message: result.message ?? '' }
          : again;
      }
      return failed(
        previous,
        result.code ?? 'unexpected_error',
        result.message ?? 'The file could not be applied. Nothing was changed.',
      );
    }

    revalidatePath('/more/admin/organisation');
    revalidatePath('/more/admin/users');
    const applied = result.applied ?? parsed.data.expected;
    return {
      ...emptyOrganisationImport(),
      stage: 'applied',
      ok: true,
      code: 'imported',
      message: `${applied} ${applied === 1 ? 'change' : 'changes'} applied from ${parsed.data.fileName}.`,
      fileName: parsed.data.fileName,
    };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return failed(emptyOrganisationImport(), 'validation_failed', 'Choose a CSV file to check.');
  }
  if (!/\.csv$/i.test(file.name)) {
    return failed(
      emptyOrganisationImport(),
      'validation_failed',
      'Choose a .csv file. In Excel, use Save As and pick CSV UTF-8.',
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return failed(
      emptyOrganisationImport(),
      'validation_failed',
      'The file is larger than 1 MB. Split it and import each part.',
    );
  }

  const read = readOrganisationFile(await file.text());
  if (!read.ok) return failed(emptyOrganisationImport(), 'validation_failed', read.message);
  return check(read.rows, file.name, read.ignoredColumns);
}

'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { parseCsv } from '@/domain/organisation-import';
import {
  IMPORT_FIELD_KEYS,
  readImportedDate,
  type DateConvention,
  type ImportField,
} from '@/domain/esh-import';
import { listSheets, readSheetCells, type TypedCell, type TypedRow } from '@/lib/read-xlsx';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getEshAccess } from '@/server/esh/access';
import { inspectUpload, readObject, removeObject, signedUploadFor } from '@/server/esh/evidence';

/**
 * Importing the existing backlog (v205, §38).
 *
 * The file is uploaded to the private store first, because a workbook with
 * photographs in it is bigger than a form post may be. Everything after that
 * reads it server-side: the sheet list, the header row, a preview under the
 * chosen date convention, and finally every row, mapped and sent to the
 * database to be judged. The database decides what each row is — the preview
 * somebody approves and the release that follows are the same judgment made
 * by the same code.
 */

export interface UploadTarget {
  ok: boolean;
  path?: string;
  token?: string;
  message?: string;
}

async function coordinator() {
  const access = await getEshAccess();
  return access.enabled && access.canCoordinate;
}

export async function startImportUpload(input: { name: string }): Promise<UploadTarget> {
  if (!(await coordinator())) return { ok: false, message: 'You cannot import a backlog.' };
  const name = input.name.trim();
  if (!/\.(xlsx|csv)$/i.test(name)) {
    return {
      ok: false,
      message: 'Excel (.xlsx) or CSV, please. Save other formats as one of those.',
    };
  }
  const signed = await signedUploadFor(`imports/${randomUUID()}/${name.slice(-120)}`);
  if (!signed.ok) return { ok: false, message: 'The upload could not be started.' };
  return { ok: true, path: signed.path, token: signed.token };
}

export interface WorkbookSheets {
  ok: boolean;
  hash?: string;
  sheets?: Array<{ name: string; path: string }>;
  message?: string;
}

/** What the uploaded file turned out to be, and what it offers to read. */
export async function readImportWorkbook(input: {
  path: string;
  name: string;
}): Promise<WorkbookSheets> {
  if (!(await coordinator())) return { ok: false, message: 'You cannot import a backlog.' };
  const inspected = await inspectUpload(input.path, input.name);
  if (!inspected.ok) {
    const reasons = {
      missing: 'That file did not arrive. Try the upload again.',
      too_large: 'That file is larger than 10 MB. Split the backlog or remove its photographs.',
      type_mismatch: 'That file is not the kind of file its name says it is.',
    } as const;
    return { ok: false, message: reasons[inspected.reason] };
  }
  const readable = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
  ];
  if (!readable.includes(inspected.type)) {
    await removeObject(input.path);
    return { ok: false, message: 'Excel (.xlsx) or CSV, please.' };
  }
  if (input.name.toLowerCase().endsWith('.csv')) {
    return { ok: true, hash: inspected.sha256, sheets: [{ name: input.name, path: 'csv' }] };
  }
  const bytes = await readObject(input.path);
  if (!bytes) return { ok: false, message: 'That file could not be read.' };
  const listed = listSheets(bytes);
  if (!listed.ok) return { ok: false, message: listed.message };
  return { ok: true, hash: inspected.sha256, sheets: listed.sheets };
}

export interface SheetPreview {
  ok: boolean;
  headers?: string[];
  rows?: Array<{ line: number; cells: string[] }>;
  total?: number;
  message?: string;
}

async function cellsOf(
  path: string,
  sheetPath: string,
  name: string,
): Promise<{ rows: TypedRow[] } | { message: string }> {
  const bytes = await readObject(path);
  if (!bytes) return { message: 'That file is no longer in the store. Upload it again.' };
  if (sheetPath === 'csv' || name.toLowerCase().endsWith('.csv')) {
    return {
      rows: parseCsv(bytes.toString('utf8')).map((record) => ({
        line: record.line,
        cells: record.cells.map((text): TypedCell => ({
          text,
          kind: text.trim() === '' ? 'blank' : 'text',
        })),
      })),
    };
  }
  const read = readSheetCells(bytes, sheetPath);
  return read.ok ? { rows: read.rows } : { message: read.message };
}

/** The header row as chosen, and enough rows under it to check the reading. */
export async function previewImportSheet(input: {
  path: string;
  name: string;
  sheetPath: string;
  headerLine: number;
}): Promise<SheetPreview> {
  if (!(await coordinator())) return { ok: false, message: 'You cannot import a backlog.' };
  const read = await cellsOf(input.path, input.sheetPath, input.name);
  if ('message' in read) return { ok: false, message: read.message };

  const header = read.rows.find((row) => row.line === input.headerLine);
  if (!header) return { ok: false, message: `Row ${input.headerLine} is empty in this sheet.` };
  const headers = header.cells.map((cell, index) => cell.text.trim() || `Column ${index + 1}`);
  const body = read.rows.filter((row) => row.line > input.headerLine);
  return {
    ok: true,
    headers,
    total: body.filter((row) => row.cells.some((cell) => cell.text.trim() !== '')).length,
    rows: body.slice(0, 8).map((row) => ({
      line: row.line,
      cells: headers.map((_, index) => row.cells[index]?.text ?? ''),
    })),
  };
}

export interface ImportOutcome {
  ok: boolean;
  batchId?: string;
  message?: string;
}

/**
 * Read the whole sheet under the chosen mapping, and stage it.
 *
 * A date cell is a date already. Text is read under the convention chosen for
 * this file and no other way: a row whose date cannot be read that way says
 * so rather than being given today's.
 */
export async function createImport(input: {
  path: string;
  name: string;
  hash: string;
  sheetName: string;
  sheetPath: string;
  headerLine: number;
  register: string;
  convention: DateConvention;
  mapping: Partial<Record<ImportField, number>>;
}): Promise<ImportOutcome> {
  if (!(await coordinator())) return { ok: false, message: 'You cannot import a backlog.' };
  const read = await cellsOf(input.path, input.sheetPath, input.name);
  if ('message' in read) return { ok: false, message: read.message };

  const header = read.rows.find((row) => row.line === input.headerLine);
  const headers = (header?.cells ?? []).map(
    (cell, index) => cell.text.trim() || `Column ${index + 1}`,
  );
  const body = read.rows.filter((row) => row.line > input.headerLine);

  const staged = body.map((row) => {
    const raw: Record<string, string> = {};
    headers.forEach((name, index) => {
      const text = row.cells[index]?.text ?? '';
      if (text.trim() !== '') raw[name] = text;
    });

    const mapped: Record<string, string> = {};
    for (const field of IMPORT_FIELD_KEYS) {
      const column = input.mapping[field];
      if (column === undefined) continue;
      const cell = row.cells[column];
      if (!cell || cell.text.trim() === '') continue;
      if (field === 'due_on' || field === 'reported_on') {
        const date = readImportedDate(cell.text, cell.kind, input.convention);
        if (!date) continue;
        // An unreadable date is passed on as it was written, so the row is
        // reported rather than quietly given a date it never had.
        mapped[field] = 'iso' in date ? date.iso : cell.text.trim();
      } else {
        mapped[field] = cell.text.trim();
      }
    }
    return { line: row.line, raw, mapped };
  });

  const supabase = await createSupabaseServerClient();
  const { data: started, error: startError } = await supabase.rpc('esh_import_start', {
    p_source_name: input.name,
    p_source_hash: input.hash,
    p_source_register: input.register,
    p_storage_path: input.path,
    p_sheet_name: input.sheetName,
    p_sheet_path: input.sheetPath,
    p_header_line: input.headerLine,
    p_date_convention: input.convention,
    p_mapping: input.mapping,
    p_source_rows: staged.length,
  });
  if (startError) {
    console.error(`[createImport] ${startError.code ?? 'unknown'}: ${startError.message}`);
    return { ok: false, message: 'The import could not be started.' };
  }
  const start = (started ?? {}) as { ok?: boolean; code?: string; batch_id?: string };
  if (!start.ok) {
    return {
      ok: false,
      batchId: start.batch_id,
      message:
        start.code === 'already_imported'
          ? 'This exact file has been imported already; open that import instead.'
          : 'The import could not be started.',
    };
  }

  const { data: stagedResult, error: stageError } = await supabase.rpc('esh_import_stage', {
    p_batch_id: start.batch_id!,
    p_rows: staged,
  });
  if (stageError) {
    console.error(`[createImport] ${stageError.code ?? 'unknown'}: ${stageError.message}`);
    return { ok: false, message: 'The rows could not be staged.' };
  }
  if (!((stagedResult ?? {}) as { ok?: boolean }).ok) {
    return { ok: false, message: 'The rows could not be staged.' };
  }
  revalidatePath('/findings/import');
  return { ok: true, batchId: start.batch_id };
}

/** The decisions a person makes about staged rows, each one audited. */
async function call(
  procedure:
    | 'esh_import_set_owner_email'
    | 'esh_import_amend_row'
    | 'esh_import_resolve_row'
    | 'esh_import_acknowledge_evidence'
    | 'esh_import_release'
    | 'esh_import_discard',
  args: Record<string, unknown>,
  batchId: string,
): Promise<{ ok: boolean; code?: string }> {
  if (!(await coordinator())) return { ok: false, code: 'not_permitted' };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(procedure, args as never);
  if (error) {
    console.error(`[${procedure}] ${error.code ?? 'unknown'}: ${error.message}`);
    return { ok: false };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (result.ok) {
    revalidatePath(`/findings/import/${batchId}`);
    revalidatePath('/findings/import');
  }
  return { ok: Boolean(result.ok), code: result.code };
}

export async function decideOwnerEmail(input: {
  batchId: string;
  sourceName: string;
  email: string | null;
}) {
  return call(
    'esh_import_set_owner_email',
    { p_batch_id: input.batchId, p_source_name: input.sourceName, p_email: input.email },
    input.batchId,
  );
}

export async function amendImportRow(input: {
  batchId: string;
  rowId: string;
  patch: Record<string, string>;
}) {
  return call(
    'esh_import_amend_row',
    { p_row_id: input.rowId, p_patch: input.patch },
    input.batchId,
  );
}

export async function resolveImportRow(input: {
  batchId: string;
  rowId: string;
  resolution: 'skip' | 'link' | 'update';
  note: string;
}) {
  return call(
    'esh_import_resolve_row',
    { p_row_id: input.rowId, p_resolution: input.resolution, p_note: input.note },
    input.batchId,
  );
}

export async function acknowledgeImportEvidence(input: {
  batchId: string;
  referenceId: string;
  note: string;
}) {
  return call(
    'esh_import_acknowledge_evidence',
    { p_ref_id: input.referenceId, p_note: input.note },
    input.batchId,
  );
}

export async function releaseImport(input: {
  batchId: string;
  rowIds: string[];
  followupFrom: string | null;
  clientKey: string;
}) {
  return call(
    'esh_import_release',
    {
      p_batch_id: input.batchId,
      p_row_ids: input.rowIds,
      p_followup_from: input.followupFrom,
      p_idempotency_key: `import-release:${input.batchId}:${input.clientKey}`,
    },
    input.batchId,
  );
}

export async function discardImport(input: { batchId: string; reason: string }) {
  return call(
    'esh_import_discard',
    { p_batch_id: input.batchId, p_reason: input.reason },
    input.batchId,
  );
}

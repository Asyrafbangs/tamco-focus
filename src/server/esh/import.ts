import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Reading a staged backlog (v205, §38).
 *
 * Staging is deliberately outside every live count: these rows are not
 * findings, so they are read from their own tables and never joined into the
 * register, the overview or anybody's timers.
 */

export interface ImportBatchSummary {
  id: string;
  sourceName: string;
  sourceRegister: string;
  sheetName: string | null;
  state: string;
  sourceRows: number;
  createdAt: string;
  releasedAt: string | null;
  ready: number;
  blocked: number;
  released: number;
}

export interface ImportRowRecord {
  id: string;
  line: number;
  raw: Record<string, string>;
  mapped: Record<string, string>;
  reference: string | null;
  outcome: string;
  problems: string[];
  needsAssignment: boolean;
  duplicateOf: string | null;
  duplicateReference: string | null;
  resolution: string | null;
  findingReference: string | null;
}

export interface ImportBatchDetail {
  id: string;
  sourceName: string;
  sourceRegister: string;
  sheetName: string | null;
  headerLine: number | null;
  dateConvention: string;
  state: string;
  sourceRows: number;
  ignoredRows: number;
  createdAt: string;
  releasedAt: string | null;
  rows: ImportRowRecord[];
  owners: Array<{ sourceName: string; email: string | null }>;
  evidence: Array<{
    id: string;
    kind: string;
    detail: string;
    state: string;
    line: number | null;
  }>;
  counts: Record<string, number>;
  /** Ready rows whose target date has already passed, counted on the server. */
  readyOverdue: number;
  /**
   * v224 — the owners this batch has still not been able to tell, and the
   * ones it has. A backlog of ninety-four releases ninety-four findings and
   * then says nothing, because under a restricted rollout every summary is
   * held; the screen has to say so where the release happened.
   */
  heldNotifications: number;
  queuedNotifications: number;
}

export async function listImportBatches(): Promise<ImportBatchSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('esh_import_batches')
    .select(
      'id, source_name, source_register, sheet_name, state, source_rows, created_at, released_at',
    )
    .neq('state', 'discarded')
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) {
    console.error(`[listImportBatches] ${error.code ?? 'unknown'}: ${error.message}`);
    return [];
  }
  const batches = data ?? [];
  if (batches.length === 0) return [];

  const { data: rows } = await supabase
    .from('esh_import_rows')
    .select('batch_id, outcome')
    .in(
      'batch_id',
      batches.map((batch) => batch.id),
    );
  const tally = new Map<string, Record<string, number>>();
  for (const row of rows ?? []) {
    const counts = tally.get(String(row.batch_id)) ?? {};
    counts[String(row.outcome)] = (counts[String(row.outcome)] ?? 0) + 1;
    tally.set(String(row.batch_id), counts);
  }

  return batches.map((batch) => {
    const counts = tally.get(String(batch.id)) ?? {};
    return {
      id: String(batch.id),
      sourceName: String(batch.source_name),
      sourceRegister: String(batch.source_register),
      sheetName: batch.sheet_name ? String(batch.sheet_name) : null,
      state: String(batch.state),
      sourceRows: Number(batch.source_rows ?? 0),
      createdAt: String(batch.created_at),
      releasedAt: batch.released_at ? String(batch.released_at) : null,
      ready: counts.ready ?? 0,
      blocked: counts.blocked ?? 0,
      released: counts.released ?? 0,
    };
  });
}

export async function loadImportBatch(batchId: string): Promise<ImportBatchDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: batch, error } = await supabase
    .from('esh_import_batches')
    .select(
      'id, source_name, source_register, sheet_name, header_line, date_convention, state, source_rows, ignored_rows, created_at, released_at',
    )
    .eq('id', batchId)
    .maybeSingle();
  if (error || !batch) return null;

  const [rowsResult, ownersResult, evidenceResult, noticesResult] = await Promise.all([
    supabase
      .from('esh_import_rows')
      .select(
        'id, source_line, raw, mapped, source_reference, outcome, problems, needs_assignment, duplicate_of_finding_id, resolution, finding_id',
      )
      .eq('batch_id', batchId)
      .order('source_line'),
    supabase
      .from('esh_import_owner_emails')
      .select('source_name, canonical_email')
      .eq('batch_id', batchId)
      .order('source_name'),
    supabase
      .from('esh_import_evidence_refs')
      .select('id, kind, detail, state, row_id')
      .eq('batch_id', batchId)
      .order('created_at'),
    supabase.from('esh_notification_outbox').select('state').eq('import_batch_id', batchId),
  ]);
  const notices = noticesResult.data ?? [];

  const rows = rowsResult.data ?? [];
  const findingIds = rows
    .flatMap((row) => [row.duplicate_of_finding_id, row.finding_id])
    .filter((id): id is string => Boolean(id));
  const references = new Map<string, string>();
  if (findingIds.length > 0) {
    const { data: findings } = await supabase
      .from('esh_findings')
      .select('id, reference')
      .in('id', findingIds);
    for (const finding of findings ?? []) {
      references.set(String(finding.id), String(finding.reference));
    }
  }
  const lineOf = new Map(rows.map((row) => [String(row.id), Number(row.source_line)]));

  const counts: Record<string, number> = {};
  for (const row of rows) counts[String(row.outcome)] = (counts[String(row.outcome)] ?? 0) + 1;
  const today = new Date().toISOString().slice(0, 10);
  const readyOverdue = rows.filter((row) => {
    const due = ((row.mapped ?? {}) as Record<string, string>).due_on;
    return String(row.outcome) === 'ready' && due !== undefined && due < today;
  }).length;

  return {
    id: String(batch.id),
    sourceName: String(batch.source_name),
    sourceRegister: String(batch.source_register),
    sheetName: batch.sheet_name ? String(batch.sheet_name) : null,
    headerLine: batch.header_line ? Number(batch.header_line) : null,
    dateConvention: String(batch.date_convention),
    state: String(batch.state),
    sourceRows: Number(batch.source_rows ?? 0),
    ignoredRows: Number(batch.ignored_rows ?? 0),
    createdAt: String(batch.created_at),
    releasedAt: batch.released_at ? String(batch.released_at) : null,
    counts,
    readyOverdue,
    heldNotifications: notices.filter((notice) => String(notice.state) === 'held_rollout').length,
    queuedNotifications: notices.filter((notice) =>
      ['queued', 'processing', 'provider_accepted'].includes(String(notice.state)),
    ).length,
    rows: rows.map((row) => ({
      id: String(row.id),
      line: Number(row.source_line),
      raw: (row.raw ?? {}) as Record<string, string>,
      mapped: (row.mapped ?? {}) as Record<string, string>,
      reference: row.source_reference ? String(row.source_reference) : null,
      outcome: String(row.outcome),
      problems: (row.problems ?? []) as string[],
      needsAssignment: Boolean(row.needs_assignment),
      duplicateOf: row.duplicate_of_finding_id ? String(row.duplicate_of_finding_id) : null,
      duplicateReference: row.duplicate_of_finding_id
        ? (references.get(String(row.duplicate_of_finding_id)) ?? null)
        : null,
      resolution: row.resolution ? String(row.resolution) : null,
      findingReference: row.finding_id ? (references.get(String(row.finding_id)) ?? null) : null,
    })),
    owners: (ownersResult.data ?? []).map((owner) => ({
      sourceName: String(owner.source_name),
      email: owner.canonical_email ? String(owner.canonical_email) : null,
    })),
    evidence: (evidenceResult.data ?? []).map((reference) => ({
      id: String(reference.id),
      kind: String(reference.kind),
      detail: String(reference.detail),
      state: String(reference.state),
      line: reference.row_id ? (lineOf.get(String(reference.row_id)) ?? null) : null,
    })),
  };
}

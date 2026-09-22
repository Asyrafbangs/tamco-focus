'use client';

import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import {
  DATE_CONVENTIONS,
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  suggestMapping,
  type DateConvention,
  type ImportField,
} from '@/domain/esh-import';
import { publicEnv } from '@/lib/env';
import {
  createImport,
  previewImportSheet,
  readImportWorkbook,
  startImportUpload,
} from '@/server/esh/import-actions';

/**
 * Upload → sheet → columns → staged (v205, §38.1).
 *
 * Four questions, in the order somebody with the file open can answer them,
 * and none of them guessed. Which sheet, because a backlog workbook usually
 * has several. Which row the headings are on, because it is rarely the first.
 * How its dates are written, because 04/05/2026 is two different days. And
 * which column means what, suggested from the headings but never applied
 * without being looked at.
 */

const BUCKET = 'finding-evidence';

type Step = 'file' | 'sheet' | 'map';

interface Sheet {
  name: string;
  path: string;
}

export function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('file');
  const [busy, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; path: string; hash: string } | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [headerLine, setHeaderLine] = useState(1);
  const [convention, setConvention] = useState<DateConvention>('dmy');
  const [register, setRegister] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<Array<{ line: number; cells: string[] }>>([]);
  const [total, setTotal] = useState(0);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const input = useRef<HTMLInputElement>(null);

  function chooseFile(chosen: File) {
    setProblem(null);
    startTransition(async () => {
      const started = await startImportUpload({ name: chosen.name });
      if (!started.ok || !started.path || !started.token) {
        setProblem(started.message ?? 'The upload could not be started.');
        return;
      }
      const storage = createClient(
        publicEnv.NEXT_PUBLIC_SUPABASE_URL,
        publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      ).storage.from(BUCKET);
      const sent = await storage.uploadToSignedUrl(started.path, started.token, chosen);
      if (sent.error) {
        setProblem('The upload did not finish. Check the connection and try again.');
        return;
      }
      const read = await readImportWorkbook({ path: started.path, name: chosen.name });
      if (!read.ok || !read.sheets || !read.hash) {
        setProblem(read.message ?? 'That file could not be read.');
        return;
      }
      setFile({ name: chosen.name, path: started.path, hash: read.hash });
      setSheets(read.sheets);
      setSheet(read.sheets[0] ?? null);
      setRegister((current) => current || chosen.name.replace(/\.(xlsx|csv)$/i, ''));
      setStep('sheet');
    });
  }

  function readSheet() {
    if (!file || !sheet) return;
    setProblem(null);
    startTransition(async () => {
      const preview = await previewImportSheet({
        path: file.path,
        name: file.name,
        sheetPath: sheet.path,
        headerLine,
      });
      if (!preview.ok || !preview.headers) {
        setProblem(preview.message ?? 'That sheet could not be read.');
        return;
      }
      setHeaders(preview.headers);
      setSample(preview.rows ?? []);
      setTotal(preview.total ?? 0);
      setMapping(suggestMapping(preview.headers));
      setStep('map');
    });
  }

  function stage() {
    if (!file || !sheet) return;
    setProblem(null);
    startTransition(async () => {
      const created = await createImport({
        path: file.path,
        name: file.name,
        hash: file.hash,
        sheetName: sheet.name,
        sheetPath: sheet.path,
        headerLine,
        register: register.trim(),
        convention,
        mapping,
      });
      if (!created.ok || !created.batchId) {
        setProblem(created.message ?? 'The import could not be staged.');
        if (created.batchId) router.push(`/findings/import/${created.batchId}`);
        return;
      }
      router.push(`/findings/import/${created.batchId}`);
    });
  }

  const missing = REQUIRED_FIELDS.filter((field) => mapping[field] === undefined);

  return (
    <section className="esh-import-wizard card" aria-labelledby="import-wizard-title">
      <div className="esh-section-heading">
        <div>
          <h2 id="import-wizard-title">New import</h2>
          <p>
            Excel or CSV. Nothing is created and nobody is told until you release the rows you have
            looked at.
          </p>
        </div>
      </div>

      {problem && (
        <div className="notice error" role="alert">
          <p>{problem}</p>
        </div>
      )}

      {step === 'file' && (
        <div className="esh-import-step">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv"
            aria-label="Backlog file"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) chooseFile(chosen);
            }}
          />
          <p className="hint">
            Up to 10 MB. Formulas are read as their last saved value and never run.
          </p>
        </div>
      )}

      {step === 'sheet' && file && (
        <div className="esh-import-step form-grid two">
          <label className="esh-field">
            <span>Sheet</span>
            <select
              value={sheet?.path ?? ''}
              onChange={(event) =>
                setSheet(sheets.find((option) => option.path === event.target.value) ?? null)
              }
            >
              {sheets.map((option) => (
                <option key={option.path} value={option.path}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="esh-field">
            <span>Heading row</span>
            <input
              type="number"
              min={1}
              max={500}
              value={headerLine}
              onChange={(event) => setHeaderLine(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <label className="esh-field">
            <span>Dates are written</span>
            <select
              value={convention}
              onChange={(event) => setConvention(event.target.value as DateConvention)}
            >
              {DATE_CONVENTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label} — {option.example}
                </option>
              ))}
            </select>
          </label>
          <label className="esh-field">
            <span>Source register</span>
            <input
              value={register}
              maxLength={80}
              onChange={(event) => setRegister(event.target.value)}
              placeholder="ESH backlog 2026"
            />
            <small>The register these finding numbers belong to.</small>
          </label>
          <div className="esh-import-actions">
            <button type="button" className="btn" onClick={readSheet} disabled={busy || !sheet}>
              Read this sheet
            </button>
          </div>
        </div>
      )}

      {step === 'map' && (
        <div className="esh-import-step">
          <p className="hint">
            {total} row{total === 1 ? '' : 's'} under row {headerLine} of {sheet?.name}. Point each
            column at what it means; anything left unset is not imported.
          </p>
          <div className="esh-import-map">
            {IMPORT_FIELDS.map((field) => {
              const column = mapping[field.key];
              const example = column === undefined ? '' : (sample[0]?.cells[column] ?? '');
              return (
                <div className="esh-field" key={field.key}>
                  {/* The label names the destination and nothing else, so it
                      reads as one thing and can be pointed at as one thing. */}
                  <label htmlFor={`map-${field.key}`}>{field.label}</label>
                  <select
                    id={`map-${field.key}`}
                    aria-describedby={`map-${field.key}-hint`}
                    value={column === undefined ? '' : String(column)}
                    onChange={(event) =>
                      setMapping((current) => {
                        const next = { ...current };
                        if (event.target.value === '') delete next[field.key];
                        else next[field.key] = Number(event.target.value);
                        return next;
                      })
                    }
                  >
                    <option value="">Not in this file</option>
                    {headers.map((header, index) => (
                      <option key={`${header}-${index}`} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                  <small id={`map-${field.key}-hint`}>
                    {/* Said in words rather than with an asterisk: a row
                        missing one of these is staged and held back. */}
                    {REQUIRED_FIELDS.includes(field.key) ? 'Needed before release. ' : ''}
                    {example ? `First row: ${example}` : field.hint}
                  </small>
                </div>
              );
            })}
          </div>
          {missing.length > 0 && (
            <p className="notice neutral" role="status">
              Rows without{' '}
              {missing
                .map((field) => IMPORT_FIELDS.find((option) => option.key === field)?.label)
                .join(', ')}{' '}
              will be staged, and held back until somebody fills that in.
            </p>
          )}
          <div className="esh-import-actions">
            <button type="button" className="btn ghost" onClick={() => setStep('sheet')}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              onClick={stage}
              disabled={busy || register.trim().length === 0}
            >
              Stage {total} row{total === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

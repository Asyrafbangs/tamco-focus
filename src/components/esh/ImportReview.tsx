'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';

import {
  blocksRelease,
  importActionProblem,
  importProblem,
  outcomeLabel,
  outcomeTone,
} from '@/domain/esh-import';
import type { ImportBatchDetail, ImportRowRecord } from '@/server/esh/import';
import { releaseHeldNotifications } from '@/server/esh/rollout-actions';
import {
  acknowledgeImportEvidence,
  amendImportRow,
  decideOwnerEmail,
  discardImport,
  releaseImport,
  resolveImportRow,
} from '@/server/esh/import-actions';

/**
 * The staged backlog, and the decisions that make it releasable (v205, §38.2).
 *
 * Every source row is here with what became of it, including the ones that are
 * not ready: a row nobody can see is a row that quietly goes missing. Release
 * takes only the rows that are ready and only the ones ticked, and says what it
 * is about to do before it does it.
 */

const FIELD_LABELS: Record<string, string> = {
  action: 'Corrective action',
  department: 'Department',
  owner_email: 'Owner email',
  due_on: 'Target date',
  reported_on: 'Reported date',
  priority: 'Priority',
  description: 'Description',
  location: 'Location',
  risk: 'Risk',
};

function Amend({
  row,
  batchId,
  onDone,
}: {
  row: ImportRowRecord;
  batchId: string;
  onDone: () => void;
}) {
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const fields = row.problems
    .filter(blocksRelease)
    .map((code) => code.replace(/_(missing|unknown|invalid|unreviewed|unreadable)$/, ''))
    .map((field) => (field === 'owner' ? 'owner_email' : field))
    .map((field) => (field === 'due' ? 'due_on' : field))
    .map((field) => (field === 'reported' ? 'reported_on' : field))
    .filter((field, index, all) => all.indexOf(field) === index && field in FIELD_LABELS);
  const values = useRef<Record<string, string>>({});
  if (fields.length === 0) return null;

  return (
    <div className="esh-import-amend">
      {fields.map((field) => (
        <label className="esh-field" key={field}>
          <span>{FIELD_LABELS[field]}</span>
          <input
            defaultValue={row.mapped[field] ?? ''}
            aria-label={`${FIELD_LABELS[field]} for row ${row.line}`}
            onChange={(event) => {
              values.current[field] = event.target.value;
            }}
          />
        </label>
      ))}
      <button
        type="button"
        className="btn small"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const patch = Object.fromEntries(
              Object.entries(values.current).filter(([, value]) => value.trim() !== ''),
            );
            if (Object.keys(patch).length === 0) return;
            const result = await amendImportRow({ batchId, rowId: row.id, patch });
            if (!result.ok) setProblem(importActionProblem(result.code));
            else onDone();
          })
        }
      >
        Save row {row.line}
      </button>
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}

export function ImportReview({ batch }: { batch: ImportBatchDetail }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = useMemo(() => batch.rows.filter((row) => row.outcome === 'ready'), [batch.rows]);
  /**
   * Ready rows are selected unless somebody says otherwise.
   *
   * Holding the selection itself would freeze it at what was ready when the
   * page first rendered: fix the row that was missing its action and it would
   * become ready, sit there unticked, and quietly not be released.
   */
  const [excluded, setExcluded] = useState<string[]>([]);
  const chosen = ready.map((row) => row.id).filter((id) => !excluded.includes(id));
  const [followup, setFollowup] = useState('');
  const clientKey = useRef('');
  const released = batch.rows.filter((row) => row.outcome === 'released');
  const unresolved = batch.evidence.filter((reference) => reference.state === 'unresolved');

  function refresh(message: string) {
    setNotice(message);
    router.refresh();
  }

  return (
    <div className="esh-import-review">
      {problem && (
        <div className="notice error" role="alert">
          <p>{problem}</p>
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          <p>{notice}</p>
        </div>
      )}

      <section className="card esh-import-reconciliation" aria-labelledby="import-reconciliation">
        <h2 id="import-reconciliation">Every row accounted for</h2>
        <dl>
          <div>
            <dt>Rows in the file</dt>
            <dd>{batch.sourceRows}</dd>
          </div>
          <div>
            <dt>Blank, ignored</dt>
            <dd>{batch.counts.ignored ?? 0}</dd>
          </div>
          <div>
            <dt>Ready</dt>
            <dd>{batch.counts.ready ?? 0}</dd>
          </div>
          <div>
            <dt>Needs a decision</dt>
            <dd>{batch.counts.blocked ?? 0}</dd>
          </div>
          <div>
            <dt>Already in the register</dt>
            <dd>{(batch.counts.duplicate ?? 0) + (batch.counts.linked ?? 0)}</dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>{batch.counts.released ?? 0}</dd>
          </div>
        </dl>
      </section>

      {batch.owners.length > 0 && (
        <section className="card" aria-labelledby="import-owners">
          <h2 id="import-owners">Names and addresses</h2>
          <p className="hint">
            A name in a spreadsheet is not an address. One decision covers every row with that name.
          </p>
          <ul className="esh-import-owners">
            {batch.owners.map((owner) => (
              <li key={owner.sourceName}>
                <span>{owner.sourceName}</span>
                <form
                  action={(formData: FormData) =>
                    start(async () => {
                      const result = await decideOwnerEmail({
                        batchId: batch.id,
                        sourceName: owner.sourceName,
                        email: String(formData.get('email') ?? '').trim() || null,
                      });
                      if (!result.ok) setProblem(importActionProblem(result.code));
                      else refresh(`Address saved for ${owner.sourceName}.`);
                    })
                  }
                >
                  <input
                    name="email"
                    type="email"
                    defaultValue={owner.email ?? ''}
                    aria-label={`Email for ${owner.sourceName}`}
                    placeholder="name@tamco.com.my"
                  />
                  <button type="submit" className="btn small" disabled={busy}>
                    Save
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {batch.evidence.length > 0 && (
        <section className="card" aria-labelledby="import-evidence">
          <h2 id="import-evidence">Photographs and links</h2>
          <p className="hint">
            Nothing is fetched from a link in a spreadsheet. Each one has an outcome before release.
          </p>
          <ul className="esh-import-evidence">
            {batch.evidence.map((reference) => (
              <li key={reference.id}>
                <div>
                  <strong>{reference.detail}</strong>
                  <small>
                    {reference.line ? `Row ${reference.line}` : 'Not anchored to a row'} ·{' '}
                    {reference.state === 'unresolved' ? 'No outcome yet' : reference.state}
                  </small>
                </div>
                {reference.state === 'unresolved' && (
                  <form
                    action={(formData: FormData) =>
                      start(async () => {
                        const result = await acknowledgeImportEvidence({
                          batchId: batch.id,
                          referenceId: reference.id,
                          note: String(formData.get('note') ?? ''),
                        });
                        if (!result.ok) setProblem(importActionProblem(result.code));
                        else refresh('Recorded.');
                      })
                    }
                  >
                    <input
                      name="note"
                      aria-label={`What happens to ${reference.detail}`}
                      placeholder="What will happen to it"
                    />
                    <button type="submit" className="btn small ghost" disabled={busy}>
                      Acknowledge
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="import-rows">
        <h2 id="import-rows">The rows</h2>
        <ul className="esh-import-rows">
          {batch.rows.map((row) => (
            <li key={row.id} data-tone={outcomeTone(row.outcome)}>
              <div className="esh-import-row-head">
                <div>
                  <strong>
                    Row {row.line}
                    {row.reference ? ` · ${row.reference}` : ''}
                  </strong>
                  <span>{row.mapped.description ?? '(no description)'}</span>
                </div>
                <span className="statepill">{outcomeLabel(row.outcome)}</span>
              </div>

              {row.outcome === 'released' && row.findingReference && (
                <p className="hint">Released as {row.findingReference}.</p>
              )}

              {row.problems.length > 0 && row.outcome !== 'released' && (
                <ul className="esh-import-problems">
                  {row.problems.map((code) => (
                    <li key={code} data-blocking={blocksRelease(code) ? 'true' : 'false'}>
                      {importProblem(code)}
                    </li>
                  ))}
                </ul>
              )}

              {row.outcome === 'blocked' && (
                <Amend
                  row={row}
                  batchId={batch.id}
                  onDone={() => refresh(`Row ${row.line} saved.`)}
                />
              )}

              {row.duplicateReference && row.outcome !== 'released' && (
                <div className="esh-import-duplicate">
                  <p>
                    {row.reference} is already in the register as {row.duplicateReference}.
                  </p>
                  {row.resolution ? (
                    <p className="hint">Decided: {row.resolution}.</p>
                  ) : (
                    <div className="esh-import-actions">
                      {(['skip', 'link'] as const).map((resolution) => (
                        <button
                          key={resolution}
                          type="button"
                          className="btn small ghost"
                          disabled={busy}
                          onClick={() =>
                            start(async () => {
                              const result = await resolveImportRow({
                                batchId: batch.id,
                                rowId: row.id,
                                resolution,
                                note: '',
                              });
                              if (!result.ok) setProblem(importActionProblem(result.code));
                              else refresh(`Row ${row.line} ${resolution}ped.`);
                            })
                          }
                        >
                          {resolution === 'skip' ? 'Skip this row' : 'Link to the existing finding'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {ready.length > 0 && (
        <section className="card esh-import-release" aria-labelledby="import-release">
          <h2 id="import-release">Release</h2>
          <p>
            {chosen.length} of {ready.length} ready row{ready.length === 1 ? '' : 's'} selected.{' '}
            {batch.readyOverdue > 0 &&
              `${batch.readyOverdue} of them are already past their target date, and stay that way. `}
            Releasing creates the findings, assigns their owners and sends each owner one summary.
          </p>
          <ul className="esh-import-choose">
            {ready.map((row) => (
              <li key={row.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.includes(row.id)}
                    onChange={(event) =>
                      setExcluded((current) =>
                        event.target.checked
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id],
                      )
                    }
                  />
                  <span>
                    Row {row.line}
                    {row.reference ? ` · ${row.reference}` : ''} — {row.mapped.owner_email ?? ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label className="esh-field">
            <span>Start following these up</span>
            <input
              type="datetime-local"
              value={followup}
              onChange={(event) => setFollowup(event.target.value)}
            />
            <small>
              Left empty, reminders and escalation begin at once. A backlog usually wants a day or
              two so owners hear from a person first.
            </small>
          </label>
          <div className="esh-import-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || chosen.length === 0}
              onClick={() =>
                start(async () => {
                  if (!clientKey.current) clientKey.current = window.crypto.randomUUID();
                  const result = await releaseImport({
                    batchId: batch.id,
                    rowIds: chosen,
                    followupFrom: followup ? new Date(followup).toISOString() : null,
                    clientKey: clientKey.current,
                  });
                  if (!result.ok) {
                    setProblem(importActionProblem(result.code));
                    return;
                  }
                  clientKey.current = '';
                  setExcluded([]);
                  refresh(
                    'Released. Each owner has one summary — held for anyone the rollout cannot write to yet.',
                  );
                })
              }
            >
              Release {chosen.length} row{chosen.length === 1 ? '' : 's'}
            </button>
          </div>
          {unresolved.length > 0 && (
            <p className="hint">
              {unresolved.length} photograph or link still has no outcome; release is held until it
              does.
            </p>
          )}
        </section>
      )}

      {/*
        v224 — the backlog says something once, to everybody.

        Releasing already writes one summary per owner rather than one per
        finding, but under a restricted rollout each of those is held, and until
        now the only way to send them was one at a time from ninety-four
        separate findings. Every rule still holds: this calls the same release
        the finding page calls, so an owner whose contact is not cleared is
        still not written to.
      */}
      {batch.heldNotifications > 0 && (
        <section className="card esh-import-notify" aria-labelledby="import-notify">
          <h2 id="import-notify">Tell the owners</h2>
          <p>
            {batch.heldNotifications} owner summar
            {batch.heldNotifications === 1 ? 'y is' : 'ies are'} held because the rollout cannot
            write to those contacts yet. Clear them under Identity and access, or open the rollout
            there, and then release them from here.
            {batch.queuedNotifications > 0 &&
              ` ${batch.queuedNotifications} ${batch.queuedNotifications === 1 ? 'has' : 'have'} already gone out.`}
          </p>
          <div className="esh-import-actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const result = await releaseHeldNotifications({ importBatchId: batch.id });
                  if (!result.ok) setProblem(result.message);
                  else refresh(result.message);
                })
              }
            >
              Notify{' '}
              {batch.heldNotifications === 1
                ? 'the owner'
                : `all ${batch.heldNotifications} owners`}
            </button>
          </div>
          <p className="hint">
            Nothing goes to a contact an administrator has not cleared. The answer says how many
            were held back and which rule held each of them.
          </p>
        </section>
      )}

      {released.length === 0 && batch.state === 'staged' && (
        <section className="card" aria-labelledby="import-discard">
          <h2 id="import-discard">Put this import down</h2>
          <form
            action={(formData: FormData) =>
              start(async () => {
                const result = await discardImport({
                  batchId: batch.id,
                  reason: String(formData.get('reason') ?? ''),
                });
                if (!result.ok) setProblem(importActionProblem(result.code));
                else router.push('/findings/import');
              })
            }
          >
            <label className="esh-field">
              <span>Why</span>
              <input name="reason" placeholder="Wrong sheet" />
            </label>
            <button type="submit" className="btn ghost small" disabled={busy}>
              Discard this import
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

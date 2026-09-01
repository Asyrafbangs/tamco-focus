'use client';

import { useState, useTransition } from 'react';

import { EvidenceDropZone } from '@/components/ui/EvidenceDropZone';
import {
  COMPLETION_EVIDENCE_DEFAULT_INSTRUCTION,
  type CompletionEvidenceRule,
} from '@/domain/types';
import { completeTaskWithEvidence, uploadTaskEvidence } from '@/server/actions/task-actions';

/**
 * One completion form, for Focus work and for routine occurrences.
 *
 * The two used to be different: Focus asked for an optional note in a large
 * textarea and nothing else, and Routine had a bare Complete button with the
 * blockers printed above it. Evidence, in both cases, had to be attached
 * somewhere else first — so the thing a completion is supposed to capture was
 * the one thing the completion did not ask for.
 *
 * The form asks two questions and no more. What proves this was done, and —
 * only if there is something worth saying — what came of it. Everything else
 * the system already knows: who completed it, when, how many steps, how many
 * files. None of it is retyped, and there is no separate "post a completion
 * update" afterwards.
 *
 * Shared rather than duplicated because an employee should learn this once.
 * Two implementations of the same moment drift, and the drift lands on the
 * person who has to remember which screen behaves which way.
 */
export function CompletionForm({
  taskId,
  expectedVersion,
  stepsTotal,
  stepsCompleted,
  stepsNeedingEvidence,
  existingEvidenceCount,
  evidenceRule,
  evidenceInstruction,
  readyToComplete,
  blockers,
  pending = false,
  completeLabel = 'Complete work',
  onCancel,
  onDone,
  onFailed,
}: {
  taskId: string;
  expectedVersion: number;
  stepsTotal: number;
  stepsCompleted: number;
  /** Steps whose own evidence rule is not yet satisfied. */
  stepsNeedingEvidence: number;
  /** Evidence already on this work, from steps or from an earlier attempt. */
  existingEvidenceCount: number;
  /** What this work requires as proof, decided when it was set up. */
  evidenceRule: CompletionEvidenceRule;
  /** What to attach, in the words of whoever set the rule. */
  evidenceInstruction: string | null;
  readyToComplete: boolean;
  /** Why it cannot be completed yet, in words somebody can act on. */
  blockers: string[];
  pending?: boolean;
  completeLabel?: string;
  onCancel: () => void;
  onDone: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const [busy, startTransition] = useTransition();
  const [noteOpen, setNoteOpen] = useState(false);
  const [staged, setStaged] = useState(0);
  const [note, setNote] = useState('');
  const working = pending || busy;
  const stepsOutstanding = stepsTotal - stepsCompleted;

  /*
   * Whether the evidence rule is satisfied, counted the same way the database
   * counts it.
   *
   * Evidence already on the work counts, wherever it arrived: a step's proof
   * is proof. And under `file_or_note` a written result counts, because the
   * work sometimes genuinely has no artefact - a decision, a conversation, a
   * phone call - and demanding a file anyway is what produces a blank document
   * uploaded to get past the gate.
   */
  const evidenceSatisfied =
    evidenceRule === 'optional' ||
    existingEvidenceCount > 0 ||
    staged > 0 ||
    (evidenceRule === 'file_or_note' && note.trim().length > 0);

  const canComplete = readyToComplete && evidenceSatisfied;
  const outstanding = [
    ...blockers,
    ...(evidenceSatisfied
      ? []
      : [
          evidenceRule === 'file'
            ? 'a file is required'
            : 'a file or a completion note is required',
        ]),
  ];

  return (
    <form
      className="completion-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set('taskId', taskId);
        data.set('expectedVersion', String(expectedVersion));
        data.set('idempotencyKey', crypto.randomUUID());
        startTransition(async () => {
          const result = await completeTaskWithEvidence(data);
          if (result.ok) onDone('Completion recorded.');
          else onFailed(result.message);
        });
      }}
    >
      <div className="modal-body">
        {/*
          What is done and what is outstanding, before anything is pressed.
          A disabled button with no explanation makes somebody hunt for the
          reason, and somebody standing in a plant with a phone cannot hover a
          tooltip to find it.
        */}
        {(stepsTotal > 0 || stepsNeedingEvidence > 0 || evidenceRule !== 'optional') && (
          <ul className="completion-requirements">
            {stepsTotal > 0 && (
              <li className={stepsOutstanding === 0 ? 'met' : undefined}>
                <span aria-hidden="true">{stepsOutstanding === 0 ? '✓' : '○'}</span>
                {stepsOutstanding === 0
                  ? `All ${stepsTotal} steps complete`
                  : `${stepsCompleted} of ${stepsTotal} steps complete`}
              </li>
            )}
            {stepsNeedingEvidence > 0 && (
              <li>
                <span aria-hidden="true">○</span>
                {stepsNeedingEvidence} step{stepsNeedingEvidence === 1 ? '' : 's'} still need
                evidence attached
              </li>
            )}
            {evidenceRule !== 'optional' && (
              <li className={evidenceSatisfied ? 'met' : undefined}>
                <span aria-hidden="true">{evidenceSatisfied ? '✓' : '○'}</span>
                {evidenceSatisfied
                  ? 'Evidence attached'
                  : evidenceRule === 'file'
                    ? 'Evidence required'
                    : 'Evidence or a completion note required'}
              </li>
            )}
          </ul>
        )}

        {/*
          What to attach, from whoever set the rule up. A requirement without an
          instruction makes somebody guess what would satisfy it, and a guess
          is how a photograph of a car park ends up filed as an inspection.
        */}
        {evidenceRule !== 'optional' && (
          <p className="completion-instruction">
            {evidenceInstruction ?? COMPLETION_EVIDENCE_DEFAULT_INSTRUCTION[evidenceRule]}
          </p>
        )}

        {/*
          Evidence already on the work counts, and is said so plainly.

          Steps often carry their own proof. Asking somebody to upload the same
          measurement sheet a second time to satisfy a completion gate is
          exactly how a gate teaches people to attach junk: a blank document, a
          duplicate photo, whatever passes.
        */}
        {existingEvidenceCount > 0 && (
          <p className="completion-existing">
            <span aria-hidden="true">✓</span> {existingEvidenceCount} file
            {existingEvidenceCount === 1 ? '' : 's'} already attached to this work
          </p>
        )}

        <div className="field">
          <span className="completion-label">Evidence</span>
          {/*
            Uploaded as they arrive rather than posted with the form, so a file
            that fails names itself and can be retried on its own. They attach
            to the work, which is a state the product already has: evidence on
            an open task, which the completion gate already counts.
          */}
          <EvidenceDropZone
            onCountChange={setStaged}
            uploadTo={{ taskId, upload: uploadTaskEvidence }}
          />
        </div>

        {/*
          Collapsed. Most completions have nothing worth recording, and a large
          empty box invites "Done." — which costs the reader a line and tells
          them nothing. Offered, not requested.
        */}
        {noteOpen ? (
          <div className="field">
            <label htmlFor={`completion-note-${taskId}`}>
              Completion note <span className="field-optional">Optional</span>
            </label>
            <textarea
              id={`completion-note-${taskId}`}
              name="completionNote"
              rows={3}
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What was achieved, or anything useful for future reference."
            />
          </div>
        ) : (
          <button
            type="button"
            className="completion-note-toggle"
            onClick={() => setNoteOpen(true)}
          >
            + Add completion note <span className="field-optional">Optional</span>
          </button>
        )}

        {!canComplete && outstanding.length > 0 && (
          <p className="completion-blockers" role="status">
            {outstanding.join(' · ')}
          </p>
        )}
      </div>

      <div className="modal-foot">
        <button type="button" className="btn" onClick={onCancel} disabled={working}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn primary"
          disabled={working || !canComplete}
          aria-busy={working}
        >
          {working
            ? 'Completing…'
            : canComplete
              ? completeLabel
              : `${outstanding.length} requirement${outstanding.length === 1 ? '' : 's'} remaining`}
        </button>
      </div>
    </form>
  );
}

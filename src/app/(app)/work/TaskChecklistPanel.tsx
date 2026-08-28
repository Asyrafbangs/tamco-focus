'use client';

import { useEffect, useRef, useState } from 'react';

import { Modal } from '@/components/ui/Modal';
import { localDateString } from '@/domain/duration';
import type { TaskDetailChecklistItem } from '@/server/queries';

export interface ChecklistAssignee {
  id: string;
  name: string;
  isPrimaryOwner: boolean;
}

export interface NewChecklistStep {
  action: string;
  assignedTo: string;
  evidenceRule: 'not_required' | 'optional' | 'required';
  dueDate: string | null;
  dependsOnItemId: string | null;
}

/** An edit carries the same five fields, plus which step they belong to. */
export interface EditChecklistStep extends NewChecklistStep {
  itemId: string;
}

/**
 * The form's own shape: every field a string, because that is what an input
 * holds. `''` means "none", and is converted to null at one boundary, so Add
 * and Edit cannot come to disagree about what an empty date means.
 */
interface StepDraft {
  action: string;
  assignedTo: string;
  evidenceRule: NewChecklistStep['evidenceRule'];
  dueDate: string;
  dependsOnItemId: string;
}

function draftToStep(draft: StepDraft, fallbackAssignee: string): NewChecklistStep {
  return {
    action: draft.action.trim(),
    assignedTo: draft.assignedTo || fallbackAssignee,
    evidenceRule: draft.evidenceRule,
    dueDate: draft.dueDate || null,
    dependsOnItemId: draft.dependsOnItemId || null,
  };
}

function formatMoment(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

const EVIDENCE_LABEL: Record<TaskDetailChecklistItem['evidenceRule'], string> = {
  not_required: 'No evidence required',
  optional: 'Evidence optional',
  required: 'Evidence required',
};

/**
 * The fields of a step, shared by Add and Edit (v45 sections 16-22).
 *
 * Written once because both forms ask exactly the same five questions. Two
 * copies would drift: one would gain a rule or lose an option, and a step
 * created one way would no longer be editable back to the same state.
 */
function StepFields({
  idPrefix,
  draft,
  onChange,
  assignees,
  prerequisiteOptions,
}: {
  idPrefix: string;
  draft: StepDraft;
  onChange: (next: StepDraft) => void;
  assignees: ChecklistAssignee[];
  prerequisiteOptions: TaskDetailChecklistItem[];
}) {
  return (
    <>
      <div className="field full">
        <label htmlFor={`${idPrefix}-action`}>What needs to be done?</label>
        <input
          id={`${idPrefix}-action`}
          value={draft.action}
          onChange={(event) => onChange({ ...draft, action: event.target.value })}
          placeholder="Example: Obtain contractor quotation"
          maxLength={300}
          required
        />
      </div>

      <div className="field full">
        <label htmlFor={`${idPrefix}-assignee`}>Assigned to</label>
        <select
          id={`${idPrefix}-assignee`}
          value={draft.assignedTo}
          onChange={(event) => onChange({ ...draft, assignedTo: event.target.value })}
        >
          {assignees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {person.isPrimaryOwner ? ' — Primary Owner' : ''}
            </option>
          ))}
        </select>
        {/* v45 section 3 — describe what happens to the person, not what
            happens to the data. "Contribution" is our word, not theirs. */}
        <small>
          Assign this step to the person responsible for completing it. Assigning another person
          adds it to their Shared work.
        </small>
      </div>

      <details className="field full checklist-more-options">
        <summary>More options</summary>

        <div className="field">
          <label htmlFor={`${idPrefix}-evidence`}>Evidence</label>
          <select
            id={`${idPrefix}-evidence`}
            value={draft.evidenceRule}
            onChange={(event) =>
              onChange({
                ...draft,
                evidenceRule: event.target.value as NewChecklistStep['evidenceRule'],
              })
            }
          >
            <option value="not_required">Not required</option>
            <option value="optional">Optional</option>
            <option value="required">Required</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-due`}>Item due date</label>
          <input
            id={`${idPrefix}-due`}
            type="date"
            value={draft.dueDate}
            onChange={(event) => onChange({ ...draft, dueDate: event.target.value })}
          />
          <small>Only if it differs from the task&rsquo;s own date.</small>
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-prerequisite`}>Starts after</label>
          <select
            id={`${idPrefix}-prerequisite`}
            value={draft.dependsOnItemId}
            onChange={(event) => onChange({ ...draft, dependsOnItemId: event.target.value })}
          >
            <option value="">No prerequisite</option>
            {prerequisiteOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.action}
              </option>
            ))}
          </select>
        </div>
      </details>
    </>
  );
}

/**
 * The per-step overflow menu (v45 section 24).
 *
 * Edit and Remove are deliberately not two more buttons in the row. The row
 * already carries Complete, which people press dozens of times a day, and
 * putting a destructive action beside it invites the wrong one.
 *
 * It closes on Escape and on a click anywhere else, because a menu that stays
 * open behind whatever you clicked next is worse than no menu.
 */
function StepMenu({
  label,
  onEdit,
  onRemove,
}: {
  label: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="step-menu" ref={container}>
      <button
        type="button"
        className="btn small ghost step-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open && (
        <div className="step-menu-list" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            Edit step
          </button>
          <button
            type="button"
            role="menuitem"
            className="step-menu-danger"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            Remove step
          </button>
        </div>
      )}
    </div>
  );
}

export function TaskChecklistPanel({
  items,
  attachmentsByChecklist,
  canEdit,
  readOnly = false,
  pending,
  timeZone,
  onComplete,
  onReopen,
  onEvidence,
  assignees,
  onAddStep,
  onEditStep,
  onRemoveStep,
}: {
  items: TaskDetailChecklistItem[];
  attachmentsByChecklist: Map<string, number>;
  canEdit: boolean;
  /** Finished work. Every control that changes a step is withheld. */
  readOnly?: boolean;
  pending: boolean;
  timeZone: string;
  onComplete: (itemId: string) => void;
  onReopen: (itemId: string) => void;
  onEvidence: (item: TaskDetailChecklistItem, mode: 'attach' | 'complete') => void;
  /** Empty when the viewer may not edit; the control is then absent entirely. */
  assignees: ChecklistAssignee[];
  onAddStep: (step: NewChecklistStep) => void;
  onEditStep: (step: EditChecklistStep) => void;
  onRemoveStep: (item: TaskDetailChecklistItem) => void;
}) {
  /*
   * v41 section 8 — Add step is a first-class control in the Steps section,
   * not something to find inside a Manage menu. It asks two questions, because
   * two questions are what adding a step actually needs: what has to be done,
   * and who owes it. Evidence, a separate due date and a prerequisite are real
   * but rare, so they sit behind More options rather than taxing every step
   * with three fields most of them will leave alone.
   */
  const primaryOwner = assignees.find((person) => person.isPrimaryOwner);
  const emptyDraft: StepDraft = {
    action: '',
    assignedTo: primaryOwner?.id ?? '',
    evidenceRule: 'not_required',
    dueDate: '',
    dependsOnItemId: '',
  };

  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<StepDraft>(emptyDraft);

  /*
   * v45 Part B — the step being edited is held by id, and its draft alongside
   * it. Binding to the row's position instead would move the edit to a
   * different step the moment completing something reorders the list.
   */
  const [editing, setEditing] = useState<{
    item: TaskDetailChecklistItem;
    draft: StepDraft;
  } | null>(null);
  const [removing, setRemoving] = useState<TaskDetailChecklistItem | null>(null);

  /*
   * v42 section E — the circle and the Complete button are the same action.
   *
   * The circle used to be an aria-hidden span, so half the people who tried to
   * tick a step off found nothing happened. Both controls now call this, and it
   * is the one place that decides whether required evidence has to be collected
   * first — so the two can never diverge into different behaviours.
   */
  function completeItem(item: TaskDetailChecklistItem) {
    // Per step, not per task. Holding one step on a piece of work is not
    // authority over somebody else's step on the same work.
    if (readOnly || !item.canComplete || item.state !== 'ready' || pending) return;
    if (item.evidenceRule === 'required') {
      onEvidence(item, 'complete');
      return;
    }
    onComplete(item.id);
  }

  function closeAdd() {
    setAddOpen(false);
    setAddDraft(emptyDraft);
  }

  function openEdit(item: TaskDetailChecklistItem) {
    setEditing({
      item,
      draft: {
        action: item.action,
        assignedTo: item.assignedTo ?? primaryOwner?.id ?? '',
        evidenceRule: item.evidenceRule,
        dueDate: item.dueAt ? localDateString(new Date(item.dueAt), timeZone) : '',
        dependsOnItemId: item.dependsOnItemId ?? '',
      },
    });
  }

  return (
    <section className="task-tab-section task-steps-section" aria-label="Step list">
      {canEdit && assignees.length > 0 && (
        <Modal open={addOpen} title="Add step" onClose={closeAdd}>
          <header className="modalhead">
            <div>
              <h2>Add step</h2>
              <p>
                Use steps for verifiable work. Assigning another person creates a Shared
                contribution — not another task.
              </p>
            </div>
          </header>

          <form
            className="modalbody detail-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!addDraft.action.trim()) return;
              onAddStep(draftToStep(addDraft, primaryOwner?.id ?? ''));
              closeAdd();
            }}
          >
            <StepFields
              idPrefix="new-step"
              draft={addDraft}
              onChange={setAddDraft}
              assignees={assignees}
              prerequisiteOptions={items}
            />

            <footer className="modalfoot">
              <button type="button" className="btn" onClick={closeAdd}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={pending || !addDraft.action.trim()}
                aria-busy={pending || !addDraft.action.trim()}
              >
                Add step
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {canEdit && assignees.length > 0 && editing && (
        <Modal open title="Edit step" onClose={() => setEditing(null)}>
          <header className="modalhead">
            <div>
              <h2>Edit step</h2>
              <p>
                Changes are recorded against this work. Reassigning it moves the step to that
                person&rsquo;s Shared list and tells them.
              </p>
            </div>
          </header>

          <form
            className="modalbody detail-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!editing.draft.action.trim()) return;
              onEditStep({
                itemId: editing.item.id,
                ...draftToStep(editing.draft, editing.item.assignedTo ?? primaryOwner?.id ?? ''),
              });
              setEditing(null);
            }}
          >
            <StepFields
              idPrefix="edit-step"
              draft={editing.draft}
              onChange={(draft) => setEditing({ item: editing.item, draft })}
              assignees={assignees}
              // A step cannot wait for itself, and offering it is how somebody
              // finds that out the hard way.
              prerequisiteOptions={items.filter((item) => item.id !== editing.item.id)}
            />

            <footer className="modalfoot">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={pending || !editing.draft.action.trim()}
                aria-busy={pending || !editing.draft.action.trim()}
              >
                Save changes
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {canEdit && removing && (
        <Modal open title="Remove step" onClose={() => setRemoving(null)}>
          <header className="modalhead">
            <div>
              <h2>Remove this step?</h2>
              <p>&ldquo;{removing.action}&rdquo; will be taken off the list of steps.</p>
            </div>
          </header>

          <div className="modalbody detail-form">
            <p className="field full">
              {removing.assignedName
                ? `${removing.assignedName} will be told it is no longer on their Shared list.`
                : 'Nobody is currently assigned to this step.'}
            </p>

            <footer className="modalfoot">
              <button type="button" className="btn" onClick={() => setRemoving(null)}>
                Keep it
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={pending}
                aria-busy={pending}
                onClick={() => {
                  onRemoveStep(removing);
                  setRemoving(null);
                }}
              >
                Remove step
              </button>
            </footer>
          </div>
        </Modal>
      )}

      {items.length === 0 && (
        <p className="muted task-steps-empty">
          No steps yet. Add one for each thing that has to happen — progress is counted from them,
          and a step given to somebody else becomes their Shared contribution.
        </p>
      )}

      <div className="task-checklist-list">
        {items.map((item) => {
          const evidenceCount = attachmentsByChecklist.get(item.id) ?? 0;
          return (
            <article key={item.id} className={`task-checklist-row ${item.state}`}>
              {!readOnly && item.canComplete && item.state === 'ready' ? (
                <button
                  type="button"
                  className="checklist-state checklist-state-button"
                  disabled={pending}
                  aria-busy={pending}
                  onClick={() => completeItem(item)}
                  aria-label={
                    item.evidenceRule === 'required'
                      ? `Complete ${item.action} with evidence`
                      : `Complete ${item.action}`
                  }
                />
              ) : (
                <span className="checklist-state" aria-hidden="true">
                  {item.state === 'completed' ? '✓' : item.state === 'waiting' ? '…' : ''}
                </span>
              )}
              <div className="checklist-copy">
                <strong>{item.action}</strong>
                <span>
                  {item.assignedName ? `${item.assignedName} · ` : ''}
                  {EVIDENCE_LABEL[item.evidenceRule]}
                </span>
                {item.completedAt ? (
                  <span>
                    Completed {formatMoment(item.completedAt, timeZone)} by {item.completedByName}
                  </span>
                ) : null}
                {evidenceCount > 0 ? (
                  <span>
                    {evidenceCount} evidence file{evidenceCount === 1 ? '' : 's'} attached
                  </span>
                ) : null}
                {/*
                  A step with no button needs a sentence. "Waiting" on its own
                  told the contributor nothing about who or what they were
                  waiting for, and left them with nothing to do about it.
                */}
                {item.waitingReason ? (
                  <span className="checklist-waiting-reason">{item.waitingReason}</span>
                ) : null}
                {item.state === 'ready' && !item.canComplete && item.assignedName ? (
                  <span className="checklist-waiting-reason">
                    {item.assignedName} completes this step.
                  </span>
                ) : null}
              </div>
              <div className="task-checklist-actions">
                {!readOnly &&
                item.canComplete &&
                item.state === 'ready' &&
                item.evidenceRule === 'optional' ? (
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => onEvidence(item, 'attach')}
                  >
                    + Evidence
                  </button>
                ) : null}
                {!readOnly && item.canComplete && item.state === 'ready' ? (
                  item.evidenceRule === 'required' ? (
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={pending}
                      aria-busy={pending}
                      onClick={() => completeItem(item)}
                    >
                      Complete with evidence
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn small"
                      disabled={pending}
                      aria-busy={pending}
                      onClick={() => completeItem(item)}
                    >
                      Complete
                    </button>
                  )
                ) : null}
                {!readOnly && item.canComplete && item.state === 'completed' ? (
                  <button
                    type="button"
                    className="btn small ghost checklist-undo"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => onReopen(item.id)}
                  >
                    Undo
                  </button>
                ) : null}
                {item.state === 'waiting' ? (
                  <span className="flag neutral" title={item.waitingReason ?? undefined}>
                    Waiting
                  </span>
                ) : null}
                {/*
                 * v45 Part B — restructuring is edit authority, never
                 * contribute authority. A collaborator completes their step;
                 * they do not get to redefine what it was.
                 *
                 * A completed step is a record of what happened, so it offers
                 * neither: Undo is the honest route back.
                 */}
                {canEdit && assignees.length > 0 && item.state !== 'completed' ? (
                  <StepMenu
                    label={item.action}
                    onEdit={() => openEdit(item)}
                    onRemove={() => setRemoving(item)}
                  />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {canEdit && assignees.length > 0 && (
        <div className="task-checklist-add-row">
          <button type="button" className="btn small primary" onClick={() => setAddOpen(true)}>
            + Add step
          </button>
        </div>
      )}
    </section>
  );
}

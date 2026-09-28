'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { RISK_LABELS, type RiskLevel } from '@/domain/esh-findings';
import {
  changeDueDate,
  changePriority,
  changeRisk,
  editFinding,
  reassignAction,
  type EshDecision,
} from '@/server/esh/verification-actions';

/**
 * The finding's administrative forms (§13, §14, §39), one per item of the
 * finding's menu. Each asks for a reason where the change is shown to the
 * owner or changes how the work is judged, because each is recorded — an
 * owner asking for more time in the conversation changes nothing by itself
 * (FM28), and a priority nobody can account for is how everything ends up
 * Urgent (FM90). What they change arrives in the conversation or the activity
 * as a recorded event.
 */

function useChange() {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<EshDecision>, said: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setProblem(result.message);
        setDone(null);
        return;
      }
      setProblem(null);
      setDone(said);
      router.refresh();
    });
  }

  const status = (
    <>
      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}
      {done && (
        <p className="notice success" role="status">
          {done}
        </p>
      )}
    </>
  );

  return { run, pending, status, clear: () => setProblem(null) };
}

export function ChangeDueForm({
  actionId,
  findingId,
  dueDate,
}: {
  actionId: string;
  findingId: string;
  /** The current due date, as a date input reads it. */
  dueDate: string;
}) {
  const { run, pending, status, clear } = useChange();
  const [newDue, setNewDue] = useState(dueDate);
  const [reason, setReason] = useState('');
  return (
    <div className="esh-action-menu-panel">
      {status}
      <div className="form-grid two">
        <label className="esh-field">
          <span>New due date</span>
          <input
            type="date"
            value={newDue}
            onChange={(event) => {
              setNewDue(event.target.value);
              clear();
            }}
          />
        </label>
        <label className="esh-field">
          <span>Reason (the owner sees it)</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              clear();
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          run(
            () => changeDueDate({ actionId, findingId, dueDate: newDue, dueTime: null, reason }),
            'Due date changed. The owner has been told.',
          )
        }
      >
        Change due date
      </button>
    </div>
  );
}

export function ChangeOwnerForm({
  actionId,
  findingId,
  ownerEmail,
}: {
  actionId: string;
  findingId: string;
  ownerEmail: string;
}) {
  const { run, pending, status, clear } = useChange();
  const [newOwner, setNewOwner] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="esh-action-menu-panel">
      {status}
      <p className="form-hint">
        {ownerEmail} keeps what they wrote; their links to this action stop working at once.
      </p>
      <div className="form-grid two">
        <label className="esh-field">
          <span>New Action Owner email</span>
          <input
            type="email"
            value={newOwner}
            onChange={(event) => {
              setNewOwner(event.target.value);
              clear();
            }}
          />
        </label>
        <label className="esh-field">
          <span>Reason (recorded)</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              clear();
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          run(
            () => reassignAction({ actionId, findingId, ownerEmail: newOwner, reason }),
            'Reassigned. The new owner is emailed their own links.',
          )
        }
      >
        Reassign action
      </button>
    </div>
  );
}

export function ChangePriorityForm({
  actionId,
  findingId,
  priority,
}: {
  actionId: string;
  findingId: string;
  /** What the owner is told to do first today. */
  priority: string;
}) {
  const { run, pending, status, clear } = useChange();
  const [newPriority, setNewPriority] = useState(priority);
  const [reason, setReason] = useState('');
  return (
    <div className="esh-action-menu-panel">
      {status}
      <p className="form-hint">
        Priority orders the owner&rsquo;s work. It does not move the due date, and no reminder or
        escalation clock restarts because of it.
      </p>
      <div className="form-grid two">
        <div className="esh-field">
          {/* Named outside the control: a select inside its own label reads
              as "Priority Urgent High Normal" to anything matching on it. */}
          <label htmlFor="action-priority">Priority</label>
          <select
            id="action-priority"
            value={newPriority}
            onChange={(event) => {
              setNewPriority(event.target.value);
              clear();
            }}
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </select>
        </div>
        <label className="esh-field">
          <span>Reason for the priority</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              clear();
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          run(
            () => changePriority({ actionId, findingId, priority: newPriority, reason }),
            'Priority changed. The due date and its reminders are unchanged.',
          )
        }
      >
        Change priority
      </button>
    </div>
  );
}

export function EditFindingForm({
  findingId,
  title,
  description,
  location,
  departmentId,
  departments,
}: {
  findingId: string;
  title: string;
  description: string;
  location: string;
  departmentId: string;
  departments: Array<{ id: string; name: string }>;
}) {
  const { run, pending, status, clear } = useChange();
  const [values, setValues] = useState({ title, description, location, departmentId });
  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    clear();
  };
  return (
    <div className="esh-action-menu-panel">
      {status}
      <p className="form-hint">
        The owner, the deadline and the follow-up stay as they are. The change and what it replaced
        are kept in the record.
      </p>
      <label className="esh-field">
        <span>Title</span>
        <input
          value={values.title}
          maxLength={200}
          onChange={(event) => set('title')(event.target.value)}
        />
      </label>
      <label className="esh-field">
        <span>What was found</span>
        <textarea
          rows={4}
          value={values.description}
          onChange={(event) => set('description')(event.target.value)}
        />
      </label>
      <div className="form-grid two">
        <label className="esh-field">
          <span>Location</span>
          <input
            value={values.location}
            maxLength={200}
            onChange={(event) => set('location')(event.target.value)}
          />
        </label>
        <div className="esh-field">
          <label htmlFor="edit-finding-department">Accountable department</label>
          <select
            id="edit-finding-department"
            value={values.departmentId}
            onChange={(event) => set('departmentId')(event.target.value)}
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() => run(() => editFinding({ findingId, ...values }), 'Finding updated.')}
      >
        Save changes
      </button>
    </div>
  );
}

export function ChangeRiskForm({ findingId, risk }: { findingId: string; risk: RiskLevel }) {
  const { run, pending, status, clear } = useChange();
  const [newRisk, setNewRisk] = useState<string>(risk);
  const [reason, setReason] = useState('');
  return (
    <div className="esh-action-menu-panel">
      {status}
      <p className="form-hint">
        The follow-up already agreed for this action stays as it is; the new risk applies to how the
        finding is read and reported.
      </p>
      <div className="form-grid two">
        <div className="esh-field">
          <label htmlFor="finding-risk">Risk</label>
          <select
            id="finding-risk"
            value={newRisk}
            onChange={(event) => {
              setNewRisk(event.target.value);
              clear();
            }}
          >
            {(Object.keys(RISK_LABELS) as RiskLevel[]).map((level) => (
              <option key={level} value={level}>
                {RISK_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
        <label className="esh-field">
          <span>Why the risk changed</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              clear();
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() => run(() => changeRisk({ findingId, risk: newRisk, reason }), 'Risk changed.')}
      >
        Change risk
      </button>
    </div>
  );
}

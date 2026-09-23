'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type DragEvent } from 'react';

import { MESSAGE_MAX_LENGTH, ownerMessageProblem, submitProblems } from '@/domain/esh-guest';
import {
  AttachButtons,
  readyItems,
  UploadList,
  useEvidenceUploads,
} from '@/components/esh/EvidenceUploader';
import {
  finishOwnerUpload,
  removeOwnerUpload,
  startOwnerUpload,
  type ReadyFile,
} from '@/server/esh/evidence-actions';
import {
  sendOwnerUpdate,
  submitOwnerWork,
  withdrawOwnerSubmission,
} from '@/server/esh/guest-actions';

/**
 * The owner's composer (§11, §12): a chat bar — attach, write, send — with
 * the two decisions an owner actually has underneath it: submit the work for
 * review, or ask for more time. While ESH reviews, Withdraw to revise.
 *
 * It reads like a messaging app because that is the only interface most Action
 * Owners use daily, and because they arrive here from an email on a phone with
 * no account and no training.
 *
 * Send update is a message; Submit for review is the completion declaration,
 * recorded by pressing it, with no second checkbox (§12). If the result was
 * already sent, the owner presses Submit on that update in the conversation
 * and it is used as it is — never a guess at the latest message (FM18,
 * FM19). The whole composer is a drop target.
 */
export function OwnerComposer({
  actionId,
  awaitingReview,
  fileRequired,
  drafts,
}: {
  actionId: string;
  awaitingReview: boolean;
  fileRequired: boolean;
  drafts: ReadyFile[];
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Asking for more time is a message with a date attached, never a change to
  // the deadline: only ESH moves a due date (§14).
  const [askingTime, setAskingTime] = useState(false);
  const [proposedDate, setProposedDate] = useState('');
  // Naming somebody else is a request too: an owner cannot hand their own
  // work away, or an action could be passed round until it expired (§14).
  const [handingOver, setHandingOver] = useState(false);
  const [proposedOwner, setProposedOwner] = useState('');
  const [pending, startTransition] = useTransition();
  const clientKey = useRef('');
  const uploads = useEvidenceUploads(
    {
      start: (file) => startOwnerUpload({ actionId, name: file.name, size: file.size }),
      finish: (assetId) => finishOwnerUpload({ assetId }),
      remove: (assetId) => removeOwnerUpload({ assetId }),
    },
    readyItems(drafts),
  );
  const waitingOnFiles = uploads.busy || uploads.unresolved;

  function key() {
    if (!clientKey.current) clientKey.current = window.crypto.randomUUID();
    return clientKey.current;
  }

  function sent() {
    clientKey.current = '';
    setBody('');
    uploads.clearSent();
    setProblem(null);
    setAskingTime(false);
    setProposedDate('');
    setHandingOver(false);
    setProposedOwner('');
    router.refresh();
  }

  function send() {
    if (!body.trim() && uploads.readyIds.length === 0) {
      setProblem({ code: 'body_required', message: ownerMessageProblem('body_required') });
      return;
    }
    const text = body;
    const files = uploads.readyIds;
    const asked = askingTime && proposedDate ? proposedDate : null;
    const handover = handingOver && proposedOwner.trim() ? proposedOwner.trim() : null;
    startTransition(async () => {
      try {
        const result = await sendOwnerUpdate({
          actionId,
          body: text,
          clientKey: key(),
          assetIds: files,
          proposedDueDate: asked,
          proposedOwnerEmail: handover,
        });
        if (!result.ok) {
          setProblem({ code: result.code, message: ownerMessageProblem(result.code) });
          return;
        }
        sent();
      } catch {
        setProblem({ code: 'invalid', message: ownerMessageProblem('invalid') });
      }
    });
  }

  function submit() {
    const text = body;
    const files = uploads.readyIds;
    startTransition(async () => {
      try {
        const result = await submitOwnerWork({
          actionId,
          body: text,
          assetIds: files,
          reuseMessageId: null,
          clientKey: key(),
        });
        if (!result.ok) {
          setProblem({ code: result.code, message: submitProblems(result.code, result.problems) });
          return;
        }
        sent();
      } catch {
        setProblem({ code: 'invalid', message: ownerMessageProblem('invalid') });
      }
    });
  }

  function withdraw() {
    startTransition(async () => {
      const result = await withdrawOwnerSubmission({ actionId });
      if (!result.ok) {
        setProblem({ code: result.code, message: submitProblems(result.code) });
        return;
      }
      setProblem(null);
      router.refresh();
    });
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) uploads.add(event.dataTransfer.files);
  }

  return (
    <form
      className="guest-composer"
      data-dragging={dragging ? 'true' : undefined}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {askingTime && (
        <div className="guest-ask-time">
          <label htmlFor="guest-proposed-date">
            <span>What date could you finish by?</span>
          </label>
          <input
            id="guest-proposed-date"
            type="date"
            value={proposedDate}
            onChange={(event) => setProposedDate(event.target.value)}
          />
          <p className="guest-note">
            ESH decides. Send this with a short reason and the date stays as it is until they agree.
          </p>
        </div>
      )}
      {handingOver && (
        <div className="guest-ask-time">
          <label htmlFor="guest-proposed-owner">
            <span>Who should hold this instead?</span>
          </label>
          <input
            id="guest-proposed-owner"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            value={proposedOwner}
            placeholder="name@company.com"
            onChange={(event) => setProposedOwner(event.target.value)}
          />
          <p className="guest-note">
            ESH decides. It stays yours, and they stay unaware of it, until ESH hands it over.
          </p>
        </div>
      )}
      <UploadList uploads={uploads} />
      {dragging && <p className="esh-drop-hint">Drop files to attach them</p>}
      {problem && (
        <p id="guest-composer-problem" className="esh-field-error" role="alert">
          {problem.message}{' '}
          {problem.code === 'no_session' && (
            <Link href="/respond/request-link">Get a new link</Link>
          )}
        </p>
      )}
      <div className="guest-composer-bar">
        <AttachButtons onFiles={(files) => uploads.add(files)} disabled={pending} />
        <textarea
          name="body"
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          value={body}
          aria-label="Message ESH"
          className="guest-composer-input"
          placeholder={
            askingTime
              ? 'Why you need longer…'
              : handingOver
                ? 'Why it is not yours…'
                : awaitingReview
                  ? 'Ask ESH a question…'
                  : 'Write your update…'
          }
          onChange={(event) => {
            setBody(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            // Enter sends, as it does in a messaging app; Shift+Enter is a
            // new line, and a phone keyboard's own Return still inserts one.
            if (event.key === 'Enter' && !event.shiftKey && !pending && !waitingOnFiles) {
              event.preventDefault();
              send();
            }
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'guest-composer-problem' : 'guest-composer-hint'}
        />
        <button
          type="submit"
          className="guest-send"
          aria-label="Send update"
          disabled={pending || waitingOnFiles}
        >
          <span aria-hidden="true">{pending ? '···' : '↑'}</span>
        </button>
      </div>
      {!awaitingReview && (
        <div className="guest-composer-actions">
          <button
            type="button"
            className="btn small ghost"
            aria-pressed={askingTime}
            disabled={pending || handingOver}
            onClick={() => setAskingTime((asking) => !asking)}
          >
            {askingTime ? 'Cancel' : 'Ask for more time'}
          </button>
          <button
            type="button"
            className="btn small ghost"
            aria-pressed={handingOver}
            disabled={pending || askingTime}
            onClick={() => setHandingOver((handing) => !handing)}
          >
            {handingOver ? 'Cancel' : 'Not mine'}
          </button>
          <button
            type="button"
            className="btn primary small"
            disabled={pending || waitingOnFiles || askingTime || handingOver}
            onClick={submit}
          >
            Submit for review
          </button>
        </div>
      )}
      <p id="guest-composer-hint" className="guest-note">
        {waitingOnFiles
          ? 'Finish, retry or remove the files above before sending.'
          : askingTime || handingOver
            ? 'This is a request, not a change.'
            : awaitingReview
              ? 'ESH is reviewing. New messages do not replace what you submitted.'
              : fileRequired
                ? 'Submit for review sends this message and your files to ESH. They need a short result and at least one file.'
                : 'Submit for review sends this message to ESH.'}
      </p>
      {awaitingReview && (
        <p className="guest-withdraw">
          Need to change what you submitted?{' '}
          <button type="button" className="btn ghost small" onClick={withdraw} disabled={pending}>
            Withdraw to revise
          </button>
        </p>
      )}
    </form>
  );
}

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
 * The owner's composer (§11, §12): one box, Attach and Photo, Send update and
 * Submit for review — and, while ESH reviews, Withdraw to revise.
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
    router.refresh();
  }

  function send() {
    if (!body.trim() && uploads.readyIds.length === 0) {
      setProblem({ code: 'body_required', message: ownerMessageProblem('body_required') });
      return;
    }
    const text = body;
    const files = uploads.readyIds;
    startTransition(async () => {
      try {
        const result = await sendOwnerUpdate({
          actionId,
          body: text,
          clientKey: key(),
          assetIds: files,
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
      <label className="esh-field">
        <span>Message ESH</span>
        <textarea
          name="body"
          rows={4}
          maxLength={MESSAGE_MAX_LENGTH}
          value={body}
          placeholder={
            awaitingReview ? 'Ask ESH a question or share another update…' : 'Write your update…'
          }
          onChange={(event) => {
            setBody(event.target.value);
            setProblem(null);
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'guest-composer-problem' : 'guest-composer-hint'}
        />
      </label>
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
      <div className="guest-composer-row">
        <AttachButtons onFiles={(files) => uploads.add(files)} disabled={pending} />
        <div className="guest-composer-actions">
          <button
            type="submit"
            className={awaitingReview ? 'btn primary' : 'btn'}
            disabled={pending || waitingOnFiles}
          >
            {pending ? 'Sending…' : 'Send update'}
          </button>
          {!awaitingReview && (
            <button
              type="button"
              className="btn primary"
              disabled={pending || waitingOnFiles}
              onClick={submit}
            >
              Submit for review
            </button>
          )}
        </div>
      </div>
      <p id="guest-composer-hint" className="guest-note">
        {waitingOnFiles
          ? 'Finish, retry or remove the files above before sending.'
          : awaitingReview
            ? 'New messages do not replace your submitted evidence.'
            : fileRequired
              ? 'Submit sends this message and your files for ESH verification. ESH needs a short result and at least one file.'
              : 'Submit sends this message for ESH verification.'}
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

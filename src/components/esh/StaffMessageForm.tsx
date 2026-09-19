'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { AttachButtons, UploadList, useEvidenceUploads } from '@/components/esh/EvidenceUploader';
import { MESSAGE_MAX_LENGTH } from '@/domain/esh-guest';
import { postEshMessage } from '@/server/esh/conversation-actions';
import {
  finishStaffUpload,
  removeStaffUpload,
  startStaffUpload,
} from '@/server/esh/evidence-actions';

/**
 * ESH writes to the Action Owner (§13), on the same conversation the owner
 * sees. What is typed stays in the box when a send is refused.
 */
export function StaffMessageForm({
  actionId,
  findingId,
  ownerReachable,
}: {
  actionId: string;
  findingId: string;
  ownerReachable: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const clientKey = useRef('');
  const uploads = useEvidenceUploads({
    start: (file) =>
      startStaffUpload({
        findingId,
        actionId,
        purpose: 'message',
        name: file.name,
        size: file.size,
      }),
    finish: (assetId) => finishStaffUpload({ assetId, findingId }),
    remove: (assetId) => removeStaffUpload({ assetId, findingId }),
  });
  const waitingOnFiles = uploads.busy || uploads.unresolved;

  return (
    <form
      className="esh-staff-composer"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim() && uploads.readyIds.length === 0) {
          setProblem('Write a message first.');
          return;
        }
        const files = uploads.readyIds;
        if (!clientKey.current) clientKey.current = window.crypto.randomUUID();
        const text = body;
        startTransition(async () => {
          const result = await postEshMessage({
            actionId,
            findingId,
            body: text,
            clientKey: clientKey.current,
            assetIds: files,
          });
          if (!result.ok) {
            setProblem(result.message);
            return;
          }
          clientKey.current = '';
          uploads.clearSent();
          setBody('');
          setProblem(null);
          setSent(true);
          router.refresh();
        });
      }}
    >
      <label className="esh-field">
        <span>Message the owner</span>
        <textarea
          rows={3}
          maxLength={MESSAGE_MAX_LENGTH}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setProblem(null);
            setSent(false);
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby="esh-staff-composer-hint"
        />
      </label>
      <UploadList uploads={uploads} />
      {problem && (
        <p className="esh-field-error" role="alert">
          {problem}
        </p>
      )}
      {sent && !problem && (
        <p className="guest-composer-sent" role="status">
          Sent to the owner.
        </p>
      )}
      <p id="esh-staff-composer-hint" className="form-hint">
        {ownerReachable
          ? 'The owner reads this in their conversation and is emailed that ESH replied.'
          : 'The owner cannot open the conversation until their access is on and the assignment email is released. The reply notice is held until then.'}
      </p>
      <div className="guest-composer-row">
        <AttachButtons onFiles={(files) => uploads.add(files)} disabled={pending} />
        <button type="submit" className="btn primary" disabled={pending || waitingOnFiles}>
          {pending ? 'Sending…' : 'Send to owner'}
        </button>
      </div>
    </form>
  );
}

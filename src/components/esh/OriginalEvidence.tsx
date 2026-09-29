'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { EVIDENCE_IMAGE_TYPES, evidenceLabel } from '@/domain/esh-evidence';
import type { EvidenceFile } from '@/domain/esh-guest';
import { AttachButtons, UploadList, useEvidenceUploads } from '@/components/esh/EvidenceUploader';
import {
  finishStaffUpload,
  removeStaffUpload,
  startStaffUpload,
} from '@/server/esh/evidence-actions';

/**
 * The finding's original evidence (§7, §23): what ESH saw, shown to the owner
 * under "Original finding & evidence". Coordinators and Verifiers add and
 * remove it here; a removal is recorded, and files sent in the conversation
 * are never affected by it.
 */
export function OriginalEvidence({
  findingId,
  files,
  canChange,
}: {
  findingId: string;
  files: EvidenceFile[];
  canChange: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // A finished upload leaves this list and joins the one the server renders.
  const uploads = useEvidenceUploads(
    {
      start: (file) =>
        startStaffUpload({
          findingId,
          actionId: null,
          purpose: 'original',
          name: file.name,
          size: file.size,
        }),
      finish: (assetId) => finishStaffUpload({ assetId, findingId }),
      remove: (assetId) => removeStaffUpload({ assetId, findingId }),
    },
    [],
    { dropWhenReady: true, onReady: () => router.refresh() },
  );

  return (
    <div className="esh-original-evidence">
      {files.length > 0 ? (
        <ul className="esh-file-list">
          {files.map((file) => (
            <li key={file.id} className="esh-file">
              <a href={`/findings/files/${file.id}`} target="_blank" rel="noopener noreferrer">
                {EVIDENCE_IMAGE_TYPES.has(file.type) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="esh-file-thumb"
                    src={`/findings/files/${file.id}`}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="esh-file-icon" aria-hidden="true">
                    ▧
                  </span>
                )}
                <span>
                  <strong>{file.name}</strong>
                  <small>{evidenceLabel(file.name, file.size)}</small>
                </span>
              </a>
              {canChange && (
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={pending}
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    startTransition(async () => {
                      await removeStaffUpload({ assetId: file.id, findingId });
                      router.refresh();
                    })
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="form-hint">No original evidence yet.</p>
      )}
      {canChange && (
        <>
          <UploadList uploads={uploads} />
          <AttachButtons onFiles={(list) => uploads.add(list)} disabled={pending} />
        </>
      )}
    </div>
  );
}

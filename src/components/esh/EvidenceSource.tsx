import { sourceNote } from '@/domain/esh-evidence';
import type { EvidenceFile } from '@/domain/esh-guest';

/**
 * v271 — whether the picture on screen is the picture that was taken.
 *
 * A photograph sent from a phone has usually been shrunk to get it there, and
 * a verifier looking at a 2000px re-encode should be able to tell, and to get
 * the camera's own file when the detail matters. When it says "kept" it is a
 * link; when the original never arrived it is a plain sentence, because there
 * is nothing to download and offering a dead link would be worse than saying
 * so.
 *
 * Nothing renders when `sourceState` is absent, which is how the owner's
 * pages get nothing: the guest procedures do not return it. The data decides
 * rather than a flag somebody has to remember to pass.
 */
export function EvidenceSource({ file, base }: { file: EvidenceFile; base: string }) {
  const note = sourceNote(file.sourceState, file.sourceBytes);
  if (!note) return null;
  return (
    <p className="esh-file-source" data-state={file.sourceState}>
      {file.sourceState === 'kept' ? (
        <a href={`${base}/${file.id}?source=1`} download>
          {note}
        </a>
      ) : (
        note
      )}
    </p>
  );
}

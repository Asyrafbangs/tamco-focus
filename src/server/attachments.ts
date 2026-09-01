import 'server-only';

import { refuseAttachments } from '@/domain/attachment-policy';
import { attachmentPolicy } from '@/lib/env';

export function safeAttachmentFileName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || 'attachment';
}

/**
 * The configured limits applied to a real upload.
 *
 * The judgement itself lives in `@/domain/attachment-policy`, where it can be
 * exercised without a server: a list of refused extensions that nothing can
 * test is a list nobody can change safely.
 */
export function validateAttachmentFiles(files: readonly File[]): string | null {
  return refuseAttachments(files, {
    maxBytes: attachmentPolicy.maxBytes,
    maxFilesPerUpload: attachmentPolicy.maxFilesPerUpload,
    maxBatchBytes: attachmentPolicy.maxBatchBytes,
    allowedMimeTypes: attachmentPolicy.allowedMimeTypes,
  });
}

import 'server-only';

import { attachmentPolicy } from '@/lib/env';

export function safeAttachmentFileName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || 'attachment';
}

export function validateAttachmentFiles(files: readonly File[]): string | null {
  for (const file of files) {
    if (file.size > attachmentPolicy.maxBytes) {
      return `${file.name} is larger than the ${Math.floor(attachmentPolicy.maxBytes / 1_048_576)} MB local limit.`;
    }
    if (!attachmentPolicy.allowedMimeTypes.includes(file.type)) {
      return `${file.name} is not an allowed file type.`;
    }
  }
  return null;
}

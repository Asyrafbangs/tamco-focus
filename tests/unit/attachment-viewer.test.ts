import { describe, expect, it } from 'vitest';

import { canPreview } from '@/app/(app)/work/AttachmentViewer';

describe('attachment preview allowlist', () => {
  it.each(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])(
    'allows the in-app renderer for %s',
    (mimeType) => {
      expect(canPreview(mimeType)).toBe(true);
    },
  );

  it.each(['image/svg+xml', 'text/html', 'text/plain', 'application/vnd.ms-excel'])(
    'keeps active or unsupported content on the download path for %s',
    (mimeType) => {
      expect(canPreview(mimeType)).toBe(false);
    },
  );
});

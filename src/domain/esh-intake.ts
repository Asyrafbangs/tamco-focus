import { z } from 'zod';

const uuid = z.string().uuid();

/** Public-looking IDs are accepted only after strict UUID validation. */
export function parseReportIntakeId(value: string): string | null {
  const parsed = uuid.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * What the Today page says about the public channel (v290).
 *
 * Three states, and the third is the point. The page used to carry the
 * sentence "Public QR reporting is not enabled" in hard-coded text; it stayed
 * there after an administrator opened the channel, so the people watching the
 * queue were told nothing could arrive while the form was live.
 *
 * `null` means the switch could not be read — which is not the same as closed,
 * and must not be reported as either state.
 */
export function reportingWords(status: { enabled: boolean } | null): string {
  if (!status) {
    return 'Reports recorded by ESH. The state of public QR reporting could not be read.';
  }
  return status.enabled
    ? 'Reports recorded by ESH, and from the QR stickers: public reporting is open.'
    : 'Reports recorded by ESH. Public QR reporting is closed, so no sticker can submit one.';
}

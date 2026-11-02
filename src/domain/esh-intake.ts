import { z } from 'zod';

const uuid = z.string().uuid();

/** Public-looking IDs are accepted only after strict UUID validation. */
export function parseReportIntakeId(value: string): string | null {
  const parsed = uuid.safeParse(value);
  return parsed.success ? parsed.data : null;
}

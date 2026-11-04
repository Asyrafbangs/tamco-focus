import Link from 'next/link';

import { readingNotes, type HealthReading } from '@/domain/esh-health';

/**
 * Whether the machinery behind all this actually ran (§27, §33.2).
 *
 * One compact line, shown only when there is something to say, and each part
 * links to where it is dealt with. What counts as worth saying is decided in
 * the domain, so it can be argued with in a test rather than in a browser.
 */
export function OperationalHealth({ reading }: { reading: HealthReading }) {
  /*
   * v290 - an unreadable monitor says so. Rendering nothing for it made a
   * failed query look like a quiet module, which is the one thing this panel
   * exists to prevent.
   */
  const notes = readingNotes(reading);
  if (notes.length === 0) return null;

  return (
    <section
      className="esh-health"
      aria-labelledby="esh-health-title"
      data-exception={notes.some((note) => note.exception)}
    >
      <h2 id="esh-health-title">Worth knowing</h2>
      <ul>
        {notes.map((note) => (
          <li key={note.text} data-exception={note.exception}>
            {note.href ? <Link href={note.href}>{note.text}</Link> : note.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

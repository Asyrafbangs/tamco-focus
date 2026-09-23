import Link from 'next/link';

import { healthNotes, type OperationalHealth as Health } from '@/domain/esh-health';

/**
 * Whether the machinery behind all this actually ran (§27, §33.2).
 *
 * One compact line, shown only when there is something to say, and each part
 * links to where it is dealt with. What counts as worth saying is decided in
 * the domain, so it can be argued with in a test rather than in a browser.
 */
export function OperationalHealth({ health }: { health: Health | null }) {
  if (!health) return null;
  const notes = healthNotes(health);
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

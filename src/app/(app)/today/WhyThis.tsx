'use client';

import { useState } from 'react';

/**
 * The "Why this?" control (section 9.5).
 *
 * Every Start Here recommendation must be able to explain itself in plain
 * language. The explanation is kept in the DOM and toggled rather than inserted
 * on demand, so assistive technology announces it through `aria-expanded` and
 * the controlled region rather than as a surprise mutation.
 */
export function WhyThis({ explanation }: { explanation: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span>
      <button
        type="button"
        className="btn small ghost why-btn"
        aria-expanded={open}
        aria-controls="why-this-explanation"
        onClick={() => setOpen((current) => !current)}
      >
        Why this?
      </button>

      <span
        id="why-this-explanation"
        className="muted"
        style={{ display: open ? 'block' : 'none', fontSize: 12, marginTop: 8 }}
      >
        {explanation}
      </span>
    </span>
  );
}

'use client';

import { useEffect, useRef } from 'react';

/**
 * A filter that applies when an option is chosen (v179).
 *
 * The filter bars — Directory status, Organisation department, the Records
 * filters — were forms whose selects did nothing until a separate Apply or
 * Find button was pressed. Choosing "Deactivated" and watching the list stay
 * exactly as it was reads as a control that is broken, and that is how it was
 * reported. Placed inside such a form, this submits it when one of its selects
 * changes. It renders nothing visible, and the form still works without it:
 * the button stays, for text fields and for a page whose script has not run.
 *
 * One care taken. On Windows a closed select changes its value on every arrow
 * key, so submitting on each change would navigate away on the first press and
 * leave a keyboard user unable to reach the third option. A change that
 * follows a key press is held until they press Enter or leave the field; a
 * change made by pointer or touch applies at once.
 */
export function SubmitOnSelect() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = marker.current?.closest('form');
    if (!form) return;

    let keyboardAt = 0;
    const held = new Set<HTMLSelectElement>();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLSelectElement)) return;
      if (event.key === 'Enter' && held.has(event.target)) {
        event.preventDefault();
        held.clear();
        form.requestSubmit();
        return;
      }
      keyboardAt = Date.now();
    };
    const onChange = (event: Event) => {
      if (!(event.target instanceof HTMLSelectElement)) return;
      if (Date.now() - keyboardAt < 1000) {
        held.add(event.target);
        return;
      }
      form.requestSubmit();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.target instanceof HTMLSelectElement && held.has(event.target)) {
        held.clear();
        form.requestSubmit();
      }
    };

    form.addEventListener('keydown', onKeyDown);
    form.addEventListener('change', onChange);
    form.addEventListener('focusout', onFocusOut);
    return () => {
      form.removeEventListener('keydown', onKeyDown);
      form.removeEventListener('change', onChange);
      form.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return <span ref={marker} hidden />;
}

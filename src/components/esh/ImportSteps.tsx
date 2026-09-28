const STEPS = ['Upload file', 'Preview & match', 'Confirm & notify'] as const;

/**
 * Where a backlog is in its journey (v228, §38.2).
 *
 * The import is three screens' worth of work spread across two addresses, and
 * the one question everybody asked of it was "has this gone out yet". Saying so
 * at the top is cheaper than answering it afterwards.
 *
 * Not links: a step is a statement about this batch, not a route through it.
 * Going back means uploading another file, which the page below already offers.
 */
export function ImportSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="esh-steps esh-import-steps" aria-label="Importing a backlog">
      {STEPS.map((name, index) => {
        const number = index + 1;
        return (
          <li
            key={name}
            className="esh-step"
            data-state={number === current ? 'current' : number < current ? 'done' : 'ahead'}
            aria-current={number === current ? 'step' : undefined}
          >
            <span className="esh-step-mark" aria-hidden="true">
              {number < current ? '✓' : number}
            </span>
            <span>{name}</span>
          </li>
        );
      })}
    </ol>
  );
}

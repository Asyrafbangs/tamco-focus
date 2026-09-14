'use client';

import { useEffect } from 'react';

export default function GoalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Goals workspace]', error);
  }, [error]);

  return (
    <div className="empty-state card" role="alert">
      <h1>Goals could not be loaded</h1>
      <p>
        If you had just saved something, check whether it is there before doing it again. Check your
        connection and try again.
      </p>
      <button type="button" className="btn primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}

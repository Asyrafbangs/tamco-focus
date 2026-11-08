/**
 * Refuse to carry on when a read failed.
 *
 * A read that answers "nothing" and a read that did not answer are different
 * facts, and conflating them is how a database outage comes to claim that a
 * finding, or a whole page, does not exist. Both still deny the reader what
 * they asked for; this only changes what they are told, and keeps the cause in
 * the message rather than only in a server log.
 *
 * This lived in `esh-findings` until v322, when the same fault turned up in
 * the task drawer and the goal drawer: an authorisation read that failed was
 * being read as an authorisation answer of "no". The rule is not an ESH rule,
 * so it no longer lives in an ESH module.
 */
export function requireAnswer(
  failure: { code?: string; message: string } | null,
  what: string,
): void {
  if (failure) {
    throw new Error(`${what} could not be read: ${failure.code ?? 'unknown'} ${failure.message}`);
  }
}

/**
 * One retry, then insist on an answer.
 *
 * The failure this guards against is a gateway 502 that does not survive being
 * asked again — `getEshAccess` has retried for exactly that reason since v197.
 * What a capability read must never do is fail quietly: `data ?? {}` turns a
 * dropped connection into a complete set of `false` capabilities, which is
 * indistinguishable from a considered refusal and renders as a screen with
 * nothing you may do on it.
 *
 * Takes a thunk rather than a promise so the retry is a second call, not a
 * second await of the first one. `first` is for the common case where the read
 * has already happened inside a `Promise.all` alongside everything else a
 * screen needs: pass its result and the retry stays a retry instead of
 * doubling every capability read on the happy path.
 */
/** What a Supabase read hands back, narrowed to the two fields this needs. */
interface CapabilityRead<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

export async function readCapabilities<T>({
  read,
  source,
  reference,
  first,
}: {
  /** The read itself, as a thunk, so the retry is a second call. */
  read: () => PromiseLike<CapabilityRead<T>>;
  /** Log prefix, in this repository's `[functionName]` form. */
  source: string;
  /**
   * What the reader is shown. `src/app/(app)/error.tsx` prints the message as
   * "Reference" and asks them to quote it, so it is a short greppable
   * identifier like the eleven already thrown from `queries.ts` — never the
   * upstream error's own words, which belong in the log above it.
   */
  reference: string;
  /**
   * The result of a read already performed, usually inside the same
   * `Promise.all` as everything else a screen needs. Passing it keeps the
   * retry a retry instead of doubling every capability read on the happy path.
   */
  first?: CapabilityRead<T>;
}): Promise<T> {
  let attempt = first ?? (await read());
  if (attempt.error) {
    console.error(
      `[${source}] ${attempt.error.code ?? 'unknown'}: ${attempt.error.message} (retrying once)`,
    );
    attempt = await read();
  }
  if (attempt.error) {
    console.error(`[${source}] ${attempt.error.code ?? 'unknown'}: ${attempt.error.message}`);
    throw new Error(reference);
  }
  return (attempt.data ?? {}) as T;
}

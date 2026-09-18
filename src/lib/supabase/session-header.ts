/**
 * The request header the proxy uses to say "the auth server knows this person".
 *
 * v195 — every click that opened a task asked the auth server who was signed in
 * twice, one after the other: once in the proxy, which must (it refreshes the
 * session and turns away one that has been revoked), and again in the page,
 * before a single row could be read. On production that second round trip was
 * a fixed cost on every open, every close and every save.
 *
 * So the proxy passes on what it established. It removes this header from
 * every incoming request, whatever it carries, and sets it only after
 * `getUser` has succeeded. The page then trusts it only when the session's own
 * signed token names the same person (`getCurrentProfile`), so neither half is
 * enough alone: a header written by a client is stripped before the page sees
 * it, and a valid token for a session the auth server has since ended arrives
 * without it and is checked the slow way.
 */
export const SESSION_USER_HEADER = 'x-tamco-session-user';

/**
 * The headers the page receives: the request's own, minus anything claiming to
 * be the proxy's word, plus the proxy's word when it has one.
 *
 * The delete is unconditional and comes first, so whatever a client sent under
 * this name is gone before the page can read it — on every path the proxy
 * serves, including the ones it waves through.
 */
export function forwardedRequestHeaders(
  incoming: Headers,
  confirmedUserId: string | null,
): Headers {
  const headers = new Headers(incoming);
  headers.delete(SESSION_USER_HEADER);
  if (confirmedUserId) headers.set(SESSION_USER_HEADER, confirmedUserId);
  return headers;
}

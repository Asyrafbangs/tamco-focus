/**
 * The `server-only` package, as it exists under vitest.
 *
 * The real package's `index.js` throws on import — "This module cannot be
 * imported from a Client Component module" — because Next.js resolves it
 * through the `react-server` export condition on the server and leaves the
 * throwing entry point for everything else. Vitest is everything else, so any
 * module that begins `import 'server-only'` was unimportable from a test, and
 * `src/server/esh/access.ts` and `src/server/esh/queries.ts` both do.
 *
 * What that cost: the v282/v283 hardening — a failed database read must not be
 * reported as "no access" or as "this finding does not exist" — could only be
 * proven on the pure helpers `accessFromAnswer` and `requireAnswer`. Nothing
 * proved that `getEshAccess` and `getFindingDetail` still CALL them, so an edit
 * could drop the call and no test would notice.
 *
 * This file is reached only through `resolve.alias` in `vitest.config.ts`. The
 * Next.js build resolves `server-only` to the real package exactly as before,
 * so the production guarantee — these modules cannot be pulled into a client
 * bundle — is unchanged. A test importing them is not a client bundle.
 */
export {};

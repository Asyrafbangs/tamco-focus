# Future deployment gates

No hosted Supabase project, GitHub remote, Vercel project, or external email provider has been connected in the local-only stage.

Before a future deployment is authorised:

1. Approve the legal retention period, attachment size/type limits, malware-scanning provider, email provider, production identity flow, base URL, scheduling platform, and secret owner.
2. Review every migration and RLS policy against the production organisation and run the complete denial suite against an isolated hosted test project.
3. Replace the local log email transport with a provider that supports a stable idempotency key. Keep the delivery table claim and retry rules.
4. Add malware scanning and quarantine. Do not reinterpret `unscanned` files as safe.
5. Configure a durable scheduler for routine generation and weekly summaries in `Asia/Kuala_Lumpur`.
6. Create production Auth identities through the administrator flow; never copy seeded local users.
7. Store secrets only in approved encrypted environment storage. The service-role key must remain server-only.
8. Run database reset on an empty disposable environment, generated-type comparison, pgTAP, integration, E2E/Axe, production build, and smoke tests.
9. Add a GitHub remote and deployment integration only after explicit Product Owner approval.

Vercel deployment remains intentionally unused because the repository instructions require a local-only build. If that boundary changes, document the exact approved project, environment separation, rollback path, and scheduler/email integrations before linking anything.

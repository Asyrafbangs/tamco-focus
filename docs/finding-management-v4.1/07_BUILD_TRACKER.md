# TAMCO Finding Management v4.1 — Build and Release Tracker

> The user approved local-only Stage 1 testing on 31 October 2026. This does not approve hosted staging, Production deployment, public QR intake or live email rollout.

| Stage                 | Done | PR / commit            | CI incl. browser                                  | Staging demo | Migration deployed | Approved by                 |
| --------------------- | ---- | ---------------------- | ------------------------------------------------- | ------------ | ------------------ | --------------------------- |
| S0 Baseline           | [ ]  | PR #49; rebased on #50 | [x] run 41179525074; current branch rerun pending | Local only   | N/A                | User: local testing, 31 Oct |
| S1 UI/nav             | [ ]  | —                      | [ ]                                               | [ ]          | N/A unless needed  | —                           |
| S2 QR intake          | [ ]  | —                      | [ ]                                               | [ ]          | [ ]                | —                           |
| S3 Taxonomy/links     | [ ]  | —                      | [ ]                                               | [ ]          | [ ]                | —                           |
| S4 Patterns           | [ ]  | —                      | [ ]                                               | [ ]          | [ ]                | —                           |
| S5 Workflow hardening | [ ]  | —                      | [ ]                                               | [ ]          | if needed          | —                           |
| S6 Pilot/rollout      | [ ]  | —                      | [ ]                                               | [ ]          | checked            | —                           |

## Decisions requiring human ownership before relevant rollout

- [ ] QR intake: anonymous reporting permitted? Policy/notice approved, reporter contact optional or mandated?
- [ ] Who receives immediate safety notifications, in/out of hours? Backup phone/radio route and escalation service levels?
- [ ] Final hazard categories and department/location names confirmed by ESH and plant representatives?
- [ ] QR sticker locations/site labels, printing responsibilities and periodic area mapping ownership?
- [ ] Photo originals/EXIF/retention and privacy policy approved (restricted originals + metadata-stripped derivatives is proposed).
- [ ] Public upload scanner available, sized, hosted, private and validated? If not, choose **text-only public QR pilot**.
- [ ] Current v269/v270 status and Supabase production migration history/backup reconciled by authorized deployer?
- [ ] Authorization to send live assignment/QR confirmation emails and to open ESH module access beyond restricted rollout?
- [ ] Pilot representative/testers, feedback owner and go/no-go date confirmed?

## Change record

| Date       | Stage  | What changed                                                                                                  | Why                                                                   | Tests                                                                                                                                                                                    | Decision / remaining risk                                                              |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 2026-10-30 | Design | v4.1 concept and source handoff only                                                                          | Practical three-page ecosystem with real email-owner engine preserved | Standalone prototype screenshots and smoke checks (see test report)                                                                                                                      | No backend implementation or production authorization included                         |
| 2026-10-31 | S0     | Local baseline drafted; fresh Production backup restore-proven; eight fixture-only desktop/mobile screenshots | Reconcile package with v271 and establish gates before UI changes     | Local 17/17; 354 saved/restored object hashes; baseline captures 2/2 and 2/2; S0 run 41179525074 and backup run 41180345379 each passed all three jobs, 626 browser passed / 155 skipped | User approved local-only testing for S1; rebase and current branch CI still to confirm |

## Stage handover snippet (fill for each PR)

```
STAGE:
PR / SHA:
DB MIGRATIONS (local / staging / production):
FUNCTIONS / ROUTES CHANGED:
USER-FACING DIFFERENCE:
TESTS PASSED / FAILED / SKIPPED:
SECURITY / ACCESS GATE:
BACKUP / ROLLBACK:
UNRESOLVED RISK:
NEXT ACTION OWNER:
```

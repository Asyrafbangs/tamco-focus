# Operational Action disclosure clarity — v85 impact map

Date: 28 August 2026

## Approved change

The expanded Operational Action drawer repeated information already present in its disclosure
buttons and allowed long summary text to crowd the drawer edges. The supplied desktop captures are
the visual defect reference for this focused correction.

| Area            | Before                                                                     | Required result                                                                                          | Impact                                |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Steps summary   | `Steps 0/3` plus `First: <full step title>`                                | Keep the count and show only a compact remaining/viewer-action summary                                   | Presentation only                     |
| Expanded Steps  | Repeated `STEPS`, completion count, and permanent teaching copy            | The disclosure button is the single visible section title; render the step list and one Add step control | Component structure and E2E selectors |
| Updates summary | Repeated the complete newest update body                                   | Show count plus `Latest · <time>`; the body appears only in the expanded update record                   | Presentation only                     |
| Drawer spacing  | Disclosure content used near-zero horizontal inset and one-line truncation | Consistent inner inset, wrapping, and narrow-screen containment                                          | Shared drawer CSS                     |

## Affected implementation

- `src/app/(app)/work/TaskDetailDrawer.tsx`
- `src/app/(app)/work/TaskChecklistPanel.tsx`
- `src/app/globals.css`
- `tests/e2e/00-ui-parity.spec.ts`
- `tests/e2e/capture-work.spec.ts`

## Preserved behavior

- Steps remain the sole execution/progress source introduced in v83/v84.
- Step assignment, readiness, completion authority, evidence rules, progress calculation and audit
  history remain unchanged.
- Update creation, private attachment storage, visibility, author and timestamp remain unchanged.
- No database, migration, API, RLS, permission, notification or production-data change is required.

## Acceptance checks

1. Expanding Steps does not display a second visible Steps heading, count, or teaching paragraph.
2. The Steps summary never renders `First:` followed by a potentially long delegated step title.
3. An update body occurs once when Updates is expanded and never appears in its summary.
4. Disclosure copy and update records wrap without horizontal overflow at desktop and 390 px mobile.
5. Add step, completion, evidence, update posting and keyboard disclosure behavior still work.

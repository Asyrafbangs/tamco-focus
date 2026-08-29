# PDF attachment preview — v103 impact map

Date: 29 August 2026

## Approved change

PDF attachments still reached the browser's grey Open placeholder when the local browser was
configured to download PDFs. The earlier inline-header and Blob-URL repairs could not override that
browser preference because the final iframe still depended on the built-in PDF plug-in.

| Area            | Previous behavior                            | Required result                                 | Impact                              |
| --------------- | -------------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| PDF reading     | Blob URL loaded in a browser PDF iframe      | Render authorised PDF bytes to an in-app canvas | Client viewer and lazy dependency   |
| Reader controls | Browser-owned or unavailable                 | Previous/Next, page count, zoom, Fit width      | Desktop/mobile UI and accessibility |
| Download        | Explicit header action plus plug-in fallback | Explicit header action only                     | No workflow change                  |
| Images          | Blob URL in the same drawer                  | Preserve existing image preview                 | Regression coverage                 |
| Security/audit  | RLS route records every view                 | Preserve the same route and audit call          | No database or policy change        |

## Affected implementation

- `src/app/(app)/work/AttachmentViewer.tsx`
- `src/app/(app)/work/TaskDetailDrawer.tsx`
- `src/app/globals.css`
- `types/pdfjs-dist-webpack.d.ts`
- `package.json` and `package-lock.json`
- `tests/unit/attachment-viewer.test.ts`
- `tests/e2e/capture-work.spec.ts`

## Preserved behavior

- Attachment rows remain preview actions only for PDF and safe raster-image MIME types.
- HTML, SVG, office documents, text and other unsupported types remain explicit downloads.
- The attachment route continues to authenticate, apply row-level visibility and write the automatic
  attachment-view audit event before returning bytes.
- Download remains optional and deliberate.
- No SQL migration, generated database type, RLS, notification or production-data change is required.

## Acceptance checks

1. A real one-page PDF uploaded through the update flow draws to a non-empty canvas on desktop and
   mobile.
2. The PDF surface contains no iframe and no browser-owned Open control.
3. Page and zoom controls are keyboard-operable, labelled and responsive.
4. Image preview and unsupported-file download paths remain unchanged.
5. Typecheck, lint, format, unit, E2E, accessibility, build and smoke gates pass.

-- ============================================================================
-- v152 — the bucket accepts the formats the interface offers
--
-- Manager and Employee Change Specification §19: "Support the business formats
-- discussed: JPG/JPEG, PNG, HEIC, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, CSV and
-- TXT, subject to actual safe processing capabilities. Do not advertise
-- formats the pipeline rejects."
--
-- Six of them were rejected. The completion panel reads
--
--     Photos · PDF · Word · Excel · PowerPoint
--
-- and the file chooser offers .doc, .xls, .ppt, .pptx and HEIC; the
-- application allow-list in `src/lib/env.ts` accepts all of them; and the
-- bucket, created in `20260805001000_storage.sql` before those formats were
-- agreed, then refused them at the far end with
--
--     mime type image/heic is not supported
--
-- So **no PowerPoint file of any kind could ever be stored as evidence**, nor
-- a legacy .doc or .xls, nor an iPhone photograph — HEIC has been the default
-- camera format on iOS since 2017, which makes it the single most likely thing
-- somebody photographing a plant inspection actually has in their hand.
--
-- The failure surfaced as a per-file upload error, so it was visible but not
-- actionable: nothing in the sentence tells you the application will never
-- accept that file however many times you retry.
--
-- Widened rather than narrowed. §19 names DOC/XLS/PPT explicitly, so they are
-- "explicitly allowed" in the sense of its own instruction to "block
-- executables/scripts and active-content variants not explicitly allowed".
-- The macro-enabled variants — .docm, .xlsm, .xlsb, .pptm — remain refused by
-- `REFUSED_EXTENSIONS` in `src/domain/attachment-policy.ts`, which is the
-- control that matters: a document that runs code when opened is exactly what
-- an allow-list keyed on type alone waves through.
--
-- This list must stay equal to `attachmentPolicy.allowedMimeTypes`.
-- `tests/integration/storage-object-access-v152.test.ts` uploads one file of
-- every advertised type and fails if any is refused, so the two cannot drift
-- apart again without a test saying so.
-- ============================================================================

update storage.buckets
   set allowed_mime_types = array[
     'image/png',
     'image/jpeg',
     'image/webp',
     'image/gif',
     'image/heic',
     'image/heif',
     'application/pdf',
     'text/plain',
     'text/csv',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation'
   ]
 where id = 'task-attachments';

-- Nothing else about the bucket changes. It stays private, it keeps its 10 MB
-- per-file ceiling, and every policy on `storage.objects` is untouched: what
-- may be stored is a separate question from who may read it, and only the
-- first one was wrong.

'use client';

import { useEffect, useRef, useState } from 'react';

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

import type { TaskDetailAttachment } from '@/server/queries';

/**
 * Reading a file instead of downloading it.
 *
 * Clicking a row used to hand the file straight to the operating system, which
 * for the commonest case - "what did they actually attach?" - is three steps
 * too many: download, find it, open it, and now there is a copy in Downloads
 * nobody asked for. Most of these are one inspection photo or a two-page PDF.
 *
 * Rendered inside the drawer rather than as another dialog on top of it, so
 * closing the file returns to the task rather than to nothing.
 */

export function canPreview(mimeType: string) {
  return mimeType === 'application/pdf' || /^image\/(png|jpeg|webp|gif)$/.test(mimeType);
}

type Source =
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; bytes: ArrayBuffer }
  | { kind: 'error'; message: string }
  | null;

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

function errorMessage(problem: unknown, fallback: string) {
  return problem instanceof Error && problem.message ? problem.message : fallback;
}

/**
 * PDF.js is intentionally loaded only after somebody opens a PDF. The task
 * drawer and image preview stay small, while PDFs are rendered by our own
 * canvas rather than by the browser plug-in whose "download PDFs" preference
 * produced the grey Open placeholder this viewer is meant to avoid.
 */
function PdfAttachmentCanvas({ bytes, fileName }: { bytes: ArrayBuffer; fileName: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [stageWidth, setStageWidth] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateWidth = () => setStageWidth(Math.floor(stage.clientWidth));
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;

    (async () => {
      try {
        /*
         * The webpack entry wires a same-origin module Worker with new URL().
         * Turbopack supports that form, and the import remains client-only and
         * on-demand because it lives inside this effect.
         */
        const pdfjs = (await import('pdfjs-dist/webpack.mjs')) as typeof import('pdfjs-dist');
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
        loadedDocument = await loadingTask.promise;

        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        setPdf(loadedDocument);
        setPageNumber(1);
        setError(null);
      } catch (problem) {
        if (!cancelled) {
          setError(errorMessage(problem, 'This PDF could not be read.'));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (!pdf || stageWidth <= 0) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        setRendering(true);

        const initialViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(stageWidth - 32, 240);
        const fitScale = availableWidth / initialViewport.width;
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d', { alpha: false });

        if (!canvas || !context) throw new Error('This browser cannot draw the PDF page.');

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;

        if (!cancelled) {
          setError(null);
          setRendering(false);
        }
      } catch (problem) {
        if (
          cancelled ||
          (problem as { name?: string } | null)?.name === 'RenderingCancelledException'
        ) {
          return;
        }
        setRendering(false);
        setError(errorMessage(problem, 'This PDF page could not be drawn.'));
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdf, stageWidth, zoom]);

  const pageCount = pdf?.numPages ?? 0;
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="attachment-pdf-viewer">
      <div className="attachment-pdf-toolbar" role="toolbar" aria-label="PDF page controls">
        <div className="attachment-pdf-control-group">
          <button
            type="button"
            className="btn small ghost"
            disabled={!pdf || pageNumber <= 1}
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span aria-live="polite">
            Page {pageCount ? pageNumber : '—'} of {pageCount || '—'}
          </span>
          <button
            type="button"
            className="btn small ghost"
            disabled={!pdf || pageNumber >= pageCount}
            onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
          >
            Next
          </button>
        </div>
        <div className="attachment-pdf-control-group">
          <button
            type="button"
            className="btn small ghost attachment-pdf-zoom-button"
            aria-label="Zoom out"
            disabled={!pdf || zoom <= MIN_ZOOM}
            onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))}
          >
            −
          </button>
          <span aria-live="polite">{zoomPercent}%</span>
          <button
            type="button"
            className="btn small ghost attachment-pdf-zoom-button"
            aria-label="Zoom in"
            disabled={!pdf || zoom >= MAX_ZOOM}
            onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))}
          >
            +
          </button>
          <button
            type="button"
            className="btn small ghost"
            disabled={!pdf || zoom === 1}
            onClick={() => setZoom(1)}
          >
            Fit width
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="attachment-pdf-stage"
        aria-busy={!pdf || rendering}
        aria-label={`${fileName} document`}
      >
        {!pdf && !error && (
          <p className="muted" role="status">
            Preparing PDF…
          </p>
        )}
        {error && (
          <div className="attachment-viewer-failed" role="alert">
            <strong>{error}</strong>
            <p>You can still use Download above to keep a copy.</p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="attachment-pdf-canvas"
          role="img"
          aria-label={`Page ${pageNumber} of ${pageCount || 1} in ${fileName}`}
          hidden={!pdf || Boolean(error)}
        />
        {pdf && rendering && !error && (
          <span className="attachment-pdf-rendering" role="status">
            Drawing page {pageNumber}…
          </span>
        )}
      </div>
    </div>
  );
}

export function AttachmentViewer({
  file,
  onClose,
}: {
  file: TaskDetailAttachment;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>(null);

  /*
   * Escape belongs to the file first.
   *
   * The drawer listens for Escape on the document and closes the whole task.
   * While a file is open, the reasonable meaning of Escape is "close the
   * file" - so this listens in the capture phase, which runs before the
   * drawer's bubble-phase handler, and stops the event there.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  /*
   * Fetched into memory rather than pointed at the route directly.
   *
   * A browser setting may refuse to draw PDFs even when every response header
   * says `inline`, so PDF bytes go to the canvas renderer above. Images keep a
   * short-lived Blob URL. Both start with this same-origin credentialed fetch,
   * preserving the route's authorisation and automatic access record.
   */
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/attachments/${file.id}?inline=1`, {
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error(`The file could not be loaded (${response.status}).`);
        const bytes = await response.arrayBuffer();
        if (cancelled) return;

        if (file.mimeType === 'application/pdf') {
          setSource({ kind: 'pdf', bytes });
        } else {
          // Retyped from our own record rather than trusting the response.
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
          setSource({ kind: 'image', url: objectUrl });
        }
      } catch (problem) {
        if (cancelled) return;
        setSource({
          kind: 'error',
          message: errorMessage(problem, 'The file could not be loaded.'),
        });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.mimeType]);

  return (
    <div className="attachment-viewer">
      {source === null && (
        <p className="muted" role="status">
          Loading {file.fileName}…
        </p>
      )}

      {source?.kind === 'error' && (
        <div className="attachment-viewer-failed" role="alert">
          <strong>{source.message}</strong>
          <p>Downloading it still works.</p>
          <a
            className="btn small"
            href={`/api/attachments/${file.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Download {file.fileName}
          </a>
        </div>
      )}

      {source?.kind === 'image' && (
        <>
          {/* A private, arbitrary-dimension upload held as a blob: next/image
              would need a loader and a size it cannot know. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source.url} alt={file.fileName} className="attachment-viewer-image" />
        </>
      )}

      {source?.kind === 'pdf' && (
        <PdfAttachmentCanvas bytes={source.bytes} fileName={file.fileName} />
      )}
    </div>
  );
}

import { attachmentPolicy } from '@/lib/env';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

/**
 * What may be shown in the page rather than handed to the operating system.
 *
 * Serving an upload inline means the browser renders it in our origin, so the
 * list is the types we actually draw and nothing else. Anything able to carry
 * script - HTML, SVG - is absent deliberately, and everything not named here
 * keeps the download behaviour whatever the request asks for.
 */
function canRenderInline(mimeType: string | null) {
  if (!mimeType) return false;
  return mimeType === 'application/pdf' || /^image\/(png|jpeg|webp|gif)$/.test(mimeType);
}

/** Header-safe: a quote or a newline in a filename can forge a header. */
function headerFilename(name: string) {
  return name.replace(/["\\\r\n]/g, '_').slice(0, 200);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: attachment, error } = await supabase
    .from('attachments')
    .select('id,storage_bucket,storage_path,file_name,mime_type')
    .eq('id', id)
    .maybeSingle();

  // RLS-denied and absent rows are intentionally indistinguishable.
  if (error || !attachment) return new Response('Not found', { status: 404 });

  const { data: viewResult, error: viewError } = await supabase.rpc('record_attachment_view', {
    p_attachment_id: id,
  });
  if (viewError || !(viewResult as { ok?: boolean } | null)?.ok) {
    return new Response('Attachment access could not be recorded', { status: 409 });
  }

  const mimeType = (attachment.mime_type as string | null) ?? 'application/octet-stream';
  const wantsInline = new URL(request.url).searchParams.get('inline') === '1';

  if (wantsInline && canRenderInline(mimeType)) {
    /*
     * Streamed here rather than redirected to a signed URL.
     *
     * A signed URL arrives with whatever `Content-Disposition` the storage
     * service decides, and in an iframe an `attachment` disposition is not a
     * download - it is Chrome's grey "Open" placeholder, which is what this
     * viewer showed. Serving the bytes ourselves means the two headers that
     * decide whether a PDF renders are set by the code that intends it, and
     * the file arrives same-origin so no signed URL is left in history.
     *
     * These are capped at 10 MB on the way in, so passing them through costs
     * little and buys certainty.
     */
    const { data: blob, error: downloadError } = await supabase.storage
      .from(attachment.storage_bucket)
      .download(attachment.storage_path);

    if (downloadError || !blob) return new Response('Not found', { status: 404 });

    return new Response(blob.stream(), {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${headerFilename(String(attachment.file_name))}"`,
        'Content-Length': String(blob.size),
        // The allowlist above already excludes anything that can carry script;
        // this stops a browser deciding for itself that it is something else.
        'X-Content-Type-Options': 'nosniff',
        // Private work. It may sit in this tab and nowhere else.
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(attachment.storage_bucket)
    .createSignedUrl(attachment.storage_path, attachmentPolicy.signedUrlTtlSeconds, {
      download: attachment.file_name,
    });

  if (signedError || !signed?.signedUrl) return new Response('Not found', { status: 404 });

  return Response.redirect(new URL(signed.signedUrl, request.url), 303);
}

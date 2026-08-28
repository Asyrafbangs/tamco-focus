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

  /*
   * `download` is what sets Content-Disposition: attachment on the signed URL,
   * so the viewer has to ask for a URL without it. Reading a file in the page
   * is still a view and is still recorded above; only the disposition differs.
   */
  const wantsInline = new URL(request.url).searchParams.get('inline') === '1';
  const inline = wantsInline && canRenderInline(attachment.mime_type as string | null);

  const { data: signed, error: signedError } = await supabase.storage
    .from(attachment.storage_bucket)
    .createSignedUrl(
      attachment.storage_path,
      attachmentPolicy.signedUrlTtlSeconds,
      inline ? {} : { download: attachment.file_name },
    );

  if (signedError || !signed?.signedUrl) return new Response('Not found', { status: 404 });

  return Response.redirect(new URL(signed.signedUrl, request.url), 303);
}

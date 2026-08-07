import { attachmentPolicy } from '@/lib/env';
import { createSupabaseServerClient, requireProfile } from '@/lib/supabase/server';

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
    .select('id,storage_bucket,storage_path,file_name')
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

  const { data: signed, error: signedError } = await supabase.storage
    .from(attachment.storage_bucket)
    .createSignedUrl(attachment.storage_path, attachmentPolicy.signedUrlTtlSeconds, {
      download: attachment.file_name,
    });

  if (signedError || !signed?.signedUrl) return new Response('Not found', { status: 404 });

  return Response.redirect(new URL(signed.signedUrl, request.url), 303);
}

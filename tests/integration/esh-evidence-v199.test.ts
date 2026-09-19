import { createHash, randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { sniffEvidenceType } from '@/domain/esh-evidence';

import { serviceClient, signInAs } from './setup';

/**
 * v199 — evidence in real storage (§23, FM49).
 *
 * The bucket is private and has no policy for anybody: a file goes in only
 * through a one-time URL the server signed after a procedure agreed, and
 * comes out only through a short signed link. The anonymous key — which
 * every browser holds — can do nothing with it directly.
 */

const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';
const BUCKET = 'finding-evidence';
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

function anonymous() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function ownerSession(id: string) {
  const izzul = await signInAs('izzul');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data: saved } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v199 storage ${id}`,
      description: 'Integration coverage for evidence storage.',
      reported_on: '2026-09-18',
      accountable_department_id: departments?.[0]?.id,
      required_outcome: 'Put it right.',
      priority: 'normal',
      owner_email: `storage.${id}@example.com`,
      due_date: '2026-12-01',
      no_further_escalation_reason: 'Integration test',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  const service = serviceClient();
  const { data: contact } = await service
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', `storage.${id}@example.com`)
    .single();
  await service.from('esh_email_principals').update({ access_enabled: true }).eq('id', contact!.id);
  const token = randomBytes(32).toString('base64url');
  await service.from('esh_access_grants').insert({
    organization_id: ORGANIZATION,
    principal_id: contact!.id,
    purpose: 'owner_inbox',
    token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
    issued_reason: 'notification',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const session = randomBytes(32).toString('base64url');
  const { data: exchanged } = await service.rpc('esh_guest_exchange', {
    p_token: token,
    p_new_session: session,
    p_existing_session: null,
    p_challenge: null,
    p_consume: true,
  });
  expect(exchanged).toMatchObject({ ok: true });
  return { session, actionId: (saved as { action_id: string }).action_id };
}

describe('v199 evidence storage', () => {
  it('takes a file only through a signed upload, and gives it back only through a signed link', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const { session, actionId } = await ownerSession(id);
    const service = serviceClient();

    const { data: started } = await service.rpc('esh_guest_start_upload', {
      p_session: session,
      p_action_id: actionId,
      p_name: 'after.jpg',
      p_size: JPEG.byteLength,
    });
    const { asset_id: assetId, object_key: key } = started as {
      asset_id: string;
      object_key: string;
    };

    // Nobody can put a file there without the signed URL.
    const blocked = await anonymous()
      .storage.from(BUCKET)
      .upload(`${key}.other`, JPEG, { contentType: 'image/jpeg' });
    expect(blocked.error).not.toBeNull();

    const { data: signed } = await service.storage.from(BUCKET).createSignedUploadUrl(key);
    const uploaded = await anonymous()
      .storage.from(BUCKET)
      .uploadToSignedUrl(signed!.path, signed!.token, JPEG, { contentType: 'image/jpeg' });
    expect(uploaded.error).toBeNull();

    // What the server does next: read the bytes back and decide what they are.
    const { data: stored } = await service.storage.from(BUCKET).download(key);
    const bytes = new Uint8Array(await stored!.arrayBuffer());
    expect(sniffEvidenceType(bytes.subarray(0, 8192), 'after.jpg')).toBe('image/jpeg');
    const { data: finished } = await service.rpc('esh_guest_finish_upload', {
      p_session: session,
      p_asset_id: assetId,
      p_ok: true,
      p_type: 'image/jpeg',
      p_size: bytes.byteLength,
      p_sha256: createHash('sha256').update(bytes).digest('hex'),
      p_reason: null,
    });
    expect(finished).toMatchObject({ ok: true, state: 'ready' });

    // The anonymous key cannot read it back, by download or by public URL.
    const direct = await anonymous().storage.from(BUCKET).download(key);
    expect(direct.error).not.toBeNull();
    const publicUrl = anonymous().storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);

    // Nor can a signed-in person who is not the server.
    const izzul = await signInAs('izzul');
    const asStaff = await izzul.storage.from(BUCKET).download(key);
    expect(asStaff.error).not.toBeNull();

    // The owner's session is allowed it, through the procedure; the link works.
    const { data: allowed } = await service.rpc('esh_guest_file', {
      p_session: session,
      p_asset_id: assetId,
    });
    expect(allowed).toMatchObject({ ok: true, object_key: key, type: 'image/jpeg' });
    const { data: link } = await service.storage.from(BUCKET).createSignedUrl(key, 300);
    const fetched = await fetch(link!.signedUrl);
    expect(fetched.ok).toBe(true);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it('refuses a type the bucket does not accept, even with a signed URL', async () => {
    const service = serviceClient();
    const key = `probe/${crypto.randomUUID()}.html`;
    const { data: signed } = await service.storage.from(BUCKET).createSignedUploadUrl(key);
    const uploaded = await anonymous()
      .storage.from(BUCKET)
      .uploadToSignedUrl(signed!.path, signed!.token, Buffer.from('<script>alert(1)</script>'), {
        contentType: 'text/html',
      });
    expect(uploaded.error).not.toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { runEshOrphanWorker } from '@/server/esh/orphans';

import { serviceClient, signInAs } from './setup';

/**
 * v286 — the abandoned upload, and the object it left in the bucket.
 *
 * The pgTAP test proves the procedure marks the right rows and hands back the
 * right keys. It cannot prove the object stops existing, because the bucket is
 * not reachable from SQL. This runs the worker against the real local stack
 * and asks storage directly afterwards.
 *
 * Nothing here relies on how many orphans the local database happens to hold —
 * the suite shares one — so every assertion names this test's own asset.
 */

const BUCKET = 'finding-evidence';
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

/** A finding with an action, and an upload agreed but never finished. */
async function agreedUpload(label: string) {
  const izzul = await signInAs('izzul');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data: saved } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v286 orphan sweep ${label}`,
      description: 'Integration coverage for the orphan sweep.',
      reported_on: '2026-11-03',
      accountable_department_id: departments?.[0]?.id,
      required_outcome: 'Put it right.',
      priority: 'normal',
      owner_email: `orphan.${label}@example.com`,
      due_date: '2026-12-30',
      no_further_escalation_reason: 'Integration test',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  const finding = saved as { finding_id: string; action_id: string };

  const { data: started } = await izzul.rpc('esh_start_upload', {
    p_finding_id: finding.finding_id,
    p_action_id: finding.action_id,
    p_purpose: 'message',
    p_name: `${label}.jpg`,
    p_size: JPEG.byteLength,
  });
  const upload = started as { ok: boolean; asset_id: string; object_key: string };
  expect(upload.ok, 'the upload was not agreed').toBe(true);
  return upload;
}

describe('v286 sweeping an upload that never finished', () => {
  it('refuses the row and deletes the object it left behind', async () => {
    const label = `abandoned-${Date.now()}`;
    const upload = await agreedUpload(label);
    const service = serviceClient();

    // The bytes arrive; the server is never told, which is exactly what a lost
    // signal or a closed tab leaves behind.
    const put = await service.storage
      .from(BUCKET)
      .upload(upload.object_key, JPEG, { contentType: 'image/jpeg' });
    expect(put.error, 'the fixture object did not upload').toBeNull();

    // Two hours older, so it is outside the window rather than inside it.
    await service
      .from('esh_evidence_assets')
      .update({ created_at: new Date(Date.now() - 3 * 3_600_000).toISOString() })
      .eq('id', upload.asset_id);

    const summary = await runEshOrphanWorker(service, { olderThanMinutes: 120 });
    expect(summary.abandoned).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBe(0);

    const { data: row } = await service
      .from('esh_evidence_assets')
      .select('state, rejected_reason')
      .eq('id', upload.asset_id)
      .single();
    expect(row).toMatchObject({ state: 'rejected', rejected_reason: 'abandoned' });

    // The point the database cannot make: the object is gone.
    const after = await service.storage.from(BUCKET).download(upload.object_key);
    expect(after.data, 'the abandoned object is still in the bucket').toBeNull();
    expect(after.error).not.toBeNull();
  });

  /*
   * The other half. An upload still in flight is somebody waiting at a screen,
   * and sweeping it would delete the file they are uploading and tell them it
   * was refused.
   */
  it('leaves an upload that is still in flight alone, object and all', async () => {
    const label = `in-flight-${Date.now()}`;
    const upload = await agreedUpload(label);
    const service = serviceClient();
    const put = await service.storage
      .from(BUCKET)
      .upload(upload.object_key, JPEG, { contentType: 'image/jpeg' });
    expect(put.error).toBeNull();

    await runEshOrphanWorker(service, { olderThanMinutes: 120 });

    const { data: row } = await service
      .from('esh_evidence_assets')
      .select('state')
      .eq('id', upload.asset_id)
      .single();
    expect(row?.state).toBe('uploading');
    const after = await service.storage.from(BUCKET).download(upload.object_key);
    expect(after.data, 'an upload in flight had its object deleted').not.toBeNull();

    // Leave nothing behind for the next run to find.
    await service.storage.from(BUCKET).remove([upload.object_key]);
  });
});

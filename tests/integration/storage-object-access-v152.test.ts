import { afterEach, describe, expect, it } from 'vitest';

import { attachmentPolicy } from '@/lib/env';

import { createTask, deleteTask, PEOPLE, serviceClient, signInAs } from './setup';

/**
 * v152 — A27 and A30 at the storage layer.
 *
 * A30: "Manager attempts unrelated employee/file URL — server denies access,
 * including aggregates and storage URLs." The aggregates half was covered by
 * `team-member-workload-v70` and `person-expansion-v143`. The storage half was
 * covered by nothing at all.
 *
 * That absence mattered more than most. The `attachments` table is guarded by
 * RLS and the API route re-checks it, but neither stands between a person and
 * an object: `storage.objects` is a different table with its own policies,
 * which re-derive authorisation from the object's own path. Those policies
 * were correct — every assertion below passed the first time it ran — and
 * nothing would have noticed if a later migration, a bucket recreated by hand,
 * or a `public = true` typed into the dashboard had made them stop being
 * correct. A private bucket that quietly becomes public looks identical from
 * inside the application.
 *
 * A27: "Manager opens completed evidence later — authorized preview/download
 * works, including Office fallback; private link not publicly usable." Both
 * halves are here: the manager can still reach it after the work closes, and
 * the mechanism they reach it through stops working when it expires.
 *
 * The route-level half of the same two scenarios — an unauthenticated or
 * unrelated HTTP request to `/api/attachments/<id>` — is in
 * `tests/e2e/evidence-access-v152.spec.ts`.
 */

const BUCKET = 'task-attachments';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const createdTasks: string[] = [];
const createdObjects: string[] = [];

/** An anonymous client: the anon key and no session, which is what a stranger
 * holding a path has. The key is public by design — it identifies the project,
 * it does not authorise anything. */
async function anonymousClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Evidence on a task owned by Izzah, stored the way the upload action stores
 * it: under the path convention the policies parse, with an `attachments` row
 * pointing at it.
 */
async function evidenceOnIzzahsTask(overrides: Record<string, unknown> = {}) {
  const task = await createTask('izzah', { status: 'active', ...overrides });
  createdTasks.push(task.id);

  const path = `tasks/${task.id}/${crypto.randomUUID()}-reading.csv`;
  const body = 'meter,reading\nA,41.2\n';

  const admin = serviceClient();
  const upload = await admin.storage
    .from(BUCKET)
    .upload(path, new Blob([body], { type: 'text/csv' }), { contentType: 'text/csv' });
  if (upload.error) throw new Error(`Could not stage the object: ${upload.error.message}`);
  createdObjects.push(path);

  const { data: row, error } = await admin
    .from('attachments')
    .insert({
      task_id: task.id,
      storage_bucket: BUCKET,
      storage_path: path,
      file_name: 'reading.csv',
      mime_type: 'text/csv',
      byte_size: body.length,
      is_evidence: true,
      uploaded_by: PEOPLE.izzah.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not record the attachment: ${error.message}`);

  return { taskId: task.id, path, body, attachmentId: String(row!.id) };
}

afterEach(async () => {
  const admin = serviceClient();
  if (createdObjects.length) {
    await admin.storage.from(BUCKET).remove(createdObjects.splice(0));
  }
  while (createdTasks.length) await deleteTask(createdTasks.pop()!);
});

describe('A30 — a storage path is not a way in', () => {
  it('refuses an unauthenticated reader, and tells them nothing by refusing', async () => {
    const { path } = await evidenceOnIzzahsTask();
    const stranger = await anonymousClient();

    const download = await stranger.storage.from(BUCKET).download(path);
    expect(download.error, 'an anonymous reader downloaded private evidence').toBeTruthy();
    expect(download.data).toBeNull();

    // Nor can they have the object signed for them, which would otherwise be
    // the loophole: a signed URL needs no session once it exists.
    const signed = await stranger.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(signed.error, 'an anonymous reader had a private object signed').toBeTruthy();

    /*
     * And the refusal is the same sentence a genuinely absent object gets, so
     * the endpoint cannot be used to ask whether a given task has evidence.
     * The API route takes the same position deliberately — "RLS-denied and
     * absent rows are intentionally indistinguishable" — and it is worth
     * asserting rather than assuming, because the storage layer reaches that
     * position by a different route than the route does.
     */
    const absent = await stranger.storage
      .from(BUCKET)
      .download(`tasks/${crypto.randomUUID()}/${crypto.randomUUID()}-nothing.csv`);
    expect(download.error!.message).toBe(absent.error!.message);
  });

  it('is not served by the public object endpoint, because the bucket is private', async () => {
    const { path } = await evidenceOnIzzahsTask();

    /*
     * §19: "Never use permanent public URLs for private evidence." The
     * application never builds this URL — but somebody reading a path out of
     * the database can, and one `public = true` on the bucket is all that
     * stands between that URL and the file. This is the assertion that would
     * fail if that flag were ever flipped, in a migration or by hand in the
     * dashboard.
     */
    const response = await fetch(`${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`);
    expect(response.ok, 'the private bucket served a file over the public endpoint').toBe(false);
    const said = await response.text();
    expect(said).toContain('Bucket not found');
  });

  it('refuses an employee with no relationship to the work', async () => {
    const { path } = await evidenceOnIzzahsTask();

    // A real session, a real person, and no business with this task.
    const outsider = await signInAs('lim');
    const download = await outsider.storage.from(BUCKET).download(path);
    expect(download.error, 'an unrelated employee read somebody else’s evidence').toBeTruthy();

    const signed = await outsider.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(signed.error, 'an unrelated employee had somebody else’s evidence signed').toBeTruthy();

    /*
     * The control that makes the refusals mean something. Without it, a policy
     * that denied everybody would pass every assertion above and the suite
     * would be green on an application where no evidence could be opened.
     */
    const owner = await signInAs('izzah');
    const allowed = await owner.storage.from(BUCKET).download(path);
    expect(allowed.error, `the owner was refused her own evidence: ${allowed.error?.message}`).toBe(
      null,
    );
  });
});

describe('A27 — evidence the manager opens later', () => {
  it('stays readable to the manager after the work is completed', async () => {
    const { taskId, path, body } = await evidenceOnIzzahsTask();

    /*
     * Closed by hand rather than through `complete_task`. What is under test
     * is whether authorisation survives the status change, and the completion
     * procedure's own rules — evidence requirements, review routing — would
     * decide which fixture could be used here without changing the answer.
     */
    const { error } = await serviceClient()
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_owner_id: PEOPLE.izzah.id,
        completed_by: PEOPLE.izzah.id,
      })
      .eq('id', taskId);
    if (error) throw new Error(`Could not close the fixture: ${error.message}`);

    const manager = await signInAs('izzul');
    const download = await manager.storage.from(BUCKET).download(path);
    expect(
      download.error,
      `the manager lost access when the work closed: ${download.error?.message}`,
    ).toBe(null);
    expect(await download.data!.text()).toBe(body);

    /*
     * §20: "Manager evidence must remain directly openable for authorized
     * year-end review without employees resending files." Directly means a
     * link they can follow, which is a signed URL — and that URL must work
     * with no session, because it is followed by the browser as a plain
     * navigation.
     */
    const signed = await manager.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(signed.error, `the manager could not be given a link: ${signed.error?.message}`).toBe(
      null,
    );
    const followed = await fetch(new URL(signed.data!.signedUrl, supabaseUrl));
    expect(followed.status).toBe(200);
    expect(await followed.text()).toBe(body);
  });

  it('hands out a link that expires, not a permanent one', async () => {
    const { path } = await evidenceOnIzzahsTask();
    const manager = await signInAs('izzul');

    /*
     * One second rather than the configured ttl, so the test measures the
     * mechanism instead of waiting out the policy. `signedUrlTtlSeconds` is
     * asserted separately below: a link that expires in two minutes and one
     * that expires in two years are the same code path and very different
     * things.
     */
    const signed = await manager.storage.from(BUCKET).createSignedUrl(path, 1);
    expect(signed.error).toBe(null);
    const url = new URL(signed.data!.signedUrl, supabaseUrl);

    expect((await fetch(url)).status, 'the link did not work while it was valid').toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const expired = await fetch(url);
    expect(expired.ok, 'an expired evidence link still served the file').toBe(false);
    expect(await expired.text()).toContain('exp');

    // The policy itself. §19 wants short-lived links; two minutes is long
    // enough to open a file and short enough that a copied URL in a chat
    // message is worthless by the time anybody reads it.
    expect(attachmentPolicy.signedUrlTtlSeconds).toBeGreaterThan(0);
    expect(attachmentPolicy.signedUrlTtlSeconds).toBeLessThanOrEqual(900);
  });

  it('will not carry its token from one object to another', async () => {
    const first = await evidenceOnIzzahsTask();
    const second = await evidenceOnIzzahsTask();

    const manager = await signInAs('izzul');
    const signed = await manager.storage.from(BUCKET).createSignedUrl(first.path, 60);
    expect(signed.error).toBe(null);

    /*
     * The obvious attack on a signing scheme, and the reason the path has to
     * be inside what is signed: a manager legitimately holding a link to one
     * file must not be able to edit the path in the address bar and read
     * another. Both objects here are readable by this manager, so a failure
     * would not be visible in ordinary use — it would show up the first time
     * somebody swapped in a path belonging to a team they do not manage.
     */
    const swapped = signed.data!.signedUrl.replace(first.path, second.path);
    expect(swapped, 'the path is not in the URL, so this proves nothing').not.toBe(
      signed.data!.signedUrl,
    );

    const response = await fetch(new URL(swapped, supabaseUrl));
    expect(response.ok, 'a signed link was redirected to a different object').toBe(false);
    expect(await response.text()).toContain('Invalid signature');
  });
});

describe('§19 — the pipeline stores the formats the interface offers', () => {
  it('accepts every advertised type', async () => {
    /*
     * "Do not advertise formats the pipeline rejects." Six were advertised and
     * rejected: HEIC, HEIF, legacy .doc, legacy .xls, and both PowerPoint
     * types — so no deck of any kind could be stored as evidence, and neither
     * could an iPhone photograph, which is the single most likely file
     * somebody has after walking an inspection. The bucket predated the format
     * list by a month and nothing compared the two.
     *
     * Uploaded as the owner rather than through the service role, so this
     * covers the whole path: the INSERT policy on `storage.objects`, the
     * bucket's own type check, and the list the interface reads from.
     */
    const task = await createTask('izzah', { status: 'active' });
    createdTasks.push(task.id);
    const owner = await signInAs('izzah');

    const refused: string[] = [];
    for (const type of attachmentPolicy.allowedMimeTypes) {
      const path = `tasks/${task.id}/${crypto.randomUUID()}-sample`;
      const { error } = await owner.storage
        .from(BUCKET)
        .upload(path, new Blob(['sample'], { type }), { contentType: type });
      if (error) refused.push(`${type} — ${error.message}`);
      else createdObjects.push(path);
    }

    expect(refused, `the interface offers types the bucket will not store`).toEqual([]);
    expect(attachmentPolicy.allowedMimeTypes.length).toBeGreaterThan(0);
  });

  it('refuses a type the application never offered, without relying on the application', async () => {
    /*
     * The bucket is the second gate, not decoration. `refuseAttachments` runs
     * in the browser and again in the server action, and both are code that a
     * future route could forget to call; the allow-list on the bucket is
     * enforced by Supabase for every writer, including one holding a stolen
     * session. §19: "User-provided MIME or filename alone is not trustworthy."
     */
    const task = await createTask('izzah', { status: 'active' });
    createdTasks.push(task.id);
    const owner = await signInAs('izzah');

    const path = `tasks/${task.id}/${crypto.randomUUID()}-tool.exe`;
    const { error } = await owner.storage
      .from(BUCKET)
      .upload(path, new Blob(['MZ'], { type: 'application/x-msdownload' }), {
        contentType: 'application/x-msdownload',
      });

    if (!error) createdObjects.push(path);
    expect(error, 'the bucket stored an executable').toBeTruthy();
    expect(error!.message).toContain('mime type');
  });
});

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  assertObjectKey,
  assertOutsideRepository,
  backupStorage,
  objectFile,
  readVerifiedManifest,
  restoreStorage,
} from '../../scripts/lib/storage-backup.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fakeClient(initial = {}) {
  const objects = new Map(
    Object.entries(initial).map(([bucket, entries]) => [
      bucket,
      new Map(Object.entries(entries).map(([key, value]) => [key, Buffer.from(value)])),
    ]),
  );
  const state = {
    failDownload: false,
    failList: false,
    publicBucket: false,
    changeInventory: false,
    corruptUpload: false,
    listCalls: [],
  };
  return {
    objects,
    state,
    storage: {
      async getBucket() {
        return { data: { public: state.publicBucket }, error: null };
      },
      from(bucket) {
        const items = objects.get(bucket) ?? new Map();
        objects.set(bucket, items);
        return {
          async list(prefix, { limit, offset }) {
            state.listCalls.push({ bucket, prefix, offset });
            if (state.failList) return { data: null, error: new Error('failed') };
            if (
              state.changeInventory &&
              bucket === 'finding-evidence' &&
              prefix === '' &&
              offset === 0 &&
              state.listCalls.filter((call) => call.bucket === bucket && call.prefix === '')
                .length === 2
            ) {
              items.set('late-object', Buffer.from('late'));
            }
            const children = new Map();
            for (const key of items.keys()) {
              if (prefix && !key.startsWith(`${prefix}/`)) continue;
              const rest = prefix ? key.slice(prefix.length + 1) : key;
              const [name, ...tail] = rest.split('/');
              if (tail.length) children.set(name, { name, id: null });
              else children.set(name, { name, id: `id-${key}`, updated_at: '2026-10-31' });
            }
            return {
              data: [...children.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .slice(offset, offset + limit),
              error: null,
            };
          },
          async download(key) {
            if (state.failDownload) return { data: null, error: new Error('failed') };
            const bytes = items.get(key);
            return bytes
              ? { data: new Blob([bytes], { type: 'application/octet-stream' }), error: null }
              : { data: null, error: new Error('missing') };
          },
          async upload(key, bytes) {
            items.set(key, state.corruptUpload ? Buffer.from('wrong') : Buffer.from(bytes));
            return { error: null };
          },
        };
      },
    },
  };
}

/**
 * The `*-storage.sql` a real backup run writes moments before walking the
 * buckets, rendered for whatever the fake client holds.
 *
 * Every successful backup below now needs one, because a run that cannot be
 * checked against the database's own record is no longer allowed to call
 * itself complete. That makes these tests stricter, not looser: the happy
 * paths now also prove the completeness gate agrees with them.
 */
const DUMP_COLUMNS =
  '"id", "bucket_id", "name", "owner", "created_at", "updated_at", ' +
  '"last_accessed_at", "metadata", "version", "owner_id", "user_metadata", ' +
  '"archived_at", "is_delete_marker", "is_versioned"';

function dumpRow(bucket, key, { deleteMarker = false } = {}) {
  return (
    `\t('${randomUUID()}', '${bucket}', '${key.replaceAll("'", "''")}', NULL, ` +
    `'2026-10-31 00:00:00+00', '2026-10-31 00:00:00+00', NULL, ` +
    `'{"eTag": "\\"abc\\"", "size": 1, "mimetype": "image/jpeg"}', 'v1', NULL, ` +
    `'{}', NULL, ${deleteMarker}, false)`
  );
}

async function recordObjects(directory, held, extraRows = []) {
  const rows = [...extraRows];
  for (const [bucket, entries] of Object.entries(held)) {
    for (const key of Object.keys(entries)) rows.push(dumpRow(bucket, key));
  }
  const sql = rows.length
    ? `INSERT INTO "storage"."objects" (${DUMP_COLUMNS}) VALUES\n${rows.join(',\n')};\n`
    : '';
  await writeFile(join(directory, 'run-storage.sql'), sql);
  return sql;
}

async function inTemp(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'tamco-storage-test-'));
  try {
    return await callback(directory);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
}

test('backs up nested keys and identical keys in separate private buckets, then restores bytes', () =>
  inTemp(async (dir) => {
    const held = {
      'task-attachments': { 'nested/photo.jpg': 'task bytes' },
      'finding-evidence': { 'nested/photo.jpg': 'finding bytes' },
    };
    await recordObjects(dir, held);
    const source = fakeClient(held);
    const manifest = await backupStorage(source, dir);
    assert.equal(manifest.count, 2);
    assert.notEqual(
      objectFile(dir, 'task-attachments', 'nested/photo.jpg'),
      objectFile(dir, 'finding-evidence', 'nested/photo.jpg'),
    );
    assert.deepEqual(
      manifest.objects.map(({ bucket, object_key, size, sha256 }) => ({
        bucket,
        object_key,
        size,
        sha256,
      })),
      [
        {
          bucket: 'task-attachments',
          object_key: 'nested/photo.jpg',
          size: 10,
          sha256: hash(Buffer.from('task bytes')),
        },
        {
          bucket: 'finding-evidence',
          object_key: 'nested/photo.jpg',
          size: 13,
          sha256: hash(Buffer.from('finding bytes')),
        },
      ],
    );
    const target = fakeClient();
    assert.equal(await restoreStorage(target, dir, await readVerifiedManifest(dir)), 2);
    assert.deepEqual(
      target.objects.get('task-attachments').get('nested/photo.jpg'),
      Buffer.from('task bytes'),
    );
    assert.deepEqual(
      target.objects.get('finding-evidence').get('nested/photo.jpg'),
      Buffer.from('finding bytes'),
    );
  }));

test('pagination includes entries beyond the first page at root and nested levels', () =>
  inTemp(async (dir) => {
    const entries = Object.fromEntries(
      Array.from({ length: 105 }, (_, index) => [
        `nested/${String(index).padStart(3, '0')}`,
        `nested-byte${index}`,
      ]).concat(
        Array.from({ length: 105 }, (_, index) => [
          `root-${String(index).padStart(3, '0')}`,
          `root-byte${index}`,
        ]),
      ),
    );
    await recordObjects(dir, { 'task-attachments': entries });
    const source = fakeClient({ 'task-attachments': entries });
    const manifest = await backupStorage(source, dir);
    assert.equal(manifest.count, 210);
    assert(source.state.listCalls.some((call) => call.prefix === '' && call.offset === 100));
    assert(source.state.listCalls.some((call) => call.prefix === 'nested' && call.offset === 100));
  }));

test('a failed download cannot produce a complete manifest', () =>
  inTemp(async (dir) => {
    const source = fakeClient({ 'finding-evidence': { photo: 'bytes' } });
    source.state.failDownload = true;
    await assert.rejects(backupStorage(source, dir), /download failed/);
    await assert.rejects(readFile(join(dir, 'storage-manifest.json')), /ENOENT/);
  }));

test('a failed listing or public bucket cannot produce a complete backup', () =>
  inTemp(async (dir) => {
    const source = fakeClient({ 'finding-evidence': { photo: 'bytes' } });
    source.state.failList = true;
    await assert.rejects(backupStorage(source, dir), /listing failed/);
    source.state.failList = false;
    source.state.publicBucket = true;
    // Says which failure it is. The three cases - the bucket could not be
    // read, it does not exist, it is public - used to share one sentence, and
    // the sentence named the worst of them: a key issued for another project
    // reported a private production bucket as "unavailable or public".
    await assert.rejects(backupStorage(source, dir), /is PUBLIC and must not be/);
    await assert.rejects(readFile(join(dir, 'storage-manifest.json')), /ENOENT/);
  }));

test('an object arriving during the bucket walk prevents completion', () =>
  inTemp(async (dir) => {
    const source = fakeClient({ 'finding-evidence': { photo: 'bytes' } });
    source.state.changeInventory = true;
    await assert.rejects(backupStorage(source, dir), /inventory changed/);
    await assert.rejects(readFile(join(dir, 'storage-manifest.json')), /ENOENT/);
  }));

test('corrupted saved bytes are refused before restore', () =>
  inTemp(async (dir) => {
    await recordObjects(dir, { 'finding-evidence': { photo: 'right' } });
    await backupStorage(fakeClient({ 'finding-evidence': { photo: 'right' } }), dir);
    await writeFile(objectFile(dir, 'finding-evidence', 'photo'), 'wrong');
    await assert.rejects(readVerifiedManifest(dir), /bytes mismatch/);
  }));

test('a missing saved object is refused before restore', () =>
  inTemp(async (dir) => {
    await recordObjects(dir, { 'finding-evidence': { photo: 'right' } });
    await backupStorage(fakeClient({ 'finding-evidence': { photo: 'right' } }), dir);
    await unlink(objectFile(dir, 'finding-evidence', 'photo'));
    await assert.rejects(readVerifiedManifest(dir), /object missing/);
  }));

test('unsafe paths are rejected before writing any object', async () => {
  for (const key of ['../escape', '/absolute', 'a//b', 'a/./b', 'a/../b', 'a\\b']) {
    assert.throws(() => assertObjectKey(key), /Unsafe/);
  }
  await inTemp(async (dir) => {
    await assert.rejects(
      backupStorage(fakeClient({ 'finding-evidence': { '../escape': 'x' } }), dir),
      /Unsafe/,
    );
    await assert.rejects(readFile(join(dir, 'storage-manifest.json')), /ENOENT/);
  });
});

test('backup data cannot be written inside the repository', () => {
  assert.throws(
    () => assertOutsideRepository('/workspace/repo/backup', '/workspace/repo'),
    /outside/,
  );
  assert.throws(() => assertOutsideRepository('/workspace/repo', '/workspace/repo'), /outside/);
  assert.throws(
    () => assertOutsideRepository('/workspace/repo/..sibling', '/workspace/repo'),
    /outside/,
  );
  assert.doesNotThrow(() => assertOutsideRepository('/workspace/backups', '/workspace/repo'));
});

test('a restored byte hash mismatch is refused', () =>
  inTemp(async (dir) => {
    await recordObjects(dir, { 'finding-evidence': { photo: 'right' } });
    await backupStorage(fakeClient({ 'finding-evidence': { photo: 'right' } }), dir);
    const target = fakeClient();
    target.state.corruptUpload = true;
    await assert.rejects(
      restoreStorage(target, dir, await readVerifiedManifest(dir)),
      /hash mismatch/,
    );
  }));

// ---------------------------------------------------------------------------
// Completeness: the backup is checked against the database, not against itself
//
// Every assertion above traces back to one bucket listing. These do not: they
// use `storage.objects`, which is Postgres's own record of what the buckets
// hold, so a listing that silently came back short is caught instead of being
// certified.
// ---------------------------------------------------------------------------

test('an object the database lists but the listing missed is refused', () =>
  inTemp(async (dir) => {
    // The database knows about two files; the bucket only hands over one.
    await recordObjects(dir, {
      'finding-evidence': { photo: 'bytes', 'nested/missed.jpg': 'bytes' },
    });
    await assert.rejects(
      backupStorage(fakeClient({ 'finding-evidence': { photo: 'bytes' } }), dir),
      /no saved bytes.*finding-evidence: 1/s,
    );
    // And it is not allowed to look like a finished run.
    await assert.rejects(readFile(join(dir, 'storage-manifest.json')), /ENOENT/);
  }));

test('a bucket nobody is backing up is refused rather than ignored', () =>
  inTemp(async (dir) => {
    await recordObjects(dir, { 'finding-evidence': { photo: 'bytes' } }, [
      dumpRow('goal-evidence', 'nested/unknown.jpg'),
    ]);
    await assert.rejects(
      backupStorage(fakeClient({ 'finding-evidence': { photo: 'bytes' } }), dir),
      /buckets this backup does not cover.*goal-evidence: 1/s,
    );
  }));

test('a delete marker is a record, not a file, and is not demanded on disk', () =>
  inTemp(async (dir) => {
    await recordObjects(dir, { 'finding-evidence': { photo: 'bytes' } }, [
      dumpRow('finding-evidence', 'nested/deleted.jpg', { deleteMarker: true }),
    ]);
    const manifest = await backupStorage(
      fakeClient({ 'finding-evidence': { photo: 'bytes' } }),
      dir,
    );
    assert.equal(manifest.count, 1);
  }));

test('a file uploaded after the dump is kept, not treated as a fault', () =>
  inTemp(async (dir) => {
    // The dump is taken moments before the walk, so the backup can legitimately
    // hold more than the record. Holding more is not an incomplete backup.
    await recordObjects(dir, { 'finding-evidence': { photo: 'bytes' } });
    const manifest = await backupStorage(
      fakeClient({ 'finding-evidence': { photo: 'bytes', 'nested/later.jpg': 'newer' } }),
      dir,
    );
    assert.equal(manifest.count, 2);
  }));

test('a dump row that cannot be read is refused, never skipped', () =>
  inTemp(async (dir) => {
    // One field short. Skipping it would turn an unreadable record into an
    // apparently complete backup, which is the whole failure being guarded.
    await writeFile(
      join(dir, 'run-storage.sql'),
      `INSERT INTO "storage"."objects" (${DUMP_COLUMNS}) VALUES\n\t('only', 'two')\n;\n`,
    );
    await assert.rejects(
      backupStorage(fakeClient({ 'finding-evidence': { photo: 'bytes' } }), dir),
      /does not match its columns/,
    );
  }));

test('a truncated dump is refused', () =>
  inTemp(async (dir) => {
    await writeFile(
      join(dir, 'run-storage.sql'),
      `INSERT INTO "storage"."objects" (${DUMP_COLUMNS}) VALUES\n` +
        `\t('a', 'finding-evidence', 'photo', NULL, 'x', 'x', NULL, '{`,
    );
    await assert.rejects(
      backupStorage(fakeClient({ 'finding-evidence': { photo: 'bytes' } }), dir),
      /truncated/,
    );
  }));

test('a run with no database record beside it cannot be restored as proven', () =>
  inTemp(async (dir) => {
    await recordObjects(dir, { 'finding-evidence': { photo: 'right' } });
    await backupStorage(fakeClient({ 'finding-evidence': { photo: 'right' } }), dir);
    await unlink(join(dir, 'run-storage.sql'));
    await assert.rejects(readVerifiedManifest(dir), /must sit beside the manifest/);
  }));

test('an object key is never printed, because keys carry original filenames', () =>
  inTemp(async (dir) => {
    const secret = 'nested/Site-photo-of-Ahmad-injury.jpg';
    await recordObjects(dir, { 'finding-evidence': { photo: 'bytes', [secret]: 'bytes' } });
    await assert.rejects(
      backupStorage(fakeClient({ 'finding-evidence': { photo: 'bytes' } }), dir),
      (error) => {
        assert.match(error.message, /no saved bytes/);
        assert.doesNotMatch(error.message, /Ahmad|injury|\.jpg/);
        return true;
      },
    );
  }));

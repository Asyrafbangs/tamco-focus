import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    const source = fakeClient({
      'task-attachments': { 'nested/photo.jpg': 'task bytes' },
      'finding-evidence': { 'nested/photo.jpg': 'finding bytes' },
    });
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
    await assert.rejects(backupStorage(source, dir), /unavailable or public/);
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
    await backupStorage(fakeClient({ 'finding-evidence': { photo: 'right' } }), dir);
    await writeFile(objectFile(dir, 'finding-evidence', 'photo'), 'wrong');
    await assert.rejects(readVerifiedManifest(dir), /bytes mismatch/);
  }));

test('a missing saved object is refused before restore', () =>
  inTemp(async (dir) => {
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
    await backupStorage(fakeClient({ 'finding-evidence': { photo: 'right' } }), dir);
    const target = fakeClient();
    target.state.corruptUpload = true;
    await assert.rejects(
      restoreStorage(target, dir, await readVerifiedManifest(dir)),
      /hash mismatch/,
    );
  }));

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const BACKUP_BUCKETS = ['task-attachments', 'finding-evidence'];
const PAGE_SIZE = 100;

export function assertOutsideRepository(directory, repoRoot) {
  const path = relative(resolve(repoRoot), resolve(directory));
  if (!path || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))) {
    throw new Error('Backup directory must be outside the repository.');
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertObjectKey(key) {
  if (
    typeof key !== 'string' ||
    !key ||
    key.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(key) ||
    key.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Unsafe storage object key; backup is incomplete.');
  }
  return key;
}

/** Hash each path segment so keys remain nested without trusting them as disk paths. */
export function objectFile(runDirectory, bucket, key) {
  if (!BACKUP_BUCKETS.includes(bucket)) throw new Error('Unexpected storage bucket.');
  return join(
    runDirectory,
    'objects',
    bucket,
    ...assertObjectKey(key)
      .split('/')
      .map((part) => sha256(Buffer.from(part))),
  );
}

async function privateBucket(client, bucket) {
  const { data, error } = await client.storage.getBucket(bucket);
  if (error || !data || data.public !== false) {
    throw new Error(`Private storage bucket ${bucket} is unavailable or public.`);
  }
  return client.storage.from(bucket);
}

/** Recursive folder walk; paginate every level, including the root. */
async function inventoryBucket(store) {
  const found = new Map();
  async function visit(prefix) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await store.list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error || !Array.isArray(data))
        throw new Error('Storage listing failed; backup incomplete.');
      for (const entry of data) {
        if (!entry || typeof entry.name !== 'string') {
          throw new Error('Invalid storage listing; backup incomplete.');
        }
        const key = assertObjectKey(prefix ? `${prefix}/${entry.name}` : entry.name);
        if (entry.id == null) {
          await visit(key);
        } else {
          if (found.has(key))
            throw new Error('Duplicate storage object listing; backup incomplete.');
          found.set(key, {
            key,
            id: entry.id,
            updatedAt: entry.updated_at ?? null,
            metadata: entry.metadata ?? null,
          });
        }
      }
      if (data.length < PAGE_SIZE) break;
    }
  }
  await visit('');
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function sameInventory(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateManifest(manifest) {
  if (
    manifest?.version !== 1 ||
    !Array.isArray(manifest.objects) ||
    !Array.isArray(manifest.buckets) ||
    BACKUP_BUCKETS.some((bucket) => !manifest.buckets.includes(bucket))
  ) {
    throw new Error('Invalid or incomplete storage manifest.');
  }
  const seen = new Set();
  const files = new Set();
  for (const object of manifest.objects) {
    const { bucket, object_key: key, size, sha256: hash } = object;
    if (
      !BACKUP_BUCKETS.includes(bucket) ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !/^[0-9a-f]{64}$/.test(hash)
    ) {
      throw new Error('Invalid storage manifest entry.');
    }
    assertObjectKey(key);
    const identity = `${bucket}\0${key}`;
    if (seen.has(identity)) throw new Error('Duplicate storage object in manifest.');
    seen.add(identity);
    const file = objectFile('', bucket, key);
    if (files.has(file)) throw new Error('Storage object disk path collision.');
    files.add(file);
  }
  if (manifest.count !== manifest.objects.length)
    throw new Error('Storage manifest count mismatch.');
}

export async function backupStorage(client, runDirectory, createdAt = new Date().toISOString()) {
  const objects = [];
  for (const bucket of BACKUP_BUCKETS) {
    const store = await privateBucket(client, bucket);
    const before = await inventoryBucket(store);
    for (const item of before) {
      const { data, error } = await store.download(item.key);
      if (error || !data) throw new Error('Storage download failed; backup incomplete.');
      const bytes = Buffer.from(await data.arrayBuffer());
      const file = objectFile(runDirectory, bucket, item.key);
      await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      objects.push({
        bucket,
        object_key: item.key,
        size: bytes.length,
        sha256: sha256(bytes),
        content_type: item.metadata?.mimetype ?? data.type ?? 'application/octet-stream',
        cache_control: item.metadata?.cacheControl ?? null,
        source_id: item.id,
        source_updated_at: item.updatedAt,
      });
    }
    const after = await inventoryBucket(store);
    if (!sameInventory(before, after)) {
      throw new Error('Storage inventory changed during backup; backup incomplete.');
    }
  }
  const manifest = {
    version: 1,
    created_at: createdAt,
    buckets: BACKUP_BUCKETS,
    count: objects.length,
    objects,
  };
  validateManifest(manifest);
  await writeFile(
    join(runDirectory, 'storage-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  return manifest;
}

/** Validate every saved byte before any destructive local database operation. */
export async function readVerifiedManifest(runDirectory) {
  if (runDirectory.endsWith('.incomplete')) {
    throw new Error('Incomplete backup run cannot be restored.');
  }
  const manifest = JSON.parse(await readFile(join(runDirectory, 'storage-manifest.json'), 'utf8'));
  validateManifest(manifest);
  for (const object of manifest.objects) {
    let bytes;
    try {
      bytes = await readFile(objectFile(runDirectory, object.bucket, object.object_key));
    } catch {
      throw new Error('Storage backup object missing; restore not proven.');
    }
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) {
      throw new Error('Storage backup bytes mismatch; restore not proven.');
    }
  }
  return manifest;
}

/** Upload to a positively identified local stack, then read it back independently. */
export async function restoreStorage(client, runDirectory, manifest) {
  validateManifest(manifest);
  for (const bucket of BACKUP_BUCKETS) await privateBucket(client, bucket);
  for (const object of manifest.objects) {
    const bytes = await readFile(objectFile(runDirectory, object.bucket, object.object_key));
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) {
      throw new Error('Storage backup bytes mismatch; restore not proven.');
    }
    const store = client.storage.from(object.bucket);
    const { error: uploadError } = await store.upload(object.object_key, bytes, {
      upsert: true,
      contentType: object.content_type ?? 'application/octet-stream',
    });
    if (uploadError) throw new Error('Storage restore upload failed; restore not proven.');
    const { data, error } = await store.download(object.object_key);
    if (error || !data) throw new Error('Restored storage object missing; restore not proven.');
    const restored = Buffer.from(await data.arrayBuffer());
    if (restored.length !== object.size || sha256(restored) !== object.sha256) {
      throw new Error('Restored storage hash mismatch; restore not proven.');
    }
  }
  return manifest.objects.length;
}

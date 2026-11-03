import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
  /*
   * Three different failures used to share one sentence, and the sentence
   * named the worst of them. A key issued for another project cannot read any
   * bucket, so "unavailable or public" was reported about a bucket that is
   * neither - and read as a security finding. Each case now says which it is.
   */
  if (error) {
    throw new Error(
      `Storage bucket ${bucket} could not be read: ${error.message}. ` +
        'A key issued for another project reports this, so check the key and the URL ' +
        'identify the same project before reading anything into it.',
    );
  }
  if (!data) {
    throw new Error(`Storage bucket ${bucket} does not exist on this project.`);
  }
  if (data.public !== false) {
    throw new Error(`Storage bucket ${bucket} is PUBLIC and must not be.`);
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

// ---------------------------------------------------------------------------
// Completeness, checked against something other than ourselves
//
// Everything above is self-consistent: the manifest comes from a bucket
// listing, the saved bytes are checked against the manifest, and the restored
// bytes are checked against the manifest again. None of that can notice a
// listing that came back short, which is the one failure a backup must not
// have — and AGENTS.md section 11 is explicit that an expected value must not
// be derived from the thing under test.
//
// The independent witness is already in the run directory. `storage.objects`
// is Postgres's own record of what the buckets hold, dumped moments earlier by
// this same backup. A row in it with no object in the manifest means something
// was missed, and a run that missed something is not a backup.
//
// Object keys carry original filenames, so nothing below ever prints a key.
// Bucket names and counts only.
// ---------------------------------------------------------------------------

/** Split a VALUES block into tuples, respecting quotes so JSON commas survive. */
function tuples(block) {
  const rows = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    if (quoted) {
      if (ch === "'" && block[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      if (ch === "'") quoted = false;
      current += ch;
      continue;
    }
    if (ch === "'") {
      quoted = true;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      if (depth === 1) {
        current = '';
        continue;
      }
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        rows.push(current);
        continue;
      }
    }
    if (ch === ';' && depth === 0) break;
    if (depth > 0) current += ch;
  }
  if (depth !== 0 || quoted) {
    throw new Error('Storage dump is truncated; completeness cannot be proven.');
  }
  return rows;
}

/** One tuple's fields, with quotes removed and doubled quotes unescaped. */
function fields(row) {
  const out = [];
  let quoted = false;
  let current = '';
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (quoted) {
      if (ch === "'" && row[i + 1] === "'") {
        current += "'";
        i += 1;
        continue;
      }
      if (ch === "'") {
        quoted = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'") {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

/**
 * What `storage.objects` says exists, from a `*-storage.sql` dump, as
 * `Map<bucket, Set<key>>`.
 *
 * A row that cannot be parsed throws rather than being skipped: skipping is
 * precisely how a short list becomes an apparently complete backup. Delete
 * markers are not objects and are not expected on disk.
 */
export function objectsInStorageDump(sql) {
  const marker = /INSERT INTO "storage"\."objects" \(([^)]*)\)\s*VALUES/.exec(sql);
  if (!marker) return new Map();
  const columns = marker[1].split(',').map((name) => name.trim().replaceAll('"', ''));
  const bucketAt = columns.indexOf('bucket_id');
  const nameAt = columns.indexOf('name');
  const markerAt = columns.indexOf('is_delete_marker');
  if (bucketAt < 0 || nameAt < 0) {
    throw new Error('Storage dump names no bucket_id/name column; completeness unproven.');
  }
  const found = new Map();
  for (const row of tuples(sql.slice(marker.index + marker[0].length))) {
    const parts = fields(row);
    if (parts.length !== columns.length) {
      throw new Error('Storage dump row does not match its columns; completeness unproven.');
    }
    if (markerAt >= 0 && parts[markerAt].toLowerCase() === 'true') continue;
    const bucket = parts[bucketAt];
    const key = parts[nameAt];
    if (!bucket || !key) {
      throw new Error('Storage dump row has no bucket or key; completeness unproven.');
    }
    if (!found.has(bucket)) found.set(bucket, new Set());
    found.get(bucket).add(key);
  }
  return found;
}

/** The run's own `*-storage.sql`. Absent means completeness cannot be claimed. */
export async function readStorageDump(runDirectory) {
  const dumps = (await readdir(runDirectory)).filter((name) => name.endsWith('-storage.sql'));
  if (dumps.length !== 1) {
    throw new Error(
      'Exactly one *-storage.sql must sit beside the manifest to prove completeness.',
    );
  }
  return readFile(join(runDirectory, dumps[0]), 'utf8');
}

/**
 * Refuse a manifest that does not account for every object the database lists.
 *
 * Asymmetric on purpose. The storage dump is taken moments before the bucket
 * walk, so a file uploaded in between appears in the manifest and not in the
 * dump — harmless, the backup simply holds more than the record, and the count
 * is reported. The other direction is not harmless: a recorded row with no
 * saved bytes is either an omission or a deletion mid-run, and neither may
 * pass as a proven backup.
 */
export function assertManifestCovers(manifest, sql) {
  validateManifest(manifest);
  const recorded = objectsInStorageDump(sql);
  const saved = new Map();
  for (const object of manifest.objects) {
    if (!saved.has(object.bucket)) saved.set(object.bucket, new Set());
    saved.get(object.bucket).add(object.object_key);
  }

  const describe = (counts) => [...counts].map(([bucket, n]) => `${bucket}: ${n}`).join(', ');
  const foreign = new Map();
  const missing = new Map();
  let recordedTotal = 0;
  for (const [bucket, keys] of recorded) {
    recordedTotal += keys.size;
    if (!BACKUP_BUCKETS.includes(bucket)) {
      foreign.set(bucket, keys.size);
      continue;
    }
    const here = saved.get(bucket) ?? new Set();
    const absent = [...keys].filter((key) => !here.has(key)).length;
    if (absent) missing.set(bucket, absent);
  }

  if (foreign.size) {
    throw new Error(
      `Storage holds objects in buckets this backup does not cover (${describe(foreign)}); ` +
        'add the bucket or record the exclusion before claiming a complete backup.',
    );
  }
  if (missing.size) {
    throw new Error(
      `The database lists objects with no saved bytes (${describe(missing)}); ` +
        'the backup is incomplete. Re-run it; if it repeats, the listing is short.',
    );
  }
  return { recorded: recordedTotal, saved: manifest.objects.length };
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
  // Against the database's own record, before this run may call itself complete.
  assertManifestCovers(manifest, await readStorageDump(runDirectory));
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
  // Again at restore time, so a backup that lost objects after it was written,
  // or was taken before this check existed, cannot be restored as proven.
  assertManifestCovers(manifest, await readStorageDump(runDirectory));
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

import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { args, config, sha256, md5, pool, immutableCache, latestCache } from './common.mjs';

export async function readPlan(path) {
  if (!path) throw new Error('Pass --plan .r2-upload/<revision>/inventory.json.');
  const plan = JSON.parse(await readFile(path, 'utf8'));
  if (plan.version !== 1 || plan.bucket !== config.bucket || plan.accountId !== config.accountId ||
      plan.domain !== config.domain || !/^[a-f0-9]{64}$/.test(plan.revision))
    throw new Error('Upload plan does not match this repository target.');
  const pinned = `characters/packs/${plan.revision}/`;
  const keys = new Set();
  for (const object of plan.objects) {
    const asset = /^versions\/[a-f0-9]{64}\.(glb|png)$/.test(object.key);
    const metadata = object.key.startsWith(pinned) && /^(manifest\.json|provenance\.json|source-map\.json|licenses\/[a-zA-Z0-9_.-]+\.txt)$/.test(object.key.slice(pinned.length));
    const latest = object.key === 'characters/manifest.json';
    if ((!asset && !metadata && !latest) || keys.has(object.key) || object.mutable !== latest ||
        object.cacheControl !== (latest ? latestCache : immutableCache))
      throw new Error('Invalid object path or publication policy in plan.');
    keys.add(object.key);
    const body = await readFile(join(dirname(path), 'objects', object.key));
    if (body.length !== object.bytes || sha256(body) !== object.sha256)
      throw new Error(`Prepared object integrity failed: ${object.key}`);
    if (asset && object.key.slice(9, 73) !== object.sha256)
      throw new Error(`Asset key integrity failed: ${object.key}`);
    object.body = body;
  }
  if (!keys.has('characters/manifest.json') || !keys.has(`${pinned}manifest.json`))
    throw new Error('Both pinned and latest manifests must be present.');
  const manifest = JSON.parse(plan.objects.find(o => o.key === 'characters/manifest.json').body);
  if (plan.objects.find(o => o.key === 'characters/manifest.json').sha256 !==
      plan.objects.find(o => o.key === `${pinned}manifest.json`).sha256)
    throw new Error('Pinned and latest manifests differ.');
  if (sha256(JSON.stringify({ ...manifest, revision: '' })) !== plan.revision || manifest.revision !== plan.revision)
    throw new Error('Prepared manifest revision failed.');
  const { assetReferences, checkAsset } = await import('./common.mjs');
  for (const asset of assetReferences(manifest)) {
    checkAsset(asset);
    const object = plan.objects.find(o => o.key === `versions/${asset.file}`);
    if (!object) throw new Error(`Plan omits required asset: ${asset.file}`);
    if (object.bytes !== asset.bytes || object.sha256 !== asset.sha256)
      throw new Error(`Plan metadata differs from manifest: ${asset.file}`);
  }
  return plan;
}

export async function upload(plan, client, { publishLatest = false, progress = () => {} } = {}) {
  let uploaded = 0, skipped = 0;
  async function put(object) {
    const input = { Bucket: plan.bucket, Key: object.key };
    let existing;
    try { existing = await client.send(new HeadObjectCommand(input)); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
    const same = existing && existing.ContentLength === object.bytes &&
      (existing.Metadata?.sha256 === object.sha256 || existing.ETag === `"${md5(object.body)}"`);
    if (existing && !same && !object.mutable) throw new Error(`Immutable object conflict: ${object.key}`);
    if (same && existing.ContentType === object.contentType && existing.CacheControl === object.cacheControl) {
      skipped++; progress({ uploaded, skipped }); return;
    }
    await client.send(new PutObjectCommand({ ...input, Body: object.body,
      ContentType: object.contentType, CacheControl: object.cacheControl,
      Metadata: { sha256: object.sha256 },
      ...(existing ? { IfMatch: existing.ETag } : { IfNoneMatch: '*' }),
    }));
    const verified = await client.send(new HeadObjectCommand(input));
    if (verified.ContentLength !== object.bytes || verified.Metadata?.sha256 !== object.sha256 ||
        verified.ContentType !== object.contentType || verified.CacheControl !== object.cacheControl)
      throw new Error(`Uploaded object verification failed: ${object.key}`);
    uploaded++; progress({ uploaded, skipped });
  }
  const immutable = plan.objects.filter(object => !object.mutable);
  await pool(immutable.filter(object => !object.key.endsWith('/manifest.json')), put);
  await pool(immutable.filter(object => object.key.endsWith('/manifest.json')), put, 1);
  // Latest is an explicit release step after every immutable object is verified.
  if (publishLatest) await put(plan.objects.find(object => object.mutable));
  return { uploaded, skipped, latestPublished: publishLatest, revision: plan.revision };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = args({ 'publish-latest': { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false } });
  const plan = await readPlan(options.plan);
  if (options['dry-run']) {
    console.log(JSON.stringify({ bucket: plan.bucket, objects: plan.objects.length, bytes: plan.totalBytes,
      revision: plan.revision, publishLatest: options['publish-latest'] }, null, 2));
  } else {
    if (!/^[a-f0-9]{32}$/.test(config.accountId ?? ''))
      throw new Error('Set accountId in the private infrastructure/r2/config.local.json before uploading.');
    const { R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
    if (!accessKeyId || !secretAccessKey) throw new Error('Set bucket-scoped R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env.');
    const client = new S3Client({ endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`, region: 'auto',
      credentials: { accessKeyId, secretAccessKey }, maxAttempts: 3, requestChecksumCalculation: 'WHEN_REQUIRED' });
    try {
      console.log(JSON.stringify(await upload(plan, client, { publishLatest: options['publish-latest'],
        progress: counts => { if ((counts.uploaded + counts.skipped) % 100 === 0) console.log(counts); } }), null, 2));
    } finally { client.destroy(); }
  }
}

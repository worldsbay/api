import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, config, immutableCache, latestCache, sha256, assetReferences, checkAsset } from './common.mjs';

export async function prepare(source, output = '.r2-upload') {
  if (!source) throw new Error('Pass --source /path/to/characters containing manifest.json and its hash-named files.');
  source = resolve(source);
  const raw = await readFile(join(source, 'manifest.json'));
  const pack = JSON.parse(raw);
  if (pack.version !== 1 || pack.profile !== 'pocket-humanoid-v2' || !pack.rigs.length ||
      sha256(JSON.stringify({ ...pack, revision: '' })) !== pack.revision)
    throw new Error('Source manifest revision or format is invalid.');
  const prefix = `characters/packs/${pack.revision}`;
  const objects = new Map();
  const add = (key, bytes, contentType, mutable = false) => {
    const object = { key, bytes: bytes.length, sha256: sha256(bytes), contentType,
      cacheControl: mutable ? latestCache : immutableCache, mutable };
    if (objects.has(key) && objects.get(key).entry.sha256 !== object.sha256)
      throw new Error(`Conflicting source object: ${key}`);
    objects.set(key, { entry: object, bytes });
  };
  for (const asset of assetReferences(pack)) {
    checkAsset(asset);
    if (objects.has(`versions/${asset.file}`)) {
      if (objects.get(`versions/${asset.file}`).entry.bytes !== asset.bytes)
        throw new Error(`Conflicting asset length: ${asset.file}`);
      continue;
    }
    const bytes = await readFile(join(source, asset.file));
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256)
      throw new Error(`Source asset integrity failed: ${asset.file}`);
    add(`versions/${asset.file}`, bytes, asset.file.endsWith('.glb') ? 'model/gltf-binary' : 'image/png');
  }
  // Explicit public provenance allowlist; never upload the whole source directory.
  for (const file of ['provenance.json', 'source-map.json'])
    add(`${prefix}/${file}`, await readFile(join(source, file)), 'application/json');
  const licenses = (await readdir(join(source, 'licenses'))).filter(file => /^[a-zA-Z0-9_.-]+\.txt$/.test(file)).sort();
  if (!licenses.length) throw new Error('Original asset license notices are required.');
  for (const file of licenses)
    add(`${prefix}/licenses/${file}`, await readFile(join(source, 'licenses', file)), 'text/plain; charset=utf-8');
  add(`${prefix}/manifest.json`, raw, 'application/json');
  add('characters/manifest.json', raw, 'application/json', true);

  // All inputs are verified before producing a deployable snapshot.
  const directory = resolve(output, pack.revision);
  for (const { entry, bytes } of objects.values()) {
    const path = join(directory, 'objects', entry.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  const entries = [...objects.values()].map(value => value.entry);
  const inventory = { version: 1, ...config, revision: pack.revision,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), objects: entries };
  await writeFile(join(directory, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  return { directory, plan: join(directory, 'inventory.json'), objects: entries.length,
    assetObjects: entries.filter(entry => entry.key.startsWith('versions/')).length,
    bytes: inventory.totalBytes, revision: pack.revision };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = args();
  console.log(JSON.stringify(await prepare(options.source), null, 2));
}

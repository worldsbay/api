import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

export async function loadConfig(directory = new URL('../../infrastructure/r2/', import.meta.url)) {
  const shared = JSON.parse(await readFile(new URL('config.json', directory), 'utf8'));
  try {
    const local = JSON.parse(await readFile(new URL('config.local.json', directory), 'utf8'));
    return { ...shared, ...local };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return shared;
  }
}
export const config = await loadConfig();
export const immutableCache = 'public, max-age=31536000, immutable';
export const latestCache = 'public, max-age=60, must-revalidate';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const md5 = bytes => createHash('md5').update(bytes).digest('hex');
export function args(extra = {}) {
  return parseArgs({ options: { source: { type: 'string' }, plan: { type: 'string' }, ...extra } }).values;
}
export function assetReferences(pack) {
  return [
    ...pack.rigs.flatMap(rig => [rig.asset, rig.defaultAnimations, ...rig.clips.map(clip => clip.asset)]),
    ...pack.parts.flatMap(part => [part.asset, ...(part.thumbnail ? [part.thumbnail] : [])]),
  ];
}
export function checkAsset(asset) {
  if (!/^[a-f0-9]{64}$/.test(asset.sha256) ||
      ![`${asset.sha256}.glb`, `${asset.sha256}.png`].includes(asset.file) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.url !== undefined)
    throw new Error('Manifest must contain hash-named assets with valid lengths and no URLs.');
}
export async function pool(items, action, concurrency = 4) {
  let index = 0, failure;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!failure && index < items.length) {
      const item = items[index++];
      try { await action(item); } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
}

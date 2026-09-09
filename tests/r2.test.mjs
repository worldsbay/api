import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare } from '../scripts/r2/prepare.mjs';
import { readPlan, upload } from '../scripts/r2/upload.mjs';
import { sha256, md5, loadConfig } from '../scripts/r2/common.mjs';
import { pathToFileURL } from 'node:url';

test('deployment configuration is optional, local and fails closed when malformed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yoworlds-r2-config-'));
  const base = new URL('./', pathToFileURL(join(directory, 'config.json')));
  const shared = { bucket: 'test-assets', domain: 'assets.example.com' };
  await writeFile(join(directory, 'config.json'), JSON.stringify(shared));
  assert.deepEqual(await loadConfig(base), shared);
  const local = { accountId: 'a'.repeat(32), bucket: 'private-test-bucket' };
  await writeFile(join(directory, 'config.local.json'), JSON.stringify(local));
  assert.deepEqual(await loadConfig(base), { ...shared, ...local });
  await writeFile(join(directory, 'config.local.json'), 'invalid JSON');
  await assert.rejects(loadConfig(base), SyntaxError);
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'yoworlds-r2-'));
  const source = join(directory, 'source');
  await mkdir(join(source, 'licenses'), { recursive: true });
  const bytes = Buffer.from('test GLB'), hash = sha256(bytes);
  const asset = { file: `${hash}.glb`, sha256: hash, bytes: bytes.length };
  const pack = { version: 1, profile: 'pocket-humanoid-v2', revision: '',
    rigs: [{ asset, defaultAnimations: asset, clips: [] }], parts: [] };
  pack.revision = sha256(JSON.stringify(pack));
  for (const [path, value] of [['manifest.json', JSON.stringify(pack)], [asset.file, bytes],
    ['provenance.json', '[]'], ['source-map.json', '[]'], ['licenses/CC0.txt', 'CC0'], ['secret.env', 'never upload']])
    await writeFile(join(source, path), value);
  return { source, directory, asset };
}
function storage(failKey) {
  const objects = new Map(), writes = [];
  return { objects, writes, async send(command) {
    const input = command.input;
    if (command.constructor.name === 'HeadObjectCommand') {
      const value = objects.get(input.Key);
      if (!value) throw { $metadata: { httpStatusCode: 404 } };
      return value;
    }
    if (input.Key === failKey) throw new Error('Upload failed');
    writes.push(input);
    objects.set(input.Key, { ContentLength: input.Body.length, ETag: `"${md5(input.Body)}"`,
      Metadata: input.Metadata, ContentType: input.ContentType, CacheControl: input.CacheControl });
    return {};
  } };
}
test('R2 preparation deduplicates referenced files, excludes unrelated files and verifies integrity', async () => {
  const f = await fixture();
  const prepared = await prepare(f.source, join(f.directory, 'prepared'));
  const plan = await readPlan(prepared.plan);
  assert.equal(prepared.assetObjects, 1);
  assert.ok(!plan.objects.some(o => o.key.includes('secret')));
  await writeFile(join(f.source, f.asset.file), 'corrupt');
  await assert.rejects(prepare(f.source, join(f.directory, 'bad')), /integrity failed/);
  const inventory = JSON.parse(await readFile(prepared.plan, 'utf8'));
  inventory.objects = inventory.objects.filter(o => !o.key.startsWith('versions/'));
  await writeFile(prepared.plan, JSON.stringify(inventory));
  await assert.rejects(readPlan(prepared.plan), /omits required asset/);
});
test('R2 uploads publish latest last, resume without writes, and refuse immutable conflicts', async () => {
  const f = await fixture();
  const prepared = await prepare(f.source, join(f.directory, 'prepared'));
  const plan = await readPlan(prepared.plan), client = storage();
  const first = await upload(plan, client, { publishLatest: true });
  assert.equal(first.uploaded, plan.objects.length);
  assert.equal(client.writes.at(-1).Key, 'characters/manifest.json');
  assert.ok(client.writes.every(input => input.IfNoneMatch === '*'));
  const second = await upload(plan, client, { publishLatest: true });
  assert.equal(second.uploaded, 0);
  assert.equal(second.skipped, plan.objects.length);
  client.objects.set(plan.objects[0].key, { ContentLength: 1, Metadata: { sha256: 'bad' } });
  await assert.rejects(upload(plan, client, { publishLatest: true }), /Immutable object conflict/);
});
test('R2 failed asset upload cannot advance either manifest; staging does not publish latest', async () => {
  const f = await fixture();
  const prepared = await prepare(f.source, join(f.directory, 'prepared'));
  const plan = await readPlan(prepared.plan), failed = storage(plan.objects[0].key);
  await assert.rejects(upload(plan, failed, { publishLatest: true }), /Upload failed/);
  assert.ok(!failed.writes.some(input => input.Key.endsWith('/manifest.json')));
  const staged = storage();
  await upload(plan, staged);
  assert.ok(staged.writes.some(input => input.Key.includes('/packs/') && input.Key.endsWith('/manifest.json')));
  assert.ok(!staged.writes.some(input => input.Key === 'characters/manifest.json'));
});

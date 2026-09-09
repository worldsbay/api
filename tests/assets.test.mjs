import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AssetClient, DEFAULT_ASSET_BASE_URL, RequestError } from '../dist/index.js';

function fixture() {
  const asset = { file: `${'a'.repeat(64)}.glb`, sha256: 'a'.repeat(64), bytes: 24 };
  const pack = { version: 1, profile: 'pocket-humanoid-v2', revision: '',
    rigs: [{ id: 'test', asset, defaultAnimations: asset, clips: [{ asset }] }],
    parts: [{ id: 'head', asset, thumbnail: { ...asset, file: `${asset.sha256}.png` } }] };
  pack.revision = createHash('sha256').update(JSON.stringify(pack)).digest('hex');
  return pack;
}
test('asset discovery verifies the manifest and resolves all references without fetching models or sending credentials', async () => {
  const pack = fixture(), calls = [];
  const assets = new AssetClient({ fetch: async (url, init) => {
    calls.push({ url, ...init }); return Response.json(pack);
  } });
  const resolved = await assets.getCharacterPack({ revision: pack.revision });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${DEFAULT_ASSET_BASE_URL}/characters/packs/${pack.revision}/manifest.json`);
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].headers.has('authorization'), false);
  assert.equal(resolved.revision, pack.revision);
  assert.equal(resolved.parts[0].thumbnail.url, `${DEFAULT_ASSET_BASE_URL}/versions/${'a'.repeat(64)}.png`);
  assert.equal(resolved.rigs[0].clips[0].asset.url, assets.assetUrl(pack.rigs[0].asset));
  assert.equal(pack.rigs[0].asset.url, undefined);
  assert.equal(assets.manifestUrl(), `${DEFAULT_ASSET_BASE_URL}/characters/manifest.json`);
});
test('asset URLs reject traversal, credentials, mismatched hashes and unsupported origins', () => {
  const assets = new AssetClient();
  for (const baseUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?q=1'])
    assert.throws(() => new AssetClient({ baseUrl }), TypeError);
  for (const file of ['../secret.glb', `${'b'.repeat(64)}.glb`, `${'a'.repeat(64)}.svg`, `${'a'.repeat(64)}.glb?secret=1`])
    assert.throws(() => assets.assetUrl({ file, sha256: 'a'.repeat(64) }), TypeError);
  assert.throws(() => assets.manifestUrl('../latest'), TypeError);
  const character = { rig: fixture().rigs[0].asset, defaultAnimations: fixture().rigs[0].asset, parts: fixture().parts };
  character.rig.url = 'https://untrusted.example/model.glb';
  const resolved = assets.resolveCharacter(character);
  assert.equal(new URL(resolved.rig.url).origin, DEFAULT_ASSET_BASE_URL);
  assert.equal(character.rig.url, 'https://untrusted.example/model.glb');
});
test('asset discovery rejects corrupt or wrong pinned manifests and propagates HTTP failures', async () => {
  const pack = fixture();
  for (const value of [null, {}, { ...pack, revision: 'b'.repeat(64) }, { ...pack, parts: [] }]) {
    await assert.rejects(new AssetClient({ fetch: async () => Response.json(value) }).getCharacterPack(),
      error => error instanceof RequestError && error.code === 'invalid-response');
  }
  await assert.rejects(new AssetClient({ fetch: async () => Response.json(pack) }).getCharacterPack({ revision: 'b'.repeat(64) }),
    { code: 'invalid-response' });
  await assert.rejects(new AssetClient({ fetch: async () => new Response('missing', { status: 404 }) }).getCharacterPack(),
    { status: 404, code: 'http' });
});

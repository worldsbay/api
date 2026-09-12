import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const sandbox = mkdtempSync(join(tmpdir(), 'worldsbay-package-'));
const consumer = join(sandbox, 'consumer');
mkdirSync(consumer);
const npm = process.env.npm_execpath ?? resolve(process.execPath, '../node_modules/npm/bin/npm-cli.js');
function run(args, cwd, executable = process.execPath) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Command failed.');
  return result.stdout;
}
const [archive] = JSON.parse(run([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', sandbox], root));
const files = archive.files.map(file => file.path);
assert.ok(files.includes('dist/index.js') && files.includes('dist/index.d.ts') && files.includes('dist/assets.js'));
assert.ok(files.includes('LICENSE') && files.includes('THIRD_PARTY_NOTICES.md'));
assert.ok(archive.size < 64 * 1024, 'API tarball exceeds the 64 KiB budget');
assert.deepEqual(Object.keys(pkg.dependencies), ['zod'], 'Operator dependencies must remain development-only');
for (const path of files) {
  assert.match(path, /^(dist\/|package\.json$|README\.md$|SOURCE\.md$|RELEASING\.md$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/);
  assert.ok(!/\.(glb|gltf|png|jpg|zip)$/.test(path), 'Asset binary entered npm package');
}
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'isolated-consumer', private: true, type: 'module' }));
run([npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', join(sandbox, archive.filename)], consumer);
writeFileSync(join(consumer, 'smoke.mjs'), `
import { WorldsBay, CentralClient, RoomConnection, RequestError, AssetClient } from '@worldsbay/api';
import { AssetClient as Assets } from '@worldsbay/api/assets';
import { WorldClient } from '@worldsbay/api/server';
import { characterRecipeSchema } from '@worldsbay/api/schemas';
if (![WorldsBay, CentralClient, RoomConnection, RequestError, AssetClient, WorldClient].every(x => typeof x === 'function') || !characterRecipeSchema || Assets !== AssetClient) throw new Error('Broken API exports');
`);
run(['smoke.mjs'], consumer);
const catalogueItem = JSON.parse(readFileSync(join(root, 'tests/fixtures/catalogue-item.json'), 'utf8'));
writeFileSync(join(consumer, 'consumer.mts'), `
import { WorldsBay, CentralClient, type Appearance, type WorldSession, type CharacterPack, type Item, type Bootstrap } from '@worldsbay/api';
import { AssetClient } from '@worldsbay/api/assets';
import { WorldClient } from '@worldsbay/api/server';
import { RoomConnection } from '@worldsbay/api/room';
const api = new WorldsBay();
const appearance: Appearance = await api.readAppearance();
const session: WorldSession = await api.enterSession();
const item: Item = ${JSON.stringify(catalogueItem)};
const bootstrap: Bootstrap = {
  hubWorldId: 'world-a', characterBuilder: true, auth: { provider: 'local' },
  players: [], demoIdentities: false, worlds: [],
};
const support: import('@worldsbay/api').AvatarStyle[] = ['low-poly', 'detailed'];
const slots: import('@worldsbay/api').AvatarSlots = {};
const current: import('@worldsbay/api').CentralMe | undefined = undefined;
const compatible: boolean | undefined = appearance.avatarSupported;
const style: import('@worldsbay/api').AvatarStyle | undefined = appearance.avatarStyle;
// @ts-expect-error invalid visual style
support.push('realistic');
const assets = new AssetClient();
const pack: CharacterPack = await assets.getCharacterPack();
if (appearance.character) assets.resolveCharacter(appearance.character);
new RoomConnection(() => api.enterSession(), 'wss://example.com/room');
// @ts-expect-error world ID must be a string
api.requestTravel(123);
// @ts-expect-error revision must be a string
assets.manifestUrl(123);
`);
for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'Bundler']])
  run([join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022',
    '--module', module, '--moduleResolution', resolution, 'consumer.mts'], consumer);
writeFileSync(join(consumer, 'browser.mjs'), "export { WorldsBay, CentralClient, RoomConnection, AssetClient } from '@worldsbay/api';");
const bundle = await build({ absWorkingDir: consumer, entryPoints: ['browser.mjs'], bundle: true,
  platform: 'browser', format: 'esm', outfile: 'browser.js', write: false, metafile: true, minify: true });
for (const path of Object.keys(bundle.metafile.inputs)) {
  assert.ok(!path.includes('dist/server.js'), 'Server entry leaked into browser bundle');
  assert.ok(!/node_modules\/(three|zod|@aws-sdk|@smithy)\//.test(path), 'API import pulled in rendering, schemas or operator dependencies');
}
writeFileSync(join(consumer, 'forbidden.mjs'), "import { WorldClient } from '@worldsbay/api/server'; console.log(WorldClient);");
await assert.rejects(build({ absWorkingDir: consumer, entryPoints: ['forbidden.mjs'], bundle: true,
  platform: 'browser', write: false, logLevel: 'silent' }));
console.log(JSON.stringify({ package: pkg.name, packedBytes: archive.size, unpackedBytes: archive.unpackedSize,
  browserMinifiedBytes: bundle.outputFiles[0].contents.length, browserGzipBytes: gzipSync(bundle.outputFiles[0].contents).length,
  files: files.length, archive: join(sandbox, archive.filename), consumer,
  checks: ['isolated install', 'Node imports', 'NodeNext types', 'Bundler types', 'browser boundaries', 'no bundled assets', '64 KiB size budget'] }, null, 2));

import assert from 'node:assert/strict';
import { args, config, sha256, pool } from './common.mjs';
import { readPlan } from './upload.mjs';

const options = args({ all: { type: 'boolean', default: false } });
const plan = await readPlan(options.plan);
const base = `https://${config.domain}`;
const origin = 'https://independent-world.example';
const check = async object => {
  const response = await fetch(`${base}/${object.key}`, {
    headers: { origin }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, `${object.key}: HTTP status`);
  assert.equal(response.headers.get('access-control-allow-origin'), '*', 'Public CORS header');
  assert.equal(response.headers.get('content-type'), object.contentType, 'Content type');
  assert.equal(response.headers.get('cache-control'), object.cacheControl, 'Cache policy');
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.length, object.bytes, 'Byte length');
  assert.equal(sha256(body), object.sha256, `Hash: ${object.key}`);
};
const sampleKeys = new Set([
  'characters/manifest.json', `characters/packs/${plan.revision}/manifest.json`,
  plan.objects.find(o => o.key.endsWith('.glb'))?.key,
  plan.objects.find(o => o.key.endsWith('.png'))?.key,
  plan.objects.find(o => o.key.endsWith('.txt'))?.key,
]);
const selected = options.all ? plan.objects : plan.objects.filter(o => sampleKeys.has(o.key));
let verified = 0;
await pool(selected, async object => { await check(object); verified++; if (verified % 100 === 0) console.log({ verified }); });
const preflight = await fetch(`${base}/characters/manifest.json`, {
  method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'range' },
  redirect: 'error', signal: AbortSignal.timeout(30000),
});
assert.ok(preflight.ok, 'CORS preflight');
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
assert.ok(preflight.headers.get('access-control-allow-methods')?.includes('GET'));
console.log(JSON.stringify({ base, verified, revision: plan.revision, preflight: 'passed' }, null, 2));

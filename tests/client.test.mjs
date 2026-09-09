import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { WorldsBay, CentralClient, RequestError } from '../dist/index.js';
import { WorldClient } from '../dist/server.js';
import { itemSchema } from '../dist/schemas.js';

const json = (value) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
test('browser calls preserve methods, request bodies, markers, and same-origin cookies', async () => {
  const calls = [];
  const api = new WorldsBay({
    baseUrl: 'https://world.example/play/',
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return json(
        url.endsWith('/session')
          ? { destinations: [{ id: 'world-b' }] }
          : { url: 'https://central.example/?context=example&view=wardrobe' },
      );
    },
  });
  assert.deepEqual(await api.getDestinations(), [{ id: 'world-b' }]);
  await api.requestTravel('world-b');
  const creator = new URL((await api.openCharacterCreator()).url);
  assert.equal(creator.searchParams.get('context'), 'example');
  assert.equal(creator.searchParams.get('view'), 'character');
  assert.equal(calls[0].url, 'https://world.example/play/api/session');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].body), { worldId: 'world-b' });
  assert.equal(calls[1].headers.get('x-worldsbay'), '1');
  assert.equal(calls[1].headers.get('x-pocketbeyond'), '1');
  assert.equal(calls[1].headers.has('authorization'), false);
  assert.equal(calls[1].credentials, 'same-origin');
  assert.equal(calls[1].redirect, 'error');
});

test('all browser and public methods target existing API routes', async () => {
  const paths = [];
  const item = JSON.parse(readFileSync(new URL('./fixtures/catalogue-item.json', import.meta.url), 'utf8'));
  const options = {
    fetch: async (url, init) => {
      paths.push([url, init.method]);
      return json(url.endsWith('/collection') ? [item] : { worlds: [], destinations: [] });
    },
  };
  const api = new WorldsBay(options);
  await api.readAppearance();
  await api.refreshAppearance();
  await api.getConfig();
  const collection = await api.getCollection();
  assert.deepEqual(collection.map(entry => itemSchema.parse(entry)), [item]);
  await api.openWardrobe('hat');
  const central = new CentralClient(options);
  await central.getWorlds();
  await central.getCharacterPack();
  assert.deepEqual(paths, [
    ['/api/appearance', 'GET'],
    ['/api/appearance', 'GET'],
    ['/api/config', 'GET'],
    ['/api/collection', 'GET'],
    ['/api/store', 'POST'],
    ['/api/bootstrap', 'GET'],
    ['/api/character-pack', 'GET'],
  ]);
});

test('server client sends credentials on a real HTTP connection, without serializing them', async (t) => {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, method: req.method, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/internal/exchange'
          ? { session: 'local-test-grant', expiresAt: Date.now() + 3600000 }
          : { ok: true },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const world = new WorldClient({
    centralUrl: `http://127.0.0.1:${server.address().port}`,
    worldId: 'test-world',
    worldSecret: 'x'.repeat(32),
  });
  assert.equal(JSON.stringify(world), '{}');
  const grant = await world.exchangeTicket('local-test-ticket');
  await world.acceptEntry(grant.session);
  await world.getAppearance(grant.session);
  await world.getWorlds();
  await world.getCatalogue(grant.session);
  await world.requestTravel(grant.session, 'world-b');
  await world.openStore(grant.session, 'hat');
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      '/internal/exchange',
      '/internal/accept',
      '/internal/appearance',
      '/internal/worlds',
      '/internal/catalogue',
      '/internal/travel',
      '/internal/store',
    ],
  );
  assert.equal(calls[0].headers.authorization, `Bearer ${'x'.repeat(32)}`);
  assert.equal(calls[0].headers['x-world-id'], 'test-world');
  assert.equal(calls[0].headers['x-world-session'], undefined);
  assert.deepEqual(JSON.parse(calls[0].body), { token: 'local-test-ticket' });
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].body, '');
  assert.equal(calls[1].headers['x-world-session'], grant.session);
  assert.deepEqual(JSON.parse(calls[5].body), { worldId: 'world-b' });
});

test('HTTP, non-JSON, network, cancellation and timeout failures are predictable', async () => {
  for (const [response, status, code] of [
    [new Response('{"error":"Conflict"}', { status: 409 }), 409, 'http'],
    [new Response('<html>Down</html>', { status: 502 }), 502, 'http'],
    [new Response('invalid'), 200, 'invalid-response'],
  ]) {
    await assert.rejects(
      new WorldsBay({ fetch: async () => response }).enterSession(),
      (e) => e instanceof RequestError && e.status === status && e.code === code,
    );
  }
  await assert.rejects(
    new WorldsBay({
      fetch: async () => {
        throw new Error('secret-from-adapter');
      },
    }).enterSession(),
    (e) => e.code === 'network' && !JSON.stringify(e).includes('secret-from-adapter') && !e.cause,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new WorldsBay().enterSession({ signal: controller.signal }),
    (e) => e.code === 'aborted',
  );
  const hungFetch = async (_url, { signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  await assert.rejects(
    new WorldsBay({ fetch: hungFetch, timeoutMs: 5 }).enterSession(),
    (e) => e.code === 'timeout',
  );
  let attempts = 0;
  const server = new WorldClient({
    centralUrl: 'https://central.example',
    worldId: 'test-world',
    worldSecret: 'x'.repeat(32),
    fetch: async () => {
      attempts++;
      return new Response('{"error":"secret-reflection"}', { status: 503 });
    },
  });
  await assert.rejects(
    server.exchangeTicket('ticket'),
    (e) => e.status === 503 && !e.message.includes('secret-reflection'),
  );
  assert.equal(attempts, 1);
});

test('server rejects redirects without forwarding credentials', async (t) => {
  let forwarded = false;
  const target = createServer((_req, res) => {
    forwarded = true;
    res.end('{}');
  });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => target.close(resolve)));
  const origin = createServer((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/leak` });
    res.end();
  });
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => origin.close(resolve)));
  const client = new WorldClient({
    centralUrl: `http://127.0.0.1:${origin.address().port}`,
    worldId: 'test-world',
    worldSecret: 'x'.repeat(32),
  });
  await assert.rejects(client.getWorlds(), (e) => e.code === 'network');
  assert.equal(forwarded, false);
});

test('invalid URLs and configuration fail before making a request', () => {
  for (const baseUrl of [
    'javascript:alert(1)',
    '//evil.example',
    'https://user:pass@example.com',
    'https://example.com?ticket=secret',
    'relative',
  ])
    assert.throws(() => new WorldsBay(baseUrl));
  assert.throws(() => new WorldsBay({ timeoutMs: 0 }));
  for (const centralUrl of [
    'http://example.com',
    'http://127.attacker.example',
    'https://example.com/path',
    'https://user:pass@example.com',
  ])
    assert.throws(() => new WorldClient({ centralUrl, worldId: 'test-world', worldSecret: 'x'.repeat(32) }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldsBay, openAccountPage } from '../dist/index.js';
import { WorldClient } from '../dist/server.js';

test('guest entry coalesces clicks and retries bootstrap without creating a guest on failure', async () => {
  const calls = [];
  let unavailable = true;
  const api = new WorldsBay({ fetch: async (path, init) => {
    calls.push([path, init.method, init.body]);
    if (path === '/api/config' && unavailable)
      return Response.json({ error: 'Unavailable' }, { status: 503 });
    return Response.json({ appearance: { player: { id: 'guest' } } });
  } });
  const first = api.startGuestSession();
  assert.equal(api.startGuestSession(), first);
  await assert.rejects(first, { status: 503 });
  assert.deepEqual(calls, [['/api/config', 'GET', undefined]]);
  unavailable = false;
  await api.startGuestSession({ newGuest: true });
  assert.deepEqual(calls.slice(1), [['/api/config', 'GET', undefined], ['/api/guest', 'POST', '{"newGuest":true}']]);
});

test('account and resume actions use world routes with no implicit guest creation', async () => {
  const calls = [];
  const api = new WorldsBay({ fetch: async (path, init) => {
    calls.push([path, init.method, init.body]);
    return Response.json({ error: 'Sign in' }, { status: 401 });
  } });
  for (const action of [() => api.resumeSession(), () => api.readAccount(), () => api.createAccountContext(), () => api.completeAccount('ticket'), () => api.signOut()])
    await assert.rejects(action, { status: 401 });
  assert.deepEqual(calls, [
    ['/api/session/resume', 'POST', '{}'], ['/api/account', 'GET', undefined],
    ['/api/account/context', 'POST', '{"hosted":true}'],
    ['/api/account/complete', 'POST', '{"ticket":"ticket"}'], ['/api/account/logout', 'POST', '{}'],
  ]);
});

test('account navigation rejects a handoff for a different parent before creating a form', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://world.example' } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location; });
  await assert.rejects(openAccountPage({ createAccountContext: async () => ({
    context: 'x'.repeat(43), expiresAt: Date.now() + 60000,
    frameUrl: 'https://central.example/account/frame', parentOrigin: 'https://other.example',
  }) }), /does not match this game/);
});

test('server extension transport retains credentials and refuses paths outside internal API', async () => {
  const calls = [];
  const api = new WorldClient({ centralUrl: 'https://central.example', worldId: 'world-a', worldSecret: 'x'.repeat(32), fetch: async (url, init) => {
    calls.push([url, init]); return Response.json({ ok: true });
  } });
  await api.request('/internal/worlds/heartbeat', 'POST', { active: 1 }, 'grant');
  assert.equal(calls[0][0], 'https://central.example/internal/worlds/heartbeat');
  assert.equal(calls[0][1].headers.get('x-world-session'), 'grant');
  assert.equal(calls[0][1].headers.get('authorization'), `Bearer ${'x'.repeat(32)}`);
  assert.equal(calls[0][1].redirect, 'error');
  for (const path of ['/api/account', '//other.example', '/internal/../account', '/internal/%2e%2e/account', '/internal/account?secret=1'])
    assert.throws(() => api.request(path, 'GET'), /internal/);
  assert.equal(calls.length, 1);
});

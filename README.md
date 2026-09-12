# @worldsbay/api

Typed clients for connecting an independently hosted game to WorldsBay. Character metadata and models load on demand from `https://assets.worldsbay.com`. The package contains no model binaries or rendering engine.

**Preview, version 0.1.2.** This repository is independent of the main WorldsBay application. Node.js 22.12+ and npm are required for development. The output is ESM with TypeScript declarations; browsers use a bundler such as Vite. Native CommonJS is not a supported entry point.

## Install

```sh
npm install @worldsbay/api
```

## Develop the package

```sh
npm ci
npm run check
```

Game integrations install the published package with `npm install @worldsbay/api`.

`npm run check` builds, runs the HTTP/WebSocket tests, packs and installs into an isolated temporary project, checks NodeNext and bundler TypeScript resolution, and verifies browser/server bundle boundaries. CI runs these checks on Windows and Linux with Node 22 and 24. No CI workflow publishes anything.

## Browser integration

Your game server must implement the registered-world `/api` routes. The WorldsBay developers starter already does. Import the client from the same origin as your world after the player has entered through WorldsBay:

```ts
import { WorldsBay, RequestError } from '@worldsbay/api';

const worlds = new WorldsBay();
const session = await worlds.enterSession();
console.log(session.appearance.player.name);

// Use a click handler in your game's travel menu:
async function travel(worldId: string) {
  try {
    const { url } = await worlds.requestTravel(worldId);
    location.assign(url);
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) {
      location.assign(session.homeUrl);
      return;
    }
    throw error;
  }
}
```

`new WorldsBay({ baseUrl: '/game', timeoutMs: 8000, fetch })` supports a route prefix, timeout and injected fetch. The previous string constructor also works. Cookie credentials use `same-origin`; setting a different hostname does not grant cross-origin account access. The SDK never reads or exposes HttpOnly cookies.

| Method | Result |
| --- | --- |
| `resumeSession(options?)` | Restore an existing remembered identity; never creates a guest |
| `startGuestSession({ newGuest? })` | Explicit guest entry; seeds cookies and coalesces simultaneous actions |
| `readAccount(options?)` | Guest/account status |
| `createAccountContext(options?)`, `completeAccount(ticket, options?)`, `signOut(options?)` | Hosted account handoff and sign-out |
| `enterSession(options?)` | World, appearance, destinations, home URL, optional expiry |
| `readAppearance(options?)`, `refreshAppearance(options?)` | Current authorized appearance |
| `getDestinations(options?)` | Session's available worlds |
| `getConfig(options?)` | World metadata and home URL |
| `getCollection(options?)` | Listed items for this world |
| `requestTravel(worldId, options?)` | `{ url }` to navigate to |
| `openStore(itemId?, options?)`, `openWardrobe(itemId?, options?)` | `{ url }` for central wardrobe |
| `openCharacterCreator(options?)` | `{ url }` for central character editing |

All requests accept `{ signal }` for cancellation. `RequestError` has `status` (zero for transport errors) and `code`: `http`, `network`, `timeout`, `aborted`, or `invalid-response`. Calls are never automatically retried. A timeout during a write does not prove the server rejected it. Endpoint results are TypeScript contracts; the transport checks JSON decoding and HTTP status, not every response field.

For account entry, import `openAccountPage` and call `openAccountPage(api, { mode: 'signup' })` or `{ mode: 'signin' }` from a user action. It navigates to WorldsBay using a POST handoff so passwords stay on the central account page. A 401 from `resumeSession()` should offer an explicit entry choice; do not create a guest on a network failure.

The standard WorldsBay rooms load appearance at entry and keep it during play. These appearance methods are explicit requests; the SDK does not start a polling timer. Call `refreshAppearance()` after an in-game wardrobe action when needed. Updated standard world adapters broadcast that requested revision to room peers; custom games decide how to apply it. Remote account changes do not automatically update an already-connected avatar.

## Multiplayer rooms

```ts
import { WorldsBay, RoomConnection } from '@worldsbay/api';
const worlds = new WorldsBay();
const room = new RoomConnection(() => worlds.enterSession());
const unsubscribe = room.on('snapshot', snapshot => {
  // Apply authoritative actor state to your own renderer.
  console.log(snapshot.actors.length);
});
room.on('chat', message => console.log(message.text));
room.connect();
// Once ready, from your own input handlers:
room.send({ type: 'chat', text: 'Hello!' });
// When removing the game:
// unsubscribe(); room.dispose();
```

This is the existing WorldsBay room protocol, not a generic multiplayer engine. It handles reconnect backoff, expiry, sequence numbers and send backpressure. It runs in browsers with native WebSocket. A custom endpoint can be passed as the second constructor argument. `on()` returns an unsubscribe callback. The `/room` subpath exposes the same class.

## Public central discovery

```ts
import { CentralClient } from '@worldsbay/api';
const central = new CentralClient({ baseUrl: 'https://worldsbay.com' });
const worlds = await central.getWorlds();
const pack = await central.getCharacterPack();
```

Use your actual central origin, including its port for local development. The deployment must expose the relevant endpoint and allow the requesting browser origin. `getBootstrap()` also returns enabled capabilities. This client is read-only; account creation, sign-in, free item claims, registration and central character writes remain in central's own UI. All listed wardrobe items are free to claim. `openWardrobe()` and `openStore()` both open that wardrobe through the existing world route.

## Avatar styles and world support

Players can save a `low-poly` and a `detailed` look independently. Worlds declare `avatarSupport` during registration or in world settings:

| Value | Accepted avatars |
| --- | --- |
| `["low-poly"]` | Low poly |
| `["detailed"]` | Detailed |
| `["low-poly", "detailed"]` | Both styles |
| `[]` | The world's own avatars |
| omitted | Legacy behavior; support is not declared |

`World.avatarSupport` is returned through discovery and world sessions. `Appearance.avatarStyle` identifies the selected look. When `Appearance.avatarSupported === false`, render your game's own avatar and keep `appearance.player` as the player identity; do not load the supplied personal model. Omitted fields remain compatible with older servers. Central selects a compatible saved look without changing the player's preference.

`AvatarStyle`, `AvatarSlots`, and `CentralMe` are exported types. `avatarStyleSchema` and `avatarSupportSchema` are available from `@worldsbay/api/schemas`. The central browser-session `/api/me` response includes `avatarSlots`; saving through `/api/character` updates only the recipe's style and remains revision-checked. Central account writes stay in the central UI; `CentralClient` remains read-only and world credentials cannot edit a player's looks.

Version 0.1.2 also aligns character recipe schemas with saved detailed characters: beard selections and per-item fabric, trim, and leather colors. Update the [developer starter](https://github.com/worldsbay/developers) and rebuild to receive renderer/editor changes; updating this SDK alone does not replace a game's renderer.

## Dynamic character assets

```ts
import { AssetClient, WorldsBay } from '@worldsbay/api';

const assets = new AssetClient(); // https://assets.worldsbay.com
const pack = await assets.getCharacterPack(); // metadata only
const modelUrl = pack.rigs[0].asset.url!;
// Hand modelUrl to your game's GLB loader when you need this model.

const { appearance } = await new WorldsBay().enterSession();
if (appearance.character) {
  const character = assets.resolveCharacter(appearance.character);
  // Load character.rig, character.defaultAnimations and selected parts in your renderer.
  // Restore an existing recipe with its pinned catalogue:
  const savedPack = await assets.getCharacterPack({
    revision: character.recipe.packRevision,
  });
}
```

`AssetClient` is also available from `@worldsbay/api/assets`. Its constructor accepts `{ baseUrl, timeoutMs, fetch }`; the asset base must be an HTTPS origin. Methods are `getCharacterPack({ revision?, signal? })`, `manifestUrl(revision?)`, `assetUrl({ file, sha256 })`, `resolvePack(pack)` and `resolveCharacter(character)`. Resolution copies the metadata and replaces all asset URLs with the configured origin. URL filenames must match their SHA-256. Manifest fetches verify the canonical pack revision using Web Crypto; use a secure browser context. Model bytes are loaded only by your renderer; their hashes are supplied for consumers that need download verification.

The current catalogue lives at `/characters/manifest.json`; pinned catalogues at `/characters/packs/<revision>/manifest.json`; GLBs and thumbnails at `/versions/<sha256>.<glb|png>`. No API credentials, cookies or player data are sent to the asset service. Public assets do not prove item ownership: obtain the authorized appearance through the world API first. Existing world API URLs remain unchanged; use `resolveCharacter()` when your game opts into CDN delivery. Every referenced revision must be available before switching a world, including older saved outfits. Legacy v1 item assets are not included in this initial modular-character snapshot.

Asset upload tools are development-only and excluded from the published archive. Game integrations need no upload credentials.

## Server integration

```ts
import { WorldClient } from '@worldsbay/api/server';

const central = new WorldClient({
  centralUrl: process.env.CENTRAL_URL!,
  worldId: process.env.WORLD_ID!,
  worldSecret: process.env.WORLD_SECRET!,
});

// In the world's /enter handler, using the received single-use ticket:
// const grant = await central.exchangeTicket(ticket);
// 1. Store grant.session and grant.expiresAt in your server-side session store.
// 2. await central.acceptEntry(grant.session);
// 3. Issue a random, HttpOnly, Secure, host-only session cookie.
// 4. Redirect to a clean URL, stripping the ticket before loading assets.
// Delete the provisional local session if acceptance fails.
```

The client uses the existing `/internal/exchange`, `/internal/accept`, `/internal/appearance`, `/internal/worlds`, `/internal/catalogue`, `/internal/travel` and `/internal/store` endpoints. Methods are `exchangeTicket(ticket)`, `acceptEntry(grant)`, `getAppearance(grant)`, `getWorlds()`, `getCatalogue(grant)`, `requestTravel(grant, worldId)` and `openStore(grant, itemId?)`; each accepts request options last.

The server subpath is blocked for browser bundling. Central URLs must be HTTPS origins, with HTTP allowed for loopback development. Redirects are rejected. Credentials are held in private fields and transport errors do not include raw request details. Keep world secrets, entry tickets and grants on the server and out of logs. Never accept player IDs or browser appearance data as proof of identity. Session storage, origin checks, cookie issuance and game authorization are the host application's responsibility; see [the developer integration guide](https://worldsbay.com/guides/AGENT-INTEGRATION.md).

## Types and schemas

Public types (`Appearance`, `WorldSession`, `World`, `CharacterPack`, room messages and others) are exported from the root and `/types`. Runtime Zod validators are opt-in from `/schemas`. The default client import does not load Zod or Three.js.

See [RELEASING.md](RELEASING.md) for the later release steps, [SOURCE.md](SOURCE.md) for extraction details, and [LICENSE](LICENSE) for the MIT software license.

## Example world and character source

The [developers repository](https://github.com/worldsbay/developers) contains the
runnable world, server adapter, character renderer, reusable editor and integration
guides. Use this API package for clients and `AssetClient` for public CDN metadata
and model URLs. Website starter and character archives are retired; clone the
developers repository for source and build it locally.

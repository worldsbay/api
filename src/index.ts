import type { Appearance, Item, World, WorldSession, WorldAccount } from './core/contract.js';
import type { AccountContext } from './accounts.js';
import type { CharacterPack } from './character/contract.js';
import { JsonClient, type ClientOptions, type RequestOptions } from './http.js';
export { RequestError } from './http.js';
export type { ClientOptions, RequestOptions, RequestErrorCode } from './http.js';
export type * from './types.js';
export { RoomConnection } from './room.js';
export { AssetClient, DEFAULT_ASSET_BASE_URL } from './assets.js';
export type { AssetClientOptions, CharacterPackOptions } from './assets.js';
export { openAccountPage, openAccountDialog } from './accounts.js';
export type * from './accounts.js';

/** Browser client for a registered world's own /api routes. */
export class WorldsBay {
  #http: JsonClient;
  #entryBootstrap?: Promise<unknown>;
  #guestStart?: Promise<WorldSession>;
  constructor(options: ClientOptions | string = {}) {
    this.#http = new JsonClient(typeof options === 'string' ? { baseUrl: options } : options, {
      'x-worldsbay': '1',
      'x-yoworlds': '1',
      'x-pocketbeyond': '1',
    });
  }
  enterSession(options?: RequestOptions) {
    return this.#http.request<WorldSession>('/api/session', 'GET', undefined, options);
  }
  /** Restore an existing identity. A 401 requires an explicit entry choice. */
  resumeSession(options?: RequestOptions) {
    return this.#http.request<WorldSession>('/api/session/resume', 'POST', {}, options);
  }
  /** Call only from an explicit guest-entry action. Concurrent actions share one request. */
  startGuestSession(options: { newGuest?: boolean } = {}) {
    if (this.#guestStart) return this.#guestStart;
    const starting = (async () => {
      this.#entryBootstrap ??= this.getConfig().catch((error) => {
        this.#entryBootstrap = undefined;
        throw error;
      });
      await this.#entryBootstrap;
      return this.#http.request<WorldSession>('/api/guest', 'POST', options.newGuest ? { newGuest: true } : {});
    })();
    this.#guestStart = starting;
    void starting.finally(() => {
      if (this.#guestStart === starting) this.#guestStart = undefined;
    }).catch(() => {});
    return starting;
  }
  readAccount(options?: RequestOptions) {
    return this.#http.request<WorldAccount>('/api/account', 'GET', undefined, options);
  }
  createAccountContext(options?: RequestOptions) {
    return this.#http.request<AccountContext>('/api/account/context', 'POST', { hosted: true }, options);
  }
  completeAccount(ticket: string, options?: RequestOptions) {
    return this.#http.request<WorldSession>('/api/account/complete', 'POST', { ticket }, options);
  }
  signOut(options?: RequestOptions) {
    return this.#http.request<{ ok: true }>('/api/account/logout', 'POST', {}, options);
  }
  readAppearance(options?: RequestOptions) {
    return this.#http.request<Appearance>('/api/appearance', 'GET', undefined, options);
  }
  refreshAppearance(options?: RequestOptions) {
    return this.readAppearance(options);
  }
  async getDestinations(options?: RequestOptions) {
    return (await this.enterSession(options)).destinations;
  }
  getConfig(options?: RequestOptions) {
    return this.#http.request<{ world: World; homeUrl: string }>('/api/config', 'GET', undefined, options);
  }
  getCollection(options?: RequestOptions) {
    return this.#http.request<Item[]>('/api/collection', 'GET', undefined, options);
  }
  requestTravel(worldId: string, options?: RequestOptions) {
    return this.#http.request<{ url: string }>('/api/travel', 'POST', { worldId }, options);
  }
  openStore(selectedItem?: string, options?: RequestOptions) {
    return this.#http.request<{ url: string }>(
      '/api/store',
      'POST',
      selectedItem ? { selectedItem } : {},
      options,
    );
  }
  openWardrobe(selectedItem?: string, options?: RequestOptions) {
    return this.openStore(selectedItem, options);
  }
  async openCharacterCreator(options?: RequestOptions) {
    const { url } = await this.openStore(undefined, options);
    const target = new URL(url);
    target.searchParams.set('view', 'character');
    return { url: target.href };
  }
}

export type Bootstrap = {
  hubWorldId: string;
  characterBuilder: boolean;
  auth: { provider: 'local' | 'supabase' };
  players: { id: string; name: string; color: string }[];
  demoIdentities: boolean;
  worlds: World[];
};

/** Read-only public central endpoints. No account writes or world credentials. */
export class CentralClient {
  #http: JsonClient;
  constructor(options: ClientOptions | string = {}) {
    this.#http = new JsonClient(typeof options === 'string' ? { baseUrl: options } : options, {}, true);
  }
  getBootstrap(options?: RequestOptions) {
    return this.#http.request<Bootstrap>('/api/bootstrap', 'GET', undefined, options);
  }
  async getWorlds(options?: RequestOptions) {
    return (await this.getBootstrap(options)).worlds;
  }
  getCharacterPack(options?: RequestOptions) {
    return this.#http.request<CharacterPack>('/api/character-pack', 'GET', undefined, options);
  }
}

/** @deprecated The product is now called WorldsBay. */
export { WorldsBay as Pocketbeyond };

/** @deprecated Compatibility export for existing integrations. */
export { WorldsBay as YoWorlds };

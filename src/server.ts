import type { Appearance, Item, World } from './core/contract.js';
import { JsonClient, type ClientOptions, type RequestOptions } from './http.js';
export { RequestError } from './http.js';
export type { RequestOptions } from './http.js';
export type WorldClientOptions = Omit<ClientOptions, 'baseUrl'> & {
  centralUrl: string;
  worldId: string;
  worldSecret: string;
};
export type EntryGrant = { session: string; expiresAt: number };

/** Server-only client. Keep this client, tickets and grants out of browser bundles. */
export class WorldClient {
  #http: JsonClient;
  constructor(options: WorldClientOptions) {
    if (typeof window !== 'undefined') throw new Error('WorldClient must run on your world server.');
    const url = new URL(options.centralUrl);
    const loopback =
      url.hostname === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname === '[::1]';
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new TypeError(
        'centralUrl must be an HTTPS origin (HTTP is allowed only on loopback for local development).',
      );
    if (!/^[a-z0-9-]{3,60}$/.test(options.worldId)) throw new TypeError('Invalid worldId.');
    if (typeof options.worldSecret !== 'string' || !/^[\x21-\x7e]{32,200}$/.test(options.worldSecret))
      throw new TypeError('Invalid world credential.');
    this.#http = new JsonClient(
      { baseUrl: url.origin, timeoutMs: options.timeoutMs, fetch: options.fetch },
      { authorization: `Bearer ${options.worldSecret}`, 'x-world-id': options.worldId },
      true,
    );
  }
  /** Low-level access for world adapters using additional central API routes. Never retries writes. */
  request<T>(path: string, method: 'GET' | 'POST', body?: unknown, grant?: string, options?: RequestOptions) {
    // World adapters may use newer internal routes without reimplementing credentials,
    // timeouts or redirect protection. Keep credentials confined to central API routes.
    if (!/^\/internal\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/.test(path))
      throw new TypeError('Expected an /internal/ API route.');
    return this.#http.request<T>(path, method, body, options, grant);
  }
  /** Consume a short-lived entry ticket exactly once. This call is never retried automatically. */
  exchangeTicket(ticket: string, options?: RequestOptions) {
    return this.#http.request<EntryGrant>('/internal/exchange', 'POST', { token: ticket }, options);
  }
  /** Call only after storing a local server session. Central acceptance is idempotent. */
  acceptEntry(grant: string, options?: RequestOptions) {
    return this.#http.request<{ ok: true }>('/internal/accept', 'POST', undefined, options, grant);
  }
  getAppearance(grant: string, options?: RequestOptions) {
    return this.#http.request<Appearance>('/internal/appearance', 'GET', undefined, options, grant);
  }
  getWorlds(options?: RequestOptions) {
    return this.#http.request<World[]>('/internal/worlds', 'GET', undefined, options);
  }
  getCatalogue(grant: string, options?: RequestOptions) {
    return this.#http.request<Item[]>('/internal/catalogue', 'GET', undefined, options, grant);
  }
  requestTravel(grant: string, worldId: string, options?: RequestOptions) {
    return this.#http.request<{ url: string }>('/internal/travel', 'POST', { worldId }, options, grant);
  }
  openStore(grant: string, selectedItem?: string, options?: RequestOptions) {
    return this.#http.request<{ url: string }>(
      '/internal/store',
      'POST',
      selectedItem ? { selectedItem } : {},
      options,
      grant,
    );
  }
}

import type { CharacterAppearance, CharacterAsset, CharacterPack } from './character/contract.js';
import { JsonClient, RequestError, type ClientOptions, type RequestOptions } from './http.js';

export const DEFAULT_ASSET_BASE_URL = 'https://assets.worldsbay.com';
const revisionPattern = /^[a-f0-9]{64}$/;

export type AssetClientOptions = ClientOptions;
export type CharacterPackOptions = RequestOptions & { revision?: string };

function revision(value: string) {
  if (!revisionPattern.test(value)) throw new TypeError('Expected a lowercase SHA-256 revision.');
  return value;
}

/** Public, credential-free asset discovery. No model binaries are bundled or preloaded. */
export class AssetClient {
  readonly baseUrl: string;
  #http: JsonClient;

  constructor(options: AssetClientOptions = {}) {
    const url = new URL(options.baseUrl ?? DEFAULT_ASSET_BASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw new TypeError('Asset baseUrl must be an HTTPS origin without credentials, path, query or fragment.');
    this.baseUrl = url.origin;
    this.#http = new JsonClient({ ...options, baseUrl: this.baseUrl }, {}, true);
  }

  /** Address a content-addressed GLB or PNG, never a caller-supplied URL or path. */
  assetUrl(asset: Pick<CharacterAsset, 'file' | 'sha256'>): string {
    const hash = revision(asset.sha256);
    if (asset.file !== `${hash}.glb` && asset.file !== `${hash}.png`)
      throw new TypeError('Asset filename must match its SHA-256 and use .glb or .png.');
    return `${this.baseUrl}/versions/${asset.file}`;
  }

  manifestUrl(packRevision?: string): string {
    return packRevision === undefined
      ? `${this.baseUrl}/characters/manifest.json`
      : `${this.baseUrl}/characters/packs/${revision(packRevision)}/manifest.json`;
  }

  /** Fetch metadata only; pin a revision when restoring an existing character recipe. */
  async getCharacterPack(options: CharacterPackOptions = {}): Promise<CharacterPack> {
    const path = this.manifestUrl(options.revision).slice(this.baseUrl.length);
    const pack = await this.#http.request<CharacterPack>(path, 'GET', undefined, options);
    try {
      revision(pack.revision);
      if (pack.version !== 1 || pack.profile !== 'pocket-humanoid-v2' || !pack.rigs.length)
        throw new Error('Unsupported character pack.');
      if (options.revision !== undefined && pack.revision !== options.revision)
        throw new Error('Character pack revision mismatch.');
      const bytes = new TextEncoder().encode(JSON.stringify({ ...pack, revision: '' }));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== pack.revision) throw new Error('Character pack integrity mismatch.');
      return this.resolvePack(pack);
    } catch {
      throw new RequestError('The asset service returned an invalid character pack.', 200, 'invalid-response');
    }
  }

  /** Copy metadata and replace all asset URLs with this configured CDN origin. */
  resolvePack(pack: CharacterPack): CharacterPack {
    const result = structuredClone(pack);
    revision(result.revision);
    for (const rig of result.rigs) {
      this.#resolve(rig.asset);
      this.#resolve(rig.defaultAnimations);
      for (const clip of rig.clips) this.#resolve(clip.asset);
    }
    for (const part of result.parts) {
      this.#resolve(part.asset);
      if (part.thumbnail) this.#resolve(part.thumbnail);
    }
    return result;
  }

  /** Resolve an already-authorized character; this does not authenticate an outfit. */
  resolveCharacter(character: CharacterAppearance): CharacterAppearance {
    const result = structuredClone(character);
    this.#resolve(result.rig);
    this.#resolve(result.defaultAnimations);
    for (const part of result.parts) {
      this.#resolve(part.asset);
      if (part.thumbnail) this.#resolve(part.thumbnail);
    }
    return result;
  }

  #resolve(asset: CharacterAsset) {
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1)
      throw new TypeError('Asset byte length must be a positive safe integer.');
    asset.url = this.assetUrl(asset);
  }
}

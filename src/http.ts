export type RequestOptions = { signal?: AbortSignal };
export type ClientOptions = {
  /** Same-origin world base URL, optionally including a reverse-proxy path prefix. */
  baseUrl?: string;
  /** Defaults to 8 seconds. Applies until the response body finishes. */
  timeoutMs?: number;
  /** Inject a fetch implementation, for example in tests or a server adapter. */
  fetch?: typeof globalThis.fetch;
};
export type RequestErrorCode = 'http' | 'network' | 'timeout' | 'aborted' | 'invalid-response';

export class RequestError extends Error {
  override name = 'RequestError';
  constructor(
    message: string,
    readonly status: number,
    readonly code: RequestErrorCode = 'http',
  ) {
    super(message);
  }
}

export class JsonClient {
  #base: string;
  #fetch: typeof globalThis.fetch;
  #timeout: number;
  #headers: Headers;
  #credentials: RequestCredentials;
  #server: boolean;
  constructor(options: ClientOptions, headers: HeadersInit = {}, server = false) {
    this.#base = options.baseUrl?.replace(/\/+$/, '') ?? '';
    if (this.#base) {
      const url = new URL(this.#base, 'https://relative.invalid');
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        this.#base.startsWith('//')
      )
        throw new TypeError(
          'baseUrl must be an HTTP(S) URL or an absolute path, without credentials, query or fragment.',
        );
      if (!/^https?:\/\//.test(this.#base) && !this.#base.startsWith('/'))
        throw new TypeError('Relative baseUrl must start with a slash.');
    }
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeout = options.timeoutMs ?? 8000;
    if (!Number.isInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 2147483647)
      throw new TypeError('timeoutMs must be a positive 32-bit integer.');
    this.#headers = new Headers(headers);
    this.#credentials = server ? 'omit' : 'same-origin';
    this.#server = server;
  }
  async request<T>(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    options: RequestOptions = {},
    grant?: string,
  ): Promise<T> {
    const headers = new Headers(this.#headers);
    if (grant !== undefined) headers.set('x-world-session', grant);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.#timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    try {
      signal.throwIfAborted();
      const response = await this.#fetch(this.#base + path, {
        method,
        headers,
        body: payload,
        credentials: this.#credentials,
        redirect: 'error',
        signal,
      });
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        signal.throwIfAborted();
        throw new RequestError(
          response.ok
            ? 'The service returned invalid JSON.'
            : `The request failed (HTTP ${response.status}).`,
          response.status,
          response.ok ? 'invalid-response' : 'http',
        );
      }
      if (!response.ok) {
        const message =
          !this.#server &&
          value &&
          typeof value === 'object' &&
          'error' in value &&
          typeof value.error === 'string'
            ? value.error
            : `The request failed (HTTP ${response.status}).`;
        throw new RequestError(message, response.status);
      }
      return value as T;
    } catch (error) {
      if (options.signal?.aborted) throw new RequestError('The request was cancelled.', 0, 'aborted');
      if (timeout.signal.aborted) throw new RequestError('The request timed out.', 0, 'timeout');
      if (error instanceof RequestError) throw error;
      // Do not attach raw fetch errors: adapters can include URLs or credentials.
      throw new RequestError('The service could not be reached.', 0, 'network');
    } finally {
      clearTimeout(timer);
    }
  }
}
